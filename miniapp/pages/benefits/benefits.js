const { PROVIDERS, PROVIDER_MAP, load, save, today } = require('../../utils/providers')

Page({
  data: { list: [] },

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
    const list = (state.benefitMarks || []).map((m) => ({
      ...m,
      label: PROVIDER_MAP[m.benefitId]?.name || m.benefitId,
    }))
    this.setData({ list })
  },

  openOfficial(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    // 小程序内 web-view 需在业务域名白名单；这里用复制链接兜底，由用户本人打开
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '官网链接已复制', icon: 'none' }),
    })
  },
})
