#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::time::{SystemTime, UNIX_EPOCH};
use std::sync::OnceLock;

mod dlna;

/// 进程级共享 HTTP Client：复用 TLS 连接池，避免每次调用重新握手（性能）。
/// v0.1.285 起禁用重定向：云端请求带会话令牌/自定义头，reqwest 跟随重定向时不会剥离
/// 自定义头，3xx 跳到内网/第三方会同时构成 SSRF 与凭据外泄面；官方端点本就不应重定向。
fn shared_http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("ai-credit-manager/0.1")
            .timeout(std::time::Duration::from_secs(120))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("初始化 HTTP 客户端失败")
    })
}

fn shared_provider_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("ai-credit-manager/0.1")
            .timeout(std::time::Duration::from_secs(120))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("初始化 API 代理客户端失败")
    })
}

/// 云 LLM 代理：桌面 WebView 直连云端 SSE 会被 CORS 拦截（POST /chat/completions 预检失败），
/// 由 Rust 后端带 publishableKey 头转发，收集 SSE 的 content delta 后返回完整文本。
#[tauri::command]
async fn call_cloud_llm(endpoint: String, publishable_key: String, body_json: String, conversation_id: Option<String>, access_token: Option<String>, device_id: Option<String>, origin: Option<String>) -> Result<String, String> {
    let url = format!("{}/.cloud/llm/chat/completions", endpoint.trim_end_matches('/'));
    let client = shared_http_client();
    let _: serde_json::Value = serde_json::from_str(&body_json).map_err(|e| format!("请求体非法：{}", e))?;
    let mut req = client.post(&url)
        .header("x-wb-webapp-access-key", &publishable_key)
        .header("Accept", "text/event-stream")
        .header("Content-Type", "application/json");
    if let Some(cid) = &conversation_id { req = req.header("X-Conversation-ID", cid); }
    // 网关按「设备 + Origin」绑定会话：带上与 WebView 一致的客户端身份，否则 401 invalid_grant
    if let Some(d) = &device_id { if !d.is_empty() { req = req.header("X-Device-Id", d); } }
    if let Some(o) = &origin { if !o.is_empty() { req = req.header("Origin", o); } }
    // 网关 LLM 能力要求登录：前端已登录时传入会话 token
    if let Some(token) = &access_token { if !token.is_empty() { req = req.header("Authorization", format!("Bearer {}", token)); } }
    let resp = req.body(body_json).send().await.map_err(|e| format!("请求失败：{}", e))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("读取响应失败：{}", e))?;
    if !status.is_success() { return Err(format!("云端返回 {}：{}", status.as_u16(), text.chars().take(300).collect::<String>())) }

    // 解析 SSE：逐行取 data: {...}，累加 choices[0].delta.content；
    // 思考模型可能把内容放在 reasoning_content，content 为空时回退使用它。
    let mut answer = String::new();
    let mut reasoning = String::new();
    for line in text.lines() {
        let line = line.trim();
        if !line.starts_with("data:") { continue }
        let data = line[5..].trim();
        if data == "[DONE]" { break }
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
            if let Some(delta) = json.get("choices").and_then(|c| c.get(0)).and_then(|ch| ch.get("delta")) {
                if let Some(content) = delta.get("content").and_then(|v| v.as_str()) { answer.push_str(content) }
                if let Some(reason) = delta.get("reasoning_content").and_then(|v| v.as_str()) { reasoning.push_str(reason) }
            }
        }
    }
    if answer.is_empty() { answer = reasoning; }
    if answer.is_empty() { return Err("云端未返回文本内容".into()) }
    Ok(answer)
}

/// 校验代理目标 URL，防止 SSRF 与 API Key 外泄。
/// - https：允许公网域名；字面量的内网/回环/链路本地/云元数据地址拒绝，
///   域名解析结果由 validate_resolved_public 在请求前另行校验（防解析到内网的域名）
/// - http：仅允许本机（localhost / 127.0.0.0/8 / ::1），供本地 Ollama 等模型使用
fn validate_proxy_url(raw: &str) -> Result<reqwest::Url, String> {
    let u = reqwest::Url::parse(raw).map_err(|_| "URL 格式不合法".to_string())?;
    let scheme = u.scheme();
    if scheme != "https" && scheme != "http" {
        return Err("仅允许 http(s) 协议".into())
    }
    let host = u.host_str().ok_or_else(|| "URL 缺少主机".to_string())?;
    // 本机判定必须基于解析后的 IP，禁止用 "127." 前缀匹配域名（127.0.0.1.evil.com 不是本机）
    let is_local = host == "localhost"
        || host.parse::<std::net::IpAddr>().map(|ip| ip.is_loopback()).unwrap_or(false)
        || host == "0.0.0.0";
    if scheme == "http" {
        if !is_local {
            return Err("http 仅允许本机地址（localhost / 127.0.0.1 / ::1）".into())
        }
        return Ok(u)
    }
    // https：拒绝字面量的内网/保留地址（防止 https://127.0.0.1、169.254.169.254 等绕过）
    let ip_blocked = host.parse::<std::net::IpAddr>().map(|ip| !is_public_ip(&ip)).unwrap_or(false);
    if is_local || ip_blocked {
        return Err("不允许请求内网或本机地址".into())
    }
    Ok(u)
}

/// 媒体下载校验：官方接口在已鉴权响应里返回的临时文件地址专用（如 DashScope 合成
/// 音频的 OSS 链接，带签名、会过期、下载不携带任何凭据）。这类地址常是 http，
/// 不能套用通用代理的「http 仅限本机」规则；但仍拒绝内网/回环/保留字面地址防 SSRF。
fn validate_media_url(raw: &str) -> Result<reqwest::Url, String> {
    let u = reqwest::Url::parse(raw).map_err(|_| "URL 格式不合法".to_string())?;
    let scheme = u.scheme();
    if scheme != "https" && scheme != "http" {
        return Err("仅允许 http(s) 协议".into());
    }
    let host = u.host_str().ok_or_else(|| "URL 缺少主机".to_string())?;
    let is_local = host == "localhost"
        || host.parse::<std::net::IpAddr>().map(|ip| ip.is_loopback()).unwrap_or(false)
        || host == "0.0.0.0";
    let ip_blocked = host.parse::<std::net::IpAddr>().map(|ip| !is_public_ip(&ip)).unwrap_or(false);
    if is_local || ip_blocked {
        return Err("不允许请求内网或本机地址".into());
    }
    Ok(u)
}

/// 判断 IP 是否为公网地址（用于 SSRF 防护）
fn is_public_ip(ip: &std::net::IpAddr) -> bool {
    use std::net::IpAddr;
    match ip {
        IpAddr::V4(v) => {
            let o = v.octets();
            !(o[0] == 10
                || o[0] == 127
                || o[0] == 0
                || (o[0] == 169 && o[1] == 254)
                || (o[0] == 172 && (16..=31).contains(&o[1]))
                || (o[0] == 192 && o[1] == 168)
                || (o[0] == 100 && (64..=127).contains(&o[1]))
                // 注意：198.18.0.0/15（基准测试段）刻意不拦——Clash/Surge/sing-box 的
                // fake-IP 模式会把真实域名解析到该段，拦了会让这类用户的所有外网请求全灭
                // （v0.1.286 实测：汇率面板 RPC 被误杀）；该段也不可路由到局域网设备，非 SSRF 目标。
                || (o[0] == 192 && o[1] == 0 && o[2] == 0) // 192.0.0.0/24
                || (o[0] == 192 && o[1] == 0 && o[2] == 2) // 文档示例段 TEST-NET-1/2/3
                || (o[0] == 198 && o[1] == 51 && o[2] == 100)
                || (o[0] == 203 && o[1] == 0 && o[2] == 113)
                || (o[0] >= 224))
        }
        IpAddr::V6(v) => {
            let s = v.segments();
            !v.is_loopback() && !v.is_unspecified() && !v.is_multicast()
                && (s[0] & 0xffc0) != 0xfe80 // fe80::/10 链路本地
                && (s[0] & 0xfe00) != 0xfc00 // fc00::/7 ULA
                // 拒绝 IPv4 映射的内网地址
                && v.to_ipv4().map(|x| is_public_ip(&IpAddr::V4(x))).unwrap_or(true)
        }
    }
}

/// 对已通过 validate_proxy_url 的 URL 再做一次 DNS 解析校验：域名解析结果只要含任一
/// 明确的内网/本机地址（见 is_internal_ip）即拒绝（防 *.nip.io 式域名与静态重绑定
/// 把请求引到内网/云元数据）；特殊保留段不在此列，避免误杀 fake-IP 代理用户。
/// 说明：reqwest 发请求时会再次解析，校验与连接之间仍有极小的动态重绑定窗口，
/// 但静态解析到内网的域名（现实中的绝大多数情况）会被这里拦下（v0.1.285）。
async fn validate_resolved_public(u: &reqwest::Url) -> Result<(), String> {
    use std::net::ToSocketAddrs;
    let host = match u.host_str() { Some(h) => h.to_string(), None => return Ok(()) };
    if host == "localhost" || host.parse::<std::net::IpAddr>().is_ok() { return Ok(()) }
    let port = u.port().unwrap_or(if u.scheme() == "http" { 80 } else { 443 });
    let addrs: Vec<std::net::SocketAddr> = (host.as_str(), port).to_socket_addrs()
        .map_err(|_| "域名解析失败".to_string())?.collect();
    if addrs.is_empty() { return Err("域名无有效解析结果".into()) }
    if addrs.iter().any(|a| is_internal_ip(&a.ip())) {
        return Err("域名解析到内网或保留地址，已拒绝".into())
    }
    Ok(())
}

/// DNS 解析结果专用判定：是否为「明确的内网/本机目标」（回环、RFC1918 私有段、
/// 链路本地含云元数据段、ULA、组播）。与 is_public_ip 的区别：解析校验只拦这些
/// 真正能到达局域网/本机/元数据的地址——fake-IP 代理（Clash/Surge/sing-box）会把
/// 所有真实域名解析到 198.18.0.0/15 等特殊段、连接由用户自己的代理接管，
/// 若按「非公网即拒绝」会把这类用户的全部外网请求误杀（v0.1.286 实测：
/// api.siliconflow.cn 与 open.er-api.com 在公共 DNS 均为正常公网 IP，
/// 在用户机器上被本地代理改写解析后遭误拒，模型拉取与汇率面板同时中招）。
fn is_internal_ip(ip: &std::net::IpAddr) -> bool {
    use std::net::IpAddr;
    match ip {
        IpAddr::V4(v) => {
            let o = v.octets();
            o[0] == 10
                || o[0] == 127
                || o[0] == 0
                || (o[0] == 169 && o[1] == 254)
                || (o[0] == 172 && (16..=31).contains(&o[1]))
                || (o[0] == 192 && o[1] == 168)
                || (o[0] >= 224)
        }
        IpAddr::V6(v) => {
            let s = v.segments();
            v.is_loopback() || v.is_unspecified() || v.is_multicast()
                || (s[0] & 0xffc0) == 0xfe80
                || (s[0] & 0xfe00) == 0xfc00
                || v.to_ipv4().map(|x| is_internal_ip(&IpAddr::V4(x))).unwrap_or(false)
        }
    }
}

/// 主机是否为本机/局域网地址（localhost、回环、私有段、链路本地、ULA；
/// 但云元数据段 169.254.0.0/16 永不视为本地服务）
fn is_local_host(host: &str) -> bool {
    if host == "localhost" { return true }
    match host.parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V4(v)) => {
            let o = v.octets();
            if o[0] == 169 && o[1] == 254 { return false }
            v.is_loopback() || o[0] == 10
                || (o[0] == 172 && (16..=31).contains(&o[1]))
                || (o[0] == 192 && o[1] == 168)
        }
        Ok(std::net::IpAddr::V6(v)) => {
            let s = v.segments();
            v.is_loopback()
                || (s[0] & 0xffc0) == 0xfe80
                || (s[0] & 0xfe00) == 0xfc00
                || v.to_ipv4().map(|x| is_local_host(&x.to_string())).unwrap_or(false)
        }
        Err(_) => false,
    }
}

/// 本地服务专用校验（ComfyUI / Ollama / LM Studio）：只允许 http(s) + 本机/局域网地址，
/// 拒绝公网域名与公网 IP——这类服务按定义就在用户自己的网络里（v0.1.285 SSRF 收口）。
fn validate_local_service_url(raw: &str) -> Result<String, String> {
    let u = reqwest::Url::parse(raw).map_err(|_| "URL 格式不合法".to_string())?;
    if u.scheme() != "https" && u.scheme() != "http" { return Err("仅允许 http(s) 协议".into()) }
    let host = u.host_str().ok_or_else(|| "URL 缺少主机".to_string())?;
    if !is_local_host(host) { return Err("本地服务地址只允许本机或局域网地址".into()) }
    Ok(u.to_string().trim_end_matches('/').to_string())
}

/// 通用服务地址校验（VoiceStudio 等用户自填端点）：本机/局域网走本地规则，公网走 validate_proxy_url。
fn validate_service_url(raw: &str) -> Result<String, String> {
    let u = reqwest::Url::parse(raw).map_err(|_| "URL 格式不合法".to_string())?;
    let host = u.host_str().ok_or_else(|| "URL 缺少主机".to_string())?;
    if is_local_host(host) {
        if u.scheme() != "https" && u.scheme() != "http" { return Err("仅允许 http(s) 协议".into()) }
        return Ok(u.to_string().trim_end_matches('/').to_string())
    }
    Ok(validate_proxy_url(raw)?.to_string().trim_end_matches('/').to_string())
}

/// 通用模型 API 代理：让「用自己 Key 调用」绕过桌面 CORS。
/// 安全约束：仅 http(s)，且拒绝内网/回环/保留地址（防止开放代理 SSRF 与 Key 外发）；
/// 不存储任何凭证，Key 仅用于本次请求头。生图/视频的异步任务也用此命令提交与轮询。
#[tauri::command]
async fn call_provider_api(url: String, api_key: String, body_json: String, method: String, headers_json: Option<String>) -> Result<String, String> {
    if api_key.trim().is_empty() { return Err("API Key 不能为空".into()) }
    let parsed = validate_proxy_url(&url)?;
    validate_resolved_public(&parsed).await?;
    let url = parsed.to_string();
    let m = method.to_uppercase();
    if m != "POST" && m != "GET" { return Err("仅支持 POST / GET".into()) }

    let client = shared_provider_client(); // 进程级复用；已禁用重定向，避免 302 到内网绕过 SSRF 校验

    let mut req = if m == "POST" {
        let parsed: serde_json::Value = serde_json::from_str(&body_json)
            .map_err(|e| format!("请求体不是合法 JSON：{}", e))?;
        // .json() 已自动设置 Content-Type: application/json。
        // 绝不可再手动 .header("Content-Type", ...) —— reqwest 的 header() 是「追加」语义，
        // 会产生两个 Content-Type 头（合并成 application/json, application/json），
        // DeepSeek 等严格网关会因此返回 415，而 GLM/Kimi 宽容只取第一个故正常。
        client.post(&url).json(&parsed)
    } else {
        client.get(&url)
    };
    // 只设 Authorization；Content-Type 由 .json() 唯一提供（GET 无需 Content-Type）。
    req = req.header("Authorization", format!("Bearer {}", api_key));
    // 附加业务头（如百炼视频的 X-DashScope-Async）：跳过 Authorization/Content-Type，避免覆盖与重复头。
    if let Some(hj) = headers_json.as_deref() {
        if let Ok(serde_json::Value::Object(map)) = serde_json::from_str::<serde_json::Value>(hj) {
            for (k, v) in map {
                let lk = k.to_ascii_lowercase();
                if lk == "authorization" || lk == "content-type" { continue }
                if let Some(s) = v.as_str() { req = req.header(k, s); }
            }
        }
    }

    let resp = req.send().await.map_err(|e| format!("请求失败：{}", e))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("读取响应失败：{}", e))?;
    if !status.is_success() {
        // 错误里带上实际请求的 URL 与请求体，便于定位 415 等兼容性问题（不含 api_key）
        let method = req::method_name(&m);
        return Err(format!("接口返回 {} [{} {} body={}]：{}",
            status.as_u16(), method, url,
            body_json.chars().take(300).collect::<String>(),
            text.chars().take(200).collect::<String>()))
    }
    Ok(text)
}

mod req {
    pub fn method_name(m: &str) -> &'static str {
        if m == "GET" { "GET" } else { "POST" }
    }
}

// ---------------- 插件系统（v0.1.264）：网络代理 + 桌面进程插件 ----------------

/// 插件网络代理：URL 先过 SSRF 校验（validate_proxy_url）；具体域名白名单在 TS 宿主侧
/// 按插件清单校验。与 call_provider_api 不同：不强制 Bearer 头、不要求成功状态码，
/// 状态码与响应体原样回传给插件自行判断。
#[tauri::command]
async fn plugin_http(url: String, method: String, headers_json: Option<String>, body: Option<String>) -> Result<String, String> {
    let parsed = validate_proxy_url(&url)?;
    validate_resolved_public(&parsed).await?;
    let url = parsed.to_string();
    let m = method.to_uppercase();
    let parsed_method = reqwest::Method::from_bytes(m.as_bytes())
        .map_err(|_| format!("不支持的请求方法：{}", m))?;
    let client = shared_provider_client(); // 已禁用重定向，避免 302 跳内网绕过 SSRF 校验
    let mut req = client.request(parsed_method, &url);
    if let Some(hj) = headers_json.as_deref() {
        if let Ok(serde_json::Value::Object(map)) = serde_json::from_str::<serde_json::Value>(hj) {
            for (k, v) in map {
                if let Some(s) = v.as_str() { req = req.header(k, s); }
            }
        }
    }
    if let Some(b) = body { req = req.body(b); }
    let resp = req.send().await.map_err(|e| format!("请求失败：{}", e))?;
    let status = resp.status().as_u16();
    let mut headers_map = serde_json::Map::new();
    for (k, v) in resp.headers().iter() {
        if let Ok(s) = v.to_str() { headers_map.insert(k.as_str().to_string(), serde_json::Value::String(s.to_string())); }
    }
    let text = resp.text().await.map_err(|e| format!("读取响应失败：{}", e))?;
    Ok(serde_json::json!({ "status": status, "body": text, "headers": headers_map }).to_string())
}

/// 媒体探测取正文（v0.1.411）：供看剧源体检真验流用——拉 m3u8 播放列表验分片。
/// 与 plugin_http 的区别：校验用 validate_media_url（公网 http(s) 都放行，
/// 只拦本机/内网/保留字面地址），因为直播流地址大多是 http；plugin_http 的
/// 「http 仅限本机」会把七成流地址直接拒掉（iptv-org cn.m3u 里 108/151 是 http）。
/// 同样过 validate_resolved_public（DNS 解析到内网即拒）、同样禁用重定向
/// （302 跳转由 TS 侧手动跟，每跳重新过校验）；正文分块读、封顶 256KB
/// （播放列表很小），防误指大文件拖垮内存。
#[tauri::command]
async fn plugin_http_media(url: String, headers_json: Option<String>) -> Result<String, String> {
    let parsed = validate_media_url(&url)?;
    validate_resolved_public(&parsed).await?;
    let url = parsed.to_string();
    let client = shared_provider_client();
    let mut req = client.request(reqwest::Method::GET, &url);
    if let Some(hj) = headers_json.as_deref() {
        if let Ok(serde_json::Value::Object(map)) = serde_json::from_str::<serde_json::Value>(hj) {
            for (k, v) in map {
                if let Some(s) = v.as_str() { req = req.header(k, s); }
            }
        }
    }
    let mut resp = req.send().await.map_err(|e| format!("请求失败：{}", e))?;
    let status = resp.status().as_u16();
    let mut headers_map = serde_json::Map::new();
    for (k, v) in resp.headers().iter() {
        if let Ok(s) = v.to_str() { headers_map.insert(k.as_str().to_string(), serde_json::Value::String(s.to_string())); }
    }
    let mut buf: Vec<u8> = Vec::new();
    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                buf.extend_from_slice(&chunk);
                if buf.len() >= 256 * 1024 { buf.truncate(256 * 1024); break; }
            }
            Ok(None) => break,
            Err(e) => return Err(format!("读取响应失败：{}", e)),
        }
    }
    let text = String::from_utf8_lossy(&buf).into_owned();
    Ok(serde_json::json!({ "status": status, "body": text, "headers": headers_map }).to_string())
}

// ---------------- 插件面板文档服务（v0.1.284） ----------------
// 真因记录：主窗口 CSP 是 script-src 'self'，srcdoc 子文档按规范继承嵌入方 CSP，
// 插件面板的内联脚本（桥 + 插件代码）在桌面端全被拦截——面板 HTML 能显示、点击毫无反应（v0.1.264 起）。
// 改法：面板 HTML 先经 plugin_frame_put 暂存，再让 iframe 加载自定义协议 acmplugin:// 的独立文档，
// 该文档带自己的 CSP 响应头（只放行内联脚本/样式，直连网络全禁，能力照旧走宿主 RPC）；
// iframe 的 sandbox="allow-scripts"（无 allow-same-origin）不变，插件与宿主依然不同源。
fn plugin_frames() -> &'static std::sync::Mutex<std::collections::HashMap<String, String>> {
    static FRAMES: OnceLock<std::sync::Mutex<std::collections::HashMap<String, String>>> = OnceLock::new();
    FRAMES.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

#[tauri::command]
fn plugin_frame_put(id: String, html: String) -> Result<(), String> {
    if html.len() > 5_000_000 { return Err("插件面板文档过大".into()) }
    plugin_frames().lock().map_err(|_| "面板表锁定失败".to_string())?.insert(id, html);
    Ok(())
}

#[tauri::command]
fn plugin_frame_remove(id: String) -> Result<(), String> {
    plugin_frames().lock().map_err(|_| "面板表锁定失败".to_string())?.remove(&id);
    Ok(())
}

fn plugin_frame_response(request: tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    let id = request.uri().path().rsplit('/').next().unwrap_or("").to_string();
    let html = plugin_frames().lock().ok()
        .and_then(|m| m.get(&id).cloned())
        .unwrap_or_else(|| "<!doctype html><html><body></body></html>".to_string());
    tauri::http::Response::builder()
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: https:; media-src data: blob: https:; font-src data:")
        .body(html.into_bytes())
        .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
}

/// 桌面进程插件：用户在插件清单里声明的本地命令，由用户手动启动/停止；输出留最近 300 行。
struct PluginProc {
    child: std::process::Child,
    output: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
}

fn plugin_procs() -> &'static std::sync::Mutex<std::collections::HashMap<String, PluginProc>> {
    static PROCS: OnceLock<std::sync::Mutex<std::collections::HashMap<String, PluginProc>>> = OnceLock::new();
    PROCS.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}


/// GUI 启动的 App 继承不到终端 PATH：Homebrew（/opt/homebrew/bin）与 ~/.local/bin 都不在内，
/// 裸命令名（uvx/npx）直接 spawn 会报 No such file or directory（v0.1.322，Ethan 实测 Fetch 连接失败）。
/// 这里解析命令到绝对路径（PATH + 常见 bin 目录），并给子进程一份补全后的 PATH，
/// 让 uvx/npx 再拉起的 python/node 子进程也找得到。
fn resolve_command(command: &str) -> (std::path::PathBuf, std::ffi::OsString) {
    let mut dirs: Vec<std::path::PathBuf> = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    #[cfg(unix)]
    {
        let mut extra = vec![
            std::path::PathBuf::from("/opt/homebrew/bin"),
            std::path::PathBuf::from("/usr/local/bin"),
        ];
        if let Some(home) = std::env::var_os("HOME") {
            extra.push(std::path::PathBuf::from(&home).join(".local/bin"));
            extra.push(std::path::PathBuf::from(&home).join(".cargo/bin"));
        }
        for d in extra.into_iter() {
            if !dirs.contains(&d) { dirs.insert(0, d); }
        }
    }
    let full_path = std::env::join_paths(&dirs).unwrap_or_default();
    let cmd_path = if command.contains('/') || command.contains('\\') {
        std::path::PathBuf::from(command)
    } else {
        dirs.iter().map(|d| d.join(command)).find(|cand| cand.is_file())
            .unwrap_or_else(|| std::path::PathBuf::from(command))
    };
    (cmd_path, full_path)
}

