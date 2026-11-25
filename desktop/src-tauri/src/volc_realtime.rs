// 火山引擎端到端实时语音桥接（桌面端专用）。
// 作用：① 浏览器 WebView 的 WebSocket 不能自定义鉴权 header，故用 Rust 建连；
//       ② WKWebView 不提供 getUserMedia，故用 cpal 从系统麦克风采 16kHz 单声道 PCM。
// 数据通过 Tauri 事件与前端交互：
//   前端 → Rust: start_volc_realtime(config) / send_volc_audio(pcm base64) / stop_volc_realtime
//   Rust → 前端: volc://event  {type:'asr'|'aiAudio'|'aiAudioEnd'|'status'|'error', ...}
//
// 协议：火山「端到端实时语音」v3 二进制帧（4B header + event + id + payload）。
// 本模块只做骨架与协议编解码；实际联调需用户开通服务、提供真实鉴权与音色。

use std::sync::{Arc, Mutex};
use std::time::Duration;

/// 全局会话状态：保存当前 WS 发送通道的克隆。tokio mpsc 用于把前端音频转给写线程。
pub struct VolcSession {
    pub audio_tx: tokio::sync::mpsc::Sender<Vec<u8>>,
    pub cancel: tokio::sync::watch::Sender<bool>,
}

pub struct VolcState {
    pub session: Mutex<Option<VolcSession>>,
    pub rt: Mutex<Option<tokio::runtime::Runtime>>,
}

impl VolcState {
    pub fn new() -> Self {
        Self { session: Mutex::new(None), rt: Mutex::new(None) }
    }
}

// ---------- 二进制协议编解码（纯函数，可单测） ----------

/// 大端 u32
fn be32(n: u32) -> [u8; 4] { n.to_be_bytes() }

/// 组控制事件帧: [header][eventId][payloadSize][payload]
/// header 0x11 0x14 0x10 0x00 = JSON full_client, flags has_event
pub fn build_connect_frame(event_id: u32, payload: &str) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&[0x11, 0x14, 0x10, 0x00]);
    out.extend_from_slice(&be32(event_id));
    let p = payload.as_bytes();
    out.extend_from_slice(&be32(p.len() as u32));
    out.extend_from_slice(p);
    out
}

/// 组会话事件帧: [header][eventId][sidLen][sid][payloadSize][payload]
pub fn build_session_frame(event_id: u32, session_id: &str, payload: &str) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&[0x11, 0x14, 0x10, 0x00]);
    out.extend_from_slice(&be32(event_id));
    let sid = session_id.as_bytes();
    out.extend_from_slice(&be32(sid.len() as u32));
    out.extend_from_slice(sid);
    let p = payload.as_bytes();
    out.extend_from_slice(&be32(p.len() as u32));
    out.extend_from_slice(p);
    out
}

/// 组音频帧(event=200): header 0x11 0x24 0x00 0x00, payload=原始 PCM
pub fn build_audio_frame(session_id: &str, pcm: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&[0x11, 0x24, 0x00, 0x00]);
    out.extend_from_slice(&be32(200));
    let sid = session_id.as_bytes();
    out.extend_from_slice(&be32(sid.len() as u32));
    out.extend_from_slice(sid);
    out.extend_from_slice(&be32(pcm.len() as u32));
    out.extend_from_slice(pcm);
    out
}

