"""
AI 积分管家 · 声音克隆 TTS 代理（阿里云函数计算 FC · 自定义运行时 / Web 函数版）

适配你在控制台看到的配置：
  运行时：自定义运行时 / Python / Python 3.10
  启动命令：python3 app.py        监听端口：9000
  代码上传方式：使用示例代码（进去后把本文件全文替换掉示例代码）

纯 Python 标准库实现，无需 Flask、无需 requirements.txt。
实现 App 端三个接口：
  POST /clone                       body {provider,name,mime,audio:dataURI} -> {voiceId}
  GET  /synthesize?voice=&text=      -> wav 音频字节
  GET  /voice?voice=                 -> wav 音频字节（试听一句）

环境变量（FC 配置 → 环境变量）：
  阿里云百炼（provider=aliyun）：
    DASHSCOPE_API_KEY  必填，百炼 API Key（sk-ws-...）
    WORKSPACE_ID       可选，业务空间 ID；留空则走通用域名 dashscope.aliyuncs.com（推荐先用留空跑通）
    TARGET_MODEL       可选，默认 cosyvoice-v3.5-flash
  火山引擎（provider=volcengine，新版控制台，仅需 API Key）：
    VOLC_API_KEY          必填，火山 API Key（控制台→API Key管理）
    VOLC_APP_ID           可选，APP ID（合成接口可能用到，留空则用 KEY 兼作 appid）
    VOLC_CLONE_ENDPOINT   可选，默认 https://openspeech.bytedance.com/api/v3/tts/voice_clone
    VOLC_TTS_ENDPOINT     可选，默认 https://openspeech.bytedance.com/api/v1/tts
    VOLC_TTS_CLUSTER      可选，合成 cluster，默认 volcano_icl
    VOLC_LANGUAGE         可选，音色语种 0=中文(默认) 1=英文
  函数执行超时建议改成 120 秒以上（创建音色需轮询审核状态）。
"""

import os
import json
import time
import uuid
import base64
import urllib.request
import urllib.error
from urllib.parse import urlparse, parse_qs
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from http.client import HTTPException

API_KEY = os.environ.get("DASHSCOPE_API_KEY", "").strip()
WORKSPACE_ID = os.environ.get("WORKSPACE_ID", "").strip()
TARGET_MODEL = os.environ.get("TARGET_MODEL", "cosyvoice-v3.5-flash").strip() or "cosyvoice-v3.5-flash"

VOLC_API_KEY = os.environ.get("VOLC_API_KEY", "").strip()
VOLC_APP_ID = os.environ.get("VOLC_APP_ID", "").strip()
VOLC_CLONE_ENDPOINT = os.environ.get("VOLC_CLONE_ENDPOINT", "https://openspeech.bytedance.com/api/v3/tts/voice_clone").strip()
VOLC_TTS_ENDPOINT = os.environ.get("VOLC_TTS_ENDPOINT", "https://openspeech.bytedance.com/api/v1/tts").strip()
VOLC_TTS_CLUSTER = os.environ.get("VOLC_TTS_CLUSTER", "volcano_icl").strip() or "volcano_icl"
try:
    VOLC_LANGUAGE = int(os.environ.get("VOLC_LANGUAGE", "0").strip() or "0")
except ValueError:
    VOLC_LANGUAGE = 0

if WORKSPACE_ID:
    BASE = "https://%s.cn-beijing.maas.aliyuncs.com/api/v1" % WORKSPACE_ID
else:
    BASE = "https://dashscope.aliyuncs.com/api/v1"


def _post_json(path, payload, timeout=60):
    url = BASE + path
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url, data=data,
        headers={"Authorization": "Bearer " + API_KEY, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "ignore")[:500]
        raise RuntimeError("百炼 HTTP %s: %s" % (e.code, detail))
    except (urllib.error.URLError, HTTPException, TimeoutError) as e:
        raise RuntimeError("百炼请求失败: %s" % e)