#[tauri::command]
fn plugin_process_start(id: String, command: String, args: Vec<String>) -> Result<u32, String> {
    use std::process::{Command, Stdio};
    let mut map = plugin_procs().lock().map_err(|_| "进程表锁定失败".to_string())?;
    let running = map.get_mut(&id)
        .map(|e| matches!(e.child.try_wait(), Ok(None)))
        .unwrap_or(false);
    if running { return Err("该插件进程已在运行".into()); }
    map.remove(&id);
    let (cmd_path, child_path) = resolve_command(&command);
    let mut child = Command::new(&cmd_path)
        .args(&args)
        .env("PATH", &child_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动失败：{}", e))?;
    let pid = child.id();
    let output = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    fn drain<R: std::io::Read + Send + 'static>(stream: R, buf: std::sync::Arc<std::sync::Mutex<Vec<String>>>) {
        use std::io::{BufRead, BufReader};
        std::thread::spawn(move || {
            for line in BufReader::new(stream).lines() {
                match line {
                    Ok(l) => {
                        if let Ok(mut v) = buf.lock() {
                            v.push(l);
                            if v.len() > 300 { let excess = v.len() - 300; v.drain(0..excess); }
                        }
                    }
                    Err(_) => break,
                }
            }
        });
    }
    if let Some(out) = child.stdout.take() { drain(out, output.clone()); }
    if let Some(err) = child.stderr.take() { drain(err, output.clone()); }
    map.insert(id, PluginProc { child, output });
    Ok(pid)
}

#[tauri::command]
fn plugin_process_stop(id: String) -> Result<(), String> {
    let mut map = plugin_procs().lock().map_err(|_| "进程表锁定失败".to_string())?;
    if let Some(mut entry) = map.remove(&id) {
        let _ = entry.child.kill();
        let _ = entry.child.wait();
    }
    Ok(())
}

#[tauri::command]
fn plugin_process_running(id: String) -> bool {
    let mut map = match plugin_procs().lock() { Ok(m) => m, Err(_) => return false };
    match map.get_mut(&id) {
        Some(entry) => matches!(entry.child.try_wait(), Ok(None)),
        None => false,
    }
}

#[tauri::command]
fn plugin_process_output(id: String) -> String {
    let map = match plugin_procs().lock() { Ok(m) => m, Err(_) => return String::new() };
    match map.get(&id) {
        Some(entry) => entry.output.lock().map(|v| v.join("\n")).unwrap_or_default(),
        None => String::new(),
    }
}

// ---------------- MCP 服务器 stdio 桥（v0.1.264） ----------------
// 本地 MCP 服务器就是普通子进程：JSON-RPC 按行走 stdin/stdout。
// 前端用 mcp_write 写入一行请求、用 mcp_read 轮询取走新到的 stdout 行（无需 Tauri 事件）。

struct McpProc {
    child: std::process::Child,
    stdin: std::process::ChildStdin,
    lines: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
    logs: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
}

fn mcp_procs() -> &'static std::sync::Mutex<std::collections::HashMap<String, McpProc>> {
    static PROCS: OnceLock<std::sync::Mutex<std::collections::HashMap<String, McpProc>>> = OnceLock::new();
    PROCS.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

fn mcp_drain<R: std::io::Read + Send + 'static>(stream: R, buf: std::sync::Arc<std::sync::Mutex<Vec<String>>>, cap: usize) {
    use std::io::{BufRead, BufReader};
    std::thread::spawn(move || {
        for line in BufReader::new(stream).lines() {
            match line {
                Ok(l) => {
                    if let Ok(mut v) = buf.lock() {
                        v.push(l);
                        if v.len() > cap { let excess = v.len() - cap; v.drain(0..excess); }
                    }
                }
                Err(_) => break,
            }
        }
    });
}

#[tauri::command]
fn open_external_path(path: String) -> Result<(), String> {
    // 用系统默认应用打开本机文件（文件管家「打开」按钮）：路径来自用户自己浏览的目录
    #[cfg(target_os = "macos")]
    let mut cmd = { let mut c = std::process::Command::new("open"); c.arg(&path); c };
    #[cfg(target_os = "windows")]
    let mut cmd = { let mut c = std::process::Command::new("explorer"); c.arg(&path); c };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = { let mut c = std::process::Command::new("xdg-open"); c.arg(&path); c };
    cmd.spawn().map_err(|e| format!("打开失败：{e}"))?;
    Ok(())
}

#[tauri::command]
fn mcp_start(id: String, command: String, args: Vec<String>) -> Result<u32, String> {
    use std::process::{Command, Stdio};
    let mut map = mcp_procs().lock().map_err(|_| "MCP 进程表锁定失败".to_string())?;
    let running = map.get_mut(&id)
        .map(|e| matches!(e.child.try_wait(), Ok(None)))
        .unwrap_or(false);
    if running { return Err("该 MCP 服务器已在运行".into()); }
    map.remove(&id);
    // v0.1.327 一劳永逸：@HOME@ 展开为用户主目录（Filesystem 预设默认目录，不用手填路径）；
    // Filesystem 服务器的目录参数中不存在的（如非 Mac 上的 /Applications）直接跳过，避免服务器启动即退出
    let is_filesystem = args.iter().any(|a| a.contains("@modelcontextprotocol/server-filesystem"));
    let home = std::env::var("HOME").unwrap_or_default();
    let args: Vec<String> = args.iter().map(|a| {
        if a == "@HOME@" && !home.is_empty() { home.clone() }
        else if a.starts_with("~/") && !home.is_empty() { format!("{}/{}", home, &a[2..]) }
        else { a.clone() }
    }).filter(|a| !(is_filesystem && a.starts_with('/') && !std::path::Path::new(a.as_str()).exists()))
    .collect();
    let (cmd_path, child_path) = resolve_command(&command);
    let mut child = Command::new(&cmd_path)
        .args(&args)
        .env("PATH", &child_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                format!("启动 MCP 服务器失败：命令 {} 未找到（已搜索 PATH、Homebrew 与 ~/.local/bin，请确认已安装）", command)
            } else {
                format!("启动 MCP 服务器失败：{}", e)
            }
        })?;
    let pid = child.id();
    let stdin = child.stdin.take().ok_or_else(|| "无法打开 MCP 服务器 stdin".to_string())?;
    let lines = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let logs = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    if let Some(out) = child.stdout.take() { mcp_drain(out, lines.clone(), 2000); }
    if let Some(err) = child.stderr.take() { mcp_drain(err, logs.clone(), 300); }
    map.insert(id, McpProc { child, stdin, lines, logs });
    Ok(pid)
}

#[tauri::command]
fn mcp_write(id: String, line: String) -> Result<(), String> {
    use std::io::Write;
    let mut map = mcp_procs().lock().map_err(|_| "MCP 进程表锁定失败".to_string())?;
    let entry = map.get_mut(&id).ok_or_else(|| "MCP 服务器未运行".to_string())?;
    entry.stdin.write_all(line.as_bytes()).map_err(|e| format!("写入 MCP 服务器失败：{}", e))?;
    entry.stdin.write_all(b"\n").map_err(|e| format!("写入 MCP 服务器失败：{}", e))?;
    entry.stdin.flush().map_err(|e| format!("写入 MCP 服务器失败：{}", e))?;
    Ok(())
}

/// 取走自上次读取以来新到的 stdout 行（JSON-RPC 消息，一行一条）
#[tauri::command]
fn mcp_read(id: String) -> Vec<String> {
    let map = match mcp_procs().lock() { Ok(m) => m, Err(_) => return Vec::new() };
    match map.get(&id) {
        Some(entry) => entry.lines.lock().map(|mut v| std::mem::take(&mut *v)).unwrap_or_default(),
        None => Vec::new(),
    }
}

#[tauri::command]
fn mcp_stop(id: String) -> Result<(), String> {
    let mut map = mcp_procs().lock().map_err(|_| "MCP 进程表锁定失败".to_string())?;
    if let Some(mut entry) = map.remove(&id) {
        let _ = entry.child.kill();
        let _ = entry.child.wait();
    }
    Ok(())
}

#[tauri::command]
fn mcp_running(id: String) -> bool {
    let mut map = match mcp_procs().lock() { Ok(m) => m, Err(_) => return false };
    match map.get_mut(&id) {
        Some(entry) => matches!(entry.child.try_wait(), Ok(None)),
        None => false,
    }
}

#[tauri::command]
fn mcp_logs(id: String) -> String {
    let map = match mcp_procs().lock() { Ok(m) => m, Err(_) => return String::new() };
    match map.get(&id) {
        Some(entry) => entry.logs.lock().map(|v| v.join("\n")).unwrap_or_default(),
        None => String::new(),
    }
}

/// 官方只读用量代理：仅允许白名单官方端点，绕过桌面端 CORS 限制。
/// 不接收任意 URL，防止被用作开放代理（SSRF）；不存储任何凭证。
/// 定位 Touch ID helper 二进制（开发态与打包态）
fn biometric_helper_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    if let Ok(dir) = app.path().resource_dir() {
        let p = dir.join("binaries").join("acm-biometric-aarch64-apple-darwin");
        if p.exists() { return Some(p) }
        let p2 = dir.join("acm-biometric-aarch64-apple-darwin");
        if p2.exists() { return Some(p2) }
    }
    // 开发态：从 exe 目录向上找 src-tauri/binaries（仅 debug 构建；发布构建只认 resource_dir，
    // 防止同名文件被预置到 exe 上层目录后被抢注执行，v0.1.285）
    #[cfg(debug_assertions)]
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent();
        while let Some(d) = dir {
            let p = d.join("binaries").join("acm-biometric-aarch64-apple-darwin");
            if p.exists() { return Some(p) }
            dir = d.parent();
        }
    }
    None
}

#[tauri::command]
async fn biometric_available(app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let p = biometric_helper_path(&app).ok_or("未找到指纹验证组件")?;
        let out = std::process::Command::new(p).arg("check").output()
            .map_err(|e| format!("指纹检测失败：{}", e))?;
        Ok(out.status.success())
    }
    #[cfg(not(target_os = "macos"))]
    { let _ = app; Ok(false) }
}

#[tauri::command]
async fn biometric_auth(app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let p = biometric_helper_path(&app).ok_or("未找到指纹验证组件")?;
        let out = std::process::Command::new(p).arg("auth").output()
            .map_err(|e| format!("指纹验证失败：{}", e))?;
        Ok(out.status.success())
    }
    #[cfg(not(target_os = "macos"))]
    { let _ = app; Ok(false) }
}

/// 在系统默认浏览器打开外部链接。仅允许 http(s)，防止被滥用。
/// 弹出系统文件夹选择框，返回选中目录路径（macOS 用 osascript，零依赖）
#[tauri::command]
async fn choose_save_dir() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let script = "POSIX path of (choose folder with prompt \"选择导出文件的保存位置\")";
        let out = std::process::Command::new("osascript")
            .arg("-e").arg(script).output()
            .map_err(|e| format!("打开文件夹选择失败：{}", e))?;
        if !out.status.success() {
            return Ok(None) // 用户取消
        }
        let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
        Ok(if path.is_empty() { None } else { Some(path) })
    }
    #[cfg(not(target_os = "macos"))]
    { Err("当前平台暂不支持选择保存目录，请使用默认下载".into()) }
}

/// 导出文件名净化（v0.1.285）：文件名来自文档标题/AI 生成名等不可信数据，
/// 只允许单个文件名——拒绝路径分隔符、.. 与绝对路径，防止写出目标目录之外。
fn safe_filename(filename: &str) -> Result<String, String> {
    let name = filename.trim();
    if name.is_empty() || name == "." || name == ".."
        || name.contains('/') || name.contains('\\') || name.contains('\0') {
        return Err("文件名不合法".into())
    }
    Ok(name.to_string())
}

/// iCloud Drive 文件夹路径（v0.1.336）：macOS 为 ~/Library/Mobile Documents/com~apple~CloudDocs，
/// Windows 为 iCloud for Windows 的 %USERPROFILE%\\iCloudDrive；目录不存在（未开启 iCloud Drive）返回 None
#[tauri::command]
fn icloud_drive_dir() -> Option<String> {
    if let Ok(home) = std::env::var("HOME") {
        let mac = format!("{home}/Library/Mobile Documents/com~apple~CloudDocs");
        if std::path::Path::new(&mac).is_dir() {
            return Some(mac);
        }
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        let win = format!("{profile}\\iCloudDrive");
        if std::path::Path::new(&win).is_dir() {
            return Some(win);
        }
    }
    None
}

/// 视频缩略图（v0.1.337，仅 macOS）：用系统 qlmanage 生成 QuickLook 缩略图，返回 data URL。
/// 按 路径+修改时间 哈希缓存到临时目录，重复打开不重复生成；其他平台返回错误，JS 回落图标/打开按钮。
#[tauri::command]
async fn video_thumb(path: String) -> Result<String, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        return Err("当前平台不支持生成视频缩略图".into());
    }
    #[cfg(target_os = "macos")]
    {
        let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let mut h: u64 = 1469598103934665603;
        for b in format!("{path}:{mtime}").bytes() {
            h ^= b as u64;
            h = h.wrapping_mul(1099511628211);
        }
        let dir = std::env::temp_dir().join("acm-vthumbs");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let cached = dir.join(format!("{h:x}.png"));
        if !cached.exists() {
            let _ = std::process::Command::new("qlmanage")
                .args(["-t", "-s", "512", "-o", dir.to_str().unwrap_or_default(), &path])
                .output()
                .map_err(|e| e.to_string())?;
            let base = std::path::Path::new(&path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let produced = dir.join(format!("{base}.png"));
            if !produced.exists() {
                return Err("生成缩略图失败".into());
            }
            std::fs::rename(&produced, &cached).map_err(|e| e.to_string())?;
        }
        let bytes = std::fs::read(&cached).map_err(|e| e.to_string())?;
        Ok(format!("data:image/png;base64,{}", base64_encode(&bytes)))
    }
}

/// 媒体缩略图（图库用）：与 video_thumb 同实现（qlmanage 对图片同样有效）
#[tauri::command]
async fn media_thumb(path: String) -> Result<String, String> {
    video_thumb(path).await
}

#[derive(serde::Serialize)]
struct GalleryItem {
    path: String,
    size: u64,
    mtime: u64,
}

/// 图库扫描（v0.1.339）：递归列出一个文件夹内的图片/视频文件（路径/大小/修改时间秒），
/// 跳过隐藏项，深度 ≤5、总量 ≤5000，供 AI 图库按日期分组展示
#[tauri::command]
fn gallery_scan(dir: String) -> Result<Vec<GalleryItem>, String> {
    let root = std::path::Path::new(&dir);
    if !root.is_dir() {
        return Err("文件夹不存在".into());
    }
    const EXTS: [&str; 28] = [
        "png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "heic",
        "dng", "tif", "tiff", "cr2", "cr3", "nef", "arw", "rw2", "orf",
        "mp4", "mov", "webm", "m4v", "ts", "mkv", "avi", "flv", "wmv", "mpg", "mpeg",
    ];
    let mut out: Vec<GalleryItem> = Vec::new();
    let mut stack: Vec<(std::path::PathBuf, usize)> = vec![(root.to_path_buf(), 0)];
    while let Some((d, depth)) = stack.pop() {
        if depth > 5 || out.len() >= 5000 {
            continue;
        }
        let rd = match std::fs::read_dir(&d) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for e in rd.flatten() {
            if out.len() >= 5000 {
                break;
            }
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let ft = match e.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            let p = e.path();
            if ft.is_dir() {
                stack.push((p, depth + 1));
                continue;
            }
            let ext = p
                .extension()
                .map(|x| x.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if !EXTS.contains(&ext.as_str()) {
                continue;
            }
            if let Ok(md) = e.metadata() {
                let mtime = md
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                out.push(GalleryItem {
                    path: p.to_string_lossy().to_string(),
                    size: md.len(),
                    mtime,
                });
            }
        }
    }
    Ok(out)
}

/// 在 ~/Pictures 下找 *.photoslibrary 包（v0.1.340 起；v0.1.347 抽出供数据库读取共用）
fn find_photos_library_package() -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let pics = std::path::Path::new(&home).join("Pictures");
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    let preferred = pics.join("Photos Library.photoslibrary");
    if preferred.is_dir() {
        candidates.push(preferred);
    }
    if let Ok(rd) = std::fs::read_dir(&pics) {
        for e in rd.flatten() {
            let p = e.path();
            let is_pkg = p.extension().map(|x| x == "photoslibrary").unwrap_or(false);
            if p.is_dir() && is_pkg && !candidates.contains(&p) {
                candidates.push(p);
            }
        }
    }
    for pkg in candidates {
        for sub in ["originals", "Masters"] {
            if pkg.join(sub).is_dir() {
                return Some(pkg);
            }
        }
    }
    None
}

/// Mac 照片图库原图目录：返回图库包的 originals（新版）或 Masters（旧版）目录；找不到返回空
#[tauri::command]
fn photos_library_dir() -> Option<String> {
    let pkg = find_photos_library_package()?;
    for sub in ["originals", "Masters"] {
        let d = pkg.join(sub);
        if d.is_dir() {
            return Some(d.to_string_lossy().to_string());
        }
    }
    None
}

/// 对 Photos.sqlite 跑一条查询，返回 JSON 行数组文本。
/// 先只读直读原库；失败则把库（连 -wal/-shm）复制到临时目录再查（绕开锁定/权限边角）。
fn run_photos_sqlite(db: &std::path::Path, sql: &str) -> Result<String, String> {
    let run = |path: &std::path::Path, readonly: bool| -> Result<String, String> {
        let mut cmd = std::process::Command::new("/usr/bin/sqlite3");
        cmd.arg("-json");
        if readonly {
            cmd.arg("-readonly");
        }
        cmd.arg(path).arg(sql);
        let out = cmd.output().map_err(|e| format!("sqlite3 启动失败：{e}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    };
    match run(db, true) {
        Ok(t) => Ok(t),
        Err(first) => {
            let tmp = std::env::temp_dir().join("acm-photos-db");
            let _ = std::fs::create_dir_all(&tmp);
            let copy = tmp.join("Photos.sqlite");
            let copied = std::fs::copy(db, &copy).is_ok();
            if copied {
                for suffix in ["-wal", "-shm"] {
                    let src = std::path::PathBuf::from(format!("{}{suffix}", db.to_string_lossy()));
                    if src.exists() {
                        let _ = std::fs::copy(&src, tmp.join(format!("Photos.sqlite{suffix}")));
                    }
                }
                run(&copy, false).map_err(|e| if e.is_empty() { first } else { e })
            } else {
                Err(first)
            }
        }
    }
}

const PHOTOS_SQL_FULL: &str = "SELECT ZFILENAME AS name, ZDIRECTORY AS dir, CAST(ZDATECREATED AS INTEGER) AS created, ZKIND AS kind, COALESCE(ZVIDEODURATION, 0) AS dur FROM ZASSET WHERE ZTRASHEDSTATE = 0 AND ZHIDDEN = 0 LIMIT 80000";
const PHOTOS_SQL_MIN: &str = "SELECT ZFILENAME AS name, ZDIRECTORY AS dir, CAST(ZDATECREATED AS INTEGER) AS created, ZKIND AS kind FROM ZASSET WHERE ZTRASHEDSTATE = 0 LIMIT 80000";

/// 照片数据库全量资产（v0.1.347，Ethan 选 B 方案）：读 Photos.sqlite 列出全部照片/视频，
/// 逐项核对 originals 里有没有本地原文件——没有的就是只在 iCloud 云端的项（local=false）。
#[tauri::command]
fn photos_db_assets() -> Result<serde_json::Value, String> {
    let pkg = find_photos_library_package().ok_or("未找到照片图库")?;
    let db = pkg.join("database").join("Photos.sqlite");
    if !db.exists() {
        return Err("照片图库数据库不存在".into());
    }
    let text = run_photos_sqlite(&db, PHOTOS_SQL_FULL)
        .or_else(|_| run_photos_sqlite(&db, PHOTOS_SQL_MIN))
        .map_err(|e| format!("读取照片数据库失败（可能未授权）：{e}"))?;
    let rows: Vec<serde_json::Value> = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let originals = pkg.join("originals");
    let originals = if originals.is_dir() { originals } else { pkg.join("Masters") };
    let mut assets = Vec::new();
    for r in rows {
        let name = r.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let dir = r.get("dir").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if name.is_empty() {
            continue;
        }
        let created_raw = r.get("created").and_then(|v| v.as_i64()).unwrap_or(0);
        let kind_num = r.get("kind").and_then(|v| v.as_i64()).unwrap_or(0);
        let dur = r.get("dur").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let full = originals.join(&dir).join(&name);
        let meta = std::fs::metadata(&full).ok();
        assets.push(serde_json::json!({
            "name": name,
            "dir": dir,
            "created": created_raw + 978307200,
            "kind": if kind_num == 1 { "video" } else { "image" },
            "dur": dur,
            "local": meta.is_some(),
            "size": meta.map(|m| m.len()).unwrap_or(0),
        }));
    }
    Ok(serde_json::json!({ "assets": assets }))
}

/// 照片授权探测（v0.1.347）：试读图库包与数据库计数，能触发系统授权弹窗；返回可读状态
#[tauri::command]
fn photos_access_probe() -> Result<String, String> {
    let pkg = find_photos_library_package().ok_or("未找到照片图库")?;
    std::fs::read_dir(&pkg).map_err(|e| format!("读不到图库（可能未授权）：{e}"))?;
    let db = pkg.join("database").join("Photos.sqlite");
    if db.exists() {
        let text = run_photos_sqlite(&db, "SELECT COUNT(*) AS n FROM ZASSET WHERE ZTRASHEDSTATE = 0")
            .map_err(|e| format!("数据库读不到（可能未授权）：{e}"))?;
        let rows: Vec<serde_json::Value> = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        let n = rows.first().and_then(|r| r.get("n")).and_then(|v| v.as_i64()).unwrap_or(0);
        return Ok(format!("已可读取照片图库数据库，共 {n} 项"));
    }
    Ok("已可访问图库文件夹".into())
}

/// 更新镜像源（v0.1.346）：GitHub 直连 + 国内常用加速前缀，测速选最快、慢/断自动切换
const UPDATE_MIRRORS: [&str; 4] = [
    "https://gh-proxy.com/https://github.com",
    "https://ghproxy.net/https://github.com",
    "https://ghfast.top/https://github.com",
    "https://github.com",
];
const UPDATE_REPO: &str = "Andre-xue/ai-credit-manager-optimized";

/// 测速：对每个候选源拉前 32KB，按耗时排序（失败排最后）
fn probe_mirror_order(path: &str) -> Vec<String> {
    let client = match reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .connect_timeout(std::time::Duration::from_secs(4))
        .build()
    {
        Ok(c) => c,
        Err(_) => return UPDATE_MIRRORS.iter().map(|m| format!("{m}/{UPDATE_REPO}/{path}")).collect(),
    };
    let mut scored: Vec<(u128, String)> = Vec::new();
    for m in UPDATE_MIRRORS {
        let url = format!("{m}/{UPDATE_REPO}/{path}");
        let t0 = std::time::Instant::now();
        let ok = client
            .get(&url)
            .header("Range", "bytes=0-32767")
            .send()
            .and_then(|r| r.bytes())
            .map(|b| !b.is_empty())
            .unwrap_or(false);
        let ms = if ok { t0.elapsed().as_millis() } else { u128::MAX };
        scored.push((ms, url));
    }
    scored.sort_by_key(|(ms, _)| *ms);
    scored.into_iter().map(|(_, u)| u).collect()
}

/// 更新快速安装（v0.1.346）：镜像测速下载更新包（stall 看门狗：8 秒窗口 <240KB 自动换源重下），
/// 用 SHA256SUMS.txt（尽量与安装包不同源）校验完整性，随后按平台安装：
/// macOS 解压替换 .app 并重启；Windows 运行安装器；其他平台报错由前端回退官方 updater。
#[tauri::command]
fn update_fast_install(
    app: tauri::AppHandle,
    path: String,
    file_name: String,
    on_progress: tauri::ipc::Channel<u64>,
) -> Result<String, String> {
    use sha2::Digest;
    let order = probe_mirror_order(&path);
    // 1) 取校验和：优先与安装包不同源的 SHA256SUMS.txt
    let sums_path = path
        .rsplit_once('/')
        .map(|(d, _)| format!("{d}/SHA256SUMS.txt"))
        .unwrap_or_default();
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;
    let mut expected: Option<String> = None;
    for base in UPDATE_MIRRORS {
        let url = format!("{base}/{UPDATE_REPO}/{sums_path}");
        if let Ok(r) = client.get(&url).timeout(std::time::Duration::from_secs(8)).send() {
            if let Ok(text) = r.text() {
                for line in text.lines() {
                    let mut it = line.split_whitespace();
                    if let (Some(hash), Some(name)) = (it.next(), it.next()) {
                        if name.trim_start_matches('*') == file_name {
                            expected = Some(hash.to_lowercase());
                        }
                    }
                }
            }
        }
        if expected.is_some() {
            break;
        }
    }
    let expected = expected.ok_or("拿不到官方校验和，已回退官方更新通道")?;
    // 2) 按测速顺序逐源下载，带 stall 看门狗
    let tmp_dir = std::env::temp_dir().join("acm-update");
    let _ = std::fs::create_dir_all(&tmp_dir);
    let dest = tmp_dir.join(&file_name);
    let mut used_url = String::new();
    let mut last_err = String::new();
    for url in &order {
        let _ = std::fs::remove_file(&dest);
        match download_with_watchdog(&client, url, &dest, &on_progress) {
            Ok(()) => {
                used_url = url.clone();
                break;
            }
            Err(e) => last_err = e,
        }
    }
    if used_url.is_empty() {
        return Err(format!("所有镜像下载失败：{last_err}"));
    }
    // 3) 校验完整性
    let bytes = std::fs::read(&dest).map_err(|e| e.to_string())?;
    let got = format!("{:x}", sha2::Sha256::digest(&bytes));
    if got != expected {
        return Err("更新包校验不一致，已回退官方更新通道".into());
    }
    // 4) 安装
    install_downloaded_update(&app, &dest, &file_name)?;
    Ok(used_url)
}

/// 流式下载 + stall 看门狗：每 8 秒窗口下载量 <240KB 判定太慢，中断换源
fn download_with_watchdog(
    client: &reqwest::blocking::Client,
    url: &str,
    dest: &std::path::Path,
    on_progress: &tauri::ipc::Channel<u64>,
) -> Result<(), String> {
    use std::io::{Read, Write};
    let mut resp = client.get(url).send().map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let mut file = std::fs::File::create(dest).map_err(|e| e.to_string())?;
    let mut buf = [0u8; 65536];
    let mut total: u64 = 0;
    let start = std::time::Instant::now();
    let mut window_start = std::time::Instant::now();
    let mut window_bytes: u64 = 0;
    loop {
        let n = resp.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        total += n as u64;
        window_bytes += n as u64;
        let _ = on_progress.send(total);
        if window_start.elapsed() >= std::time::Duration::from_secs(8) {
            if start.elapsed() > std::time::Duration::from_secs(10) && window_bytes < 240 * 1024 {
                return Err("该镜像速度过慢，自动切换".into());
            }
            window_start = std::time::Instant::now();
            window_bytes = 0;
        }
    }
    if total < 1024 * 1024 {
        return Err("下载内容异常过小".into());
    }
    Ok(())
}

/// 安装已下载并校验过的更新包（平台分支）
fn install_downloaded_update(app: &tauri::AppHandle, dest: &std::path::Path, file_name: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        if !file_name.ends_with(".app.tar.gz") {
            return Err("macOS 更新包格式不符".into());
        }
        let extract = std::env::temp_dir().join("acm-update-extract");
        let _ = std::fs::remove_dir_all(&extract);
        std::fs::create_dir_all(&extract).map_err(|e| e.to_string())?;
        let st = std::process::Command::new("tar")
            .args(["-xzf", &dest.to_string_lossy(), "-C", &extract.to_string_lossy()])
            .status()
            .map_err(|e| e.to_string())?;
        if !st.success() {
            return Err("更新包解压失败".into());
        }
        let new_app = find_app_bundle(&extract).ok_or("更新包里没找到 .app")?;
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let bundle = exe
            .ancestors()
            .nth(3)
            .map(|p| p.to_path_buf())
            .filter(|p| p.extension().map(|x| x == "app").unwrap_or(false))
            .ok_or("定位不到当前应用包")?;
        let backup = bundle.with_extension("app.acm-bak");
        let _ = std::fs::remove_dir_all(&backup);
        std::fs::rename(&bundle, &backup).map_err(|e| format!("替换应用失败（权限）：{e}"))?;
        if let Err(e) = std::fs::rename(&new_app, &bundle) {
            let _ = std::fs::rename(&backup, &bundle);
            return Err(format!("写入新应用失败：{e}"));
        }
        let _ = std::fs::remove_dir_all(&backup);
        std::process::Command::new("open")
            .arg(&bundle)
            .spawn()
            .map_err(|e| e.to_string())?;
        std::process::exit(0);
        #[allow(unreachable_code)]
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        if !file_name.ends_with(".exe") {
            return Err("Windows 更新包格式不符".into());
        }
        std::process::Command::new(dest).spawn().map_err(|e| e.to_string())?;
        app.exit(0);
        return Ok(());
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (app, dest, file_name);
        Err("该平台暂走官方更新通道".into())
    }
}

/// 在解压目录里找 .app（顶层或一层子目录）
fn find_app_bundle(dir: &std::path::Path) -> Option<std::path::PathBuf> {
    let rd = std::fs::read_dir(dir).ok()?;
    let mut subdirs = Vec::new();
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            if p.extension().map(|x| x == "app").unwrap_or(false) {
                return Some(p);
            }
            subdirs.push(p);
        }
    }
    for d in subdirs {
        if let Some(found) = find_app_bundle(&d) {
            return Some(found);
        }
    }
    None
}

