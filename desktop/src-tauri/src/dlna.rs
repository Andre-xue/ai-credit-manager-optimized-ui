//! DLNA 投屏（v0.1.409）：桌面端用 SSDP 发现局域网 MediaRenderer，SOAP 控制播放。
//! 只做最小集：发现 / 播放 / 暂停 / 继续 / 停止。
//! 安全：控制地址只允许 SSDP 回包里的局域网地址（is_local_host 校验），
//! 不接受公网地址；播放地址（m3u8/mp4）是用户正在看的源，由前端传入。
//! 命令都是同步 fn（仓库里 gallery_scan 等同步命令做阻塞 I/O 已是既定做法）。

use std::net::UdpSocket;
use std::time::Duration;

const AVTRANSPORT_URN: &str = "urn:schemas-upnp-org:service:AVTransport:1";
const SSDP_ADDR: &str = "239.255.255.250:1900";

/// SSDP 回包里抠 LOCATION 头（大小写不敏感）
pub fn parse_ssdp_location(resp: &str) -> Option<String> {
    for line in resp.lines() {
        let l = line.trim();
        if l.len() > 9 && l[..9].eq_ignore_ascii_case("location:") {
            let v = l[9..].trim();
            if !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    None
}

fn tag_content<'a>(xml: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let s = xml.find(&open)? + open.len();
    let e = xml[s..].find(&close)? + s;
    Some(xml[s..e].trim())
}

fn resolve_url(base: &str, rel: &str) -> String {
    if rel.starts_with("http://") || rel.starts_with("https://") {
        return rel.to_string();
    }
    match reqwest::Url::parse(base).and_then(|b| b.join(rel)) {
        Ok(u) => u.to_string(),
        Err(_) => rel.to_string(),
    }
}

/// 设备描述 XML 里找友好名 + AVTransport 控制地址（相对地址按 LOCATION 基址拼）
pub fn parse_device_description(xml: &str, base: &str) -> Option<(String, String)> {
    let name = tag_content(xml, "friendlyName")?.to_string();
    let mut rest = xml;
    loop {
        let s = rest.find("<service>")? + "<service>".len();
        let e = rest[s..].find("</service>")? + s;
        let block = &rest[s..e];
        let st = tag_content(block, "serviceType").unwrap_or("");
        if st.contains("AVTransport") {
            let ctrl = tag_content(block, "controlURL")?;
            return Some((name, resolve_url(base, ctrl)));
        }
        rest = &rest[e + "</service>".len()..];
    }
}

pub fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

pub fn soap_envelope(action: &str, body: &str) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:{} xmlns:u=\"{}\">{}</u:{}></s:Body></s:Envelope>",
        action, AVTRANSPORT_URN, body, action
    )
}

fn mime_of_url(url: &str) -> &'static str {
    let path = url.split('?').next().unwrap_or("").to_lowercase();
    if path.ends_with(".m3u8") {
        "application/vnd.apple.mpegurl"
    } else if path.ends_with(".mkv") {
        "video/x-matroska"
    } else if path.ends_with(".webm") {
        "video/webm"
    } else if path.ends_with(".mov") {
        "video/quicktime"
    } else if path.ends_with(".avi") {
        "video/x-msvideo"
    } else {
        "video/mp4"
    }
}

/// SetAVTransportURI 用的 DIDL-Lite 元数据（部分严格电视空元数据会拒）
pub fn didl_metadata(media_url: &str, title: &str) -> String {
    let mime = mime_of_url(media_url);
    let t = if title.trim().is_empty() { "AI 魔方" } else { title };
    format!(
        "<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\"><item id=\"0\" parentID=\"0\" restricted=\"1\"><dc:title>{}</dc:title><upnp:class>object.item.videoItem</upnp:class><res protocolInfo=\"http-get:*:{}:*\" >{}</res></item></DIDL-Lite>",
        escape_xml(t),
        mime,
        escape_xml(media_url)
    )
}

fn validate_control_url(raw: &str) -> Result<reqwest::Url, String> {
    let u = reqwest::Url::parse(raw).map_err(|_| "投屏地址格式不对".to_string())?;
    if u.scheme() != "http" {
        return Err("投屏只支持局域网 http 地址".into());
    }
    let host = u.host_str().ok_or_else(|| "投屏地址缺少主机".to_string())?;
    if !super::is_local_host(host) {
        return Err("投屏只允许局域网设备地址".into());
    }
    Ok(u)
}

fn soap_post(control_url: &str, action: &str, body: &str) -> Result<String, String> {
    let url = validate_control_url(control_url)?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("建投屏请求失败：{}", e))?;
    let env = soap_envelope(action, body);
    let resp = client
        .post(url)
        .header("Content-Type", "text/xml; charset=\"utf-8\"")
        .header("SOAPACTION", format!("\"{}#{}\"", AVTRANSPORT_URN, action))
        .body(env)
        .send()
        .map_err(|e| format!("投屏请求失败：{}", e))?;
    let status = resp.status();
    let text = resp.text().unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "电视返回 HTTP {}：{}",
            status.as_u16(),
            text.chars().take(200).collect::<String>()
        ));
    }
    Ok(text)
}

