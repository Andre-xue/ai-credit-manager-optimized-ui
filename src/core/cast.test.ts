import { describe, it, expect } from 'vitest'
import {
  parseSsdpLocation,
  parseDeviceDescription,
  escapeXml,
  soapEnvelope,
  didlMetadata,
  dlnaMediaNote,
} from './cast'

const SSDP_RESP = 'HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=1800\r\nLOCATION: http://192.168.1.10:1400/xml/device_description.xml\r\nSERVER: Linux UPnP/1.0\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\nUSN: uuid:xxx::urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n'

const DEVICE_XML = `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
<device>
<deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
<friendlyName>客厅电视</friendlyName>
<serviceList>
<service>
<serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
<serviceId>urn:upnp-org:serviceId:AVTransport</serviceId>
<controlURL>/upnp/control/AVTransport</controlURL>
<eventSubURL>/upnp/event/AVTransport</eventSubURL>
<SCPDURL>/xml/AVTransport.xml</SCPDURL>
</service>
<service>
<serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType>
<serviceId>urn:upnp-org:serviceId:RenderingControl</serviceId>
<controlURL>/upnp/control/RenderingControl</controlURL>
<eventSubURL>/upnp/event/RenderingControl</eventSubURL>
<SCPDURL>/xml/RenderingControl.xml</SCPDURL>
</service>
</serviceList>
</device>
</root>`

describe('parseSsdpLocation', () => {
  it('抠出 LOCATION 头', () => {
    expect(parseSsdpLocation(SSDP_RESP)).toBe('http://192.168.1.10:1400/xml/device_description.xml')
  })
  it('大小写不敏感、无 LOCATION 返回 null', () => {
    expect(parseSsdpLocation('HTTP/1.1 200 OK\r\nlocation: http://10.0.0.2:80/d.xml\r\n\r\n')).toBe('http://10.0.0.2:80/d.xml')
    expect(parseSsdpLocation('HTTP/1.1 200 OK\r\nST: xxx\r\n\r\n')).toBeNull()
    expect(parseSsdpLocation('')).toBeNull()
  })
})

describe('parseDeviceDescription', () => {
  it('友好名 + 相对控制地址按 LOCATION 基址拼', () => {
    const d = parseDeviceDescription(DEVICE_XML, 'http://192.168.1.10:1400/xml/device_description.xml')
    expect(d).toEqual({
      name: '客厅电视',
      controlUrl: 'http://192.168.1.10:1400/upnp/control/AVTransport',
    })
  })
  it('绝对控制地址原样保留', () => {
    const xml = DEVICE_XML.replace('/upnp/control/AVTransport', 'http://192.168.1.10:9000/avt')
    const d = parseDeviceDescription(xml, 'http://192.168.1.10:1400/xml/device_description.xml')
    expect(d?.controlUrl).toBe('http://192.168.1.10:9000/avt')
  })
  it('没有 AVTransport 服务返回 null', () => {
    const xml = DEVICE_XML.replace('AVTransport:1', 'RenderingControl:1')
    expect(parseDeviceDescription(xml, 'http://192.168.1.10:1400/x.xml')).toBeNull()
  })
  it('没有友好名返回 null', () => {
    expect(parseDeviceDescription('<root></root>', 'http://192.168.1.10:1400/x.xml')).toBeNull()
  })
})

describe('escapeXml / soapEnvelope', () => {
  it('转义 & < > "', () => {
    expect(escapeXml('a&b<c>"d"')).toBe('a&amp;b&lt;c&gt;&quot;d&quot;')
  })
  it('信封包含动作名与体', () => {
    const env = soapEnvelope('Play', '<InstanceID>0</InstanceID>')
    expect(env).toContain('<u:Play')
    expect(env).toContain('urn:schemas-upnp-org:service:AVTransport:1')
    expect(env).toContain('<InstanceID>0</InstanceID>')
  })
})

describe('didlMetadata', () => {
  it('mp4 用 video/mp4，m3u8 用 mpegurl，标题转义', () => {
    const m = didlMetadata('https://cdn.example.com/a.mp4', '片名&<>')
    expect(m).toContain('video/mp4')
    expect(m).toContain('片名&amp;&lt;&gt;')
    expect(m).toContain('https://cdn.example.com/a.mp4')
    expect(didlMetadata('https://x/y.m3u8', 't')).toContain('application/vnd.apple.mpegurl')
    expect(didlMetadata('https://x/y.mkv', 't')).toContain('video/x-matroska')
  })
})

describe('dlnaMediaNote', () => {
  it('flv / m3u8 给提示，mp4 不给', () => {
    expect(dlnaMediaNote('https://x/a.flv')).toContain('FLV')
    expect(dlnaMediaNote('https://x/a.m3u8?token=1')).toContain('m3u8')
    expect(dlnaMediaNote('https://x/a.mp4')).toBeNull()
  })
})
