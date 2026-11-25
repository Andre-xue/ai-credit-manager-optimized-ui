// 数据存储偏好（v0.1.298，Ethan 要求）：三类数据的自定义存放位置。
// 路径是设备专属信息，只存本机 localStorage、不云同步、不进备份
// （与界面语言等设备级偏好同一待遇）。
// - apikey：API Key 清单文件（固定密文 JSON，与备份页的密文备份一致；明文/格式
//   在备份页选择，v0.1.300 按 Ethan 要求移除设置里的重复选项），Key 变更后自动
//   保持最新；同时作为密钥备份的默认目录（备份弹窗不再让选文件夹）
// - ai：AI 助手文件——对话导出、归档会话的 md 文件默认存这里
// - media：AI 图像/视频生成完成后自动存这里（v0.1.310 起自动保存；手动保存时也默认用此目录）

export type ApiKeyStoreFormat = 'md' | 'xlsx' | 'json' | 'txt' | 'html'
export type StorageKind = 'apikey' | 'ai' | 'media'

export interface StoragePrefs {
  /** 总开关：关了三类都不生效 */
  enabled: boolean
  apikey: { enabled: boolean; dir: string }
  ai: { enabled: boolean; dir: string }
  media: { enabled: boolean; dir: string }
}

export const STORAGE_PREFS_KEY = 'acm.storage.prefs'

export const DEFAULT_STORAGE_PREFS: StoragePrefs = {
  enabled: false,
  apikey: { enabled: true, dir: '' },
  ai: { enabled: true, dir: '' },
  media: { enabled: true, dir: '' },
}

export function loadStoragePrefs(): StoragePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_PREFS_KEY)
    if (!raw) return structuredClone(DEFAULT_STORAGE_PREFS)
    const p = JSON.parse(raw) as Partial<StoragePrefs>
    return {
      enabled: !!p.enabled,
      apikey: { ...DEFAULT_STORAGE_PREFS.apikey, ...(p.apikey ?? {}) },
      ai: { ...DEFAULT_STORAGE_PREFS.ai, ...(p.ai ?? {}) },
      media: { ...DEFAULT_STORAGE_PREFS.media, ...(p.media ?? {}) },
    }
  } catch {
    return structuredClone(DEFAULT_STORAGE_PREFS)
  }
}

export function saveStoragePrefs(prefs: StoragePrefs): void {
  try { localStorage.setItem(STORAGE_PREFS_KEY, JSON.stringify(prefs)) } catch { /* ignore */ }
}

/** 某类存储当前生效的目录：总开关开 + 该类开关开 + 已选目录，三者齐备才返回 */
export function storageDir(kind: StorageKind, prefs: StoragePrefs = loadStoragePrefs()): string | null {
  if (!prefs.enabled) return null
  const sub = prefs[kind]
  if (!sub.enabled || !sub.dir.trim()) return null
  return sub.dir.trim()
}