/// SSDP 搜局域网里的 DLNA 电视/盒子（约 3 秒），返回 JSON 数组 [{name, location, controlUrl}]
#[tauri::command]
pub fn dlna_discover() -> Result<String, String> {
    let sock = UdpSocket::bind("0.0.0.0:0").map_err(|e| format!("打不开发送端口：{}", e))?;
    sock.set_read_timeout(Some(Duration::from_millis(3000))).ok();
    let msg = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ns=01\"\r\nMX: 2\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\nUSER-AGENT: AI-Cube/1.0 UPnP/1.0\r\n\r\n";
    sock.send_to(msg.as_bytes(), SSDP_ADDR)
        .map_err(|e| format!("发不出搜索包：{}", e))?;
    let mut buf = [0u8; 8192];
    let mut locations: Vec<String> = vec![];
    let deadline = std::time::Instant::now() + Duration::from_millis(3200);
    loop {
        if std::time::Instant::now() > deadline {
            break;
        }
        match sock.recv_from(&mut buf) {
            Ok((n, _)) => {
                let text = String::from_utf8_lossy(&buf[..n]).to_string();
                if let Some(loc) = parse_ssdp_location(&text) {
                    if !locations.contains(&loc) {
                        locations.push(loc);
                    }
                }
            }
            Err(_) => break,
        }
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| format!("建请求失败：{}", e))?;
    let mut devices = vec![];
    for loc in locations {
        let xml = match client.get(&loc).send().and_then(|r| r.text()) {
            Ok(t) => t,
            Err(_) => continue,
        };
        if let Some((name, control_url)) = parse_device_description(&xml, &loc) {
            devices.push(serde_json::json!({ "name": name, "location": loc, "controlUrl": control_url }));
        }
    }
    Ok(serde_json::Value::Array(devices).to_string())
}

/// 投屏播放：SetAVTransportURI + Play
#[tauri::command]
pub fn dlna_play(control_url: String, media_url: String, title: String) -> Result<String, String> {
    let meta = escape_xml(&didl_metadata(&media_url, &title));
    let body = format!(
        "<InstanceID>0</InstanceID><CurrentURI>{}</CurrentURI><CurrentURIMetaData>{}</CurrentURIMetaData>",
        escape_xml(&media_url),
        meta
    );
    soap_post(&control_url, "SetAVTransportURI", &body)?;
    soap_post(&control_url, "Play", "<InstanceID>0</InstanceID><Speed>1</Speed>")
}

/// 暂停投屏
#[tauri::command]
pub fn dlna_pause(control_url: String) -> Result<String, String> {
    soap_post(&control_url, "Pause", "<InstanceID>0</InstanceID>")
}

/// 继续投屏
#[tauri::command]
pub fn dlna_resume(control_url: String) -> Result<String, String> {
    soap_post(&control_url, "Play", "<InstanceID>0</InstanceID><Speed>1</Speed>")
}

/// 停止投屏
#[tauri::command]
pub fn dlna_stop(control_url: String) -> Result<String, String> {
    soap_post(&control_url, "Stop", "<InstanceID>0</InstanceID>")
}

#[cfg(test)]
mod dlna_tests {
    use super::*;

    #[test]
    fn ssdp_location_case_insensitive() {
        let resp = "HTTP/1.1 200 OK\r\nlocation: http://192.168.1.10:1400/d.xml\r\nST: xxx\r\n\r\n";
        assert_eq!(
            parse_ssdp_location(resp).as_deref(),
            Some("http://192.168.1.10:1400/d.xml")
        );
        assert_eq!(parse_ssdp_location("HTTP/1.1 200 OK\r\nST: xxx\r\n\r\n"), None);
    }

    #[test]
    fn device_description_relative_control_url() {
        let xml = r#"<?xml version="1.0"?><root><device><friendlyName>客厅电视</friendlyName><serviceList><service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/upnp/control/AVTransport</controlURL></service></serviceList></device></root>"#;
        let d = parse_device_description(xml, "http://192.168.1.10:1400/xml/d.xml").unwrap();
        assert_eq!(d.0, "客厅电视");
        assert_eq!(d.1, "http://192.168.1.10:1400/upnp/control/AVTransport");
    }

    #[test]
    fn device_description_without_avtransport_is_none() {
        let xml = r#"<root><device><friendlyName>音箱</friendlyName><serviceList><service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/rc</controlURL></service></serviceList></device></root>"#;
        assert!(parse_device_description(xml, "http://192.168.1.10:1400/x.xml").is_none());
    }

    #[test]
    fn soap_envelope_escapes_title() {
        let meta = didl_metadata("https://x/a.mp4?a=1&b=2", "片名&<>\"");
        assert!(meta.contains("video/mp4"));
        assert!(meta.contains("片名&amp;&lt;&gt;&quot;"));
        assert!(meta.contains("https://x/a.mp4?a=1&amp;b=2"));
        let env = soap_envelope("Play", "<InstanceID>0</InstanceID>");
        assert!(env.contains("<u:Play"));
        assert!(env.contains(AVTRANSPORT_URN));
    }

    #[test]
    fn mime_by_extension() {
        assert_eq!(mime_of_url("https://x/a.m3u8"), "application/vnd.apple.mpegurl");
        assert_eq!(mime_of_url("https://x/a.mkv"), "video/x-matroska");
        assert_eq!(mime_of_url("https://x/a.mp4"), "video/mp4");
    }
}