/// 将文本文件写入指定目录
#[tauri::command]
async fn write_file_to_dir(dir: String, filename: String, content: String) -> Result<String, String> {
    use std::io::Write;
    let path = std::path::Path::new(&dir).join(safe_filename(&filename)?);
    let mut f = std::fs::File::create(&path).map_err(|e| format!("创建文件失败：{}", e))?;
    f.write_all(content.as_bytes()).map_err(|e| format!("写入失败：{}", e))?;
    Ok(path.to_string_lossy().to_string())
}

/// 写二进制文件到指定目录（content 为 base64），用于 docx / 图片等
#[tauri::command]
async fn write_binary_to_dir(dir: String, filename: String, content_base64: String) -> Result<String, String> {
    use std::io::Write;
    let bytes = base64_decode(&content_base64)?;
    let path = std::path::Path::new(&dir).join(safe_filename(&filename)?);
    let mut f = std::fs::File::create(&path).map_err(|e| format!("创建文件失败：{}", e))?;
    f.write_all(&bytes).map_err(|e| format!("写入失败：{}", e))?;
    Ok(path.to_string_lossy().to_string())
}

/// 通道同步文件读（v0.1.352，iCloud Drive 同步用）：文件不存在返回 None
#[tauri::command]
async fn sync_file_read(dir: String, filename: String) -> Result<Option<String>, String> {
    let path = std::path::Path::new(&dir).join(safe_filename(&filename)?);
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("读取失败：{}", e)),
    }
}

/// 通道同步文件写（v0.1.352）：目录不存在先建，再整体写入
#[tauri::command]
async fn sync_file_write(dir: String, filename: String, content: String) -> Result<String, String> {
    use std::io::Write;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败：{}", e))?;
    let path = std::path::Path::new(&dir).join(safe_filename(&filename)?);
    let mut f = std::fs::File::create(&path).map_err(|e| format!("创建文件失败：{}", e))?;
    f.write_all(content.as_bytes()).map_err(|e| format!("写入失败：{}", e))?;
    Ok(path.to_string_lossy().to_string())
}


// ---- 阅览方式（v0.1.306）：扫描本机能打开视频/图片的软件 + 用指定软件打开生成的媒体 ----
// macOS 按各 App 在 Info.plist 里声明的文档类型（UTI/扩展名）分类；每次调用都重新扫描，
// 新安装的软件自然会出现。非 macOS 返回空列表（设置里只剩「应用内/系统默认」）。

#[derive(serde::Serialize)]
struct MediaAppInfo {
    name: String,
    path: String,
    kinds: Vec<String>,
}

#[cfg(target_os = "macos")]
fn scan_media_apps_macos() -> Vec<MediaAppInfo> {
    use std::collections::BTreeMap;
    const VIDEO_UTIS: [&str; 10] = ["public.movie", "public.video", "public.mpeg-4", "com.apple.quicktime-movie", "public.avi", "public.mpeg", "public.3gpp", "public.3gpp2", "com.apple.protected-mpeg-4-video", "public.enhanced-definition-3gpp"];
    const IMAGE_UTIS: [&str; 12] = ["public.image", "public.jpeg", "public.png", "public.heic", "public.heif", "public.tiff", "public.gif", "com.compuserve.gif", "public.svg-image", "public.camera-raw-image", "public.avif", "com.microsoft.bmp"];
    const VIDEO_EXTS: [&str; 13] = ["mp4", "mov", "m4v", "mkv", "avi", "webm", "wmv", "flv", "mpg", "mpeg", "ts", "3gp", "rmvb"];
    const IMAGE_EXTS: [&str; 13] = ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp", "tif", "tiff", "svg", "avif", "ico"];
    let mut dirs = vec![
        "/Applications".to_string(),
        "/System/Applications".to_string(),
        "/System/Applications/Utilities".to_string(),
    ];
    if let Ok(home) = std::env::var("HOME") {
        dirs.push(format!("{home}/Applications"));
    }
    let mut found: BTreeMap<String, MediaAppInfo> = BTreeMap::new();
    for dir in dirs {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for ent in rd.flatten() {
            let path = ent.path();
            if path.extension().and_then(|e| e.to_str()) != Some("app") { continue }
            let plist = path.join("Contents/Info.plist");
            if !plist.exists() { continue }
            let Ok(out) = std::process::Command::new("/usr/bin/plutil")
                .args(["-convert", "json", "-o", "-", "--"]).arg(&plist).output() else { continue };
            if !out.status.success() { continue }
            let Ok(v) = serde_json::from_slice::<serde_json::Value>(&out.stdout) else { continue };
            // 后台代理类 App（无界面）不列入，避免噪音
            if v.get("LSUIElement").and_then(|x| x.as_bool()) == Some(true) { continue }
            if v.get("LSBackgroundOnly").and_then(|x| x.as_bool()) == Some(true) { continue }
            let name = v.get("CFBundleDisplayName").and_then(|x| x.as_str())
                .or_else(|| v.get("CFBundleName").and_then(|x| x.as_str()))
                .map(|x| x.to_string())
                .unwrap_or_else(|| path.file_stem().and_then(|x| x.to_str()).unwrap_or("").to_string());
            if name.is_empty() { continue }
            let (mut is_video, mut is_image) = (false, false);
            if let Some(types) = v.get("CFBundleDocumentTypes").and_then(|x| x.as_array()) {
                for ty in types {
                    if let Some(utis) = ty.get("LSItemContentTypes").and_then(|x| x.as_array()) {
                        for u in utis.iter().filter_map(|x| x.as_str()) {
                            if VIDEO_UTIS.contains(&u) { is_video = true }
                            if IMAGE_UTIS.contains(&u) { is_image = true }
                        }
                    }
                    if let Some(exts) = ty.get("CFBundleTypeExtensions").and_then(|x| x.as_array()) {
                        for e in exts.iter().filter_map(|x| x.as_str()) {
                            let e = e.to_lowercase();
                            if VIDEO_EXTS.contains(&e.as_str()) { is_video = true }
                            if IMAGE_EXTS.contains(&e.as_str()) { is_image = true }
                        }
                    }
                }
            }
            if !is_video && !is_image { continue }
            let path_str = path.to_string_lossy().to_string();
            let mut kinds = Vec::new();
            if is_video { kinds.push("video".to_string()) }
            if is_image { kinds.push("image".to_string()) }
            found.entry(path_str.clone()).or_insert(MediaAppInfo { name, path: path_str, kinds });
        }
    }
    let mut list: Vec<MediaAppInfo> = found.into_values().collect();
    list.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    list
}

#[tauri::command]
async fn list_media_apps() -> Result<Vec<MediaAppInfo>, String> {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(scan_media_apps_macos)
            .await
            .map_err(|e| format!("扫描本机软件失败：{e}"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(Vec::new())
    }
}

fn media_ext_for(mime: &str, kind: &str) -> &'static str {
    match mime {
        "video/mp4" => "mp4",
        "video/quicktime" => "mov",
        "video/webm" => "webm",
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => if kind == "video" { "mp4" } else { "png" },
    }
}

fn write_media_cache(bytes: &[u8], ext: &str) -> Result<std::path::PathBuf, String> {
    let dir = std::env::temp_dir().join("acm-viewer");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建缓存目录失败：{e}"))?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = dir.join(format!("media-{stamp}.{ext}"));
    std::fs::write(&path, bytes).map_err(|e| format!("写入媒体缓存失败：{e}"))?;
    Ok(path)
}

// 用指定软件（或系统默认）打开 AI 生成的媒体：source 可为 data: / http(s): / 本地路径。
#[tauri::command]
async fn open_media_external(source: String, kind: String, app_path: Option<String>) -> Result<String, String> {
    let file_path: std::path::PathBuf = if let Some(rest) = source.strip_prefix("data:") {
        let (meta, data) = rest.split_once(',').ok_or("媒体数据格式不正确")?;
        let mime = meta.split(';').next().unwrap_or("");
        let bytes = if meta.contains("base64") {
            base64_decode(data.trim())?
        } else {
            data.as_bytes().to_vec()
        };
        write_media_cache(&bytes, media_ext_for(mime, &kind))?
    } else if source.starts_with("http://") || source.starts_with("https://") {
        let resp = reqwest::get(&source).await.map_err(|e| format!("下载媒体失败：{e}"))?;
        if !resp.status().is_success() {
            return Err(format!("下载媒体失败：HTTP {}", resp.status()));
        }
        let ct = resp.headers().get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()).unwrap_or("").split(';').next().unwrap_or("").trim().to_string();
        let bytes = resp.bytes().await.map_err(|e| format!("下载媒体失败：{e}"))?;
        write_media_cache(&bytes, media_ext_for(&ct, &kind))?
    } else {
        let p = std::path::PathBuf::from(&source);
        if !p.exists() { return Err("本地媒体文件不存在".into()) }
        p
    };
    let file_str = file_path.to_string_lossy().to_string();
    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("open");
        if let Some(app) = app_path.as_deref().filter(|a| !a.is_empty()) {
            cmd.arg("-a").arg(app);
        }
        let ok = cmd.arg(&file_path).status().map(|s| s.success()).unwrap_or(false);
        if !ok { return Err("打开媒体失败：所选软件可能已卸载".into()) }
    }
    #[cfg(target_os = "windows")]
    {
        let _ = &app_path;
        let ok = std::process::Command::new("cmd").args(["/C", "start", "", &file_str]).status()
            .map(|s| s.success()).unwrap_or(false);
        if !ok { return Err("打开媒体失败".into()) }
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        let _ = &app_path;
        let ok = std::process::Command::new("xdg-open").arg(&file_path).status()
            .map(|s| s.success()).unwrap_or(false);
        if !ok { return Err("打开媒体失败".into()) }
    }
    Ok(file_str)
}

#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("仅允许 http(s) 链接".into())
    }
    // 校验 URL 不含空白与控制字符，杜绝 cmd/shell 元字符注入面
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("链接含非法字符".into())
    }
    // Windows 用 rundll32 直接交给系统处理 URL，不走 cmd，避免 &|^ 等被当作命令分隔符。
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", &url]).status();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&url).status();
    #[cfg(target_os = "linux")]
    let result = std::process::Command::new("xdg-open").arg(&url).status();
    result.map(|_| ()).map_err(|e| format!("打开浏览器失败：{}", e))
}

/// 打开客户端协议链接（v0.1.413：游戏链接直达桌面客户端）。
/// 只放行 steam:// 与 com.epicgames.launcher:// 两个 scheme，其余一律拒绝；
/// 校验不含空白与控制字符，杜绝 cmd/shell 元字符注入面。
/// 返回是否成功发起：macOS 下 `open <url>` 在没有应用注册该 scheme 时返回非 0，
/// 调用方据此回落浏览器；Windows 的 rundll32 退出码不可靠，基本总返回 true，
/// 属尽力而为（Ethan 在 Mac 上，macOS 路径是实测主线）。
#[tauri::command]
async fn open_protocol_url(url: String) -> Result<bool, String> {
    if !url.starts_with("steam://") && !url.starts_with("com.epicgames.launcher://") {
        return Err("仅允许 steam:// 与 com.epicgames.launcher:// 链接".into())
    }
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("链接含非法字符".into())
    }
    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("open").arg(&url).output()
            .map_err(|e| format!("打开客户端失败：{}", e))?;
        Ok(out.status.success())
    }
    #[cfg(target_os = "windows")]
    {
        let st = std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &url]).status()
            .map_err(|e| format!("打开客户端失败：{}", e))?;
        Ok(st.success())
    }
    #[cfg(target_os = "linux")]
    {
        let st = std::process::Command::new("xdg-open").arg(&url).status()
            .map_err(|e| format!("打开客户端失败：{}", e))?;
        Ok(st.success())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = &url;
        Ok(false)
    }
}

/// 打开系统「麦克风隐私设置」面板。目标地址固定，不接受前端传参，避免命令注入。
#[tauri::command]
async fn open_mic_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // 新系统 scheme 先跳麦克风页；再显式唤起系统设置 App 保证窗口到前台
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone").status();
        let _ = std::process::Command::new("open").args(["-a", "System Settings"]).status();
        return Ok(())
    }
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", "ms-settings:privacy-microphone"]).status();
    #[cfg(target_os = "linux")]
    let result = std::process::Command::new("xdg-open").arg("gnome-control-center privacy").status();
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    let result = Ok(std::process::ExitStatus::default());
    #[cfg(not(target_os = "macos"))]
    result.map(|_| ()).map_err(|e| format!("打开系统设置失败：{}", e))
}

/// 打开系统「语音识别隐私设置」面板（仅桌面端）。
#[tauri::command]
async fn open_speech_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition").status();
        let _ = std::process::Command::new("open").args(["-a", "System Settings"]).status();
        return Ok(())
    }
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", "ms-settings:privacy-speech"]).status();
    #[cfg(target_os = "linux")]
    let result = std::process::Command::new("xdg-open").arg("gnome-control-center privacy").status();
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    let result = Ok(std::process::ExitStatus::default());
    #[cfg(not(target_os = "macos"))]
    result.map(|_| ()).map_err(|e| format!("打开系统设置失败：{}", e))
}

/// 检测本机是否安装了指定客户端。
/// macOS：用 mdfind 按官方 bundle id 精确匹配（Spotlight 索引）；Windows：查注册表 App Paths / where。
/// 仅做只读检测，不启动任何程序。
#[tauri::command]
async fn is_app_installed(bundle_ids: Vec<String>, exe_names: Vec<String>) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        for bid in &bundle_ids {
            if bid.is_empty() { continue }
            // 允许字母数字、点、横线，防止命令注入
            if !bid.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') { continue }
            if let Ok(out) = std::process::Command::new("mdfind")
                .arg(format!("kMDItemCFBundleIdentifier == '{}'", bid)).output() {
                if !out.stdout.is_empty() { return Ok(true) }
            }
        }
        // mdfind 索引未建立时，回退检查常见安装目录（整行精确匹配 xxx.app，避免子串误判）
        if let Ok(out) = std::process::Command::new("ls").arg("/Applications").output() {
            let installed: Vec<String> = String::from_utf8_lossy(&out.stdout)
                .lines().map(|l| l.trim().to_lowercase()).collect();
            for exe in &exe_names {
                let stem = exe.trim_end_matches(".exe").to_lowercase();
                if !stem.is_empty() && installed.iter().any(|n| n == &format!("{}.app", stem)) {
                    return Ok(true)
                }
            }
        }
        Ok(false)
    }
    #[cfg(target_os = "windows")]
    {
        for exe in &exe_names {
            if exe.is_empty() { continue }
            if !exe.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == ' ') { continue }
            // 注册表 App Paths
            if let Ok(out) = std::process::Command::new("reg")
                .args(["query", &format!("HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\{}", exe)])
                .output() {
                if out.status.success() { return Ok(true) }
            }
            // PATH 中查找
            if let Ok(out) = std::process::Command::new("where").arg(exe).output() {
                if out.status.success() { return Ok(true) }
            }
        }
        Ok(false)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (bundle_ids, exe_names);
        Ok(false)
    }
}

/// 唤醒本机已安装的客户端。命中第一个可用标识即打开，返回是否成功发起。
/// 调用方应在失败时回退到官网，保证始终有可用出口。
#[tauri::command]
async fn open_local_app(bundle_ids: Vec<String>, exe_names: Vec<String>) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = &exe_names; // macOS 仅用 bundle id 唤醒
        for bid in &bundle_ids {
            if bid.is_empty() { continue }
            if !bid.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') { continue }
            if let Ok(out) = std::process::Command::new("mdfind")
                .arg(format!("kMDItemCFBundleIdentifier == '{}'", bid)).output() {
                if !out.stdout.is_empty() {
                    // status() 等待并检查退出码：bundle id 未注册时 open 会返回非 0，
                    // 避免"report 成功但没唤醒"的假阳性。
                    let ok = std::process::Command::new("open").arg("-b").arg(bid).status()
                        .map(|s| s.success()).unwrap_or(false);
                    if ok { return Ok(true) }
                }
            }
        }
        Ok(false)
    }
    #[cfg(target_os = "windows")]
    {
        for exe in &exe_names {
            if exe.is_empty() { continue }
            if !exe.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == ' ') { continue }
            if let Ok(out) = std::process::Command::new("where").arg(exe).output() {
                if out.status.success() {
                    std::process::Command::new("cmd").args(["/C", "start", "", exe]).spawn()
                        .map_err(|e| format!("唤醒客户端失败：{}", e))?;
                    return Ok(true)
                }
            }
        }
        Ok(false)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (bundle_ids, exe_names);
        Ok(false)
    }
}

#[tauri::command]
async fn send_notification(title: String, body: String) -> Result<(), String> {
    // 用系统原生命令发通知，避免引入额外 crate（本机无外网时也能编译）。
    // 转义双引号与反斜杠，防止 AppleScript 注入。
    let esc = |s: &str| s.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        "display notification \"{}\" with title \"AI 魔方\" subtitle \"{}\"",
        esc(&body), esc(&title)
    );
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("osascript")
            .arg("-e").arg(&script)
            .output()
            .map_err(|e| format!("发送通知失败：{}", e))?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = script;
        Err("当前平台暂未实现系统通知".into())
    }
}

#[tauri::command]
async fn proxy_usage(provider: String, api_key: String) -> Result<serde_json::Value, String> {
    if api_key.trim().is_empty() {
        return Err("API Key 不能为空".into())
    }
    let (url, need_range): (&str, bool) = match provider.as_str() {
        "openai" => ("https://api.openai.com/v1/organization/usage/completions", true),
        "anthropic" => ("https://api.anthropic.com/v1/usage", false),
        "deepseek" => ("https://api.deepseek.com/user/balance", false),
        "kim" => ("https://api.moonshot.cn/v1/users/me/balance", false),
        "siliconflow" => ("https://api.siliconflow.cn/v1/user/info", false),
        "openrouter" => ("https://openrouter.ai/api/v1/auth/key", false),
        _ => return Err(format!("平台 {} 不支持官方只读用量 API", provider)),
    };

    let client = shared_http_client();
    let mut req = client.get(url).header("Authorization", format!("Bearer {}", api_key));
    if need_range {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_secs();
        req = req.query(&[("start_time", (now - 30 * 24 * 3600).to_string())]);
    }

    let resp = req.send().await.map_err(|e| format!("请求官方接口失败：{}", e))?;
    let status = resp.status();
    if !status.is_success() {
        // 带上平台返回体片段（如 {"message":"Token is invalid."}），用户一眼能看出是 Key 无效还是权限问题
        let body = resp.text().await.unwrap_or_default();
        let snippet: String = body.chars().take(140).collect();
        return Err(format!("官方接口返回 {}：{}", status.as_u16(), snippet))
    }
    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("解析响应失败：{}", e))
}

/// 本地服务 HTTP 指纹判定：Ollama GET /api/tags 返回 {"models":[...]}
fn fp_ollama(v: &serde_json::Value) -> bool { v.get("models").is_some() }
/// ComfyUI GET /system_stats 返回 {"system":...,"devices":...}
fn fp_comfyui(v: &serde_json::Value) -> bool { v.get("system").is_some() && v.get("devices").is_some() }
/// LM Studio GET /v1/models 返回 OpenAI 格式 {"data":[...]}
fn fp_lmstudio(v: &serde_json::Value) -> bool { v.get("data").is_some() }

/// Qwen3-TTS /health 指纹：status ok 且带 model 字段（只认 status 的话无关 Web 服务也常回 ok）
fn fp_qwentts(v: &serde_json::Value) -> bool {
    v.get("status").and_then(|s| s.as_str()) == Some("ok") && v.get("model").is_some()
}

