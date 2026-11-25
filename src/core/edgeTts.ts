// Edge 免费音色：微软 Edge「大声朗读」的云端神经网络音色（非官方接口，无需 Key、不花钱）。
// 手机端 WebView 直接走 WSS；桌面端 WKWebView 里 new WebSocket 会抛 SecurityError
// 「The operation is insecure.」（自定义协议非安全上下文），故桌面端走 Rust 原生命令
// edge_tts_synthesize（同一套协议）。微软若调整校验（Sec-MS-GEC 版本号），需跟着更新 GEC_VERSION。
import { isDesktopApp } from './openExternal'

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
function getInvoke(): Invoke | null {
  if (!isDesktopApp()) return null
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: Invoke } }
  return w.__TAURI_INTERNALS__?.invoke ?? null
}
const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const GEC_VERSION = '2-143.0.3650.75'
const EDGE_VOICE_KEY = 'acm.tts.edgeVoice'
const SPEAK_PREF_KEY = 'acm.tts.speakPref'

export interface EdgeVoice { id: string; name: string; desc: string }
export const EDGE_VOICES: EdgeVoice[] = [
  { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓', desc: '女声 · 温暖自然' },
  { id: 'zh-CN-XiaoyiNeural', name: '晓伊', desc: '女声 · 活泼明亮' },
  { id: 'zh-CN-liaoning-XiaobeiNeural', name: '晓北', desc: '女声 · 东北口音' },
  { id: 'zh-CN-YunjianNeural', name: '云健', desc: '男声 · 沉稳有力' },
  { id: 'zh-CN-YunyangNeural', name: '云扬', desc: '男声 · 新闻播报' },
  { id: 'zh-CN-YunxiaNeural', name: '云夏', desc: '男声 · 少年清朗' },
]

export function getEdgeVoiceId(): string {
  try {
    const saved = localStorage.getItem(EDGE_VOICE_KEY)
    // 已保存的音色若不在当前列表里（例如微软把该音色从免费朗读目录下架），回落到默认音色，避免合成必失败
    return saved && EDGE_VOICES.some(v => v.id === saved) ? saved : EDGE_VOICES[0].id
  } catch { return EDGE_VOICES[0].id }
}
export function setEdgeVoiceId(id: string): void {
  try { localStorage.setItem(EDGE_VOICE_KEY, id) } catch { /* ignore */ }
}
/** 朗读音色来源偏好：'edge' 时全局走 Edge 免费音色；选克隆/系统音色时清掉 */
export function getSpeakPref(): string {
  try { return localStorage.getItem(SPEAK_PREF_KEY) ?? '' } catch { return '' }
}
export function setSpeakPref(v: string): void {
  try { if (v) localStorage.setItem(SPEAK_PREF_KEY, v); else localStorage.removeItem(SPEAK_PREF_KEY) } catch { /* ignore */ }
}

// ---- Sec-MS-GEC v2（微软 2026 年改版：定制 SHA-256 + CS64 校验，移植自 edge-tts 参考实现） ----
// v1 的普通 SHA256 已被服务端拒绝（握手 403）。本移植已用金标准时间戳与参考实现逐字节对拍；
// Rust 原生通道（desktop/src-tauri/src/lib.rs）有同一算法与金标准测试，两处改版需同步。
const GEC_INITIAL = [0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19]
const GEC_STATE = [0xFD9FBEA2, 0x91243CE7, 0xBE499094, 0xCD2E1E0A, 0x6C006F49, 0x04BD35AB, 0xFEB0A7E4, 0x03EFFBD2]
const GEC_SCHEDULE = [0xEB24BF9E, 0x1558691F, 0xA0C09EE2, 0x0CFA32BA, 0xA622EE8C, 0xD1DD9491, 0xC0DD25A0, 0xF9E70AB6, 0xF0C31573, 0x7058CE4E, 0x7188E606, 0x00E5AB33, 0xD258B060, 0x72766564]
const GEC_K = [0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5, 0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174, 0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA, 0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967, 0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85, 0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070, 0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3, 0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2]
const GEC_ADJ = 0xC9DC06A7
const GEC_BLOCK_K = GEC_K.slice(0, 14).concat([GEC_ADJ], GEC_K.slice(15))
const GEC_S0ADJ = 0x059C0B80
const GEC_S1ADJ = 0x000B92C0
const GEC_CS64: Array<[number, number]> = [[0xE82E91B1, 0xB32700D0], [0x44DE24C6, 0x88DFF51D], [0x3BEB65BC, 0x29514038], [0xC89C5933, 0xB328CBDF], [0x8D1EC211, 0xD405B4D5], [0x314EF5D5, 0x26E55F3C], [0xE92491B1, 0x607801C6], [0xF0A5B9D5, 0x82B2C1FB], [0x06064CF3, 0xFA51A3DA], [0xDA79FA60, 0x207CC464], [0xBED20560, 0x3C3C74F3], [0x89F9C9F8, 0xD2D14B61], [0x35FA38C6, 0xBB04A2C1], [0xCB49E3C6, 0xC5626167]]
const GEC_CS64_FACTOR = 0x82893933
const GEC_CS64_ADJ0 = 0xF2F90B1A
const GEC_CS64_ADJ1 = 0x0B1A0000

const gecRotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0
const gecSigma0 = (x: number) => (((x >>> 7) ^ (x << 25) ^ (x >>> 18) ^ (x << 14) ^ (x >>> 3)) >>> 0)
const gecSigma1 = (x: number) => (((x >>> 17) ^ (x << 15) ^ (x >>> 19) ^ (x << 13) ^ (x >>> 10)) >>> 0)
const gecRol16 = (v: number) => (((v << 16) | (v >>> 16)) >>> 0)

function gecRounds(state: number[], words: number[], firstRound: number): number[] {
  let [a, b, c, d, e, f, g, h] = state
  const constants = firstRound === 14 ? GEC_BLOCK_K : GEC_K
  for (let i = firstRound; i < 64; i++) {
    const s1 = (gecRotr(e, 6) ^ gecRotr(e, 11) ^ gecRotr(e, 25)) >>> 0
    const ch = (g ^ (e & (f ^ g))) >>> 0
    const t1 = (h + s1 + ch + constants[i] + words[i]) >>> 0
    const s0 = (gecRotr(a, 2) ^ gecRotr(a, 13) ^ gecRotr(a, 22)) >>> 0
    const maj = ((a & b) | (c & (a | b))) >>> 0
    const t2 = (s0 + maj) >>> 0
    const na = (t1 + t2) >>> 0
    const ne = (d + t1) >>> 0
    h = g; g = f; f = e; e = ne; d = c; c = b; b = a; a = na
  }
  return [a, b, c, d, e, f, g, h]
}

function gecExpand(words: number[], firstWord: number): void {
  for (let i = firstWord; i < 64; i++) {
    words.push((gecSigma1(words[i - 2]) + words[i - 7] + gecSigma0(words[i - 15]) + words[i - 16]) >>> 0)
  }
}

function gecShaInit(data7: number[]): number[] {
  const be = (bytes: number[]) => bytes.reduce((acc, x) => ((acc << 8) | x) >>> 0, 0)
  const words: number[] = new Array(14).fill(0)
  words.push(be(data7.slice(0, 3)), be(data7.slice(3, 7)))
  for (let index = 16; index < 30; index++) {
    let value = GEC_SCHEDULE[index - 16]
    if (index - 2 >= 14) value += index === 16 ? (gecSigma1(words[index - 2]) ^ GEC_S1ADJ) >>> 0 : gecSigma1(words[index - 2])
    if (index - 7 >= 14) value += words[index - 7]
    if (index - 15 >= 14) value += index === 29 ? (gecSigma0(words[index - 15]) ^ GEC_S0ADJ) >>> 0 : gecSigma0(words[index - 15])
    words.push(value >>> 0)
  }
  words.push((gecSigma1(words[28]) + words[23] + gecSigma0(words[15]) + words[14] + GEC_ADJ - GEC_K[14]) >>> 0)
  gecExpand(words, 31)
  const working = gecRounds(GEC_STATE, words, 14)
  return GEC_INITIAL.map((x, i) => (x + working[i]) >>> 0)
}

function gecShaDigest(data: number[]): number[] {
  const length = 57 + data.length
  const zeros = (((55 - length) % 64) + 64) % 64
  const padded = [...data.slice(7), 0x80, ...new Array(zeros).fill(0)]
  const bitLen = length * 8
  for (let i = 7; i >= 0; i--) padded.push(Math.floor(bitLen / 2 ** (8 * i)) % 256)
  let state = gecShaInit(data.slice(0, 7))
  for (let off = 0; off < padded.length; off += 64) {
    const words: number[] = []
    for (let i = 0; i < 16; i++) words.push(((padded[off + 4 * i] << 24) | (padded[off + 4 * i + 1] << 16) | (padded[off + 4 * i + 2] << 8) | padded[off + 4 * i + 3]) >>> 0)
    gecExpand(words, 16)
    const working = gecRounds(state, words, 0)
    state = state.map((x, i) => (x + working[i]) >>> 0)
  }
  const out: number[] = []
  for (const w of state) out.push((w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255)
  return out
}

function gecWordsLe4Even(data: number[]): number[] {
  const padded = [...data]
  while (padded.length % 4) padded.push(0)
  const words: number[] = []
  for (let i = 0; i < padded.length; i += 4) words.push((padded[i] | (padded[i + 1] << 8) | (padded[i + 2] << 16) | (padded[i + 3] << 24)) >>> 0)
  if (words.length % 2) words.push(0)
  return words
}

function gecCs64Digest(data: number[], digest: number[]): [number, number] {
  const le = (off: number) => (digest[off] | (digest[off + 1] << 8) | (digest[off + 2] << 16) | (digest[off + 3] << 24)) >>> 0
  const keyA = (le(0) | 1) >>> 0
  const keyB = (le(4) | 1) >>> 0
  const factors = [Math.imul(keyA, GEC_CS64_FACTOR) >>> 0, Math.imul(keyB, GEC_CS64_FACTOR) >>> 0]
  const terms = GEC_CS64.map(([coef], i) => Math.imul(coef, factors[i % 2]) >>> 0)
  const offsets = GEC_CS64.map(([, off]) => off)
  gecWordsLe4Even([0, ...data]).forEach((word, index) => {
    let term = Math.imul(word, index % 2 === 0 ? keyA : keyB)
    let offset = Math.imul(gecRol16(word), index % 2 === 0 ? 0xEF0569FB : 0xC31713DB)
    if (index === 0) {
      term = (term + Math.imul(GEC_CS64_ADJ0, factors[0])) >>> 0
      offset = (offset + GEC_CS64_ADJ1) >>> 0
    }
    terms.push(term >>> 0)
    offsets.push(offset >>> 0)
  })
  let swapAcc = 0
  let swapLast = 0
  let state = 0
  let acc = 0
  for (let index = 0; index < terms.length; index += 2) {
    const x = terms[index]
    const y = terms[index + 1]
    let t = gecRol16((offsets[index] + x) >>> 0)
    let q = Math.imul(t, 0x76F50F34) >>> 0
    swapAcc = (swapAcc + ((Math.imul(gecRol16(q), 0xC3EFEA97) + q) >>> 0)) >>> 0
    t = gecRol16((offsets[index + 1] + y) >>> 0)
    q = Math.imul(t, 0x1881CE3C) >>> 0
    swapLast = (Math.imul(gecRol16(q), 0x35BD1EC9) + q) >>> 0
    swapAcc = (swapAcc + swapLast) >>> 0
    state = (Math.imul(state, keyA) + x) >>> 0
    state = Math.imul(gecRol16(state), 0xCF98B111) >>> 0
    state = Math.imul(gecRol16(state), 0x87085B9F) >>> 0
    state = Math.imul(gecRol16(state), 0x12CEB96D) >>> 0
    state = Math.imul(gecRol16(state), 0x257E1D83) >>> 0
    acc = (acc + state) >>> 0
    t = (Math.imul(state, keyB) + y) >>> 0
    t = Math.imul(gecRol16(t), 0xA27416F5) >>> 0
    t = Math.imul(gecRol16(t), 0xD38396FF) >>> 0
    state = Math.imul(gecRol16(Math.imul(gecRol16(t), 0x7C932B89) >>> 0), 0xBFA49F69) >>> 0
    acc = (acc + state) >>> 0
  }
  return [(swapLast ^ state) >>> 0, (swapAcc ^ acc) >>> 0]
}

function secMsGec(): string {
  let ticks = Math.floor(Date.now() / 1000) + 11644473600
  ticks -= ticks % 300
  const str = `${ticks * 10000000}${TOKEN}`
  const data = [...str].map(c => c.charCodeAt(0))
  const digest = gecShaDigest(data)
  const [c1, c2] = gecCs64Digest(data, digest)
  const cs64 = [c1 & 255, (c1 >>> 8) & 255, (c1 >>> 16) & 255, (c1 >>> 24) & 255, c2 & 255, (c2 >>> 8) & 255, (c2 >>> 16) & 255, (c2 >>> 24) & 255]
    .map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  const sha = digest.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  return `${cs64}-${sha}`
}

function edgeTimestamp(): string {
  const d = new Date()
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const p = (n: number) => String(n).padStart(2, '0')
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${p(d.getUTCDate())} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** 用指定 Edge 音色合成一句话，返回 mp3 的 ArrayBuffer。桌面端走 Rust 原生 WSS，其余走 WebView WSS */
export async function synthesizeEdgeMp3(text: string, voice: string): Promise<ArrayBuffer> {
  const invoke = getInvoke()
  if (invoke) {
    const dataUrl = await invoke('edge_tts_synthesize', { text, voice }) as string
    const b64 = dataUrl.split(',')[1] ?? ''
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes.buffer
  }
  return synthesizeEdgeMp3Ws(text, voice)
}

/** WebView 内 WSS 直连实现（手机端用；桌面端 WKWebView 会抛 insecure 错误，不走这里） */
async function synthesizeEdgeMp3Ws(text: string, voice: string): Promise<ArrayBuffer> {
  const gec = secMsGec()
  const connId = (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join(''))
  const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TOKEN}&ConnectionId=${connId}&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=${GEC_VERSION}`
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    const chunks: Uint8Array[] = []
    const timer = setTimeout(() => { try { ws.close() } catch { /* ignore */ } reject(new Error('Edge 音色合成超时')) }, 30000)
    const reqId = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('')
    ws.onopen = () => {
      const ts = edgeTimestamp()
      ws.send(`X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`)
      ws.send(`X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}\r\nPath:ssml\r\n\r\n<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN"><voice name="${voice}"><prosody pitch="+0Hz" rate="+0%" volume="+0%">${xmlEscape(text)}</prosody></voice></speak>`)
    }
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        if (ev.data.includes('Path:turn.end')) {
          clearTimeout(timer)
          try { ws.close() } catch { /* ignore */ }
          const total = chunks.reduce((n, c) => n + c.length, 0)
          if (!total) { reject(new Error('Edge 未返回音频')); return }
          const out = new Uint8Array(total)
          let off = 0
          for (const c of chunks) { out.set(c, off); off += c.length }
          resolve(out.buffer)
        }
        return
      }
      const buf = new Uint8Array(ev.data as ArrayBuffer)
      if (buf.length < 2) return
      const headerLen = (buf[0] << 8) | buf[1]
      const header = new TextDecoder().decode(buf.slice(2, 2 + headerLen))
      if (header.includes('Path:audio')) chunks.push(buf.slice(2 + headerLen))
    }
    ws.onerror = () => { clearTimeout(timer); reject(new Error('Edge 音色连接失败（网络不通或微软接口变更）')) }
  })
}
