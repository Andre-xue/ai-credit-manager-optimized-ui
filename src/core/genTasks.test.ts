import { describe, it, expect } from 'vitest'
import { getGenTask, startGenTask, subscribeGenTask, resetGenTask } from './genTasks'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('genTasks 云端生成任务管理器', () => {
  it('任务在订阅者取消订阅（页面切走）后仍完成并保留结果', async () => {
    resetGenTask('image')
    const seen: string[] = []
    const unsub = subscribeGenTask('image', () => seen.push(getGenTask('image').status))
    const started = startGenTask('image', '一只猫', async (rep) => {
      rep.advance(30, '生成中')
      await sleep(30)
      return { results: ['https://x/1.png'], note: 'ok', doneLabel: '生成完成' }
    })
    expect(started).toBe(true)
    expect(getGenTask('image').status).toBe('running')
    unsub() // 模拟页面卸载
    await sleep(80)
    const s = getGenTask('image')
    expect(s.status).toBe('done')
    expect(s.results).toEqual(['https://x/1.png'])
    expect(s.progress.percent).toBe(100)
    expect(seen.length).toBeGreaterThan(0)
  })

  it('运行中重复启动被拒绝', async () => {
    resetGenTask('video')
    const first = startGenTask('video', '海浪', async () => { await sleep(40); return { results: [], note: '' } })
    const second = startGenTask('video', '海浪2', async () => ({ results: [], note: '' }))
    expect(first).toBe(true)
    expect(second).toBe(false)
    await sleep(70)
    expect(getGenTask('video').status).toBe('done')
  })

  it('执行体抛错 → error 状态带错误信息', async () => {
    resetGenTask('image')
    startGenTask('image', 'x', async () => { throw new Error('接口返回 401') })
    await sleep(20)
    const s = getGenTask('image')
    expect(s.status).toBe('error')
    expect(s.note).toContain('401')
    expect(s.progress.phase).toBe('error')
  })

  it('advance 只增不减且同步到 note', async () => {
    resetGenTask('video')
    startGenTask('video', 'y', async (rep) => {
      rep.advance(50, '一半')
      rep.advance(20, '回退尝试')
      await sleep(10)
      return { results: [], note: 'done' }
    })
    await sleep(5)
    expect(getGenTask('video').progress.percent).toBeGreaterThanOrEqual(50)
    await sleep(30)
    expect(getGenTask('video').status).toBe('done')
  })
})