/// 探测本机正在运行的本地模型服务（Ollama / ComfyUI / LM Studio 等）。
/// 不再仅凭 TCP 端口开放就认定（会把占用 8080/5000 的无关程序误报为本地服务），
/// 而是对每个候选地址发真实 HTTP 请求做指纹校验，只有响应匹配服务特征才返回。
/// 返回实际可连接的网关地址与端口，前端只读展示、不可修改。
#[tauri::command]
async fn detect_local_services() -> Result<Vec<serde_json::Value>, String> {
    use std::time::Duration;

    // 探测专用短超时客户端：本地服务应快速响应，避免无关端口拖慢整体探测
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(1200))
        .connect_timeout(Duration::from_millis(300))
        .build()
        .map_err(|e| format!("初始化探测客户端失败：{}", e))?;

    // (服务名, 指纹路径, 判定函数)：对候选地址依次尝试，命中即确认服务类型
    let fingerprints: &[(&str, &str, fn(&serde_json::Value) -> bool)] = &[
        ("Ollama", "/api/tags", fp_ollama),
        ("ComfyUI", "/system_stats", fp_comfyui),
        ("LM Studio", "/v1/models", fp_lmstudio),
    ];

    // 候选端口：各服务默认端口 + 常见自定义端口（覆盖大多数本机部署习惯）
    let ports: &[u16] = &[
        11434, 11435, 11436, // Ollama 默认及常见自定义
        8188, 8189, 8288,    // ComfyUI 默认及常见自定义
        1234, 1235,          // LM Studio 默认及常见自定义
        5000, 5001, 8000, 8080, 7860, 3000, // 通用本地端口（需指纹命中才返回）
    ];
    // 各端口并行探测：此前串行逐个端口×双主机×三指纹试，最坏要等几十秒，
    // 添加本地模型的表单长时间卡在「正在探测本机服务…」像检测不到服务（v0.1.256 改并行）
    let mut handles = Vec::new();
    for &port in ports {
        let client = client.clone();
        let fps: Vec<(&str, &str, fn(&serde_json::Value) -> bool)> = fingerprints.to_vec();
        handles.push(tauri::async_runtime::spawn(async move {
            for host in ["127.0.0.1", "localhost"] {
                for (service, path, check) in &fps {
                    let url = format!("http://{}:{}{}", host, port, path);
                    if let Ok(resp) = client.get(&url).send().await {
                        if resp.status().is_success() {
                            if let Ok(json) = resp.json::<serde_json::Value>().await {
                                if check(&json) {
                                    let h = if host == "localhost" { "127.0.0.1" } else { host };
                                    return Some(serde_json::json!({
                                        "service": service,
                                        "host": h,
                                        "port": port,
                                        "url": format!("http://{}:{}", h, port),
                                    }));
                                }
                            }
                        }
                    }
                }
            }
            None
        }));
    }
    let mut found: Vec<serde_json::Value> = Vec::new();
    for h in handles {
        if let Ok(Some(v)) = h.await { found.push(v) }
    }
    Ok(found)
}

/// 从 macOS `sysctl -n hw.memsize` 的输出（字节数）解析物理内存 GB
fn parse_memsize_bytes_macos(out: &str) -> Option<f64> {
    let bytes: u64 = out.trim().parse().ok()?;
    Some(bytes as f64 / (1024.0 * 1024.0 * 1024.0))
}

/// 从 Linux /proc/meminfo 的 MemTotal 行解析物理内存 GB（kB → GB）
fn parse_meminfo_linux(out: &str) -> Option<f64> {
    for line in out.lines() {
        if let Some(rest) = line.strip_prefix("MemTotal:") {
            let kb: f64 = rest.split_whitespace().next()?.parse().ok()?;
            return Some(kb / 1024.0 / 1024.0)
        }
    }
    None
}

/// 读取本机物理内存 GB（桌面端）。失败返回 0，前端按 8G 保守档处理。
#[tauri::command]
fn get_system_memory_gb() -> f64 {
    use std::process::Command;
    let out = {
        #[cfg(target_os = "macos")]
        { Command::new("sysctl").args(["-n", "hw.memsize"]).output().ok().and_then(|o| String::from_utf8(o.stdout).ok()).and_then(|s| parse_memsize_bytes_macos(&s)) }
        #[cfg(target_os = "linux")]
        { std::fs::read_to_string("/proc/meminfo").ok().and_then(|s| parse_meminfo_linux(&s)) }
        #[cfg(target_os = "windows")]
        { Command::new("wmic").args(["computersystem", "get", "TotalPhysicalMemory", "/value"]).output().ok().and_then(|o| String::from_utf8(o.stdout).ok()).and_then(|s| s.split('=').nth(1).map(|x| x.trim().to_string())).and_then(|n| n.parse::<u64>().ok()).map(|b| b as f64 / (1024.0*1024.0*1024.0)) }
        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
        { None::<f64> }
    };
    out.unwrap_or(0.0)
}

// ==================== Qwen3-TTS 本地服务（MLX 后端，仅 Apple 芯片 Mac） ====================
// 首次安装与服务管理：venv 在 ~/.ai-credit-manager/qwen-tts/.venv，模型走 HF 缓存。

/// Qwen3-TTS 本机服务端口（mlx-tts-server 默认 8000 易撞，改用专属端口）
const QWENTTS_PORT: u16 = 18123;
/// MLX 量化版 Base 模型（官方 mlx-tts-server 支持表内 0.6B 克隆档；权重约 1GB）
const QWENTTS_MODEL: &str = "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit";
const QWENTTS_URL: &str = "http://127.0.0.1:18123";

/// Qwen3-TTS 本机目录：~/.ai-credit-manager/qwen-tts（venv + 服务日志）
fn qwentts_dir() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    std::path::Path::new(&home).join(".ai-credit-manager").join("qwen-tts")
}

fn qwentts_venv_bin() -> std::path::PathBuf {
    qwentts_dir().join(".venv").join("bin")
}

/// HF 缓存里的 MLX 模型是否已下载（snapshot_download 默认缓存位置）
fn qwentts_model_cached() -> bool {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let dir = std::path::Path::new(&home)
        .join(".cache").join("huggingface").join("hub")
        .join("models--mlx-community--Qwen3-TTS-12Hz-0.6B-Base-4bit");
    dir.join("snapshots").exists()
}

/// 检测单个本地服务是否正在运行（HTTP 指纹校验，返回服务实际地址或 null）。
/// key: ollama / comfyui / lmstudio / qwentts
#[tauri::command]
async fn check_local_service(key: String) -> Option<String> {
    use std::time::Duration;
    let (ports, path, check): (&[u16], &str, fn(&serde_json::Value) -> bool) = match key.as_str() {
        "ollama" => (&[11434, 11435, 11436], "/api/tags", fp_ollama),
        "comfyui" => (&[8188, 8189, 8288], "/system_stats", fp_comfyui),
        "lmstudio" => (&[1234, 1235], "/v1/models", fp_lmstudio),
        "qwentts" => (&[QWENTTS_PORT], "/health", fp_qwentts),
        _ => return None,
    };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(1000))
        .connect_timeout(Duration::from_millis(250))
        .build()
        .ok()?;
    // 各端口并行探测：旧版顺序逐个敲，服务未启动时要挨个等超时（最坏 6 秒以上），
    // 弹窗会长时间停在「正在探测」。并行后按端口优先级取第一个命中。
    let mut handles = Vec::new();
    for &port in ports {
        let client = client.clone();
        let path = path.to_string();
        handles.push(tauri::async_runtime::spawn(async move {
            for host in ["127.0.0.1", "localhost"] {
                let url = format!("http://{}:{}{}", host, port, path);
                if let Ok(resp) = client.get(&url).send().await {
                    if resp.status().is_success() {
                        if let Ok(json) = resp.json::<serde_json::Value>().await {
                            if check(&json) {
                                return Some(port);
                            }
                        }
                    }
                }
            }
            None
        }));
    }
    for h in handles {
        if let Ok(Some(port)) = h.await {
            return Some(format!("http://127.0.0.1:{}", port));
        }
    }
    None
}

/// App 自己启动的本地服务 PID 记录文件路径：~/.ai-credit-manager/local-services.json
fn managed_pids_path() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    std::path::Path::new(&home).join(".ai-credit-manager").join("local-services.json")
}

/// 读取 App 启动的服务 PID 映射：{ "ollama": 1234, "comfyui": 5678 }
fn load_managed_pids() -> std::collections::HashMap<String, u32> {
    let path = managed_pids_path();
    std::fs::read_to_string(path).ok()
        .and_then(|s| serde_json::from_str::<std::collections::HashMap<String, u32>>(&s).ok())
        .unwrap_or_default()
}

/// 保存 App 启动的服务 PID 映射
fn save_managed_pids(map: &std::collections::HashMap<String, u32>) {
    let path = managed_pids_path();
    if let Some(dir) = path.parent() { let _ = std::fs::create_dir_all(dir); }
    if let Ok(json) = serde_json::to_string(map) { let _ = std::fs::write(path, json); }
}

/// 判断某进程是否仍在运行（macOS/Linux kill -0；Windows 用 tasklist）
fn pid_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        use std::process::Command;
        Command::new("kill").arg("-0").arg(pid.to_string()).status().map(|s| s.success()).unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        use std::process::Command;
        let out = Command::new("tasklist").args(["/FI", &format!("PID eq {}", pid)]).output().ok();
        out.map(|o| String::from_utf8_lossy(&o.stdout).contains(&pid.to_string())).unwrap_or(false)
    }
}

/// 查监听某 TCP 端口的进程 PID 列表（unix 用 lsof；Windows 返回空，走 managed PID 路径）
fn port_listener_pids(port: u16) -> Vec<u32> {
    #[cfg(unix)]
    {
        use std::process::Command;
        match Command::new("lsof").args(["-ti", &format!("tcp:{}", port), "-sTCP:LISTEN"]).output() {
            Ok(o) => String::from_utf8_lossy(&o.stdout)
                .lines().filter_map(|l| l.trim().parse().ok()).collect(),
            Err(_) => Vec::new(),
        }
    }
    #[cfg(not(unix))]
    { Vec::new() }
}

/// 向进程发送信号：force=false 为常规终止（SIGTERM），true 为强制结束（SIGKILL；Windows 恒为 taskkill /F）
fn signal_pid(pid: u32, force: bool) -> bool {
    use std::process::Command;
    #[cfg(unix)]
    {
        let mut cmd = Command::new("kill");
        if force { cmd.arg("-9"); }
        cmd.arg(pid.to_string()).status().map(|s| s.success()).unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        let _ = force;
        Command::new("taskkill").args(["/PID", &pid.to_string(), "/F"]).status().map(|s| s.success()).unwrap_or(false)
    }
}

/// 轮询等待进程退出，最多等 max_ms；返回等待结束时仍存活的 PID
fn wait_pids_exit(pids: &[u32], max_ms: u64) -> Vec<u32> {
    let mut remaining: Vec<u32> = pids.to_vec();
    let mut waited = 0u64;
    while !remaining.is_empty() && waited < max_ms {
        std::thread::sleep(std::time::Duration::from_millis(200));
        waited += 200;
        remaining.retain(|p| pid_alive(*p));
    }
    remaining
}

/// 确认式停止一组进程：先 SIGTERM 并等待退出（≤2s），未退出的 SIGKILL 再等一轮（≤1s）。
/// 返回 (已确认退出的 PID, 其中被强制结束的 PID, 仍存活的 PID)
fn stop_pids_confirmed(pids: &[u32]) -> (Vec<u32>, Vec<u32>, Vec<u32>) {
    for pid in pids { signal_pid(*pid, false); }
    let alive = wait_pids_exit(pids, 2000);
    if alive.is_empty() { return (pids.to_vec(), Vec::new(), Vec::new()); }
    for pid in &alive { signal_pid(*pid, true); }
    let still = wait_pids_exit(&alive, 1000);
    let forced: Vec<u32> = alive.iter().copied().filter(|p| !still.contains(p)).collect();
    let graceful: Vec<u32> = pids.iter().copied().filter(|p| !alive.contains(p)).collect();
    let mut done = graceful;
    done.extend(forced.iter().copied());
    (done, forced, still)
}

/// 读取进程的命令行（ps -o command=）；失败返回空串
fn pid_command(pid: u32) -> String {
    #[cfg(unix)]
    {
        use std::process::Command;
        Command::new("ps").args(["-p", &pid.to_string(), "-o", "command="]).output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default()
    }
    #[cfg(not(unix))]
    { String::new() }
}

/// Ollama 桌面应用是否在运行（macOS：进程名恰为 Ollama）
fn ollama_app_running() -> bool {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("pgrep").args(["-x", "Ollama"]).output().map(|o| !o.stdout.is_empty()).unwrap_or(false)
    }
    #[cfg(not(target_os = "macos"))]
    { false }
}

/// 退出 Ollama 桌面应用。必要性：该应用会守护自己的服务进程，应用不退出时，
/// 关开关杀掉的 11434 服务会被它重新拉回来，达不到「关掉就停、不常驻」。
/// 返回退出前它是否在运行。
fn quit_ollama_app() -> bool {
    if !ollama_app_running() { return false; }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let _ = Command::new("pkill").args(["-x", "Ollama"]).status();
        let mut waited = 0;
        while ollama_app_running() && waited < 2000 {
            std::thread::sleep(std::time::Duration::from_millis(200));
            waited += 200;
        }
    }
    true
}

/// Ollama CLI 可执行路径：Homebrew（Apple Silicon / Intel）与桌面应用自带 CLI，取第一个存在的
fn ollama_program() -> String {
    for p in ["/opt/homebrew/bin/ollama", "/usr/local/bin/ollama", "/Applications/Ollama.app/Contents/Resources/ollama"] {
        if std::path::Path::new(p).exists() { return p.to_string(); }
    }
    "/opt/homebrew/bin/ollama".to_string()
}

/// 某服务是否由本 App 启动且仍在运行（供前端决定是否显示"停止"按钮）
#[tauri::command]
fn is_service_app_managed(key: String) -> bool {
    load_managed_pids().get(&key).copied().map(pid_alive).unwrap_or(false)
}

/// 启动本机本地模型服务的后台进程（不打开 GUI 窗口，不改系统自启）。
/// Ollama: ollama serve；ComfyUI: venv python main.py --listen 127.0.0.1 --port 8188。
/// 成功启动后记录 PID，仅这些由 App 启动的进程可被 stop_local_service 停止。
#[tauri::command]
fn start_local_service(key: String, launch_desktop: bool) -> Result<String, String> {
    use std::process::{Command, Stdio};
    // Comfy Desktop 拉起模式（设置开关）：不走命令行 venv 路径，改为打开桌面应用，
    // 实例由用户在应用内点开；不记录 managed PID（没有可管理的子进程）。
    if key == "comfyui" && launch_desktop {
        #[cfg(target_os = "macos")]
        {
            for app_name in ["Comfy Desktop", "ComfyUI"] {
                let ok = Command::new("open").args(["-a", app_name]).status().map(|s| s.success()).unwrap_or(false);
                if ok {
                    return Ok(format!("已打开 {}，请在其中打开你的实例；实例启动后本 App 会自动识别", app_name));
                }
            }
            return Err("未找到 Comfy Desktop 应用（已尝试 Comfy Desktop / ComfyUI 两个名称）".to_string());
        }
        #[cfg(not(target_os = "macos"))]
        {
            return Err("拉起 Comfy Desktop 仅支持 macOS".to_string());
        }
    }
    // 若已在运行（无论谁启动），不重复启动
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let (program, args, work_dir, guide): (String, Vec<String>, String, &str) = match key.as_str() {
        "ollama" => (
            ollama_program(),
            vec!["serve".to_string()],
            home.clone(),
            "Ollama 后台服务将在 11434 端口运行",
        ),
        "comfyui" => {
            let py = format!("{}/ComfyUI/venv/bin/python", home);
            let main = format!("{}/ComfyUI/main.py", home);
            if !std::path::Path::new(&py).exists() || !std::path::Path::new(&main).exists() {
                return Err("未找到 ComfyUI（venv 或 main.py 缺失），请确认安装路径为 ~/ComfyUI".to_string())
            }
            (
                py,
                vec![main, "--listen".to_string(), "127.0.0.1".to_string(), "--port".to_string(), "8188".to_string()],
                format!("{}/ComfyUI", home),
                "ComfyUI 后台服务将在 8188 端口运行",
            )
        }
        "lmstudio" => return Err("LM Studio 无 CLI 后台启动方式，请在 LM Studio 应用内手动开启本地服务器".to_string()),
        "qwentts" => {
            // 前置检查：venv 与模型必须已由「首次安装」准备好，否则拒绝并指路（不在开关里现下 1GB）
            let bin = qwentts_venv_bin().join("mlx-tts");
            if !bin.exists() {
                return Err("Qwen3-TTS 未安装：请先到「语音配置 → Qwen3-TTS 本地克隆」点「首次安装」完成准备（约下载 1GB 模型）".to_string());
            }
            if !qwentts_model_cached() {
                return Err("Qwen3-TTS 模型尚未下载：请先到「语音配置 → Qwen3-TTS 本地克隆」点「首次安装」完成下载（约 1GB）".to_string());
            }
            (
                bin.to_string_lossy().to_string(),
                vec!["serve".to_string(), QWENTTS_MODEL.to_string(), "--host".to_string(), "127.0.0.1".to_string(), "--port".to_string(), QWENTTS_PORT.to_string()],
                qwentts_dir().to_string_lossy().to_string(),
                "Qwen3-TTS 本地服务将在 18123 端口运行，模型加载约 5~30 秒",
            )
        }
        _ => return Err("未知服务".to_string()),
    };
    if !std::path::Path::new(&program).exists() {
        return Err(format!("未找到启动程序 {}，请确认已安装", program))
    }
    // Qwen3-TTS 的服务输出写进日志文件（起不来时在语音配置页可看到原因），其他服务沿用静默
    let (mut cmd_out, mut cmd_err) = (Stdio::null(), Stdio::null());
    if key == "qwentts" {
        let log = qwentts_dir().join("server.log");
        if let Some(dir) = log.parent() { let _ = std::fs::create_dir_all(dir); }
        if let Ok(f) = std::fs::File::create(&log) {
            if let Ok(f2) = f.try_clone() { cmd_out = Stdio::from(f); cmd_err = Stdio::from(f2); }
        }
    }
    let child = Command::new(&program)
        .args(&args)
        .current_dir(work_dir)
        .stdin(Stdio::null()).stdout(cmd_out).stderr(cmd_err)
        .spawn()
        .map_err(|e| format!("启动失败：{}", e))?;
    let mut pids = load_managed_pids();
    pids.insert(key.clone(), child.id());
    save_managed_pids(&pids);
    let display = match key.as_str() { "qwentts" => "Qwen3-TTS", _ => key.as_str() };
    Ok(format!("已启动 {} 后台进程（PID {}），请稍候点击「重新检测」。{}", display, child.id(), guide))
}

/// 停止由本 App 启动的本地服务进程；仅处理记录中的 PID，不碰用户手动启动的服务。
/// 确认式：发终止信号后等待进程真的退出，未退出则强制结束，并如实报告结果。
#[tauri::command]
fn stop_local_service(key: String) -> Result<String, String> {
    let mut pids = load_managed_pids();
    let pid = match pids.remove(&key) {
        Some(p) => p,
        None => return Err("该服务不是由本 App 启动的，为不影响其他软件，请在其应用内自行关闭".to_string()),
    };
    save_managed_pids(&pids);
    if !pid_alive(pid) {
        return Ok(format!("服务进程（PID {}）已不在运行，记录已清理", pid));
    }
    let (_done, forced, still) = stop_pids_confirmed(&[pid]);
    if !still.is_empty() {
        return Err(format!("进程 {} 经强制结束仍未退出，可能需要管理员权限手动处理", pid));
    }
    if forced.is_empty() {
        Ok(format!("已停止由本 App 启动的 {} 服务（PID {}，已确认进程退出，内存已释放）", key, pid))
    } else {
        Ok(format!("已停止由本 App 启动的 {} 服务（PID {}，常规终止未退出已强制结束，已确认进程退出，内存已释放）", key, pid))
    }
}

/// 服务默认端口映射（用于按端口定位并停止外部启动的服务进程）
fn service_port(key: &str) -> Option<u16> {
    match key {
        "ollama" => Some(11434),
        "comfyui" => Some(8188),
        "lmstudio" => Some(1234),
        "qwentts" => Some(QWENTTS_PORT),
        _ => None,
    }
}

/// 停止占用服务端口的进程（无论由谁启动），用于关闭开关时真正释放端口与内存。
/// 通过 lsof 精确定位监听该端口的 PID；确认式关闭：SIGTERM 后等待进程退出（≤2s），
/// 未退出的 SIGKILL 强杀再等一轮（≤1s），最后复查端口无监听才算成功；若 App 曾启动该服务则一并清理 PID 记录。
#[tauri::command]
fn stop_service_by_port(key: String) -> Result<String, String> {
    let port = service_port(&key).ok_or_else(|| "未知服务".to_string())?;
    #[cfg(unix)]
    {
        use std::process::Command;
        if Command::new("lsof").arg("-v").output().is_err() {
            return Err("查找端口进程失败：lsof 不可用".to_string());
        }
    }
    // Ollama 先退出桌面应用：它会守护自己的服务进程，不先退出，刚杀掉的服务会被它拉回来
    let app_quit = key == "ollama" && quit_ollama_app();
    let app_note = if app_quit { "；已一并退出 Ollama 应用，防止它把服务重新拉起" } else { "" };
    let pids = port_listener_pids(port);
    if pids.is_empty() {
        // 端口无监听进程，仍需清理 App 的 PID 记录
        let mut m = load_managed_pids();
        m.remove(&key);
        save_managed_pids(&m);
        return Ok(format!("{} 服务端口 {} 当前无进程监听{}", key, port, app_note));
    }
    let (done, forced, still) = stop_pids_confirmed(&pids);
    let mut m = load_managed_pids();
    m.remove(&key);
    save_managed_pids(&m);
    // 最终复查：目标进程须全部退出，且端口上不得再有任何监听进程
    let listeners = port_listener_pids(port);
    if !still.is_empty() || !listeners.is_empty() {
        let mut bad: Vec<u32> = still.iter().copied().chain(listeners.iter().copied()).collect();
        bad.sort_unstable();
        bad.dedup();
        return Err(format!("{} 服务端口 {} 仍有进程未退出（PID {}），可能需要管理员权限手动处理",
            key, port, bad.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(", ")));
    }
    // Ollama 落定复查：等 1.5 秒确认端口没有被任何守护者重新监听；若又出现则再清一次，
    // 仍清不掉才报错——保证「关开关」返回成功时服务是真的停了，而不是杀完瞬间没人、过会儿又回来
    if key == "ollama" {
        std::thread::sleep(std::time::Duration::from_millis(1500));
        let again = port_listener_pids(port);
        if !again.is_empty() {
            let (_d2, _f2, still2) = stop_pids_confirmed(&again);
            let left = port_listener_pids(port);
            if !still2.is_empty() || !left.is_empty() {
                let mut bad: Vec<u32> = still2.iter().copied().chain(left.iter().copied()).collect();
                bad.sort_unstable();
                bad.dedup();
                return Err(format!("{} 服务端口 {} 上的进程被停止后又重新出现（PID {}），可能有其他守护程序在拉起它，请手动处理",
                    key, port, bad.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(", ")));
            }
        }
    }
    let pid_list = done.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(", ");
    if forced.is_empty() {
        Ok(format!("已停止 {} 服务端口 {} 上的进程（PID {}），已确认进程退出、端口已释放，内存已回收{}", key, port, pid_list, app_note))
    } else {
        Ok(format!("已停止 {} 服务端口 {} 上的进程（PID {}），其中 PID {} 常规终止未退出已强制结束；已确认端口已释放，内存已回收{}",
            key, port, pid_list, forced.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(", "), app_note))
    }
}

/// 开关关闭状态下的遗留进程对账（App 启动时由前端对每个「关着」的服务调用一次）：
/// 保证「开关关了 = 服务不常驻」跨重启也成立。处理三类遗留：
/// 1) 本 App 记录的托管 PID 还活着（App 上次异常退出/被强杀留下的孤儿进程）→ 确认式停止并清记录；
/// 2) 服务端口上命令行确属该服务的监听进程（ollama serve / ComfyUI main.py）→ 确认式停止；
/// 3) Ollama 端口仍被占且桌面应用在跑 → 退出该应用（它在守护服务）后再清一次。
/// 命令行对不上的未知进程不动，只在返回信息里如实说明。返回 (是否动了进程, 说明)。
#[tauri::command]
fn reconcile_local_service(key: String) -> Result<(bool, String), String> {
    let port = match service_port(&key) {
        Some(p) => p,
        None => return Ok((false, "未知服务".to_string())),
    };
    if key == "lmstudio" {
        return Ok((false, "LM Studio 不由本 App 托管".to_string()));
    }
    let mut acted = false;
    let mut notes: Vec<String> = Vec::new();
    // 1) 托管 PID 遗留
    let mut m = load_managed_pids();
    if let Some(pid) = m.remove(&key) {
        save_managed_pids(&m);
        if pid_alive(pid) {
            let (_d, _f, still) = stop_pids_confirmed(&[pid]);
            if still.is_empty() {
                acted = true;
                notes.push(format!("已停止上次遗留的 {} 服务进程（PID {}）", key, pid));
            }
        }
    }
    // 2) 端口上确属该服务的监听进程
    let matches_service = |pid: u32| -> bool {
        let cmd = pid_command(pid).to_lowercase();
        match key.as_str() {
            "ollama" => cmd.contains("ollama") && cmd.contains("serve"),
            "comfyui" => cmd.contains("main.py"),
            "qwentts" => cmd.contains("mlx-tts"),
            _ => false,
        }
    };
    let mut sweep_matching = |acted: &mut bool, notes: &mut Vec<String>| {
        let targets: Vec<u32> = port_listener_pids(port).into_iter().filter(|p| matches_service(*p)).collect();
        if !targets.is_empty() {
            let (_d, _f, still) = stop_pids_confirmed(&targets);
            let killed: Vec<u32> = targets.iter().copied().filter(|p| !still.contains(p)).collect();
            if !killed.is_empty() {
                *acted = true;
                notes.push(format!("已停止占用 {} 端口的 {} 服务进程（PID {}）",
                    port, key, killed.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(", ")));
            }
        }
    };
    sweep_matching(&mut acted, &mut notes);
    // 3) Ollama 应用守护兜底
    if key == "ollama" && !port_listener_pids(port).is_empty() && ollama_app_running() {
        if quit_ollama_app() {
            acted = true;
            notes.push("已退出 Ollama 应用（它在守护 11434 端口的服务）".to_string());
            sweep_matching(&mut acted, &mut notes);
        }
    }
    if !acted && !port_listener_pids(port).is_empty() {
        notes.push(format!("{} 端口被其他进程占用（非 {} 服务本身），未做处理", port, key));
    }
    Ok((acted, notes.join("；")))
}

