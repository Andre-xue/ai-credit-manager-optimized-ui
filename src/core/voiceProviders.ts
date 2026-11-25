// 语音服务目录：按"免费优先"排序，供设置页展示与选择。
// 说明：真正的密钥必须放在用户自己的服务端代理，客户端只保存端点地址。

export type VoiceProviderId = 'system' | 'local' | 'voicestudio' | 'qwentts' | 'aliyun' | 'volcengine' | 'tencent' | 'minimax' | 'elevenlabs'

export interface VoiceProviderDef {
  id: VoiceProviderId
  name: string
  short: string
  desc: string
  free: string
  paid: string
  /** 免费优先排序，越小越优先 */
  rank: number
  docs: string
  recommended?: boolean
}

export const VOICE_PROVIDERS: VoiceProviderDef[] = [
  {
    id: 'system', name: '系统内置音色', short: '系统', rank: 1,
    desc: '无需网络、无需 Key、完全免费；音质取决于设备已安装的语音包。',
    free: '完全免费，离线可用', paid: '无',
    docs: 'https://www.workbuddy.cn',
    recommended: true,
  },
  {
    id: 'local', name: '本地自部署（CosyVoice / GPT-SoVITS）', short: '本地', rank: 2,
    desc: '自己部署开源模型，浏览器/App 通过本地代理调用；隐私最好。',
    free: '模型开源免费，需自备机器（约 8GB 显存）', paid: '仅电费/硬件',
    docs: 'https://github.com/FunAudioLLM/CosyVoice',
    recommended: true,
  },
  {
    id: 'voicestudio', name: 'VoiceStudio（全本地开源）', short: 'VoiceStudio', rank: 2,
    desc: '开源 ElevenLabs 替代：声音克隆/语音合成全在本机。需先在本机运行 VoiceStudio 服务（端口 3900），可复用已克隆的音色。',
    free: '软件开源免费(AGPL-3.0)，模型下载后离线可用', paid: '仅电费/硬件，GPU 更佳',
    docs: 'https://github.com/debpalash/VoiceStudio',
    recommended: true,
  },
  {
    id: 'qwentts', name: 'Qwen3-TTS 本地克隆（免费 · 本机）', short: 'Qwen3-TTS', rank: 2,
    desc: '阿里 Qwen3-TTS 开源模型在本机跑（MLX 加速）：3 秒参考音频克隆音色，合成全在本机。需先在语音配置页完成首次安装（下载约 1GB 模型），仅桌面端 Apple 芯片 Mac 可用。',
    free: '模型开源免费(Apache-2.0)，本机运行不花钱', paid: '仅电费/硬件',
    docs: 'https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base',
    recommended: true,
  },
  {
    id: 'aliyun', name: '阿里云百炼 CosyVoice / Qwen3-TTS', short: '阿里云', rank: 3,
    desc: '创建克隆音色免费，5 秒样本，中文和方言效果好。',
    free: 'CosyVoice 创建音色免费；新模型有约 90 天免费额度', paid: '合成约 ¥0.8–1.5/万字符',
    docs: 'https://help.aliyun.com/zh/model-studio/voice-cloning-and-voice-design',
    recommended: true,
  },
  {
    id: 'volcengine', name: '火山引擎 / 豆包声音复刻', short: '豆包', rank: 4,
    desc: '最接近豆包 App 的效果，实时语音交互成熟。',
    free: '约 1 个免费音色 + 5 万字符合成额度', paid: '音色 ¥138/个；合成约 ¥8/万字符',
    docs: 'https://www.volcengine.com/docs/84458/1585106',
  },
  {
    id: 'tencent', name: '腾讯云声音复刻', short: '腾讯云', rank: 5,
    desc: '实时延迟低，企业级稳定；个人使用门槛略高。',
    free: '一句话版 5 个音色 + 1 万字符免费额度', paid: '音色训练与合成按量计费',
    docs: 'https://cloud.tencent.com/document/product/1552/93105',
  },
  {
    id: 'minimax', name: 'MiniMax Speech 2.8', short: 'MiniMax', rank: 6,
    desc: '自然度国际领先，10 秒克隆；API 克隆按次收费。',
    free: '网页版每月约 1 万积分，API 克隆无免费额度', paid: '克隆 $1.5/音色；合成 $60–100/百万字符',
    docs: 'https://platform.minimax.io/docs/guides/speech-voice-clone',
  },
  {
    id: 'elevenlabs', name: 'ElevenLabs', short: 'ElevenLabs', rank: 7,
    desc: '英文与多语种最强；中文不占优，免费版不能克隆。',
    free: '免费版仅测试 TTS，不含克隆和商用授权', paid: 'Starter $6/月起',
    docs: 'https://elevenlabs.io/pricing',
  },
]

export function voiceProviderLabel(id?: string): string {
  return VOICE_PROVIDERS.find(p => p.id === id)?.short ?? id ?? '未选择'
}
