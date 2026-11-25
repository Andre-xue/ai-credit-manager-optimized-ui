import { describe, it, expect, beforeAll } from 'vitest'
import { webcrypto } from 'node:crypto'

// Node 环境 polyfill：WebCrypto + localStorage
beforeAll(async () => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true, writable: true })
  if (!(globalThis as any).localStorage) {
    const m = new Map<string, string>()
    ;(globalThis as any).localStorage = {
      getItem: (k: string) => m.has(k) ? m.get(k)! : null,
      setItem: (k: string, v: string) => { m.set(k, v) },
      removeItem: (k: string) => { m.delete(k) },
      clear: () => m.clear(),
    }
  }
})

const {
  fingerprint, isVaultInitialized, initVault, verifyVault, encryptSecret, decryptSecret,
  resetVault, changeMasterPassword, getVaultSyncMaterial, applyVaultSyncMaterial,
  saveBiometricPassword, getBiometricPassword,
} = await import('./crypto')

describe('保险箱同步材料不含主密码凭据（安全回归）', () => {
  it('getVaultSyncMaterial 绝不返回可还原的主密码', () => {
    resetVault()
    saveBiometricPassword('super-secret-master-pwd')
    const mat = getVaultSyncMaterial()
    expect(mat.biometricPwd == null || mat.biometricPwd === '').toBe(true)
    expect(JSON.stringify(mat)).not.toContain('super-secret-master-pwd')
  })

  it('applyVaultSyncMaterial 忽略旧数据里的 biometricPwd，不还原到本机', () => {
    resetVault()
    applyVaultSyncMaterial({ salt: 's', verify: 'v', biometricPwd: 'obfuscated-old-pwd' })
    expect(getBiometricPassword()).toBeNull()
  })
})

describe('fingerprint', () => {
  it('短密钥打码', () => {
    expect(fingerprint('abc')).toBe('••••')
  })
  it('长密钥仅保留前四后四', () => {
    const f = fingerprint('sk-1234567890abcdef')
    expect(f.startsWith('sk-1')).toBe(true)
    expect(f.endsWith('cdef')).toBe(true)
    expect(f).toContain('····')
    expect(f).not.toContain('567890')
  })
})

describe('本地保险箱', () => {
  it('初始化后可校验主密码，错误密码被拒', async () => {
    resetVault()
    expect(isVaultInitialized()).toBe(false)
    await initVault('correct-password')
    expect(isVaultInitialized()).toBe(true)
    expect(await verifyVault('correct-password')).toBe(true)
    expect(await verifyVault('wrong-password')).toBe(false)
  })

  it('加密解密往返', async () => {
    resetVault()
    await initVault('mypassword')
    const secret = 'sk-abcdefghijklmnop'
    const cipher = await encryptSecret(secret, 'mypassword')
    expect(cipher).not.toContain(secret)
    expect(cipher.split(':')).toHaveLength(2)
    expect(await decryptSecret(cipher, 'mypassword')).toBe(secret)
  })

  it('错误主密码解密失败', async () => {
    resetVault()
    await initVault('rightpass')
    const cipher = await encryptSecret('secret-value', 'rightpass')
    await expect(decryptSecret(cipher, 'wrongpass')).rejects.toThrow()
  })

  it('短主密码被拒绝', async () => {
    resetVault()
    await expect(initVault('123')).rejects.toThrow(/至少 8 位/)
  })

  it('重置后保险箱不可用', async () => {
    await initVault('abcdef99')
    resetVault()
    expect(isVaultInitialized()).toBe(false)
    expect(await verifyVault('abcdef')).toBe(false)
  })
})

describe('changeMasterPassword', () => {
  it('修改密码后用新密码可解密，旧密码失效', async () => {
    resetVault()
    await initVault('oldpass8')
    const cipher = await encryptSecret('sk-secret-value', 'oldpass8')
    const [newCipher] = await changeMasterPassword('oldpass8', 'newpass8', [cipher])
    expect(await verifyVault('newpass8')).toBe(true)
    expect(await verifyVault('oldpass8')).toBe(false)
    expect(await decryptSecret(newCipher, 'newpass8')).toBe('sk-secret-value')
    await expect(decryptSecret(newCipher, 'oldpass8')).rejects.toThrow()
  })

  it('原密码错误时抛错且不改动保险箱', async () => {
    resetVault()
    await initVault('correctpass')
    const cipher = await encryptSecret('secret', 'correctpass')
    await expect(changeMasterPassword('wrongpass', 'newpassword', [cipher])).rejects.toThrow(/原主密码错误/)
    // 保险箱仍可用原密码
    expect(await verifyVault('correctpass')).toBe(true)
    expect(await decryptSecret(cipher, 'correctpass')).toBe('secret')
  })

  it('新密码过短被拒绝', async () => {
    resetVault()
    await initVault('oldpass8')
    await expect(changeMasterPassword('oldpass8', '123', [])).rejects.toThrow(/至少 8 位/)
  })

  it('可批量重加密多条密钥', async () => {
    resetVault()
    await initVault('oldpass8')
    const ciphers = await Promise.all(['key1', 'key2', 'key3'].map(k => encryptSecret(k, 'oldpass8')))
    const renewed = await changeMasterPassword('oldpass8', 'newpass8', ciphers)
    const plains = await Promise.all(renewed.map(c => decryptSecret(c, 'newpass8')))
    expect(plains).toEqual(['key1', 'key2', 'key3'])
  })
})
