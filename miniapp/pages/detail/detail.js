const { PROVIDERS, PROVIDER_MAP, load, save, today } = require('../../utils/providers')

Page({
  data: { list: [], doneCount: 0, total: 0, t: '' },

  onShow() { this.syncUiTheme(); this.refresh() },

  syncUiTheme() {
    const u = require('../../utils/providers')
    const id = u.getUiTheme()
    this.setData({ uiTheme: id })
    u.applyUiThemeChrome(id)
  },
  onPullDownRefresh() { this.refresh(); wx.stopPullDownRefresh() },

  refresh() {
    const state = load()
    const t = today()
    const usedIds = new Set(state.accounts.map((a) => a.providerId))
    const list = PROVIDERS.filter((p) => usedIds.has(p.id)).map((p) => {
      const done = state.checkins.some((c) => c.providerId === p.id && c.date === t && c.done)
      return { ...p, done, canCheckin: !!p.checkin }
    })
    const doneCount = list.filter((x) => x.done).length
    this.setData({ list, doneCount, total: list.length, t })
  },

  toggle(e) {
    const id = e.currentTarget.dataset.id
    const state = load()
    const t = today()
    const idx = state.checkins.findIndex((c) => c.providerId === id && c.date === t)
    if (idx >= 0) state.checkins[idx].done = !state.checkins[idx].done
    else state.checkins.push({ id: 'ci_' + Date.now(), providerId: id, date: t, done: true })
    save(state)
    this.refresh()
  },

  openOfficial(e) {
    const p = PROVIDER_MAP[e.currentTarget.dataset.id]
    if (!p) return
    wx.showModal({
      title: '前往 ' + p.name,
      content: '将复制官方页面链接，请在浏览器打开并登录后由你本人完成签到/查看。本小程序不自动领取、不模拟登录。',
      confirmText: '复制链接',
      success: (res) => {
        if (!res.confirm) return
        wx.setClipboardData({ data: p.checkin || p.url, success: () => wx.showToast({ title: '链接已复制', icon: 'success' }) })
      },
    })
  },
})
