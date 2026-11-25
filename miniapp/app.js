// app.js
App({
  globalData: {
    providerMap: {},
  },
  onLaunch() {
    const u = require('./utils/providers')
    this.globalData.providerMap = u.PROVIDER_MAP
    this.globalData.uiTheme = u.getUiTheme()
    u.applyUiThemeChrome(this.globalData.uiTheme)
    this.checkUpdate()
  },

  /** 切换外观：仅更新显示层，业务数据保持不变 */
  setUiTheme(id) {
    const u = require('./utils/providers')
    this.globalData.uiTheme = u.setUiTheme(id)
    return this.globalData.uiTheme
  },

  // 应用更新：微信官方更新机制（检测 → 下载 → 弹窗确认重启）
  checkUpdate() {
    if (typeof wx === 'undefined' || !wx.getUpdateManager) return
    try {
      const um = wx.getUpdateManager()
      um.onCheckForUpdate((res) => {
        if (res.hasUpdate) wx.showToast({ title: '发现新版本，正在下载', icon: 'none' })
      })
      um.onUpdateReady(() => {
        wx.showModal({
          title: '更新提示',
          content: '新版本已下载完成，重启后即可使用。是否立即重启？',
          confirmText: '立即重启',
          cancelText: '稍后',
          success: (r) => { if (r.confirm) um.applyUpdate() },
        })
      })
      um.onUpdateFailed(() => {
        wx.showToast({ title: '更新下载失败，请检查网络', icon: 'none' })
      })
    } catch (e) { /* 非小程序环境忽略 */ }
  },
})
