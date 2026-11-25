// 复制 API Key 后定时清剪贴板：30 秒后若剪贴板里仍是这把 Key 就清空，
// 避免 Key 长期滞留在剪贴板被其他应用读走；若用户期间复制了别的内容则不动。

export async function copyKeyWithAutoClear(text: string, seconds = 30): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    return false
  }
  window.setTimeout(() => {
    void (async () => {
      try {
        const cur = await navigator.clipboard.readText()
        if (cur === text) await navigator.clipboard.writeText('')
      } catch {
        /* 无剪贴板读取权限时不强行覆盖，保护用户后来复制的内容 */
      }
    })()
  }, seconds * 1000)
  return true
}