// ==================== Qwen3-TTS 本地服务：安装 / 状态 / 测试 / 合成 ====================

/// 找一个可用的 Python 3.10+：先试常见版本名与 Homebrew 路径，返回 (程序, 版本号)
fn qwentts_find_python() -> Option<(String, String)> {
    use std::process::Command;
    let candidates = [
        "/opt/homebrew/bin/python3.13", "/opt/homebrew/bin/python3.12", "/opt/homebrew/bin/python3.11",
        "/opt/homebrew/bin/python3.10", "/opt/homebrew/bin/python3",
        "/usr/local/bin/python3",
        "python3.13", "python3.12", "python3.11", "python3.10", "python3",
    ];
    for prog in candidates {
        let out = match Command::new(prog).arg("--version").output() {
            Ok(o) => o,
            Err(_) => continue,
        };
        let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
        if let Some(v) = text.trim().strip_prefix("Python ") {
            let parts: Vec<u32> = v.split('.').filter_map(|p| p.trim().parse().ok()).collect();
            if parts.len() >= 2 && (parts[0] > 3 || (parts[0] == 3 && parts[1] >= 10)) {
                return Some((prog.to_string(), v.trim().to_string()));
            }
        }
    }
    None
}

/// 运行一条命令并返回 (成功与否, 合并输出尾部约 600 字)，供安装步骤报错时如实呈现原因
fn run_captured(program: &str, args: &[String], work_dir: Option<&str>) -> (bool, String) {
    use std::process::Command;
    let mut cmd = Command::new(program);
    cmd.args(args);
    if let Some(d) = work_dir { cmd.current_dir(d); }
    match cmd.output() {
        Ok(o) => {
            let mut text = format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr));
            if text.chars().count() > 600 {
                text = text.chars().skip(text.chars().count() - 600).collect();
            }
            (o.status.success(), text.trim().to_string())
        }
        Err(e) => (false, format!("执行失败：{}", e)),
    }
}

/// Qwen3-TTS 安装/运行状态：JSON 字符串 {installed, python, pythonOk, modelCached, running, url, lastLog}
#[tauri::command]
async fn qwentts_status() -> Result<String, String> {
    let installed = qwentts_venv_bin().join("mlx-tts").exists();
    let (python, python_ok) = qwentts_find_python()
        .map(|(_, v)| (v, true))
        .unwrap_or_else(|| (String::new(), false));
    let model_cached = qwentts_model_cached();
    let running = check_local_service("qwentts".to_string()).await.is_some();
    let url = if running { Some(QWENTTS_URL.to_string()) } else { None };
    // 服务没在跑时附上日志尾部（起不来时看原因）；在跑时不附，避免 uvicorn 启动行刷屏
    let last_log = if running { String::new() } else {
        std::fs::read_to_string(qwentts_dir().join("server.log")).ok()
            .map(|t| {
                let lines: Vec<&str> = t.lines().collect();
                let start = lines.len().saturating_sub(3);
                let joined = lines[start..].join(" / ");
                if joined.chars().count() > 300 { joined.chars().take(300).collect() } else { joined }
            })
            .unwrap_or_default()
    };
    Ok(serde_json::json!({
        "installed": installed,
        "python": python,
        "pythonOk": python_ok,
        "modelCached": model_cached,
        "running": running,
        "url": url,
        "lastLog": last_log,
    }).to_string())
}

/// Qwen3-TTS 首次安装准备（同步长任务，几分钟）：建 venv → pip 安装 mlx-tts-server → 预下载约 1GB 模型。
/// 每步失败都返回真实原因（Python 版本、网络、磁盘），不静默兜底。
#[tauri::command]
fn qwentts_setup() -> Result<String, String> {
    // 仅 Apple 芯片 Mac：MLX 不支持 Intel；macOS 需 13+
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let arch = Command::new("uname").arg("-m").output().ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
        if arch != "arm64" {
            return Err("Qwen3-TTS 本地服务需要 Apple 芯片 Mac（MLX 只支持 Apple Silicon），当前机器不是 arm64".to_string());
        }
        let ver = Command::new("sw_vers").args(["-productVersion"]).output().ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
        let major: u32 = ver.split('.').next().and_then(|p| p.parse().ok()).unwrap_or(0);
        if major < 13 {
            return Err(format!("Qwen3-TTS 本地服务需要 macOS 13 或以上（MLX 要求），当前为 macOS {}", ver));
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        return Err("Qwen3-TTS 本地服务目前只支持 macOS（MLX 后端）".to_string());
    }
    let (python, version) = qwentts_find_python().ok_or_else(|| {
        "未找到 Python 3.10+：请先安装 Python 3.10 或以上（如 brew install python@3.12，或到 python.org 下载），再点「首次安装」".to_string()
    })?;
    let dir = qwentts_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败：{}", e))?;
    let venv = dir.join(".venv");
    let venv_bin = venv.join("bin");
    let mlx_tts = venv_bin.join("mlx-tts");
    // 1) 建 venv（已有则跳过）
    if !venv_bin.join("python").exists() {
        let (ok, out) = run_captured(&python, &["-m".to_string(), "venv".to_string(), venv.to_string_lossy().to_string()], None);
        if !ok {
            return Err(format!("创建 Python 虚拟环境失败（{}）：{}", python, out));
        }
    }
    // 2) pip 安装 mlx-tts-server（已有则升级校验）
    let pip = venv_bin.join("pip").to_string_lossy().to_string();
    let (ok, out) = run_captured(&pip, &["install".to_string(), "-U".to_string(), "mlx-tts-server".to_string()], None);
    if !ok {
        return Err(format!("安装 mlx-tts-server 失败（可能网络被代理拦截，请换节点再试）：{}", out));
    }
    if !mlx_tts.exists() {
        return Err("安装完成但未找到 mlx-tts 可执行文件，请重试或检查 pip 输出".to_string());
    }
    // 3) 预下载模型（约 1GB；首次启动服务时不再现下）
    let venv_py = venv_bin.join("python").to_string_lossy().to_string();
    let dl_code = "from huggingface_hub import snapshot_download; snapshot_download(repo_id='mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit')";
    let (ok, out) = run_captured(&venv_py, &["-c".to_string(), dl_code.to_string()], None);
    if !ok {
        return Err(format!("下载 Qwen3-TTS 模型失败（约 1GB，可能网络被代理拦截，请换节点再试）：{}", out));
    }
    if !qwentts_model_cached() {
        return Err("模型下载命令已执行，但未在缓存中找到模型文件，请重试".to_string());
    }
    Ok(format!("Qwen3-TTS 已安装就绪（Python {}，模型约 1GB 已下载）。现在可以到「设置 → 本地模型服务」打开 Qwen3-TTS 开关启动服务。", version))
}

/// 测试 Qwen3-TTS 本机服务：GET /health
#[tauri::command]
async fn qwentts_test() -> Result<String, String> {
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(10))
        .build().map_err(|e| format!("客户端错误：{}", e))?;
    let resp = client.get(format!("{}/health", QWENTTS_URL)).send().await
        .map_err(|e| format!("连接失败（请确认 Qwen3-TTS 服务已启动）：{}", e))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("连接失败（HTTP {}）：{}", status.as_u16(), text.chars().take(160).collect::<String>()));
    }
    let v: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    let model = v.get("model").and_then(|m| m.as_str()).unwrap_or(QWENTTS_MODEL);
    Ok(format!("连接成功，Qwen3-TTS 服务可用（模型 {}）", model))
}

/// Qwen3-TTS 合成取消标志：前端「取消」按钮调用 qwentts_cancel_synthesize 置位，
/// 进行中的 qwentts_synthesize 在 select! 里感知后丢弃请求、立刻返回；下一次合成开始时自动复位。
/// 注意：一次只能取消当前正在跑的那次合成；界面上不会并发起两次合成。
static QWENTTS_SYNTH_CANCEL: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 取消一次正在进行的 Qwen3-TTS 合成（v0.1.428：试听/朗读卡住时可取消）。
#[tauri::command]
fn qwentts_cancel_synthesize() {
    QWENTTS_SYNTH_CANCEL.store(true, std::sync::atomic::Ordering::SeqCst);
}

/// Qwen3-TTS 本地克隆合成：POST /v1/audio/clone（multipart：input 文本 + ref_audio 参考音频 + ref_text 原文）。
/// language=auto 由服务端按文本自动识别（传 english 会强制英文）。返回 wav 音频 data URI。
#[tauri::command]
async fn qwentts_synthesize(audio_data_url: String, ref_text: String, text: String) -> Result<String, String> {
    // 新一次合成开始时复位取消标志（上一次取消后残留的 true 不应误杀下一次）
    QWENTTS_SYNTH_CANCEL.store(false, std::sync::atomic::Ordering::SeqCst);
    let (mime, bytes) = parse_data_uri(&audio_data_url)?;
    if text.trim().is_empty() {
        return Err("朗读内容为空".to_string());
    }
    let boundary = format!("----QwenTtsBoundary{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());
    let ext = match mime.as_str() { "audio/mpeg" | "audio/mp3" => "mp3", "audio/ogg" => "ogg", "audio/flac" => "flac", "audio/webm" => "webm", "audio/mp4" | "audio/x-m4a" => "m4a", _ => "wav" };
    let mut body: Vec<u8> = Vec::new();
    let mut part = |field: &str, value: &str| {
        body.extend_from_slice(format!("--{}\r\nContent-Disposition: form-data; name=\"{}\"\r\n\r\n{}\r\n", boundary, field, value).as_bytes());
    };
    part("input", &text);
    part("ref_text", &ref_text);
    part("response_format", "wav");
    part("language", "auto");
    part("model", "clone");
    body.extend_from_slice(format!("--{}\r\nContent-Disposition: form-data; name=\"ref_audio\"; filename=\"ref_audio.{}\"\r\nContent-Type: {}\r\n\r\n", boundary, ext, mime).as_bytes());
    body.extend_from_slice(&bytes);
    body.extend_from_slice(format!("\r\n--{}--\r\n", boundary).as_bytes());
    // 600 秒：首次克隆要加载约 1GB 模型，M1 8GB 上可能超过 3 分钟，旧 180 秒会在加载中途
    // 掐断请求（须与前端 QWENTTS_SYNTH_TIMEOUT_S 保持一致）
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(600))
        .build().map_err(|e| format!("客户端错误：{}", e))?;
    // 合成请求与取消标志二选一（v0.1.428）：200ms 一片地轮询，取消标志一立就丢弃
    // 进行中的请求 future，reqwest 随即中断连接，单线程服务端不再被占住；
    // 前端不再干等 600 秒超时。这里不用 tokio::select!——本包 tokio 只开了 time
    // 特性（select! 要 macros 特性，CI 编译不过），timeout 轮询只用已有特性。
    let mut work = Box::pin(async {
        let resp = client.post(format!("{}/v1/audio/clone", QWENTTS_URL))
            .header("Content-Type", format!("multipart/form-data; boundary={}", boundary))
            .body(body).send().await.map_err(|e| format!("合成请求失败（请确认 Qwen3-TTS 服务已启动）：{}", e))?;
        let status = resp.status();
        if !status.is_success() {
            let t = resp.text().await.unwrap_or_default();
            return Err(format!("合成失败（HTTP {}）：{}", status.as_u16(), t.chars().take(200).collect::<String>()));
        }
        let content_type = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
        let bytes = resp.bytes().await.map_err(|e| format!("读取音频失败：{}", e))?;
        // 防止误把 JSON 错误当成音频
        if content_type.contains("application/json") || bytes.starts_with(b"{\"") {
            return Err(format!("合成返回非音频：{}", String::from_utf8_lossy(&bytes).chars().take(200).collect::<String>()));
        }
        Ok::<String, String>(format!("data:audio/wav;base64,{}", base64_encode(&bytes)))
    });
    loop {
        if QWENTTS_SYNTH_CANCEL.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("合成已取消".to_string());
        }
        match tokio::time::timeout(std::time::Duration::from_millis(200), &mut work).await {
            Ok(r) => return r,
            Err(_) => continue,
        }
    }
}

// ==================== 阿里云百炼 TTS 直连 ====================
// 用户只需填 API Key，App 后端直调官方 REST API（规避浏览器 CORS、免部署代理）。

/// 阿里云百炼旧域名（仍可用，无需 WorkspaceId，降低用户配置门槛）
const DASHSCOPE_BASE: &str = "https://dashscope.aliyuncs.com/api/v1/services/audio/tts";

/// 解析声音复刻响应中的 voice_id
fn parse_clone_voice_id(json: &serde_json::Value) -> Option<String> {
    json.get("output")?.get("voice_id")?.as_str().map(|s| s.to_string())
}

/// 解析语音合成响应中的音频 URL（非流式：output.audio.url）
fn parse_synthesize_url(json: &serde_json::Value) -> Option<String> {
    json.get("output")?.get("audio")?.get("url")?.as_str().map(|s| s.to_string())
}

/// 校验测试连接响应是否有效（list_voice 成功即 Key 有效；有 voice_list 或仅 request_id 都算成功）
fn parse_test_ok(json: &serde_json::Value) -> bool {
    json.get("request_id").and_then(|v| v.as_str()).is_some()
}

/// base64 编码字节（无外部依赖）
fn base64_encode(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    let mut i = 0;
    while i < data.len() {
        let b0 = data[i];
        let b1 = if i + 1 < data.len() { data[i + 1] } else { 0 };
        let b2 = if i + 2 < data.len() { data[i + 2] } else { 0 };
        out.push(T[(b0 >> 2) as usize] as char);
        out.push(T[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        out.push(if i + 1 < data.len() { T[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char } else { '=' });
        out.push(if i + 2 < data.len() { T[(b2 & 0x3f) as usize] as char } else { '=' });
        i += 3;
    }
    out
}

/// base64 解码字符串为字节（无外部依赖，与 base64_encode 配套）
fn base64_decode(s: &str) -> Result<Vec<u8>, String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    let mut buf: u32 = 0;
    let mut bits = 0u32;
    for &c in bytes {
        if c == b'=' { break }
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'\n' | b'\r' | b' ' => continue,
            _ => return Err("非法 base64 字符".into()),
        } as u32;
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1u32 << bits) - 1;
        }
    }
    Ok(out)
}

/// 校验 API Key 有效性：调用 list_voice，成功即有效
#[tauri::command]
async fn tts_test_direct(api_key: String) -> Result<String, String> {
    let key = api_key.trim();
    if key.is_empty() { return Err("请先填写 API Key".to_string()) }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build().map_err(|e| format!("客户端错误：{}", e))?;
    let url = format!("{}/customization", DASHSCOPE_BASE);
    let body = serde_json::json!({
        "model": "voice-enrollment",
        "input": { "action": "list_voice", "page_size": 1, "page_index": 0 }
    });
    let resp = client.post(&url)
        .header("Authorization", format!("Bearer {}", key))
        .header("Content-Type", "application/json")
        .json(&body).send().await
        .map_err(|e| format!("连接失败：{}", e))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() { return Err(format!("API Key 无效或未知错误（HTTP {}）：{}", status.as_u16(), text.chars().take(160).collect::<String>())) }
    let json: serde_json::Value = serde_json::from_str(&text).map_err(|_| "响应格式异常".to_string())?;
    if parse_test_ok(&json) { Ok("连接成功，API Key 有效".to_string()) }
    else { Err(format!("校验未通过：{}", text.chars().take(160).collect::<String>())) }
}

/// 声音复刻：POST customization create_voice，audio 为 Data URI
#[tauri::command]
async fn tts_clone_direct(api_key: String, name: String, mime: String, audio_data_url: String) -> Result<String, String> {
    let key = api_key.trim();
    if key.is_empty() { return Err("请先填写 API Key".to_string()) }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build().map_err(|e| format!("客户端错误：{}", e))?;
    // prefix 仅允许字母数字、≤10 字符
    let prefix: String = name.chars().filter(|c| c.is_ascii_alphanumeric()).take(10).collect();
    let prefix = if prefix.is_empty() { "voice".to_string() } else { prefix };
    let body = serde_json::json!({
        "model": "voice-enrollment",
        "input": {
            "action": "create_voice",
            "target_model": "cosyvoice-v2",
            "prefix": prefix,
            "audio": audio_data_url,
            "language_hints": ["zh"]
        }
    });
    let url = format!("{}/customization", DASHSCOPE_BASE);
    let resp = client.post(&url)
        .header("Authorization", format!("Bearer {}", key))
        .header("Content-Type", "application/json")
        .json(&body).send().await
        .map_err(|e| format!("克隆请求失败：{}", e))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() { return Err(format!("克隆失败（HTTP {}）：{}", status.as_u16(), text.chars().take(200).collect::<String>())) }
    let json: serde_json::Value = serde_json::from_str(&text).map_err(|_| format!("响应格式异常：{}", text.chars().take(160).collect::<String>()))?;
    parse_clone_voice_id(&json).ok_or_else(|| format!("服务未返回 voice_id：{}", text.chars().take(200).collect::<String>()))
}

/// 语音合成：POST SpeechSynthesizer → 取 audio.url → 下载字节 → 返回 base64（含 data URI）
#[tauri::command]
async fn tts_synthesize_direct(api_key: String, voice: String, text: String) -> Result<String, String> {
    let key = api_key.trim();
    if key.is_empty() { return Err("请先填写 API Key".to_string()) }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build().map_err(|e| format!("客户端错误：{}", e))?;
    let body = serde_json::json!({
        "model": "cosyvoice-v2",
        "input": { "text": text, "voice": voice, "format": "mp3", "sample_rate": 24000 }
    });
    let url = format!("{}/SpeechSynthesizer", DASHSCOPE_BASE);
    let resp = client.post(&url)
        .header("Authorization", format!("Bearer {}", key))
        .header("Content-Type", "application/json")
        .json(&body).send().await
        .map_err(|e| format!("合成请求失败：{}", e))?;
    let status = resp.status();
    let resp_text = resp.text().await.unwrap_or_default();
    if !status.is_success() { return Err(format!("合成失败（HTTP {}）：{}", status.as_u16(), resp_text.chars().take(200).collect::<String>())) }
    let json: serde_json::Value = serde_json::from_str(&resp_text).map_err(|_| "合成响应格式异常".to_string())?;
    let audio_url = parse_synthesize_url(&json).ok_or_else(|| format!("合成未返回音频地址：{}", resp_text.chars().take(200).collect::<String>()))?;
    // 音频地址来自官方接口的已鉴权响应（带签名的临时 OSS 链接，常为 http）：
    // 用媒体下载校验（v0.1.378）——通用代理校验的「http 仅限本机」会误杀它，
    // 曾导致克隆音色合成成功却下载不了音频、被迫回退系统音色。
    let audio_url = validate_media_url(&audio_url)?.to_string();
    let audio = client.get(&audio_url).send().await.map_err(|e| format!("下载音频失败：{}", e))?;
    if !audio.status().is_success() { return Err(format!("下载音频失败（HTTP {}）", audio.status().as_u16())) }
    let bytes = audio.bytes().await.map_err(|e| format!("读取音频失败：{}", e))?;
    Ok(format!("data:audio/mp3;base64,{}", base64_encode(&bytes)))
}

// ==================== Edge 免费音色（微软云端 WSS，桌面端原生实现） ====================
// 桌面 WebView（WKWebView）里 new WebSocket 会抛 SecurityError「The operation is insecure.」
// （应用页面走自定义协议、不是安全上下文），JS 版在桌面端连不上，故桌面端改走原生 WSS；
// 手机端 Chromium WebView 是 https://localhost 安全上下文，仍用 JS 版（core/edgeTts.ts）。

const EDGE_TOKEN: &str = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const EDGE_GEC_VERSION: &str = "2-143.0.3650.75";

// ---- Sec-MS-GEC v2（微软 2026 年改版：定制 SHA-256 + CS64 校验） ----
// v1 的普通 SHA256 已被服务端拒绝（握手 403）。v2 算法移植自 edge-tts 参考实现（drm.py），
// 已用固定时间戳金标准逐字节对拍（见文件末尾测试 edge_gec_v2_golden）。
const GEC_INITIAL: [u32; 8] = [0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19];
const GEC_STATE: [u32; 8] = [0xFD9FBEA2, 0x91243CE7, 0xBE499094, 0xCD2E1E0A, 0x6C006F49, 0x04BD35AB, 0xFEB0A7E4, 0x03EFFBD2];
const GEC_SCHEDULE: [u32; 14] = [0xEB24BF9E, 0x1558691F, 0xA0C09EE2, 0x0CFA32BA, 0xA622EE8C, 0xD1DD9491, 0xC0DD25A0, 0xF9E70AB6, 0xF0C31573, 0x7058CE4E, 0x7188E606, 0x00E5AB33, 0xD258B060, 0x72766564];
const GEC_K: [u32; 64] = [
    0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
    0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
    0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
    0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
    0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
    0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
    0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
    0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
];
const GEC_ADJ: u32 = 0xC9DC06A7;
const GEC_S0ADJ: u32 = 0x059C0B80;
const GEC_S1ADJ: u32 = 0x000B92C0;
const GEC_CS64: [(u32, u32); 14] = [
    (0xE82E91B1, 0xB32700D0), (0x44DE24C6, 0x88DFF51D), (0x3BEB65BC, 0x29514038),
    (0xC89C5933, 0xB328CBDF), (0x8D1EC211, 0xD405B4D5), (0x314EF5D5, 0x26E55F3C),
    (0xE92491B1, 0x607801C6), (0xF0A5B9D5, 0x82B2C1FB), (0x06064CF3, 0xFA51A3DA),
    (0xDA79FA60, 0x207CC464), (0xBED20560, 0x3C3C74F3), (0x89F9C9F8, 0xD2D14B61),
    (0x35FA38C6, 0xBB04A2C1), (0xCB49E3C6, 0xC5626167),
];
const GEC_CS64_FACTOR: u32 = 0x82893933;
const GEC_CS64_ADJ0: u32 = 0xF2F90B1A;
const GEC_CS64_ADJ1: u32 = 0x0B1A0000;

fn gec_sigma0(x: u32) -> u32 { (x >> 7) ^ (x << 25) ^ (x >> 18) ^ (x << 14) ^ (x >> 3) }
fn gec_sigma1(x: u32) -> u32 { (x >> 17) ^ (x << 15) ^ (x >> 19) ^ (x << 13) ^ (x >> 10) }
fn gec_rol16(v: u32) -> u32 { (v << 16) | (v >> 16) }

fn gec_rounds(state: [u32; 8], words: &[u32], first_round: usize) -> [u32; 8] {
    let (mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h) =
        (state[0], state[1], state[2], state[3], state[4], state[5], state[6], state[7]);
    for i in first_round..64 {
        let k = if first_round == 14 && i == 14 { GEC_ADJ } else { GEC_K[i] };
        let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
        let ch = g ^ (e & (f ^ g));
        let t1 = h.wrapping_add(s1).wrapping_add(ch).wrapping_add(k).wrapping_add(words[i]);
        let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
        let maj = (a & b) | (c & (a | b));
        let t2 = s0.wrapping_add(maj);
        let na = t1.wrapping_add(t2);
        let ne = d.wrapping_add(t1);
        h = g; g = f; f = e; e = ne; d = c; c = b; b = a; a = na;
    }
    [a, b, c, d, e, f, g, h]
}

fn gec_expand(words: &mut Vec<u32>, first_word: usize) {
    for i in first_word..64 {
        let v = gec_sigma1(words[i - 2])
            .wrapping_add(words[i - 7])
            .wrapping_add(gec_sigma0(words[i - 15]))
            .wrapping_add(words[i - 16]);
        words.push(v);
    }
}

