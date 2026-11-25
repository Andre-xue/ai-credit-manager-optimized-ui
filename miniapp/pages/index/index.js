const { PROVIDERS, PROVIDER_MAP, load, save, today } = require('../../utils/providers')

Page({
  data: {
    stats: { accounts: 0, platforms: 0, low: 0, pending: 0 },
    accounts: [],
    showAdd: false,
    pickProvider: false,
    selectedProvider: '',
    formLabel: '',
    formMode: 'manual',
    formTotal: '',
    formUsed: '',
    providerList: PROVIDERS,
    providerMap: PROVIDER_MAP,
    showEdit: false,
    editAccountId: '',
    editLabel: '',
    editTotal: '',
    editUsed: '',
    editUnit: 'credit',
    editUnitLabel: '积分',
    editResetAt: '',
  },

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
    const accounts = state.accounts.map((a) => {
      const p = PROVIDER_MAP[a.providerId] || { short: a.providerId, color: '#6b7280', initials: '?' }
      const accountQuotas = state.quotas.filter((x) => x.accountId === a.id)
      const q = accountQuotas.reduce((latest, x) => (!latest || x.capturedAt > latest.capturedAt ? x : latest), null)
      const total = q ? q.total : 0
      const used = q ? q.used : 0
      const pct = total > 0 ? Math.min(100, Math.round(used / total * 100)) : 0

      // 用量预测：基于窗口内快照的 used 增量估算日均消耗
      let forecastText = ''
      let forecastLevel = ''
      if (q && total > 0 && accountQuotas.length >= 2) {
        const now = Date.now()
        const windowMs = 14 * 86400000
        const inWindow = accountQuotas.filter((x) => new Date(x.capturedAt).getTime() >= now - windowMs)
        const first = inWindow[0]
        if (first && q.capturedAt >= first.capturedAt) {
          const span = (new Date(q.capturedAt).getTime() - new Date(first.capturedAt).getTime()) / 86400000
          if (span >= 0.5 && q.used > first.used) {
            const burn = (q.used - first.used) / span
            const daysLeft = Math.max(0, (total - q.used) / burn)
            forecastLevel = daysLeft <= 3 ? 'critical' : daysLeft <= 7 ? 'warning' : 'healthy'
            forecastText = daysLeft <= 0 ? '额度已用尽' : '按近期速度约 ' + Math.ceil(daysLeft) + ' 天后耗尽'
          }
        }
      }

      return {
        ...a,
        providerName: p.name || p.short,
        initials: p.initials,
        color: p.color,
        total: total,
        used: used,
        remaining: total - used,
        pct: pct,
        barColor: pct >= 90 ? '#dc2626' : pct >= 70 ? '#d97706' : '#059669',
        hasQuota: !!q,
        forecastText: forecastText,
        forecastLevel: forecastLevel,
      }
    })
    const low = accounts.filter((a) => a.pct >= 80).length
    const usedPlatforms = new Set(state.accounts.map((a) => a.providerId))
    const pending = Array.from(usedPlatforms).filter((pid) => {
      const p = PROVIDER_MAP[pid]
      if (!p || !p.checkin) return false
      return !state.checkins.some((c) => c.providerId === pid && c.date === t && c.done)
    }).length
    this.setData({
      accounts,
      stats: { accounts: accounts.length, platforms: usedPlatforms.size, low, pending },
    })
  },

  openAdd() { this.setData({ showAdd: true, pickProvider: false, selectedProvider: '', formLabel: '', formTotal: '', formUsed: '' }) },
  closeAdd() { this.setData({ showAdd: false }) },
  noop() {},

  chooseProvider() { this.setData({ pickProvider: true }) },
  selectProvider(e) {
    const id = e.currentTarget.dataset.id
    const p = PROVIDER_MAP[id]
    this.setData({ selectedProvider: id, pickProvider: false, formLabel: p ? '我的 ' + p.short + ' 账户' : '' })
  },

  onLabel(e) { this.setData({ formLabel: e.detail.value }) },
  onTotal(e) { this.setData({ formTotal: e.detail.value }) },
  onUsed(e) { this.setData({ formUsed: e.detail.value }) },

  saveAccount() {
    const { selectedProvider, formLabel, formTotal, formUsed } = this.data
    if (!selectedProvider) { wx.showToast({ title: '请选择平台', icon: 'none' }); return }
    const state = load()
    const id = 'acc_' + Date.now()
    state.accounts.push({ id, providerId: selectedProvider, label: formLabel || PROVIDER_MAP[selectedProvider].short, mode: 'manual', createdAt: new Date().toISOString() })
    const total = Number(formTotal) || 0
    const used = Number(formUsed) || 0
    if (formTotal !== '') {
      state.quotas = state.quotas.filter((q) => q.accountId !== id)
      state.quotas.push({ id: 'q_' + Date.now(), accountId: id, unit: 'credit', total, used, capturedAt: new Date().toISOString(), source: 'manual' })
    }
    save(state)
    this.setData({ showAdd: false })
    wx.showToast({ title: '已添加', icon: 'success' })
    this.refresh()
  },

  editQuota(e) {
    const id = e.currentTarget.dataset.id
    const state = load()
    const acc = state.accounts.find((a) => a.id === id)
    if (!acc) return
    const q = state.quotas.find((x) => x.accountId === id)
    const unitLabels = { credit: '积分', token: 'Tokens', request: '次', currency: '元', day: '天' }
    this.setData({
      showEdit: true,
      editAccountId: id,
      editLabel: acc.label,
      editTotal: q ? String(q.total) : '',
      editUsed: q ? String(q.used) : '0',
      editUnit: q ? (q.unit || 'credit') : 'credit',
      editUnitLabel: unitLabels[q?.unit || 'credit'] || '积分',
      editResetAt: q && q.resetAt ? q.resetAt.slice(0, 10) : '',
    })
  },

  closeEdit() { this.setData({ showEdit: false }) },
  onEditTotal(e) { this.setData({ editTotal: e.detail.value }) },
  onEditUsed(e) { this.setData({ editUsed: e.detail.value }) },
  onEditReset(e) { this.setData({ editResetAt: e.detail.value }) },
  onEditUnit(e) {
    const units = ['credit', 'token', 'request', 'currency', 'day']
    const unit = units[Number(e.detail.value)] || 'credit'
    const unitLabels = { credit: '积分', token: 'Tokens', request: '次', currency: '元', day: '天' }
    this.setData({ editUnit: unit, editUnitLabel: unitLabels[unit] || '积分' })
  },

  saveQuota() {
    const { editAccountId, editLabel, editTotal, editUsed, editUnit, editResetAt } = this.data
    if (editTotal === '' || isNaN(Number(editTotal)) || Number(editTotal) < 0 ||
        editUsed === '' || isNaN(Number(editUsed)) || Number(editUsed) < 0) {
      wx.showToast({ title: '请输入有效数字', icon: 'none' }); return
    }
    const state = load()
    state.accounts = state.accounts.map((a) => a.id === editAccountId ? { ...a, label: editLabel || a.label, updatedAt: new Date().toISOString() } : a)
    state.quotas = state.quotas.filter((q) => q.accountId !== editAccountId)
    state.quotas.push({
      id: 'q_' + Date.now(), accountId: editAccountId, unit: editUnit,
      total: Number(editTotal), used: Number(editUsed),
      resetAt: editResetAt ? new Date(editResetAt + 'T23:59:59').toISOString() : undefined,
      capturedAt: new Date().toISOString(), source: 'manual',
    })
    save(state)
    this.setData({ showEdit: false })
    wx.showToast({ title: '额度已更新', icon: 'success' })
    this.refresh()
  },

  clearQuota() {
    const id = this.data.editAccountId
    wx.showModal({
      title: '清除额度',
      content: '确定清除该账户的额度记录？账户本身会保留。',
      success: (res) => {
        if (!res.confirm) return
        const state = load()
        state.quotas = state.quotas.filter((q) => q.accountId !== id)
        save(state)
        this.setData({ showEdit: false })
        wx.showToast({ title: '已清除', icon: 'success' })
        this.refresh()
      },
    })
  },

  removeAccount(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '移除账户',
      content: '确定移除该账户及其额度记录？',
      success: (res) => {
        if (!res.confirm) return
        const state = load()
        state.accounts = state.accounts.filter((a) => a.id !== id)
        state.quotas = state.quotas.filter((q) => q.accountId !== id)
        save(state)
        this.refresh()
        wx.showToast({ title: '已移除', icon: 'success' })
      },
    })
  },

  openOfficial(e) {
    const id = e.currentTarget.dataset.id
    const p = PROVIDER_MAP[id]
    if (!p) return
    wx.showModal({
      title: '前往官方页面',
      content: '将复制官方用量页链接到剪贴板，请在浏览器打开并登录后查看。本小程序不自动领取、不模拟登录。',
      confirmText: '复制链接',
      success: (res) => {
        if (!res.confirm) return
        wx.setClipboardData({ data: p.url, success: () => wx.showToast({ title: '链接已复制', icon: 'success' }) })
      },
    })
  },

  goCheckin() { wx.switchTab({ url: '/pages/detail/detail' }) },
  goUsage() { wx.navigateTo({ url: '/pages/usage/usage' }) },
})
