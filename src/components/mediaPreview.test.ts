import { describe, it, expect, vi } from 'vitest'
import { spaceOpenProps, videoResumeProps } from './mediaPreview'

describe('spaceOpenProps 空格放大', () => {
  it('焦点在卡片本身时空格/回车触发打开并阻止滚动', () => {
    const open = vi.fn()
    const card = { tag: 'card' }
    const ev = (key: string, target: unknown) => ({
      key, target, currentTarget: card, preventDefault: vi.fn(),
    }) as unknown as React.KeyboardEvent<HTMLElement>
    const props = spaceOpenProps(open)
    props.onKeyDown(ev(' ', card))
    expect(open).toHaveBeenCalledTimes(1)
    props.onKeyDown(ev('Enter', card))
    expect(open).toHaveBeenCalledTimes(2)
  })
  it('焦点在内部按钮时不触发（按钮保留自己的空格行为）', () => {
    const open = vi.fn()
    const card = { tag: 'card' }
    const btn = { tag: 'button' }
    const ev = { key: ' ', target: btn, currentTarget: card, preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>
    spaceOpenProps(open).onKeyDown(ev)
    expect(open).not.toHaveBeenCalled()
  })
})

describe('videoResumeProps 移开暂停/移回续播', () => {
  function fakeVideo() {
    return {
      paused: false, ended: false, currentTime: 12.5, dataset: {} as Record<string, string>,
      pause() { this.paused = true },
      async play() { this.paused = false },
    }
  }
  it('播放中移开 → 暂停且不重置进度；移回 → 从同一帧续播', async () => {
    const v = fakeVideo()
    const ev = () => ({ currentTarget: v }) as unknown as React.MouseEvent<HTMLVideoElement>
    videoResumeProps.onMouseLeave(ev())
    expect(v.paused).toBe(true)
    expect(v.currentTime).toBe(12.5)
    expect(v.dataset.hoverResume).toBe('1')
    videoResumeProps.onMouseEnter(ev())
    await Promise.resolve()
    expect(v.paused).toBe(false)
    expect(v.currentTime).toBe(12.5)
  })
  it('用户手动暂停后移开/移回不会自动播放', async () => {
    const v = fakeVideo()
    v.paused = true
    const ev = () => ({ currentTarget: v }) as unknown as React.MouseEvent<HTMLVideoElement>
    videoResumeProps.onMouseLeave(ev())
    expect(v.dataset.hoverResume).toBeUndefined()
    videoResumeProps.onMouseEnter(ev())
    await Promise.resolve()
    expect(v.paused).toBe(true)
  })
})