fn gec_sha_init(data7: &[u8]) -> [u32; 8] {
    let mut words: Vec<u32> = vec![0; 14];
    words.push(u32::from_be_bytes([0, data7[0], data7[1], data7[2]]));
    words.push(u32::from_be_bytes([data7[3], data7[4], data7[5], data7[6]]));
    for index in 16..30 {
        let mut value = GEC_SCHEDULE[index - 16];
        if index - 2 >= 14 {
            value = value.wrapping_add(if index == 16 { gec_sigma1(words[index - 2]) ^ GEC_S1ADJ } else { gec_sigma1(words[index - 2]) });
        }
        if index - 7 >= 14 {
            value = value.wrapping_add(words[index - 7]);
        }
        if index - 15 >= 14 {
            value = value.wrapping_add(if index == 29 { gec_sigma0(words[index - 15]) ^ GEC_S0ADJ } else { gec_sigma0(words[index - 15]) });
        }
        words.push(value);
    }
    words.push(
        gec_sigma1(words[28])
            .wrapping_add(words[23])
            .wrapping_add(gec_sigma0(words[15]))
            .wrapping_add(words[14])
            .wrapping_add(GEC_ADJ)
            .wrapping_sub(GEC_K[14]),
    );
    gec_expand(&mut words, 31);
    let working = gec_rounds(GEC_STATE, &words, 14);
    let mut out = [0u32; 8];
    for i in 0..8 {
        out[i] = GEC_INITIAL[i].wrapping_add(working[i]);
    }
    out
}

fn gec_sha_digest(data: &[u8]) -> [u8; 32] {
    let length = 57 + data.len();
    let zeros = (55i64 - length as i64).rem_euclid(64) as usize;
    let mut padded: Vec<u8> = Vec::new();
    padded.extend_from_slice(&data[7..]);
    padded.push(0x80);
    padded.extend(std::iter::repeat(0u8).take(zeros));
    padded.extend_from_slice(&(length as u64).wrapping_mul(8).to_be_bytes());
    let mut state = gec_sha_init(&data[..7]);
    for chunk in padded.chunks_exact(64) {
        let mut words: Vec<u32> = (0..16)
            .map(|i| u32::from_be_bytes([chunk[4 * i], chunk[4 * i + 1], chunk[4 * i + 2], chunk[4 * i + 3]]))
            .collect();
        gec_expand(&mut words, 16);
        let working = gec_rounds(state, &words, 0);
        for i in 0..8 {
            state[i] = state[i].wrapping_add(working[i]);
        }
    }
    let mut out = [0u8; 32];
    for i in 0..8 {
        out[4 * i..4 * i + 4].copy_from_slice(&state[i].to_be_bytes());
    }
    out
}

fn gec_words_le4_even(data: &[u8]) -> Vec<u32> {
    let mut padded = data.to_vec();
    while padded.len() % 4 != 0 {
        padded.push(0);
    }
    let mut words: Vec<u32> = padded
        .chunks_exact(4)
        .map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();
    if words.len() % 2 == 1 {
        words.push(0);
    }
    words
}

fn gec_cs64(data: &[u8], digest: &[u8; 32]) -> (u32, u32) {
    let key_a = u32::from_le_bytes([digest[0], digest[1], digest[2], digest[3]]) | 1;
    let key_b = u32::from_le_bytes([digest[4], digest[5], digest[6], digest[7]]) | 1;
    let factors = [key_a.wrapping_mul(GEC_CS64_FACTOR), key_b.wrapping_mul(GEC_CS64_FACTOR)];
    let mut terms: Vec<u32> = GEC_CS64.iter().enumerate().map(|(i, (coef, _))| coef.wrapping_mul(factors[i % 2])).collect();
    let mut offsets: Vec<u32> = GEC_CS64.iter().map(|(_, off)| *off).collect();
    let mut prefixed = vec![0u8];
    prefixed.extend_from_slice(data);
    for (index, word) in gec_words_le4_even(&prefixed).into_iter().enumerate() {
        let mut term = word.wrapping_mul(if index % 2 == 0 { key_a } else { key_b });
        let mut offset = gec_rol16(word).wrapping_mul(if index % 2 == 0 { 0xEF0569FB } else { 0xC31713DB });
        if index == 0 {
            term = term.wrapping_add(GEC_CS64_ADJ0.wrapping_mul(factors[0]));
            offset = offset.wrapping_add(GEC_CS64_ADJ1);
        }
        terms.push(term);
        offsets.push(offset);
    }
    let (mut swap_acc, mut swap_last, mut state, mut acc) = (0u32, 0u32, 0u32, 0u32);
    let mut i = 0;
    while i < terms.len() {
        let (x, y) = (terms[i], terms[i + 1]);
        let mut t = gec_rol16(offsets[i].wrapping_add(x));
        let mut q = t.wrapping_mul(0x76F50F34);
        swap_acc = swap_acc.wrapping_add(gec_rol16(q).wrapping_mul(0xC3EFEA97).wrapping_add(q));
        t = gec_rol16(offsets[i + 1].wrapping_add(y));
        q = t.wrapping_mul(0x1881CE3C);
        swap_last = gec_rol16(q).wrapping_mul(0x35BD1EC9).wrapping_add(q);
        swap_acc = swap_acc.wrapping_add(swap_last);
        state = state.wrapping_mul(key_a).wrapping_add(x);
        state = gec_rol16(state).wrapping_mul(0xCF98B111);
        state = gec_rol16(state).wrapping_mul(0x87085B9F);
        state = gec_rol16(state).wrapping_mul(0x12CEB96D);
        state = gec_rol16(state).wrapping_mul(0x257E1D83);
        acc = acc.wrapping_add(state);
        t = state.wrapping_mul(key_b).wrapping_add(y);
        t = gec_rol16(t).wrapping_mul(0xA27416F5);
        t = gec_rol16(t).wrapping_mul(0xD38396FF);
        state = gec_rol16(gec_rol16(t).wrapping_mul(0x7C932B89)).wrapping_mul(0xBFA49F69);
        acc = acc.wrapping_add(state);
        i += 2;
    }
    (swap_last ^ state, swap_acc ^ acc)
}

/// Sec-MS-GEC v2： "<CS64 十六进制>-<定制 SHA256 十六进制>"（入参为 unix 秒，便于金标准测试）
fn edge_gec_v2_at(unix_secs: u64) -> String {
    let mut ticks = unix_secs as i64 + 11644473600;
    ticks -= ticks % 300;
    let raw = format!("{}{}", ticks * 10_000_000, EDGE_TOKEN);
    let data = raw.as_bytes();
    let digest = gec_sha_digest(data);
    let (c1, c2) = gec_cs64(data, &digest);
    let mut cs = Vec::with_capacity(8);
    cs.extend_from_slice(&c1.to_le_bytes());
    cs.extend_from_slice(&c2.to_le_bytes());
    let cs64: String = cs.iter().map(|b| format!("{:02X}", b)).collect();
    let sha: String = digest.iter().map(|b| format!("{:02X}", b)).collect();
    format!("{}-{}", cs64, sha)
}

fn edge_gec() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    edge_gec_v2_at(secs)
}

/// JS Date 的 UTC 串风格："Tue Nov 24 2026 05:11:00 GMT+0000 (Coordinated Universal Time)"
fn edge_timestamp() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64;
    let days = secs.div_euclid(86400);
    let tod = secs.rem_euclid(86400);
    let (h, mi, s) = (tod / 3600, (tod % 3600) / 60, tod % 60);
    // 1970-01-01 是周四
    let wd = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"][days.rem_euclid(7) as usize];
    // civil-from-days（Howard Hinnant 算法，已对 1970-01-01 与 2026-11-24 校验）
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let yr = if mo <= 2 { y + 1 } else { y };
    let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    format!("{} {} {:02} {} {:02}:{:02}:{:02} GMT+0000 (Coordinated Universal Time)",
        wd, months[(mo - 1) as usize], d, yr, h, mi, s)
}

fn edge_xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

/// 简单 xorshift 随机字节（仅作握手 nonce / 请求 ID，不作安全用途）
fn edge_rand_bytes(n: usize) -> Vec<u8> {
    let mut x = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()
        ^ ((std::process::id() as u128) << 64) ^ 0x9E3779B97F4A7C15u128;
    let mut out = Vec::with_capacity(n);
    for _ in 0..n {
        x ^= x << 13; x ^= x >> 7; x ^= x << 17;
        out.push((x & 0xff) as u8);
    }
    out
}

/// Edge 免费音色合成：WSS 直连微软 Edge 朗读接口，返回 data:audio/mp3;base64,...
#[tauri::command]
async fn edge_tts_synthesize(text: String, voice: String) -> Result<String, String> {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;
    // ConnectionId = uuid4 去横线（与官方客户端一致）；muid Cookie 为匿名客户端标识
    let mut uuid_bytes = edge_rand_bytes(16);
    uuid_bytes[6] = (uuid_bytes[6] & 0x0f) | 0x40;
    uuid_bytes[8] = (uuid_bytes[8] & 0x3f) | 0x80;
    let conn_id: String = uuid_bytes.iter().map(|b| format!("{:02x}", b)).collect();
    let muid: String = edge_rand_bytes(16).iter().map(|b| format!("{:02X}", b)).collect();
    let url = format!("wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken={}&ConnectionId={}&Sec-MS-GEC={}&Sec-MS-GEC-Version={}",
        EDGE_TOKEN, conn_id, edge_gec(), EDGE_GEC_VERSION);
    let req = tokio_tungstenite::tungstenite::http::Request::builder()
        .uri(url.as_str())
        .header("Host", "speech.platform.bing.com")
        .header("Upgrade", "websocket")
        .header("Connection", "Upgrade")
        .header("Sec-WebSocket-Key", base64_encode(&edge_rand_bytes(16)))
        .header("Sec-WebSocket-Version", "13")
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0")
        .header("Accept-Encoding", "gzip, deflate, br, zstd")
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Pragma", "no-cache")
        .header("Cache-Control", "no-cache")
        .header("Cookie", format!("muid={};", muid))
        .header("Origin", "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold")
        .body(())
        .map_err(|e| format!("Edge 请求构造失败：{}", e))?;
    let (mut ws, _resp) = tokio::time::timeout(std::time::Duration::from_secs(20),
        tokio_tungstenite::connect_async(req))
        .await.map_err(|_| "Edge 音色连接超时".to_string())?
        .map_err(|e| format!("Edge 音色连接失败：{}", e))?;
    let ts = edge_timestamp();
    let req_id: String = edge_rand_bytes(16).iter().map(|b| format!("{:02x}", b)).collect();
    let config_body = serde_json::json!({
        "context": { "synthesis": { "audio": {
            "metadataoptions": { "sentenceBoundaryEnabled": "false", "wordBoundaryEnabled": "false" },
            "outputFormat": "audio-24khz-48kbitrate-mono-mp3"
        } } }
    }).to_string();
    let config = format!("X-Timestamp:{}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{}", ts, config_body);
    let ssml = format!("X-RequestId:{}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:{}\r\nPath:ssml\r\n\r\n<speak version=\"1.0\" xmlns=\"http://www.w3.org/2001/10/synthesis\" xml:lang=\"zh-CN\"><voice name=\"{}\"><prosody pitch=\"+0Hz\" rate=\"+0%\" volume=\"+0%\">{}</prosody></voice></speak>",
        req_id, ts, voice, edge_xml_escape(&text));
    ws.send(Message::Text(config.into())).await.map_err(|e| format!("Edge 发送失败：{}", e))?;
    ws.send(Message::Text(ssml.into())).await.map_err(|e| format!("Edge 发送失败：{}", e))?;
    let mut audio: Vec<u8> = Vec::new();
    let read_loop = async {
        while let Some(msg) = ws.next().await {
            match msg {
                Ok(Message::Binary(data)) => {
                    if data.len() < 2 { continue }
                    let hlen = ((data[0] as usize) << 8) | data[1] as usize;
                    if data.len() < 2 + hlen { continue }
                    let header = String::from_utf8_lossy(&data[2..2 + hlen]).into_owned();
                    if header.contains("Path:audio") { audio.extend_from_slice(&data[2 + hlen..]) }
                }
                Ok(Message::Text(t)) => { if t.to_string().contains("Path:turn.end") { break } }
                Ok(Message::Close(_)) => break,
                Ok(_) => {}
                Err(e) => return Err(format!("Edge 接收失败：{}", e)),
            }
        }
        Ok::<(), String>(())
    };
    tokio::time::timeout(std::time::Duration::from_secs(30), read_loop).await
        .map_err(|_| "Edge 音色合成超时".to_string())??;
    if audio.is_empty() { return Err("Edge 未返回音频".to_string()) }
    Ok(format!("data:audio/mp3;base64,{}", base64_encode(&audio)))
}

// ==================== VoiceStudio 本地语音服务（OpenAI 兼容 :3900） ====================

/// 规范化 VoiceStudio 基址：默认 http://127.0.0.1:3900，去掉末尾斜杠
fn vs_base(endpoint: &str) -> String {
    let e = endpoint.trim();
    if e.is_empty() { "http://127.0.0.1:3900".to_string() } else { e.trim_end_matches('/').to_string() }
}

/// VoiceStudio 基址校验（v0.1.285 SSRF 收口）：本机/局域网或公网 https 才放行
fn vs_base_checked(endpoint: &str) -> Result<String, String> {
    validate_service_url(&vs_base(endpoint))
}

/// 解析 data URI 为 (mime, bytes)
fn parse_data_uri(uri: &str) -> Result<(String, Vec<u8>), String> {
    let (head, data) = uri.split_once(',').ok_or_else(|| "音频不是有效的 Data URI".to_string())?;
    let mime = head.strip_prefix("data:").and_then(|h| h.split(';').next()).unwrap_or("audio/wav").to_string();
    let bytes = base64_decode(data).map_err(|e| format!("音频解码失败：{}", e))?;
    if bytes.is_empty() { return Err("音频数据为空".to_string()) }
    Ok((mime, bytes))
}

/// 测试 VoiceStudio 连接：GET /health
#[tauri::command]
async fn voicestudio_test(endpoint: String, api_key: String) -> Result<String, String> {
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(15))
        .build().map_err(|e| format!("客户端错误：{}", e))?;
    let mut req = client.get(format!("{}/health", vs_base_checked(&endpoint)?));
    if !api_key.trim().is_empty() { req = req.header("Authorization", format!("Bearer {}", api_key.trim())) }
    let resp = req.send().await.map_err(|e| format!("连接失败（请确认 VoiceStudio 已启动）：{}", e))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() { return Err(format!("连接失败（HTTP {}）：{}", status.as_u16(), text.chars().take(160).collect::<String>())) }
    Ok("连接成功，VoiceStudio 服务可用".to_string())
}

/// 列出 VoiceStudio 已保存的音色：GET /profiles → [{id,name,...}]
#[tauri::command]
async fn voicestudio_list(endpoint: String, api_key: String) -> Result<Vec<serde_json::Value>, String> {
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(30))
        .build().map_err(|e| format!("客户端错误：{}", e))?;
    let mut req = client.get(format!("{}/profiles", vs_base_checked(&endpoint)?));
    if !api_key.trim().is_empty() { req = req.header("Authorization", format!("Bearer {}", api_key.trim())) }
    let resp = req.send().await.map_err(|e| format!("请求失败：{}", e))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() { return Err(format!("获取音色失败（HTTP {}）：{}", status.as_u16(), text.chars().take(200).collect::<String>())) }
    // 兼容返回数组或 {profiles:[...]} / {data:[...]}
    let json: serde_json::Value = serde_json::from_str(&text).map_err(|_| format!("响应格式异常：{}", text.chars().take(160).collect::<String>()))?;
    let arr = if let Some(a) = json.as_array() { a.clone() }
        else if let Some(a) = json.get("profiles").and_then(|v| v.as_array()) { a.clone() }
        else if let Some(a) = json.get("data").and_then(|v| v.as_array()) { a.clone() }
        else { vec![] };
    Ok(arr)
}

/// VoiceStudio 克隆：POST /profiles（multipart: name/kind=clone/ref_audio）
#[tauri::command]
async fn voicestudio_clone(endpoint: String, api_key: String, name: String, audio_data_url: String) -> Result<String, String> {
    let (mime, bytes) = parse_data_uri(&audio_data_url)?;
    let boundary = format!("----VoiceStudioBoundary{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());
    let ext = match mime.as_str() { "audio/mpeg" | "audio/mp3" => "mp3", "audio/ogg" => "ogg", "audio/flac" => "flac", "audio/webm" => "webm", _ => "wav" };
    let mut body: Vec<u8> = Vec::new();
    let mut part = |field: &str, value: &str| {
        body.extend_from_slice(format!("--{}\r\nContent-Disposition: form-data; name=\"{}\"\r\n\r\n{}\r\n", boundary, field, value).as_bytes());
    };
    part("name", &name);
    part("kind", "clone");
    part("language", "Auto");
    body.extend_from_slice(format!("--{}\r\nContent-Disposition: form-data; name=\"ref_audio\"; filename=\"ref_audio.{}\"\r\nContent-Type: {}\r\n\r\n", boundary, ext, mime).as_bytes());
    body.extend_from_slice(&bytes);
    body.extend_from_slice(format!("\r\n--{}--\r\n", boundary).as_bytes());
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(180))
        .build().map_err(|e| format!("客户端错误：{}", e))?;
    let mut req = client.post(format!("{}/profiles", vs_base_checked(&endpoint)?))
        .header("Content-Type", format!("multipart/form-data; boundary={}", boundary));
    if !api_key.trim().is_empty() { req = req.header("Authorization", format!("Bearer {}", api_key.trim())) }
    let resp = req.body(body).send().await.map_err(|e| format!("克隆请求失败：{}", e))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() { return Err(format!("克隆失败（HTTP {}）：{}", status.as_u16(), text.chars().take(200).collect::<String>())) }
    let json: serde_json::Value = serde_json::from_str(&text).map_err(|_| format!("响应格式异常：{}", text.chars().take(160).collect::<String>()))?;
    // 兼容 {id:...} / {profile_id:...} / 直接字符串
    let id = json.get("id").and_then(|v| v.as_str())
        .or_else(|| json.get("profile_id").and_then(|v| v.as_str()))
        .or_else(|| json.as_str())
        .ok_or_else(|| format!("服务未返回音色 ID：{}", text.chars().take(200).collect::<String>()))?;
    Ok(id.to_string())
}

/// VoiceStudio 合成：POST /v1/audio/speech → 返回 data URI
#[tauri::command]
async fn voicestudio_synthesize(endpoint: String, api_key: String, voice: String, text: String) -> Result<String, String> {
    let body = serde_json::json!({
        "model": "tts-1",
        "voice": voice,
        "input": text,
        "response_format": "wav"
    });
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(180))
        .build().map_err(|e| format!("客户端错误：{}", e))?;
    let mut req = client.post(format!("{}/v1/audio/speech", vs_base_checked(&endpoint)?))
        .header("Content-Type", "application/json");
    if !api_key.trim().is_empty() { req = req.header("Authorization", format!("Bearer {}", api_key.trim())) }
    let resp = req.json(&body).send().await.map_err(|e| format!("合成请求失败：{}", e))?;
    let status = resp.status();
    if !status.is_success() {
        let t = resp.text().await.unwrap_or_default();
        return Err(format!("合成失败（HTTP {}）：{}", status.as_u16(), t.chars().take(200).collect::<String>()))
    }
    let content_type = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let bytes = resp.bytes().await.map_err(|e| format!("读取音频失败：{}", e))?;
    // 防止误把 JSON 错误当成音频
    if content_type.contains("application/json") || bytes.starts_with(b"{\"") {
        return Err(format!("合成返回非音频：{}", String::from_utf8_lossy(&bytes).chars().take(200).collect::<String>()))
    }
    let mime = if content_type.contains("audio/") { content_type.split(';').next().unwrap_or("audio/wav").to_string() }
        else if bytes.starts_with(b"ID3") || content_type.contains("mpeg") { "audio/mpeg".to_string() }
        else { "audio/wav".to_string() };
    Ok(format!("data:{};base64,{}", mime, base64_encode(&bytes)))
}

// ==================== 本地模型列表与文件选择 ====================

/// 从 Ollama /api/tags 响应解析模型名列表
fn parse_ollama_models(json: &serde_json::Value) -> Vec<String> {
    json.get("models").and_then(|m| m.as_array()).map(|arr| arr.iter()
        .filter_map(|x| x.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()))
        .collect()).unwrap_or_default()
}

/// 从 LM Studio /v1/models 响应解析模型 id 列表
fn parse_openai_models(json: &serde_json::Value) -> Vec<String> {
    json.get("data").and_then(|m| m.as_array()).map(|arr| arr.iter()
        .filter_map(|x| x.get("id").and_then(|n| n.as_str()).map(|s| s.to_string()))
        .collect()).unwrap_or_default()
}

/// 支持的本地模型文件扩展名（用于文件选择器过滤与扫描）
const MODEL_FILE_EXTS: &[&str] = &["gguf", "safetensors", "ckpt", "bin", "model", "pth"];

/// 扫描 ComfyUI models 目录下支持的模型文件（递归一层），返回相对 models 的路径
/// 递归收集模型文件（相对名去重，总量上限 5000 条防失控目录）
fn walk_model_files(dir: &std::path::Path, rel: &str, out: &mut Vec<String>, seen: &mut std::collections::HashSet<String>) {
    if out.len() >= 5000 { return; }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                let name = e.file_name().to_string_lossy().to_string();
                let next = if rel.is_empty() { name } else { format!("{}/{}", rel, name) };
                walk_model_files(&p, &next, out, seen);
            } else if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                if MODEL_FILE_EXTS.contains(&ext.to_ascii_lowercase().as_str()) {
                    let name = e.file_name().to_string_lossy().to_string();
                    let rel_name = if rel.is_empty() { name } else { format!("{}/{}", rel, name) };
                    if seen.insert(rel_name.clone()) { out.push(rel_name); }
                }
            }
        }
    }
}

fn scan_comfyui_models() -> Vec<String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let root = std::path::Path::new(&home).join("ComfyUI").join("models");
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    walk_model_files(&root, "", &mut out, &mut seen);
    out.sort();
    out
}

/// 从 Comfy Desktop 的 electron-store 配置（config.json）里泛化提取实例目录：
/// 不依赖其字段结构——收集所有「存在的绝对路径」字符串，取其 models 子目录。
/// 配置位置随版本/改名变化，逐个候选尝试。
fn comfy_desktop_models_roots() -> Vec<std::path::PathBuf> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let app_support = std::path::Path::new(&home).join("Library").join("Application Support");
    let mut roots: Vec<std::path::PathBuf> = Vec::new();
    fn collect_paths(v: &serde_json::Value, acc: &mut Vec<String>) {
        match v {
            serde_json::Value::String(s) => { if s.starts_with('/') { acc.push(s.clone()); } }
            serde_json::Value::Array(a) => { for x in a { collect_paths(x, acc); } }
            serde_json::Value::Object(m) => { for (_, x) in m { collect_paths(x, acc); } }
            _ => {}
        }
    }
    for name in ["Comfy Desktop", "ComfyUI", "Comfy", "comfyui-electron"] {
        let cfg = app_support.join(name).join("config.json");
        let Ok(text) = std::fs::read_to_string(&cfg) else { continue };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        let mut paths = Vec::new();
        collect_paths(&json, &mut paths);
        for p in paths {
            let dir = std::path::PathBuf::from(&p);
            if !dir.is_dir() { continue; }
            if dir.file_name().map(|n| n == "models").unwrap_or(false) {
                if !roots.contains(&dir) { roots.push(dir.clone()); }
            }
            let models = dir.join("models");
            if models.is_dir() && !roots.contains(&models) { roots.push(models); }
        }
    }
    roots
}

/// 解析某 ComfyUI 安装目录下的 extra_model_paths.yaml，返回 (分类, 目录) 列表（仅保留真实存在的目录）
fn extra_model_path_dirs(install_root: &std::path::Path) -> Vec<(String, std::path::PathBuf)> {
    let yaml = install_root.join("extra_model_paths.yaml");
    let Ok(text) = std::fs::read_to_string(&yaml) else { return Vec::new() };
    const CATS: [&str; 18] = ["checkpoints", "loras", "vae", "controlnet", "animatediff_models", "upscale_models", "embeddings", "clip", "unet", "diffusion_models", "text_encoders", "clip_vision", "style_models", "gligen", "hypernetworks", "photomaker", "classifiers", "animatediff_motion_lora"];
    let mut base_path: Option<std::path::PathBuf> = None;
    let mut pairs: Vec<(String, String)> = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') { continue; }
        let Some((k, v)) = line.split_once(':') else { continue };
        let key = k.trim().to_string();
        let val = v.trim().trim_matches(|c| c == '"' || c == '\'').to_string();
        if val.is_empty() { continue; }
        if key == "base_path" { base_path = Some(std::path::PathBuf::from(&val)); }
        else if CATS.contains(&key.as_str()) { pairs.push((key, val)); }
    }
    let mut out = Vec::new();
    for (key, val) in pairs {
        let p = std::path::PathBuf::from(&val);
        let resolved = if p.is_absolute() { p } else if let Some(b) = &base_path { b.join(&p) } else { install_root.join(&p) };
        if resolved.is_dir() { out.push((key, resolved)); }
    }
    out
}

