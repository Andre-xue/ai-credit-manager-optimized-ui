import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// 与 vite.config.ts 保持同一套插件；仅把测试超时放宽到 20s：
// crypto 的 PBKDF2 重加密用例在低核沙箱全量并行时多次卡 5s 默认超时（单独跑均通过），避免假失败。
export default defineConfig({
  plugins: [react()],
  test: { testTimeout: 20000 },
})
