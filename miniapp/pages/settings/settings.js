const { load, updateSettings } = require('../../utils/providers')

const ALERT_DAYS = [1, 3, 7, 14, 30]
const UNITS = [
  { value: 'credit', label: '积分' }, { value: 'token', label: 'Tokens' },
  { value: 'request', label: '次' }, { value: 'currency', label: '元' }, { value: 'day', label: '天' },
]

Page({
  data: {
    settings: {},
    stats: { accounts: 0, quotas: 0, checkins: 0 },
    alertDaysOptions: ALERT_DAYS,
    alertDaysIndex: 2,
    unitOptions: UNITS,
    unitIndex: 0,
    showClearConfirm: false,
    themes: [],
    uiTheme: 'aurora',
    uiThemeName: '极光琉璃',
    themePrimary: '#a996ff',
  },

  onShow() { this.syncUiTheme(); this.refresh() },

  syncUiTheme() {
    const u = require('../../utils/providers')
    const id = u.getUiTheme()
    this.setData({ uiTheme: id, uiThemeName: u.getUiThemeDef(id).name, themePrimary: u.getUiThemeDef(id).tabSelected, themes: u.UI_THEMES })
    u.applyUiThemeChrome(id)
  },

  onSelectTheme(e) {
    const u = require('../../utils/providers')
    const id = e.currentTarget.dataset.id
    u.setUiTheme(id)
    this.setData({ uiTheme: id, uiThemeName: u.getUiThemeDef(id).name, themePrimary: u.getUiThemeDef(id).tabSelected })
    wx.showToast({ title: '外观已切换', icon: 'success', duration: 700 })
  },

  refresh() {
    const state = load()
    const s = state.settings
    const unitIdx = UNITS.findIndex(u => u.value === s.defaultUnit)
    this.setData({
      settings: s,
      stats: { accounts: state.accounts.length, quotas: state.quotas.length, checkins: state.checkins.length },
      alertDaysIndex: Math.max(0, ALERT_DAYS.indexOf(s.alertDays)),
      unitIndex: unitIdx >= 0 ? unitIdx : 0,
    })
  },

  goUsage() { wx.navigateTo({ url: '/pages/usage/usage' }) },
  onToggleReminder(e) { this.apply({ checkinReminder: e.detail.value }) },
  onToggleBackup(e) { this.apply({ backupReminder: e.detail.value }) },
  onAlertDays(e) { this.apply({ alertDays: ALERT_DAYS[Number(e.detail.value)] }) },
  onUnit(e) { this.apply({ defaultUnit: UNITS[Number(e.detail.value)].value }) },
  onBudget(e) {
    const v = Number(e.detail.value)
    if (!isNaN(v) && v >= 0) this.apply({ monthlyBudget: v })
  },

  apply(patch) {
    updateSettings(patch)
    this.refresh()
    wx.showToast({ title: '已保存', icon: 'success', duration: 800 })
  },

  exportData() {
    const state = load()
    const safe = {
      accounts: state.accounts.map(a => ({ id: a.id, providerId: a.providerId, label: a.label, mode: a.mode })),
      quotas: state.quotas, checkins: state.checkins, usage: state.usage, settings: state.settings,
    }
    wx.setClipboardData({
      data: JSON.stringify(safe),
      success: () => wx.showToast({ title: '数据已复制到剪贴板', icon: 'success' }),
    })
  },

  requestClear() { this.setData({ showClearConfirm: true }) },
  cancelClear() { this.setData({ showClearConfirm: false }) },
  confirmClear() {
    const state = load()
    state.accounts = []; state.quotas = []; state.checkins = []; state.usage = []
    wx.setStorageSync('acm.mini.v1', state)
    this.setData({ showClearConfirm: false })
    this.refresh()
    wx.showToast({ title: '已清空业务数据', icon: 'success' })
  },

  noop() {},
})