/// 扩展扫描：固定目录 + Comfy Desktop 实例目录 + 各安装目录 extra_model_paths.yaml 指向的分类目录
fn scan_comfyui_models_extended() -> Vec<String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let home_root = std::path::Path::new(&home).join("ComfyUI");
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    walk_model_files(&home_root.join("models"), "", &mut out, &mut seen);
    for (cat, dir) in extra_model_path_dirs(&home_root) {
        walk_model_files(&dir, &cat, &mut out, &mut seen);
    }
    for models_root in comfy_desktop_models_roots() {
        walk_model_files(&models_root, "", &mut out, &mut seen);
        if let Some(install_root) = models_root.parent() {
            for (cat, dir) in extra_model_path_dirs(install_root) {
                walk_model_files(&dir, &cat, &mut out, &mut seen);
            }
        }
    }
    out.sort();
    out
}

/// ComfyUI 原生 API 桥接：endpoint 为相对路径（如 "prompt" / "history/<id>" / "view?filename=...&type=output"）。
/// method=POST 时 body_json 为请求体；want_image=true 时把响应二进制转 base64 返回（用于 /view 取图）。
/// 仅允许本机/局域网地址（validate_local_service_url，v0.1.285 起收紧：此前公网 https 也可达）。
#[tauri::command]
async fn comfyui_api(base_url: String, endpoint: String, method: String, body_json: String, want_image: bool) -> Result<String, String> {
    let base = validate_local_service_url(base_url.trim().trim_end_matches('/'))?;
    // endpoint 只允许简单路径与查询串，禁止 //、.. 防止路径穿越
    if endpoint.contains("..") || endpoint.starts_with("//") { return Err("非法端点".into()) }
    let url = format!("{}/{}", base, endpoint.trim_start_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(if want_image { 60 } else { 30 }))
        .redirect(reqwest::redirect::Policy::none())
        .build().map_err(|e| format!("客户端错误：{}", e))?;
    let m = method.to_uppercase();
    let mut req = if m == "POST" {
        let v: serde_json::Value = serde_json::from_str(&body_json)
            .map_err(|e| format!("请求体不是合法 JSON：{}", e))?;
        client.post(&url).json(&v)
    } else {
        client.get(&url)
    };
    let resp = req.send().await.map_err(|e| format!("请求失败：{}", e))?;
    let status = resp.status();
    if want_image {
        let bytes = resp.bytes().await.map_err(|e| format!("读取图片失败：{}", e))?;
        if !status.is_success() { return Err(format!("取图失败（HTTP {}）", status.as_u16())) }
        return Ok(base64_encode(&bytes))
    }
    let text = resp.text().await.map_err(|e| format!("读取响应失败：{}", e))?;
    if !status.is_success() { return Err(format!("接口返回 {}：{}", status.as_u16(), text.chars().take(200).collect::<String>())) }
    Ok(text)
}

/// 从 ComfyUI /object_info/CheckpointLoaderSimple 获取实时可用的 checkpoint 列表（比扫目录准确）。
#[tauri::command]
async fn comfyui_checkpoints(base_url: String) -> Result<Vec<String>, String> {
    // validate_local_service_url 已处理尾斜杠（Url 序列化补的尾斜杠会拼出 //object_info 双斜杠被 aiohttp 404）
    let base = validate_local_service_url(base_url.trim().trim_end_matches('/'))?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build().map_err(|e| format!("客户端错误：{}", e))?;
    let resp = client.get(format!("{}/object_info/CheckpointLoaderSimple", base)).send().await
        .map_err(|e| format!("连接 ComfyUI 失败：{}", e))?;
    if !resp.status().is_success() { return Err(format!("ComfyUI 返回 {}", resp.status().as_u16())) }
    let json: serde_json::Value = resp.json().await.map_err(|e| format!("响应格式异常：{}", e))?;
    let names = json.get("CheckpointLoaderSimple")
        .and_then(|v| v.get("input"))
        .and_then(|v| v.get("required"))
        .and_then(|v| v.get("ckpt_name"))
        .and_then(|v| v.get(0))
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(str::to_string)).collect::<Vec<_>>())
        .unwrap_or_default();
    if names.is_empty() { return Err("ComfyUI 未报告任何 checkpoint（可能未加载模型）".into()) }
    Ok(names)
}

/// 拉取本地服务已加载/已安装的模型列表，供添加本地模型弹窗选择。
/// key: ollama / comfyui / lmstudio；url 为探测到的服务网关地址。
#[tauri::command]
async fn fetch_local_models(key: String, url: String, scan_extra: bool) -> Result<Vec<String>, String> {
    let base = url.trim().trim_end_matches('/');
    if key == "comfyui" {
        // ComfyUI 无标准已加载模型 API，扫描 models 目录下的模型文件；
        // scan_extra（设置开关）时同时覆盖 Comfy Desktop 实例目录与 extra_model_paths.yaml
        let models = if scan_extra { scan_comfyui_models_extended() } else { scan_comfyui_models() };
        if models.is_empty() {
            return Err(if scan_extra {
                "未在 ~/ComfyUI/models 与 Comfy Desktop 实例目录下找到模型文件（支持 gguf/safetensors/ckpt/bin）".to_string()
            } else {
                "未在 ~/ComfyUI/models 下找到模型文件（支持 gguf/safetensors/ckpt/bin）".to_string()
            })
        }
        return Ok(models)
    }
    let base = validate_local_service_url(base)?;
    let (path, parser): (&str, fn(&serde_json::Value) -> Vec<String>) = match key.as_str() {
        "ollama" => ("/api/tags", parse_ollama_models),
        "lmstudio" => ("/v1/models", parse_openai_models),
        _ => return Err("未知服务".to_string()),
    };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build().map_err(|e| format!("客户端错误：{}", e))?;
    let resp = client.get(format!("{}{}", base, path)).send().await
        .map_err(|e| format!("拉取模型列表失败：{}", e))?;
    if !resp.status().is_success() { return Err(format!("拉取模型列表失败（HTTP {}）", resp.status().as_u16())) }
    let json: serde_json::Value = resp.json().await.map_err(|e| format!("响应格式异常：{}", e))?;
    Ok(parser(&json))
}

/// 从 Ollama /api/embed 响应解析向量（兼容 embeddings[0] 数组与 embedding 单数组）
fn parse_embed_vector(json: &serde_json::Value) -> Option<Vec<f64>> {
    let arr = json.get("embeddings")
        .and_then(|e| e.get(0))
        .or_else(|| json.get("embedding"))
        .and_then(|v| v.as_array())?;
    arr.iter().map(|n| n.as_f64()).collect()
}

/// 调用本机 Ollama 的嵌入接口生成文本向量（供本地文档问答/RAG 使用）。
/// base_url: 探测到的网关（如 http://127.0.0.1:11434）；model: 嵌入模型名（如 nomic-embed-text）
#[tauri::command]
async fn ollama_embed(base_url: String, model: String, input: String) -> Result<Vec<f64>, String> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() { return Err("未配置 Ollama 服务地址".to_string()) }
    let base = validate_local_service_url(base)?;
    if input.trim().is_empty() { return Err("待嵌入文本为空".to_string()) }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build().map_err(|e| format!("客户端错误：{}", e))?;
    let body = serde_json::json!({ "model": model, "input": input });
    let resp = client.post(format!("{}/api/embed", base))
        .header("Content-Type", "application/json")
        .json(&body).send().await
        .map_err(|e| format!("嵌入请求失败：{}", e))?;
    let status = resp.status();
    if !status.is_success() {
        let t = resp.text().await.unwrap_or_default();
        return Err(format!("嵌入失败（HTTP {}）：{}", status.as_u16(), t.chars().take(160).collect::<String>()))
    }
    let json: serde_json::Value = resp.json().await.map_err(|e| format!("响应格式异常：{}", e))?;
    parse_embed_vector(&json).ok_or_else(|| format!("响应中未找到向量：{}", json.to_string().chars().take(160).collect::<String>()))
}

/// 弹出系统文件选择器，让用户选择本地模型文件（不读取内容，仅返回完整路径供前端取文件名）
#[tauri::command]
fn choose_model_file() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        // AppleScript：允许选择任意文件；模型格式由前端提示
        let script = "POSIX path of (choose file with prompt \"选择本地模型文件（.gguf / .safetensors / .ckpt / .bin）\")";
        let out = std::process::Command::new("osascript")
            .arg("-e").arg(script).output()
            .map_err(|e| format!("打开文件选择器失败：{}", e))?;
        // 用户取消时 osascript 返回非 0 且 stderr 含 -128
        if !out.status.success() { return Ok(None) }
        let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
        Ok(if path.is_empty() { None } else { Some(path) })
    }
    #[cfg(not(target_os = "macos"))]
    { Err("当前平台暂不支持系统文件选择，请手动输入模型名".to_string()) }
}

// ================= 桌面外壳：托盘常驻 / 菜单栏迷你窗 / 全局快捷键 / 开机自启 =================
use tauri::menu::{MenuBuilder, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const TRAY_ID: &str = "acm-tray";
const MINI_LABEL: &str = "mini";
/// 内嵌浏览器窗口标签：Epic 领取专用（v0.1.397）
const EPIC_BROWSER_LABEL: &str = "epic-browser";
/// 内嵌浏览器领取结果事件名（发给主窗口；与 src/core/epicBrowser.ts 的 EPIC_BROWSER_EVENT 一致）
const EPIC_BROWSER_EVENT: &str = "epic-browser-claim";

/// 内嵌浏览器自动领 Epic 免费游戏用的注入脚本（v0.1.397，实验性质）。
/// 只在 Epic 商店结账页（/store/purchase）运行：轮询找领取按钮并点它，
/// 结果写进 URL hash（#epic-claim=<结果>），open_epic_browser 的轮询线程
/// 读回后发事件给主窗口。按钮文案匹配与 TS 侧的说明对照，改一处要同步另一处
/// （TS 侧不直接复用这段 JS，只解析 hash，见 epicBrowser.ts）。
/// 故意不用远程 IPC 回传：Tauri 默认拦截远程域 invoke，开
/// dangerousRemoteDomainIpcAccess 会让 epicgames.com 的任意 JS 都能调命令。
const AUTO_CLAIM_JS: &str = r##"(function () {
  if (window.__epicAutoClaimInstalled) return;
  window.__epicAutoClaimInstalled = true;
  var POLL_MS = 1000;
  var TIMEOUT_MS = 120000;
  var AFTER_CLICK_MS = 45000;
  function setState(s) {
    try {
      history.replaceState(null, '', location.pathname + location.search + '#epic-claim=' + s);
    } catch (e) { /* 忽略 */ }
  }
  function isPurchasePage() {
    return /(^|\.)epicgames\.com$/.test(location.hostname) && location.pathname.indexOf('/store/purchase') !== -1;
  }
  function visible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }
  function isClaimButton(el) {
    if (!el || el.disabled) return false;
    var t = (el.innerText || el.textContent || '').trim();
    if (!t) return false;
    return /place order|confirm order/i.test(t)
      || /^\s*get\s*$/i.test(t)
      || /领取|免费获取|免费领取|下单|提交订单|确认购买|确认下单|立即购买/.test(t);
  }
  function findClaimButton() {
    var els = document.querySelectorAll('button, [role="button"], a');
    for (var i = 0; i < els.length; i++) {
      if (visible(els[i]) && isClaimButton(els[i])) return els[i];
    }
    return null;
  }
  function isChallenge() {
    if (document.querySelector('iframe[src*="turnstile"], iframe[src*="captcha"], iframe[src*="challenge"]')) return true;
    var t = document.body ? document.body.innerText || '' : '';
    return /verify you are human|just a moment|attention required|人机验证|请验证你是人类/i.test(t);
  }
  function isLoginPage() {
    return location.pathname.indexOf('/login') !== -1
      || !!document.querySelector('form[action*="login"], input[type="password"]');
  }
  function isSuccess() {
    var t = document.body ? document.body.innerText || '' : '';
    return /thank you for your order|order confirmed|order placed|感谢您的订|订单已确认|已领取|领取成功|successfully claimed/i.test(t)
      || /confirmation|thank-you/i.test(location.pathname + location.search);
  }
  var start = Date.now();
  var clickedAt = 0;
  var timer = setInterval(function () {
    if (!isPurchasePage() && !isLoginPage()) return;
    if (isLoginPage()) { setState('login'); clearInterval(timer); return; }
    if (isChallenge()) { setState('challenge'); clearInterval(timer); return; }
    if (isSuccess()) { setState('claimed'); clearInterval(timer); return; }
    if (clickedAt) {
      if (Date.now() - clickedAt > AFTER_CLICK_MS) { clearInterval(timer); }
      return;
    }
    var btn = findClaimButton();
    if (btn) {
      try { btn.click(); } catch (e) { /* 忽略 */ }
      clickedAt = Date.now();
      setState('clicked');
      return;
    }
    if (Date.now() - start > TIMEOUT_MS) { setState('needs-manual'); clearInterval(timer); }
  }, POLL_MS);
})();"##;

/// 在内嵌浏览器窗口打开 Epic 结账页并尝试自动领取（v0.1.397，实验性质）。
/// 窗口用系统 webview（macOS WKWebView），Cookie 走默认数据存储、跨重启保留：
/// 用户在窗口内登录一次 Epic，以后打开结账页就是已登录态。自动领取靠注入
/// AUTO_CLAIM_JS 点领取按钮；结果经 URL hash 回传，轮询线程发事件给主窗口。
/// Epic/Cloudflare 反自动化检测可能拦住内嵌浏览器，届时事件报 challenge /
/// login / needs-manual / timeout，前端回落到 396 的手动兜底（系统浏览器
/// 直开结账页），绝不静默失败。只允许打开 epicgames.com 的 https 链接。
#[tauri::command]
fn open_epic_browser(app: tauri::AppHandle, url: String, title: String) -> Result<String, String> {
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("链接含非法字符".into());
    }
    let parsed: tauri::Url = url.parse().map_err(|_| "链接格式不正确".to_string())?;
    if parsed.scheme() != "https" {
        return Err("只允许 https 链接".into());
    }
    let host = parsed.host_str().unwrap_or("");
    if host != "epicgames.com" && !host.ends_with(".epicgames.com") {
        return Err("内嵌浏览器只打开 Epic 商店页面".into());
    }
    if let Some(w) = app.get_webview_window(EPIC_BROWSER_LABEL) {
        let _ = w.set_focus();
        let js = format!("window.location.href = {};", serde_json::to_string(&url).unwrap_or_default());
        let _ = w.eval(js);
        return Ok("focused".into());
    }
    let win = tauri::WebviewWindowBuilder::new(
        &app,
        EPIC_BROWSER_LABEL,
        tauri::WebviewUrl::External(parsed),
    )
    .title("Epic 领取 · AI 魔方")
    .inner_size(1120.0, 780.0)
    .build()
    .map_err(|e| format!("打开内嵌浏览器失败：{e}"))?;
    let _ = win.set_focus();
    // 轮询线程：给结账页注入自动领取脚本，并把 URL hash 里的结果发事件给主窗口。
    // 每 2 秒一轮、最多约 200 秒；窗口被用户关了就静默结束。
    let handle = app.clone();
    let checkout_url = url.clone();
    let game_title = title.clone();
    std::thread::spawn(move || {
        let mut injected_for = String::new();
        let mut clicked_reported = false;
        for _ in 0..100 {
            std::thread::sleep(std::time::Duration::from_secs(2));
            let Some(w) = handle.get_webview_window(EPIC_BROWSER_LABEL) else {
                return;
            };
            // 注意：WebviewWindow::url() 返回 Result<Url>（本版 Tauri），不是 Url
            let Ok(cur) = w.url() else { continue; };
            let cur_str = cur.as_str().to_string();
            // 登录页：内嵌浏览器里没登录 Epic，用户需在窗口内登录
            if cur.path().contains("/login") {
                let _ = handle.emit(EPIC_BROWSER_EVENT, serde_json::json!({
                    "outcome": "login", "title": game_title, "checkoutUrl": checkout_url,
                }));
                return;
            }
            // 下单后跳到确认页：算领取成功
            if clicked_reported && (cur.path().contains("confirmation") || cur.path().contains("thank-you")) {
                let _ = handle.emit(EPIC_BROWSER_EVENT, serde_json::json!({
                    "outcome": "claimed", "title": game_title, "checkoutUrl": checkout_url,
                }));
                return;
            }
            // 注入脚本写进 hash 的结果
            if let Some(frag) = cur.fragment() {
                if let Some(state) = frag.strip_prefix("epic-claim=") {
                    match state {
                        "claimed" | "challenge" | "login" | "needs-manual" => {
                            let _ = handle.emit(EPIC_BROWSER_EVENT, serde_json::json!({
                                "outcome": state, "title": game_title, "checkoutUrl": checkout_url,
                            }));
                            return;
                        }
                        "clicked" => {
                            if !clicked_reported {
                                clicked_reported = true;
                                let _ = handle.emit(EPIC_BROWSER_EVENT, serde_json::json!({
                                    "outcome": "clicked", "title": game_title, "checkoutUrl": checkout_url,
                                }));
                            }
                        }
                        _ => {}
                    }
                }
            }
            // 结账页：注入一次自动领取脚本（换了 URL 就再注入一次）
            if cur.path().contains("/store/purchase") && injected_for != cur_str {
                let _ = w.eval(AUTO_CLAIM_JS);
                injected_for = cur_str;
            }
        }
        // 200 秒还没等到终端结果
        let _ = handle.emit(EPIC_BROWSER_EVENT, serde_json::json!({
            "outcome": "timeout", "title": game_title, "checkoutUrl": checkout_url,
        }));
    });
    Ok("opened".into())
}

/// 图标显示模式：both（Dock+菜单栏）/ dock（仅 Dock，关主窗即退出）/ menubar（仅菜单栏）
static ICON_MODE: OnceLock<std::sync::Mutex<String>> = OnceLock::new();

fn icon_mode() -> String {
    ICON_MODE
        .get_or_init(|| std::sync::Mutex::new("both".to_string()))
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| "both".to_string())
}

fn set_icon_mode(mode: &str) {
    if let Ok(mut g) = ICON_MODE.get_or_init(|| std::sync::Mutex::new("both".to_string())).lock() {
        *g = mode.to_string();
    }
}

/// 迷你窗闲置自动关闭：代次（每次显示 +1，旧计时作废）/ 鼠标悬停中 / 已有交互
static MINI_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static MINI_HOVER: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static MINI_INTERACTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 迷你窗显示后启动闲置计时：无任何交互、且鼠标不在窗口上时，约 5 秒后自动隐藏。
/// 鼠标悬停会清零计时；一旦有交互（前端上报）本次显示不再自动关闭。
fn arm_mini_autohide(app: tauri::AppHandle) {
    use std::sync::atomic::Ordering;
    let gen = MINI_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    MINI_INTERACTED.store(false, Ordering::SeqCst);
    MINI_HOVER.store(false, Ordering::SeqCst);
    std::thread::spawn(move || {
        let mut idle_ms: u64 = 0;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(250));
            if MINI_GEN.load(Ordering::SeqCst) != gen {
                return;
            }
            if MINI_INTERACTED.load(Ordering::SeqCst) {
                return;
            }
            let Some(w) = app.get_webview_window(MINI_LABEL) else { return };
            if !w.is_visible().unwrap_or(false) {
                return;
            }
            if MINI_HOVER.load(Ordering::SeqCst) {
                idle_ms = 0;
                continue;
            }
            idle_ms += 250;
            if idle_ms >= 5000 {
                let _ = w.hide();
                return;
            }
        }
    });
}

/// 前端上报：鼠标是否悬停在迷你窗上
#[tauri::command]
fn mini_hover(inside: bool) {
    MINI_HOVER.store(inside, std::sync::atomic::Ordering::SeqCst);
}

/// 前端上报：用户在迷你窗内有操作（点击/按键），本次显示取消自动关闭
#[tauri::command]
fn mini_interacted() {
    MINI_INTERACTED.store(true, std::sync::atomic::Ordering::SeqCst);
}

/// 前端下发图标显示模式：both / dock / menubar
#[tauri::command]
fn icon_display_apply(app: tauri::AppHandle, mode: String) {
    set_icon_mode(&mode);
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_visible(mode != "dock");
    }
    #[cfg(target_os = "macos")]
    {
        let policy = if mode == "menubar" {
            tauri::ActivationPolicy::Accessory
        } else {
            tauri::ActivationPolicy::Regular
        };
        let _ = app.set_activation_policy(policy);
    }
}

// ===== 本地统一网关：OpenAI 兼容代理（仅监听 127.0.0.1，真实 Key 只存进程内存） =====
// 前端在保险箱解锁后把「模型 id → 上游账户列表」路由表下发到这里；本地工具（Cursor 等）
// 以 http://127.0.0.1:<port>/v1 + 网关令牌调用，按模型名路由到真实账户；
// 上游报错（401/403/429/5xx）或连接失败时自动换下一个账户重试（故障转移）。
// gateway_stop 会清掉路由与令牌；应用退出后内存路由自然消失，不落盘。

#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GatewayRouteIn {
    base_url: String,
    api_key: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct GatewayStatus {
    running: bool,
    port: u16,
    route_count: usize,
    model_count: usize,
    requests: u64,
}

struct GatewayInner {
    running: bool,
    port: u16,
    token: String,
    routes: std::collections::HashMap<String, Vec<GatewayRouteIn>>,
    requests: u64,
    stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

static GATEWAY: OnceLock<std::sync::Mutex<GatewayInner>> = OnceLock::new();

fn gateway_inner() -> &'static std::sync::Mutex<GatewayInner> {
    GATEWAY.get_or_init(|| std::sync::Mutex::new(GatewayInner {
        running: false,
        port: 0,
        token: String::new(),
        routes: std::collections::HashMap::new(),
        requests: 0,
        stop: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
    }))
}

fn gateway_blocking_client() -> &'static reqwest::blocking::Client {
    static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .user_agent("ai-credit-manager-gateway/0.1")
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_secs(180))
            .build()
            .expect("初始化网关 HTTP 客户端失败")
    })
}

#[tauri::command]
fn gateway_set_routes(routes: std::collections::HashMap<String, Vec<GatewayRouteIn>>) -> Result<usize, String> {
    let mut g = gateway_inner().lock().map_err(|_| "网关状态锁定失败".to_string())?;
    let models = routes.len();
    g.routes = routes;
    Ok(models)
}

#[tauri::command]
fn gateway_start(port: u16, token: String) -> Result<String, String> {
    if token.trim().is_empty() {
        return Err("网关令牌为空，先在设置里生成令牌".to_string());
    }
    let stop;
    {
        let mut g = gateway_inner().lock().map_err(|_| "网关状态锁定失败".to_string())?;
        if g.running && g.port == port {
            g.token = token;
            return Ok(format!("网关已在运行：http://127.0.0.1:{}/v1", port));
        }
        if g.running {
            g.stop.store(true, std::sync::atomic::Ordering::SeqCst);
            g.running = false;
        }
        stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        g.stop = stop.clone();
        g.port = port;
        g.token = token;
    }
    let listener = std::net::TcpListener::bind(("127.0.0.1", port))
        .map_err(|e| format!("端口 {} 绑定失败：{}", port, e))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    {
        let mut g = gateway_inner().lock().map_err(|_| "网关状态锁定失败".to_string())?;
        g.running = true;
    }
    std::thread::spawn(move || {
        while !stop.load(std::sync::atomic::Ordering::SeqCst) {
            match listener.accept() {
                Ok((stream, _)) => {
                    std::thread::spawn(move || gateway_handle_conn(stream));
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(std::time::Duration::from_millis(120));
                }
                Err(_) => break,
            }
        }
    });
    Ok(format!("网关已开启：http://127.0.0.1:{}/v1", port))
}

#[tauri::command]
fn gateway_stop() -> Result<(), String> {
    let mut g = gateway_inner().lock().map_err(|_| "网关状态锁定失败".to_string())?;
    g.stop.store(true, std::sync::atomic::Ordering::SeqCst);
    g.running = false;
    g.routes.clear();
    g.token.clear();
    Ok(())
}

#[tauri::command]
fn gateway_status() -> GatewayStatus {
    match gateway_inner().lock() {
        Ok(g) => GatewayStatus {
            running: g.running,
            port: g.port,
            route_count: g.routes.values().map(|v| v.len()).sum(),
            model_count: g.routes.len(),
            requests: g.requests,
        },
        Err(_) => GatewayStatus { running: false, port: 0, route_count: 0, model_count: 0, requests: 0 },
    }
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() { return None; }
    haystack.windows(needle.len()).position(|w| w == needle)
}

