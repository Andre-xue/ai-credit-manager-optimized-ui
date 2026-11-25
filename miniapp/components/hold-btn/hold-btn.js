// 长按确认按钮（Hold to Confirm）— 圆形删除按钮
// 按住：外圈进度环顺时针走满（默认1秒）；中途松手倒退归零；
// 走满：wx.vibrateShort 轻震 + CSS 左右抖动 + 变对勾和「已删除」+ 触发 confirm 事件。
Component({
  properties: {
    holdMs: { type: Number, value: 1000 },
    title: { type: String, value: '删除' },
    size: { type: Number, value: 72 }, // rpx
  },
  data: {
    progress: 0,
    phase: 'idle', // idle | holding | releasing | done
  },
  lifetimes: {
    attached() { this._draw(0) },
    detached() { this._stop() },
  },
  methods: {
    _ctx(cb) {
      const q = this.createSelectorQuery()
      q.select('#ring').fields({ node: true, size: true }).exec(res => {
        if (res && res[0] && res[0].node) cb(res[0].node, res[0].node.getContext('2d'))
      })
    },
    _draw(p) {
      this._ctx((canvas, ctx) => {
        const dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : (wx.getSystemInfoSync().pixelRatio || 2)
        const cssW = this.data.size / 2 // rpx → px（750rpx 设计稿按 375px 基准）
        if (!canvas.width) { canvas.width = cssW * dpr; canvas.height = cssW * dpr }
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.scale(dpr, dpr)
        const cx = cssW / 2, cy = cssW / 2, r = cssW / 2 - 3
        // 轨道
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI)
        ctx.strokeStyle = this.data.phase === 'done' ? '#bbf7d0' : '#e5e7eb'
        ctx.lineWidth = 2.5; ctx.stroke()
        // 进度（从顶部顺时针）
        if (p > 0) {
          ctx.beginPath()
          ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * p)
          ctx.strokeStyle = this.data.phase === 'done' ? '#16a34a' : '#dc2626'
          ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.stroke()
        }
      })
    },
    _stop() { if (this._raf) { clearTimeout(this._raf); this._raf = null } },
    _forward() {
      const elapsed = Date.now() - this._startAt
      const p = Math.min(1, elapsed / this.data.holdMs)
      this.setData({ progress: p }); this._draw(p)
      if (p >= 1) this._complete()
      else this._raf = setTimeout(() => this._forward(), 16)
    },
    _back() {
      const p = this.data.progress - 0.07
      if (p <= 0) { this.setData({ progress: 0, phase: 'idle' }); this._draw(0); this._raf = null }
      else { this.setData({ progress: p }); this._draw(p); this._raf = setTimeout(() => this._back(), 16) }
    },
    _complete() {
      this._stop()
      this.setData({ progress: 1, phase: 'done' }); this._draw(1)
      wx.vibrateShort({ type: 'medium', fail() {} })
      // 先显示对勾「已删除」约 0.7 秒，再触发真正的删除
      this._confirmTimer = setTimeout(() => this.triggerEvent('confirm'), 700)
      this._doneTimer = setTimeout(() => {
        this.setData({ progress: 0, phase: 'idle' }); this._draw(0)
      }, 1400)
    },
    onStart() {
      if (this.data.phase === 'holding' || this.data.phase === 'done') return
      this._stop()
      if (this._doneTimer) { clearTimeout(this._doneTimer); this._doneTimer = null }
      if (this._confirmTimer) { clearTimeout(this._confirmTimer); this._confirmTimer = null }
      this.setData({ phase: 'holding' })
      this._startAt = Date.now()
      this._forward()
    },
    onEnd() {
      if (this.data.phase !== 'holding') return
      this._stop()
      this.setData({ phase: 'releasing' })
      this._back()
    },
    onNoop() {},
  },
})