def _download_bytes(url, timeout=60):
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return resp.read()


# ---------------- 火山引擎（provider=volcengine，新版 API Key）----------------
def _volc_headers(resource_id="volc.megatts.timbre"):
    # 声音复刻克隆接口用 volc.megatts.timbre；合成接口走默认，故允许覆盖。
    headers = {
        "Content-Type": "application/json",
        "X-Api-Key": VOLC_API_KEY,
        "X-Api-Request-Id": str(uuid.uuid4()),
    }
    if resource_id:
        headers["X-Api-Resource-Id"] = resource_id
    return headers


def _volc_post_json(url, payload, timeout=90, resource_id="volc.megatts.timbre"):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=_volc_headers(resource_id), method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "ignore")[:500]
        if "not granted" in detail or "45000030" in detail:
            raise RuntimeError("火山服务未授权：API Key 所属项目未开通该音色资源（正式版声音复刻服务）。请在火山控制台「开通管理」开通豆包声音复刻模型2.0 + 音色服务，或确认 API Key 属于已开通的项目。原始：" + detail)
        raise RuntimeError("火山 HTTP %s: %s" % (e.code, detail))
    except (urllib.error.URLError, HTTPException, TimeoutError) as e:
        raise RuntimeError("火山请求失败: %s" % e)


def _data_uri_to_b64(audio_data_uri):
    if "," in audio_data_uri:
        return audio_data_uri.split(",", 1)[1]
    return audio_data_uri


def _mime_to_format(mime):
    m = (mime or "").lower()
    for fmt in ("wav", "mp3", "m4a", "ogg", "aac", "pcm"):
        if fmt in m:
            return fmt
    return "wav"


def _volc_create_voice(audio_data_uri, mime, name):
    # 官方：POST /api/v3/tts/voice_clone  X-Api-Key
    # speaker_id 传空 → 系统分配 S_xxx；status 2(Success)/4(Active) 可用。
    b64 = _data_uri_to_b64(audio_data_uri)
    payload = {
        "speaker_id": "",
        "audio": {"data": b64, "format": _mime_to_format(mime)},
        "language": VOLC_LANGUAGE,
    }
    obj = _volc_post_json(VOLC_CLONE_ENDPOINT, payload, timeout=90)
    code = obj.get("code", 0)
    status = obj.get("status")
    voice_id = obj.get("speaker_id") or ""
    if not voice_id:
        raise RuntimeError("火山音色注册未返回 speaker_id: " + json.dumps(obj, ensure_ascii=False)[:300])
    if status is not None and status not in (2, 4):
        raise RuntimeError("火山音色注册未完成（status=%s）: %s" % (status, obj.get("message", "")))
    return voice_id


def _volc_synthesize(voice_id, text):
    # 官方：POST /api/v1/tts  body app/user/audio/request，返回 data=base64 音频
    appid = VOLC_APP_ID or VOLC_API_KEY
    token = VOLC_API_KEY
    payload = {
        "app": {"appid": appid, "token": token, "cluster": VOLC_TTS_CLUSTER},
        "user": {"uid": "acm-user"},
        "audio": {
            "voice_type": voice_id, "encoding": "wav", "rate": 24000,
            "speed_ratio": 1.0, "volume_ratio": 1.0, "pitch_ratio": 1.0,
        },
        "request": {
            "reqid": str(uuid.uuid4()), "text": text[:1024], "text_type": "plain",
            "operation": "query",
        },
    }
    # 合成接口：不指定 timbre 资源头（保持服务默认），让 appid/token 决定资源
    obj = _volc_post_json(VOLC_TTS_ENDPOINT, payload, timeout=60, resource_id="")
    code = obj.get("code", 0)
    if code != 3000:
        raise RuntimeError("火山合成失败（code=%s）: %s" % (code, obj.get("message", "")))
    data_b64 = obj.get("data") or ""
    if not data_b64:
        raise RuntimeError("火山合成未返回音频数据: " + json.dumps(obj, ensure_ascii=False)[:300])
    return base64.b64decode(data_b64)