/// 解析下行帧 → (error_code, event_id, payload)
/// 规则: header 后按 flags 依次读 errorCode(bit3)/eventId(bit2)/sequence(bit1)/id/payload
pub fn parse_frame(data: &[u8]) -> Option<(u32, u32, Vec<u8>)> {
    if data.len() < 4 { return None; }
    let flags = data[1] & 0x0F;
    let mut off = 4usize;
    let read_u32 = |off: &mut usize| -> Option<u32> {
        if *off + 4 > data.len() { return None; }
        let v = u32::from_be_bytes([data[*off], data[*off+1], data[*off+2], data[*off+3]]);
        *off += 4;
        Some(v)
    };
    let mut error_code = 0u32;
    if flags & 0b1000 != 0 { error_code = read_u32(&mut off)?; }
    let mut event_id = 0u32;
    if flags & 0b0100 != 0 { event_id = read_u32(&mut off)?; }
    if flags & 0b0010 != 0 { let _ = read_u32(&mut off)?; } // sequence
    // 仅 session 类事件(event>=100)携带 connect_id/session_id；connect 类(event<100)不含
    if event_id >= 100 {
        let id_len = read_u32(&mut off)? as usize;
        if id_len > 0 {
            if off + id_len > data.len() { return None; }
            *(&mut off) += id_len;
        }
    }
    let payload_size = read_u32(&mut off)? as usize;
    if payload_size == 0 { return Some((error_code, event_id, vec![])); }
    if off + payload_size > data.len() { return None; }
    Some((error_code, event_id, data[off..off + payload_size].to_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connect_frame_layout() {
        let f = build_connect_frame(1, "{}");
        assert_eq!(&f[0..4], &[0x11, 0x14, 0x10, 0x00]);
        assert_eq!(u32::from_be_bytes([f[4],f[5],f[6],f[7]]), 1);
        let size = u32::from_be_bytes([f[8],f[9],f[10],f[11]]);
        assert_eq!(size as usize, 2);
        assert_eq!(&f[12..], b"{}");
    }

    #[test]
    fn audio_frame_layout() {
        let f = build_audio_frame("sid", &[1, 2, 3]);
        assert_eq!(&f[0..4], &[0x11, 0x24, 0x00, 0x00]);
        assert_eq!(u32::from_be_bytes([f[4],f[5],f[6],f[7]]), 200);
        assert_eq!(u32::from_be_bytes([f[8],f[9],f[10],f[11]]), 3); // sid len
        assert_eq!(&f[12..15], b"sid");
        assert_eq!(u32::from_be_bytes([f[15],f[16],f[17],f[18]]), 3); // pcm len
        assert_eq!(&f[19..], &[1, 2, 3]);
    }

    #[test]
    fn parse_roundtrip_connect() {
        let f = build_connect_frame(1, "{}");
        let (err, event, payload) = parse_frame(&f).unwrap();
        assert_eq!(err, 0);
        assert_eq!(event, 1);
        assert_eq!(payload, b"{}");
    }

    #[test]
    fn parse_session_frame() {
        let f = build_session_frame(100, "s1", "{\"a\":1}");
        let (_, event, payload) = parse_frame(&f).unwrap();
        assert_eq!(event, 100);
        assert_eq!(payload, b"{\"a\":1}");
    }

    #[test]
    fn parse_truncated_returns_none() {
        assert!(parse_frame(&[0x11, 0x14]).is_none());
        let f = build_connect_frame(1, "{}");
        assert!(parse_frame(&f[..f.len()-1]).is_none());
    }
}

// ---------- Tauri 命令与会话运行时 ----------

use tauri::{AppHandle, State};
use serde::Deserialize;

#[derive(Deserialize, Clone)]
pub struct VolcStartConfig {
    pub app_id: String,
    pub access_token: String,
    #[serde(default = "default_ws")]
    pub ws_url: String,
    #[serde(default = "default_resource")]
    pub resource_id: String,
    #[serde(default)]
    pub voice: String,
    #[serde(default = "default_app_key")]
    pub app_key: String,
}

fn default_ws() -> String { "wss://openspeech.bytedance.com/api/v3/realtime/dialog".into() }
fn default_resource() -> String { "volc.speech.dialog".into() }
fn default_app_key() -> String { "PlgvMymc7f3tQnJ6".into() }

fn emit(app: &AppHandle, kind: &str, text: &str) {
    let _ = app.emit("volc://event", serde_json::json!({ "type": kind, "data": text }));
}
fn emit_bin(app: &AppHandle, kind: &str, bytes: &[u8], sample_rate: u32) {
    // 音频以 base64 推给前端播放
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    let _ = app.emit("volc://event", serde_json::json!({
        "type": kind, "audio": b64, "sampleRate": sample_rate
    }));
}

/// 组装 StartSession(100) 的 payload（豆包端到端 asr+dialog+tts 配置）
fn start_session_payload(cfg: &VolcStartConfig) -> String {
    let speaker = if cfg.voice.trim().is_empty() { "zh_female_vv_jupiter_bigtts" } else { &cfg.voice };
    serde_json::json!({
        "asr": { "audio_info": { "format": "pcm", "sample_rate": 16000, "channel": 1 } },
        "dialog": {
            "bot_name": "AI助手",
            "system_role": "你是一个友好的AI助手，请用简洁易懂的中文回答。",
            "bot_personality": "你是一个友好的AI助手，请用简洁易懂的中文回答。",
            "extra": { "input_mod": "keep_alive", "model": "1.2.1.1" }
        },
        "tts": {
            "speaker": speaker,
            "audio_config": { "format": "pcm_s16le", "sample_rate": 24000, "channel": 1 }
        }
    }).to_string()
}

#[tauri::command]
pub async fn start_volc_realtime(app: AppHandle, state: State<'_, VolcState>, cfg: VolcStartConfig) -> Result<String, String> {
    if cfg.app_id.trim().is_empty() || cfg.access_token.trim().is_empty() {
        return Err("缺少 APP ID 或 Access Token".into());
    }
    // 停止已有会话
    stop_volc_realtime(state.clone()).ok();

    let connect_id = uuid::Uuid::new_v4().to_string();
    let url = format!("{}?appid={}", cfg.ws_url.trim_end_matches('/'), cfg.app_id);

    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::http::HeaderValue;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use tokio_tungstenite::tungstenite::Message;
    use tokio_tungstenite::connect_async;

    let mut req = url.into_client_request().map_err(|e| e.to_string())?;
    {
        let h = req.headers_mut();
        h.insert("X-Api-App-ID", HeaderValue::from_str(&cfg.app_id).map_err(|e| e.to_string())?);
        h.insert("X-Api-Access-Key", HeaderValue::from_str(&cfg.access_token).map_err(|e| e.to_string())?);
        h.insert("X-Api-Resource-Id", HeaderValue::from_str(&cfg.resource_id).map_err(|e| e.to_string())?);
        h.insert("X-Api-App-Key", HeaderValue::from_str(&cfg.app_key).map_err(|e| e.to_string())?);
        h.insert("X-Api-Connect-Id", HeaderValue::from_str(&connect_id).map_err(|e| e.to_string())?);
    }

    let (ws, _resp) = connect_async(req).await.map_err(|e| format!("连接火山失败：{}", e))?;
    let (mut write, mut read) = ws.split();
    emit(&app, "status", "connected");

    // StartConnection(event=1)
    write.send(Message::Binary(build_connect_frame(1, "{}"))).await.map_err(|e| e.to_string())?;

    // 会话 id 与音频通道
    let session_id = uuid::Uuid::new_v4().to_string();
    let (audio_tx, mut audio_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(64);
    let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
    let mut read_cancel = cancel_tx.subscribe();
    let mut write_cancel = cancel_tx.subscribe();

    // 读任务：解析下行事件(451 ASR / 453 文本 / 352 音频 / 359 音频结束)推给前端。
    // session 由写任务在首帧音频前发送(火山要求先 StartSession 再送音频)。
    let app_for_read = app.clone();
    let read_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = read_cancel.changed() => { break; }
                msg = read.next() => {
                    match msg {
                        Some(Ok(Message::Binary(data))) => {
                            if let Some((_err, event, payload)) = parse_frame(&data) {
                                match event {
                                    451 => {
                                        let text = String::from_utf8_lossy(&payload);
                                        emit(&app_for_read, "asr", &text);
                                    }
                                    453 => {
                                        let text = String::from_utf8_lossy(&payload);
                                        emit(&app_for_read, "ai_text", &text);
                                    }
                                    352 => emit_bin(&app_for_read, "aiAudio", &payload, 24000),
                                    359 => emit(&app_for_read, "aiAudioEnd", ""),
                                    _ => {}
                                }
                            }
                        }
                        Some(Ok(Message::Close(_))) | None => break,
                        Some(Err(e)) => { emit(&app_for_read, "error", &e.to_string()); break; }
                        _ => {}
                    }
                }
            }
        }
    });

    // 写任务：把音频通道里的 PCM 以 event=200 推送；同时负责发 StartSession
    let sid_for_write = session_id.clone();
    let session_payload = start_session_payload(&cfg);
    let write_task = tokio::spawn(async move {
        let mut session_sent = false;
        loop {
            tokio::select! {
                _ = write_cancel.changed() => {
                    let _ = write.send(Message::Binary(build_session_frame(102, &sid_for_write, "{}"))).await;
                    break;
                }
                maybe_pcm = audio_rx.recv() => {
                    match maybe_pcm {
                        Some(pcm) => {
                            if !session_sent {
                                let _ = write.send(Message::Binary(build_session_frame(100, &sid_for_write, &session_payload))).await;
                                session_sent = true;
                            }
                            if !pcm.is_empty() {
                                let _ = write.send(Message::Binary(build_audio_frame(&sid_for_write, &pcm))).await;
                            }
                        }
                        None => break,
                    }
                }
            }
        }
    });
    let _ = (read_task, write_task);

    // 保存会话（简化 state，仅用于停止标志）
    let session = VolcSession { audio_tx, cancel: cancel_tx };
    *state.session.lock().unwrap() = Some(session);

    // TODO(联调): cpal 原生麦克风采集未在此骨架启用；需按本机音频设备校准后接入。
    // 前端目前可通过 send_volc_audio 推送 PCM（Web 端若拿到流），桌面端待 cpal 校准。
    Ok("火山端到端会话已建立（骨架；麦克风采集待联调）".into())
}

#[tauri::command]
pub fn send_volc_audio(state: State<'_, VolcState>, pcm_b64: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(&pcm_b64).map_err(|e| e.to_string())?;
    let guard = state.session.lock().unwrap();
    if let Some(s) = guard.as_ref() {
        let _ = s.audio_tx.try_send(bytes);
        Ok(())
    } else { Err("没有活跃的火山语音会话".into()) }
}

#[tauri::command]
pub fn stop_volc_realtime(state: State<'_, VolcState>) -> Result<(), String> {
    if let Some(s) = state.session.lock().unwrap().take() {
        let _ = s.cancel.send(true);
    }
    Ok(())
}