fn gateway_write(stream: &mut std::net::TcpStream, status: u16, reason: &str, content_type: &str, body: &[u8]) {
    use std::io::Write;
    let head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        status, reason, content_type, body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

fn gateway_err_json(stream: &mut std::net::TcpStream, status: u16, reason: &str, msg: &str) {
    let body = serde_json::json!({ "error": { "message": msg, "type": "gateway_error" } }).to_string();
    gateway_write(stream, status, reason, "application/json", body.as_bytes());
}

fn gateway_handle_conn(mut stream: std::net::TcpStream) {
    use std::io::{Read, Write};
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(180)));
    let mut buf: Vec<u8> = Vec::with_capacity(8192);
    let mut chunk = [0u8; 8192];
    let head_end;
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => return,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if let Some(pos) = find_subslice(&buf, b"\r\n\r\n") {
                    head_end = pos + 4;
                    break;
                }
                if buf.len() > 65536 { return; }
            }
            Err(_) => return,
        }
    }
    let head_text = String::from_utf8_lossy(&buf[..head_end]).to_string();
    let mut lines = head_text.lines();
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();
    let mut content_length: usize = 0;
    let mut authorization = String::new();
    let mut expect_continue = false;
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            let key = k.trim().to_ascii_lowercase();
            let val = v.trim().to_string();
            match key.as_str() {
                "content-length" => content_length = val.parse().unwrap_or(0),
                "authorization" => authorization = val,
                "expect" => expect_continue = val.eq_ignore_ascii_case("100-continue"),
                _ => {}
            }
        }
    }
    if expect_continue {
        let _ = stream.write_all(b"HTTP/1.1 100 Continue\r\n\r\n");
        let _ = stream.flush();
    }
    let mut body: Vec<u8> = buf.split_off(head_end);
    while body.len() < content_length {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => body.extend_from_slice(&chunk[..n]),
            Err(_) => break,
        }
        if body.len() > 33_554_432 { return; }
    }
    body.truncate(content_length);

    let (token, routes_snapshot) = {
        let g = match gateway_inner().lock() { Ok(g) => g, Err(_) => return };
        (g.token.clone(), g.routes.clone())
    };
    if path.starts_with("/v1/") {
        if token.is_empty() || authorization != format!("Bearer {}", token) {
            gateway_err_json(&mut stream, 401, "Unauthorized", "网关令牌不正确（Authorization: Bearer <令牌>）");
            return;
        }
    } else if path == "/" || path == "/health" {
        let body = serde_json::json!({ "ok": true, "service": "ai-credit-manager gateway" }).to_string();
        gateway_write(&mut stream, 200, "OK", "application/json", body.as_bytes());
        return;
    } else {
        gateway_err_json(&mut stream, 404, "Not Found", "路径不存在");
        return;
    }

    if method == "GET" && path == "/v1/models" {
        let data: Vec<serde_json::Value> = routes_snapshot.keys()
            .map(|id| serde_json::json!({ "id": id, "object": "model", "owned_by": "ai-credit-manager" }))
            .collect();
        let body = serde_json::json!({ "object": "list", "data": data }).to_string();
        gateway_write(&mut stream, 200, "OK", "application/json", body.as_bytes());
        return;
    }
    if !(method == "POST" && path == "/v1/chat/completions") {
        gateway_err_json(&mut stream, 404, "Not Found", "仅支持 GET /v1/models 与 POST /v1/chat/completions");
        return;
    }

    let req_json: serde_json::Value = serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null);
    let model = req_json.get("model").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let want_stream = req_json.get("stream").and_then(|v| v.as_bool()).unwrap_or(false);
    let candidates = match routes_snapshot.get(&model) {
        Some(list) if !list.is_empty() => list.clone(),
        _ => {
            gateway_err_json(&mut stream, 404, "Not Found", &format!("模型 {} 未注册路由（开启网关时按账户引擎目录注册）", model));
            return;
        }
    };
    if let Ok(mut g) = gateway_inner().lock() { g.requests += 1; }

    let client = gateway_blocking_client();
    let mut last_err = String::new();
    for (idx, route) in candidates.iter().enumerate() {
        let url = format!("{}/chat/completions", route.base_url.trim_end_matches('/'));
        let resp = client.post(&url)
            .header("Authorization", format!("Bearer {}", route.api_key))
            .header("Content-Type", "application/json")
            .body(body.clone())
            .send();
        let mut resp = match resp {
            Ok(r) => r,
            Err(e) => { last_err = format!("连接上游失败：{}", e); continue; }
        };
        let status = resp.status();
        let failover_worthy = status.as_u16() == 401 || status.as_u16() == 403 || status.as_u16() == 429 || status.is_server_error();
        if failover_worthy && idx + 1 < candidates.len() {
            last_err = format!("上游返回 {}", status);
            continue;
        }
        let reason = status.canonical_reason().unwrap_or("");
        let content_type = resp.headers().get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()).unwrap_or("application/json").to_string();
        if want_stream || content_type.contains("text/event-stream") {
            let head = format!(
                "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nConnection: close\r\nCache-Control: no-cache\r\n\r\n",
                status.as_u16(), reason, content_type
            );
            if stream.write_all(head.as_bytes()).is_err() { return; }
            let mut rbuf = [0u8; 8192];
            loop {
                match resp.read(&mut rbuf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if stream.write_all(&rbuf[..n]).is_err() { return; }
                        let _ = stream.flush();
                    }
                    Err(_) => break,
                }
            }
            let _ = stream.flush();
        } else {
            match resp.bytes() {
                Ok(bytes) => gateway_write(&mut stream, status.as_u16(), reason, &content_type, &bytes),
                Err(e) => gateway_err_json(&mut stream, 502, "Bad Gateway", &format!("读取上游响应失败：{}", e)),
            }
        }
        return;
    }
    gateway_err_json(&mut stream, 502, "Bad Gateway", &format!("所有上游账户均不可用：{}", last_err));
}

/// 最近一次托盘图标的物理矩形（x, y, w, h）：迷你窗据此定位到图标正下方弹出
static TRAY_RECT: OnceLock<std::sync::Mutex<Option<(i32, i32, i32, i32)>>> = OnceLock::new();

fn tray_rect_store() -> &'static std::sync::Mutex<Option<(i32, i32, i32, i32)>> {
    TRAY_RECT.get_or_init(|| std::sync::Mutex::new(None))
}

fn show_main_window(app: &tauri::AppHandle, section: Option<&str>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        if let Some(s) = section {
            let _ = w.emit("acm-navigate", s);
        }
    }
}

fn toggle_mini_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window(MINI_LABEL) {
        if w.is_visible().unwrap_or(false) {
            MINI_GEN.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let _ = w.hide();
        } else {
            // 定位：优先贴托盘图标正下方弹出（与图标水平居中对齐）；从未点过托盘
            // （快捷键呼出）时退回主显示器右上角。全部用物理像素计算——逻辑宽度
            // 直接相减会在 Retina 屏上让窗口溢出屏幕右缘、右侧数据被切掉。
            if let Ok(Some(monitor)) = w.primary_monitor() {
                let scale = monitor.scale_factor();
                let mon_w = monitor.size().width as i32;
                let mon_h = monitor.size().height as i32;
                let win_w = w.outer_size().map(|s| s.width as i32).unwrap_or((348.0 * scale) as i32);
                let win_h = w.outer_size().map(|s| s.height as i32).unwrap_or((470.0 * scale) as i32);
                let edge = (8.0 * scale) as i32;
                let gap = (4.0 * scale) as i32;
                let anchored = tray_rect_store().lock().ok().and_then(|g| *g);
                let (x, y) = match anchored {
                    Some((rx, ry, rw, rh)) => {
                        let cx = rx + rw / 2;
                        let x = (cx - win_w / 2).clamp(edge, (mon_w - win_w - edge).max(edge));
                        // 图标在屏幕上半部（macOS 菜单栏）→ 窗口在其下方；下半部（Windows 任务栏）→ 窗口在其上方
                        let y = if ry + rh / 2 <= mon_h / 2 { ry + rh + gap } else { (ry - win_h - gap).max(edge) };
                        (x, y)
                    }
                    None => ((mon_w - win_w - (12.0 * scale) as i32).max(0), (32.0 * scale) as i32),
                };
                let _ = w.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(x, y)));
            }
            let _ = w.show();
            let _ = w.set_focus();
            arm_mini_autohide(app.clone());
        }
    }
}

/// 前端下发快捷键设置：先注销全部，再按开关与自定义组合重新注册（设置页动态生效）
#[tauri::command]
fn shortcuts_apply(app: tauri::AppHandle, enabled: bool, ai: Option<String>, mini: Option<String>) -> Result<(), String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    if !enabled {
        return Ok(());
    }
    let parse = |s: Option<String>| -> Result<Option<Shortcut>, String> {
        match s {
            None => Ok(None),
            Some(v) => v
                .parse::<Shortcut>()
                .map(Some)
                .map_err(|e| format!("快捷键格式无效（{v}）：{e}")),
        }
    };
    if let Some(sc) = parse(ai)? {
        let h = app.clone();
        gs.on_shortcut(sc, move |_app, _s, event| {
            if event.state == ShortcutState::Pressed {
                show_main_window(&h, Some("ai"));
            }
        })
        .map_err(|e| format!("注册 AI 助手快捷键失败（可能被其他应用占用）：{e}"))?;
    }
    if let Some(sc) = parse(mini)? {
        let h = app.clone();
        gs.on_shortcut(sc, move |_app, _s, event| {
            if event.state == ShortcutState::Pressed {
                toggle_mini_window(&h);
            }
        })
        .map_err(|e| format!("注册迷你窗快捷键失败（可能被其他应用占用）：{e}"))?;
    }
    Ok(())
}

/// 显示主窗口并（可选）跳转到指定页签（迷你窗/托盘/快捷键共用）
#[tauri::command]
fn show_main(app: tauri::AppHandle, section: Option<String>) {
    show_main_window(&app, section.as_deref());
}

#[tauri::command]
fn mini_hide(app: tauri::AppHandle) {
    MINI_GEN.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    if let Some(w) = app.get_webview_window(MINI_LABEL) {
        let _ = w.hide();
    }
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// Mac 系统毛玻璃增强（v0.1.294）：液态玻璃风格开启时给主窗口挂系统
/// NSVisualEffectView（Sidebar 材质）作底材，前端再把壳/侧边栏底色调透让它透上来；
/// 关闭即撤除。窗口透明由 tauri.macos.conf.json 的 transparent + macOSPrivateApi 保证。
/// 非 macOS 平台为空操作（CSS 液态玻璃在所有平台都有效，系统底材只是 Mac 的增强）。
#[tauri::command]
fn set_window_glass(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use tauri::window::{Effect, EffectState, EffectsBuilder};
        if let Some(w) = app.get_webview_window("main") {
            if enabled {
                let effects = EffectsBuilder::new()
                    .effect(Effect::Sidebar)
                    .state(EffectState::Active)
                    .build();
                let _ = w.set_effects(Some(effects));
            } else {
                let _ = w.set_effects(None);
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, enabled);
    }
    Ok(())
}

#[tauri::command]
fn autostart_is_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn autostart_set(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let m = app.autolaunch();
    if enabled { m.enable() } else { m.disable() }.map_err(|e| e.to_string())
}

/// 静默启动标记文件（app 数据目录）：存在=开启。Rust 在 webview 加载前就要
/// 做显隐决定，读不了前端 localStorage，故用标记文件存这个设备级偏好。
fn silent_start_flag_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("silent_start.flag"))
}

fn silent_start_enabled(app: &tauri::AppHandle) -> bool {
    silent_start_flag_path(app).map(|p| p.exists()).unwrap_or(false)
}

#[tauri::command]
fn silent_start_get(app: tauri::AppHandle) -> bool {
    silent_start_enabled(&app)
}

#[tauri::command]
fn silent_start_set(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let path = silent_start_flag_path(&app).ok_or("无法定位应用数据目录")?;
    if enabled {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&path, b"1").map_err(|e| e.to_string())?;
        // 自启项若是旧版本注册的（不带 --autostart 参数），重写一次让参数生效
        let m = app.autolaunch();
        if m.is_enabled().unwrap_or(false) {
            let _ = m.disable();
            let _ = m.enable();
        }
    } else if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 本次进程是否由开机自启拉起（自启注册时带 --autostart 参数，手动打开没有）
fn launched_from_autostart() -> bool {
    std::env::args().any(|a| a == "--autostart")
}

fn setup_desktop_shell(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();

    // 主窗口默认隐藏创建（tauri.conf visible:false）：普通启动立刻显示；
    // 开机自启 + 静默启动开启时不显示，只常驻托盘/菜单栏（v0.1.298）
    if let Some(main) = app.get_webview_window("main") {
        if !(launched_from_autostart() && silent_start_enabled(&handle)) {
            let _ = main.show();
        }
    }

    // 主窗口关闭行为随图标模式：菜单栏常驻（both/menubar）时隐藏到托盘；仅 Dock 时关窗即退出
    if let Some(main) = app.get_webview_window("main") {
        let main_for_event = main.clone();
        let handle_for_event = handle.clone();
        main.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if icon_mode() == "dock" {
                    handle_for_event.exit(0);
                } else {
                    api.prevent_close();
                    let _ = main_for_event.hide();
                }
            }
        });
    }

    // 迷你窗：隐藏创建，点托盘图标或快捷键时在右上角切换显隐
    let mini = tauri::WebviewWindowBuilder::new(app.handle(), MINI_LABEL, tauri::WebviewUrl::App("index.html#/mini".into()))
        .title("AI 魔方 · 速览")
        .inner_size(348.0, 470.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()?;
    let mini_for_event = mini.clone();
    let handle_for_mini = handle.clone();
    mini.on_window_event(move |event| {
        match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = mini_for_event.hide();
            }
            // 点击窗口之外（桌面 / 其他应用 / 主窗口）→ 收起，原生弹出层行为。
            // 延迟 200ms 并校验代次：点托盘图标切换时由切换逻辑先处理，避免刚关又开。
            tauri::WindowEvent::Focused(false) => {
                let gen = MINI_GEN.load(std::sync::atomic::Ordering::SeqCst);
                let app = handle_for_mini.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(200));
                    if MINI_GEN.load(std::sync::atomic::Ordering::SeqCst) != gen {
                        return;
                    }
                    if let Some(w) = app.get_webview_window(MINI_LABEL) {
                        if w.is_visible().unwrap_or(false) && !w.is_focused().unwrap_or(false) {
                            let _ = w.hide();
                        }
                    }
                });
            }
            _ => {}
        }
    });

    // 托盘菜单（右键）：打开主窗口 / AI 助手 / 今日签到 / 退出
    let menu = MenuBuilder::new(app.handle())
        .item(&MenuItem::with_id(app.handle(), "open-main", "打开主窗口", true, None::<&str>)?)
        .item(&MenuItem::with_id(app.handle(), "open-ai", "AI 助手", true, None::<&str>)?)
        .item(&MenuItem::with_id(app.handle(), "open-checkin", "今日签到", true, None::<&str>)?)
        .separator()
        .item(&MenuItem::with_id(app.handle(), "quit", "退出 AI 魔方", true, None::<&str>)?)
        .build()?;

    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("AI 魔方")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open-main" => show_main_window(app, None),
            "open-ai" => show_main_window(app, Some("ai")),
            "open-checkin" => show_main_window(app, Some("checkin")),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, rect, .. } = event {
                // 记住托盘图标位置，迷你窗据此定位到图标正下方
                let app = tray.app_handle();
                let scale = app
                    .get_webview_window(MINI_LABEL)
                    .and_then(|w| w.primary_monitor().ok().flatten())
                    .map(|m| m.scale_factor())
                    .unwrap_or(2.0);
                let p: tauri::PhysicalPosition<i32> = rect.position.to_physical(scale);
                let s: tauri::PhysicalSize<u32> = rect.size.to_physical(scale);
                if let Ok(mut g) = tray_rect_store().lock() {
                    *g = Some((p.x, p.y, s.width as i32, s.height as i32));
                }
                toggle_mini_window(app);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;

    // 全局快捷键：Cmd/Ctrl+Shift+A 呼出 AI 助手；Cmd/Ctrl+Shift+M 切换迷你窗
    #[cfg(target_os = "macos")]
    let mods = Modifiers::SUPER | Modifiers::SHIFT;
    #[cfg(not(target_os = "macos"))]
    let mods = Modifiers::CONTROL | Modifiers::SHIFT;
    let h1 = handle.clone();
    app.global_shortcut().on_shortcut(Shortcut::new(Some(mods), Code::KeyA), move |_app, _sc, event| {
        if event.state == ShortcutState::Pressed {
            show_main_window(&h1, Some("ai"));
        }
    })?;
    let h2 = handle;
    app.global_shortcut().on_shortcut(Shortcut::new(Some(mods), Code::KeyM), move |_app, _sc, event| {
        if event.state == ShortcutState::Pressed {
            toggle_mini_window(&h2);
        }
    })?;
    Ok(())
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--autostart"])))
        .register_uri_scheme_protocol("acmplugin", |_app, request| plugin_frame_response(request))
        .setup(|app| setup_desktop_shell(app))
        .invoke_handler(tauri::generate_handler![proxy_usage, call_provider_api, call_cloud_llm, send_notification, open_url, open_protocol_url, open_mic_settings, open_speech_settings, biometric_available, biometric_auth, choose_save_dir, write_file_to_dir, write_binary_to_dir, sync_file_read, sync_file_write, icloud_drive_dir, video_thumb, media_thumb, gallery_scan, photos_library_dir, update_fast_install, photos_db_assets, photos_access_probe, is_app_installed, open_local_app, detect_local_services, get_system_memory_gb, check_local_service, start_local_service, stop_local_service, is_service_app_managed, qwentts_status, qwentts_setup, qwentts_test, qwentts_synthesize, qwentts_cancel_synthesize, tts_test_direct, tts_clone_direct, tts_synthesize_direct, edge_tts_synthesize, voicestudio_test, voicestudio_list, voicestudio_clone, voicestudio_synthesize, fetch_local_models, choose_model_file, ollama_embed, stop_service_by_port, reconcile_local_service, comfyui_api, comfyui_checkpoints, show_main, mini_hide, quit_app, set_window_glass, autostart_is_enabled, autostart_set, silent_start_get, silent_start_set, shortcuts_apply, mini_hover, mini_interacted, icon_display_apply, gateway_set_routes, gateway_start, gateway_stop, gateway_status, plugin_http, plugin_http_media, plugin_frame_put, plugin_frame_remove, plugin_process_start, plugin_process_stop, plugin_process_running, plugin_process_output, open_external_path, mcp_start, mcp_write, mcp_read, mcp_stop, mcp_running, mcp_logs, list_media_apps, open_media_external, open_epic_browser, dlna::dlna_discover, dlna::dlna_play, dlna::dlna_pause, dlna::dlna_resume, dlna::dlna_stop])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");
    // macOS：主窗口隐藏到菜单栏常驻后，点击 Dock 图标只会发来 Reopen 事件；
    // 不接住它，点 Dock 就毫无反应、只能去点菜单栏图标（Ethan 实机反馈，v0.1.313 修）。
    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            show_main_window(app_handle, None);
        }
        let _ = &event;
    });
}

#[cfg(test)]
mod local_service_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn edge_gec_v2_golden() {
        // 金标准来自 edge-tts 参考实现（drm.py）在同时间戳的输出，逐字节对拍
        assert_eq!(edge_gec_v2_at(1764042000), "1ABB96183A2C256D-73B639A3F44394AE3242A9C6C8F2630C9D2E0665AD6F71D066E6B2DE285DA1FC");
        assert_eq!(edge_gec_v2_at(1764000000), "BB2B3ADE6A8DD1F3-B07567543B86F99C3539F563D8D3368C59A22CAF50BF1E35F42DA34792F80A76");
        assert_eq!(edge_gec_v2_at(1700000000), "2CD23A2CA0B2595A-F3C846C370E05F9CC83ACC5F995C5F5D87A4D0F14CE8936A0F902E64099E38A2");
    }

    #[test]
    fn ollama_fingerprint_matches_only_ollama_shape() {
        assert!(fp_ollama(&json!({"models": [{"name": "llama3"}]})));
        assert!(!fp_ollama(&json!({"status": "ok"})));
        assert!(!fp_ollama(&json!({})));
    }

    #[test]
    fn comfyui_fingerprint_requires_system_and_devices() {
        assert!(fp_comfyui(&json!({"system": {}, "devices": []})));
        assert!(!fp_comfyui(&json!({"system": {}}))); // 缺 devices 不算
        assert!(!fp_comfyui(&json!({"hello": "world"})));
    }

    #[test]
    fn lmstudio_fingerprint_matches_openai_models_shape() {
        assert!(fp_lmstudio(&json!({"data": [{"id": "m"}]})));
        assert!(!fp_lmstudio(&json!({"models": []}))); // Ollama 形状不算 LM Studio
        assert!(!fp_lmstudio(&json!({})));
    }

    #[test]
    fn parse_macos_memsize() {
        let bytes_16g = 16u64 * 1024 * 1024 * 1024;
        assert_eq!(parse_memsize_bytes_macos(&bytes_16g.to_string()), Some(16.0));
        assert_eq!(parse_memsize_bytes_macos("17179869184\n"), Some(16.0));
        assert_eq!(parse_memsize_bytes_macos("invalid"), None);
    }

    #[test]
    fn parse_linux_meminfo() {
        let meminfo = "MemTotal:       16384256 kB\nMemFree:         1234567 kB\n";
        let gb = parse_meminfo_linux(meminfo).unwrap();
        assert!(gb > 15.0 && gb < 17.0, "解析结果 {} 应接近 16GB", gb);
        assert_eq!(parse_meminfo_linux("no mem here"), None);
    }

    #[test]
    fn parse_embed_vector_ok() {
        let j = serde_json::json!({"model":"nomic-embed-text","embeddings":[[0.1, -0.2, 0.3]]});
        let v = parse_embed_vector(&j).unwrap();
        assert_eq!(v.len(), 3);
        assert!((v[1] + 0.2).abs() < 1e-9);
        let j2 = serde_json::json!({"embedding":[1.0, 2.0]});
        assert_eq!(parse_embed_vector(&j2).unwrap().len(), 2);
        assert!(parse_embed_vector(&serde_json::json!({})).is_none());
    }

    #[test]
    fn parse_ollama_models_ok() {
        let j = serde_json::json!({"models":[{"name":"llama3:latest"},{"name":"qwen2.5:7b"}]});
        assert_eq!(parse_ollama_models(&j), vec!["llama3:latest", "qwen2.5:7b"]);
        assert!(parse_ollama_models(&serde_json::json!({})).is_empty());
    }

    #[test]
    fn parse_openai_models_ok() {
        let j = serde_json::json!({"data":[{"id":"model-a"},{"id":"model-b"}]});
        assert_eq!(parse_openai_models(&j), vec!["model-a", "model-b"]);
        assert!(parse_openai_models(&serde_json::json!({"data":[]})).is_empty());
    }

    #[test]
    fn service_port_ok() {
        assert_eq!(service_port("ollama"), Some(11434));
        assert_eq!(service_port("comfyui"), Some(8188));
        assert_eq!(service_port("lmstudio"), Some(1234));
        assert_eq!(service_port("unknown"), None);
    }

    #[test]
    fn parse_clone_voice_id_ok() {
        let j = serde_json::json!({"request_id":"x","output":{"voice_id":"cosyvoice-v2-abc-123"}});
        assert_eq!(parse_clone_voice_id(&j), Some("cosyvoice-v2-abc-123".to_string()));
        assert_eq!(parse_clone_voice_id(&serde_json::json!({"output":{}})), None);
    }

    #[test]
    fn parse_synthesize_url_ok() {
        let j = serde_json::json!({"output":{"audio":{"url":"https://oss.example/a.wav"},"finish_reason":"stop"}});
        assert_eq!(parse_synthesize_url(&j), Some("https://oss.example/a.wav".to_string()));
        assert_eq!(parse_synthesize_url(&serde_json::json!({"output":{"audio":{"data":""}}})), None);
    }

    #[test]
    fn parse_test_ok_requires_request_id() {
        assert!(parse_test_ok(&serde_json::json!({"request_id":"req-1","output":{"voice_list":[]}})));
        assert!(!parse_test_ok(&serde_json::json!({"error":"bad key"})));
    }

    #[test]
    fn base64_encode_standard() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
    }

    #[test]
    fn qwentts_fingerprint_requires_status_ok_and_model() {
        assert!(fp_qwentts(&json!({"status": "ok", "model": "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit", "uptime": 42.0})));
        assert!(!fp_qwentts(&json!({"status": "ok"}))); // 缺 model 不算（无关 Web 服务也常回 status ok）
        assert!(!fp_qwentts(&json!({"status": "error", "model": "x"})));
        assert!(!fp_qwentts(&json!({})));
    }

    #[test]
    fn local_service_ports_are_distinct() {
        assert_eq!(service_port("ollama"), Some(11434));
        assert_eq!(service_port("comfyui"), Some(8188));
        assert_eq!(service_port("lmstudio"), Some(1234));
        assert_eq!(service_port("qwentts"), Some(18123));
        assert_eq!(service_port("unknown"), None);
    }

    #[test]
    fn unrelated_services_do_not_match_any_fingerprint() {
        // 占用 8080/5000 的无关 Web 服务响应，不应被误判为任何本地模型服务
        for body in [json!({"status": "ok"}), json!({"hello": "world"}), json!({"version": "1.0"})] {
            assert!(!fp_ollama(&body) && !fp_comfyui(&body) && !fp_lmstudio(&body) && !fp_qwentts(&body));
        }
    }
}