def _create_voice(audio_data_uri):
    prefix = "acm" + str(int(time.time()))[-6:]
    created = _post_json("/services/audio/tts/customization", {
        "model": "voice-enrollment",
        "input": {
            "action": "create_voice",
            "target_model": TARGET_MODEL,
            "prefix": prefix,
            "audio": audio_data_uri,
            "language_hints": ["zh"],
        },
    })
    voice_id = (created.get("output") or {}).get("voice_id")
    if not voice_id:
        raise RuntimeError("创建音色未返回 voice_id: " + json.dumps(created, ensure_ascii=False)[:300])
    for _ in range(55):
        q = _post_json("/services/audio/tts/customization", {
            "model": "voice-enrollment",
            "input": {"action": "query_voice", "voice_id": voice_id},
        })
        status = (q.get("output") or {}).get("status", "")
        if status == "OK":
            return voice_id
        if status and status not in ("PENDING", "RUNNING", "DEPLOYING", "AUDITING"):
            raise RuntimeError("音色状态异常: %s" % status)
        time.sleep(1)
    raise RuntimeError("音色创建超时，请稍后在百炼控制台确认")


def _synthesize(voice_id, text):
    r = _post_json("/services/audio/tts/SpeechSynthesizer", {
        "model": TARGET_MODEL,
        "input": {"text": text[:2000], "voice": voice_id, "format": "wav", "sample_rate": 24000},
    })
    audio = (r.get("output") or {}).get("audio") or {}
    url = audio.get("url")
    if not url:
        raise RuntimeError("合成未返回音频地址: " + json.dumps(r, ensure_ascii=False)[:300])
    return _download_bytes(url)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _audio(self, data):
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _error(self, message, status=500):
        self._json({"error": str(message)[:500]}, status)

    def _ready(self, provider=""):
        if provider == "volcengine":
            if not VOLC_API_KEY:
                self._error("服务端未配置 VOLC_API_KEY", 500)
                return False
            return True
        if not API_KEY:
            self._error("服务端未配置 DASHSCOPE_API_KEY", 500)
            return False
        return True

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        path = urlparse(self.path).path.rstrip("/")
        if path != "/clone":
            self._error("未知路径: " + path, 404)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        raw = self.rfile.read(length) if length else b""
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            self._error("请求体不是合法 JSON", 400)
            return
        provider = (body.get("provider") or "").strip()
        if not self._ready(provider):
            return
        audio = body.get("audio", "")
        if not isinstance(audio, str) or not audio.startswith("data:"):
            self._error("audio 需为 data URI（data:audio/...;base64,...）", 400)
            return
        try:
            if provider == "volcengine":
                voice_id = _volc_create_voice(audio, body.get("mime") or "audio/wav", body.get("name") or "cloned")
            else:
                voice_id = _create_voice(audio)
            self._json({"voiceId": voice_id})
        except Exception as e:
            self._error(e)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        query = parse_qs(parsed.query)
        if path not in ("/synthesize", "/voice"):
            self._error("未知路径: " + path, 404)
            return
        voice = (query.get("voice") or [""])[0]
        text = (query.get("text") or [""])[0]
        provider = (query.get("provider") or [""])[0].strip()
        if not voice:
            self._error("缺少 voice 参数", 400)
            return
        if path == "/voice" and not text:
            text = "你好，这是声音克隆的试听。"
        if not text:
            self._error("缺少 text 参数", 400)
            return
        if not self._ready(provider):
            return
        try:
            if provider == "volcengine":
                audio_bytes = _volc_synthesize(voice, text)
            else:
                audio_bytes = _synthesize(voice, text)
            self._audio(audio_bytes)
        except Exception as e:
            self._error(e)

    def log_message(self, fmt, *args):
        pass  # 减少日志噪声


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 9000), Handler).serve_forever()
