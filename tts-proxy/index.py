"""
AI 积分管家 · 声音克隆 TTS 代理（阿里云函数计算 FC / HTTP 函数 · Python 3.10）

作用：把 App 的 /clone 与 /synthesize 请求转发到阿里云百炼（CosyVoice），
API Key 只作为函数环境变量保存，客户端不接触密钥。

适配 App 端接口（见 src/core/voiceClone.ts 与 src/core/tts.ts）：
  POST /clone  body: { provider, name, mime, audio: "data:audio/...;base64,..." }
               resp: { voiceId: "..." }
  GET  /synthesize?provider=aliyun&voice=<voiceId>&text=<文本>  -> 音频字节(wav)
  GET  /voice?provider=aliyun&voice=<voiceId>                  -> 音频字节(wav)（试听一句）

阿里云百炼接口（华北2 北京，声音复刻 + CosyVoice 合成）：
  POST {base}/services/audio/tts/customization      action=create_voice / query_voice
  POST {base}/services/audio/tts/SpeechSynthesizer  text + voice -> output.audio.url

需要的环境变量（在函数计算控制台配置）：
  DASHSCOPE_API_KEY  必填，百炼 API Key（sk-...）
  WORKSPACE_ID       可选，业务空间 ID；留空则走通用域名 dashscope.aliyuncs.com
  TARGET_MODEL       可选，默认 cosyvoice-v3.5-flash（创建音色免费）
  说明：也兼容旧域名 dashscope.aliyuncs.com（当 WORKSPACE_ID 为空时）。
"""

import os
import json
import time
import base64
import urllib.request
import urllib.error
from urllib.parse import parse_qs, urlencode
from http.client import HTTPException

API_KEY = os.environ.get("DASHSCOPE_API_KEY", "").strip()
WORKSPACE_ID = os.environ.get("WORKSPACE_ID", "").strip()
TARGET_MODEL = os.environ.get("TARGET_MODEL", "cosyvoice-v3.5-flash").strip() or "cosyvoice-v3.5-flash"

if WORKSPACE_ID:
    BASE = "https://%s.cn-beijing.maas.aliyuncs.com/api/v1" % WORKSPACE_ID
else:
    BASE = "https://dashscope.aliyuncs.com/api/v1"

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


def _post_json(path, payload, timeout=60):
    """向百炼 POST JSON，返回解析后的 dict；出错抛异常。"""
    url = BASE + path
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": "Bearer " + API_KEY,
            "Content-Type": "application/json",
        },
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
    """下载百炼返回的音频 URL 字节。"""
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return resp.read()


def _create_voice(audio_data_uri, name):
    """创建复刻音色，轮询到 OK，返回 voice_id。"""
    # prefix 仅允许数字字母，<=10 字符
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

    # 音色创建后需审核/部署，轮询到 OK（最多约 60 秒）
    for _ in range(60):
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
    """用复刻音色合成语音，返回 wav 字节。"""
    r = _post_json("/services/audio/tts/SpeechSynthesizer", {
        "model": TARGET_MODEL,
        "input": {
            "text": text[:2000],   # 单次合成文本上限，避免超长
            "voice": voice_id,
            "format": "wav",
            "sample_rate": 24000,
        },
    })
    audio = (r.get("output") or {}).get("audio") or {}
    url = audio.get("url")
    if not url:
        raise RuntimeError("合成未返回音频地址: " + json.dumps(r, ensure_ascii=False)[:300])
    return _download_bytes(url)


def _json_resp(start_response, obj, status="200 OK"):
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    headers = dict(CORS)
    headers["Content-Type"] = "application/json; charset=utf-8"
    headers["Content-Length"] = str(len(body))
    start_response(status, list(headers.items()))
    return [body]


def _audio_resp(start_response, data):
    headers = dict(CORS)
    headers["Content-Type"] = "audio/wav"
    headers["Content-Length"] = str(len(data))
    start_response("200 OK", list(headers.items()))
    return [data]


def _err_resp(start_response, message, status="500 Internal Server Error"):
    return _json_resp(start_response, {"error": str(message)[:500]}, status)


def handler(environ, start_response):
    """函数计算 HTTP 函数入口（WSGI 风格）。"""
    method = environ.get("REQUEST_METHOD", "GET").upper()
    path = environ.get("PATH_INFO", "/") or "/"
    query = parse_qs(environ.get("QUERY_STRING", ""))

    if method == "OPTIONS":
        return _json_resp(start_response, {})

    if not API_KEY:
        return _err_resp(start_response, "服务端未配置 DASHSCOPE_API_KEY", "500 Internal Server Error")

    try:
        if path.rstrip("/") == "/clone" and method == "POST":
            try:
                length = int(environ.get("CONTENT_LENGTH") or 0)
            except ValueError:
                length = 0
            raw = environ["wsgi.input"].read(length) if length else b""
            try:
                body = json.loads(raw.decode("utf-8"))
            except Exception:
                return _err_resp(start_response, "请求体不是合法 JSON", "400 Bad Request")
            audio = body.get("audio", "")
            if not isinstance(audio, str) or not audio.startswith("data:"):
                return _err_resp(start_response, "audio 需为 data URI（data:audio/...;base64,...）", "400 Bad Request")
            voice_id = _create_voice(audio, body.get("name", "voice"))
            return _json_resp(start_response, {"voiceId": voice_id})

        if path.rstrip("/") in ("/synthesize", "/voice") and method == "GET":
            voice = (query.get("voice") or [""])[0]
            text = (query.get("text") or [""])[0]
            if not voice:
                return _err_resp(start_response, "缺少 voice 参数", "400 Bad Request")
            if path.rstrip("/") == "/voice" and not text:
                text = "你好，这是声音克隆的试听。"
            if not text:
                return _err_resp(start_response, "缺少 text 参数", "400 Bad Request")
            data = _synthesize(voice, text)
            return _audio_resp(start_response, data)

        return _err_resp(start_response, "未知路径: " + path, "404 Not Found")
    except Exception as e:
        return _err_resp(start_response, e)
