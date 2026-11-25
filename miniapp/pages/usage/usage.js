const { PROVIDER_MAP, load, save, today } = require('../../utils/providers')

// 与主端一致的参考单价（元 / token），仅用于记一笔时自动估算费用
const UNIT_PRICE = {
  openai: 0.01, anthropic: 0.02, gemini: 0.001, deepseek: 0.001, qwen: 0.0005,
  kim: 0.002, doubao: 0.0008, glm: 0.0005, default: 0.01,
}

function monthPrefix() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
}

Page({
  data: {
    month: '',
    totalCost: '0.00',
    totalTokens: 0,
    recordCount: 0,
    budget: 0,
    budgetPct: 0,
    platforms: [],
    records: [],
    accounts: [],
    showForm: false,
    formAccountIndex: 0,
    formModel: '',
    formIn: '',
    formOut: '',
    formCost: '',
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
    const mp = monthPrefix()
    const accMap = {}
    state.accounts.forEach(a => { accMap[a.id] = a })
    const monthUsage = (state.usage || []).filter(u => (u.date || '').indexOf(mp) === 0)
    let cost = 0, tokens = 0
    const byProvider = {}
    monthUsage.forEach(u => {
      cost += Number(u.estimatedCost) || 0
      tokens += (Number(u.inputTokens) || 0) + (Number(u.outputTokens) || 0)
      const acc = accMap[u.accountId]
      const pid = acc ? acc.providerId : 'unknown'
      if (!byProvider[pid]) byProvider[pid] = { pid, cost: 0, tokens: 0 }
      byProvider[pid].cost += Number(u.estimatedCost) || 0
      byProvider[pid].tokens += (Number(u.inputTokens) || 0) + (Number(u.outputTokens) || 0)
    })
    const platforms = Object.keys(byProvider).map(pid => {
      const p = PROVIDER_MAP[pid] || { short: pid, color: '#6b7280' }
      return {
        pid, name: p.short || pid, color: p.color,
        cost: byProvider[pid].cost.toFixed(2),
        tokens: byProvider[pid].tokens,
        share: cost > 0 ? Math.max(2, Math.round(byProvider[pid].cost / cost * 100)) : 0,
      }
    }).sort((a, b) => Number(b.cost) - Number(a.cost))
    const records = (state.usage || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 30).map(u => {
      const acc = accMap[u.accountId]
      return {
        ...u,
        accountLabel: acc ? acc.label : '已删除账户',
        costText: (Number(u.estimatedCost) || 0).toFixed(3),
        tokens: (Number(u.inputTokens) || 0) + (Number(u.outputTokens) || 0),
      }
    })
    const budget = Number(state.settings.monthlyBudget) || 0
    this.setData({
      month: mp,
      totalCost: cost.toFixed(2),
      totalTokens: tokens,
      recordCount: monthUsage.length,
      budget,
      budgetPct: budget > 0 ? Math.min(100, Math.round(cost / budget * 100)) : 0,
      platforms,
      records,
      accounts: state.accounts.map(a => ({ id: a.id, label: a.label })),
    })
  },

  openForm() {
    if (this.data.accounts.length === 0) { wx.showToast({ title: '请先在首页添加账户', icon: 'none' }); return }
    this.setData({ showForm: true, formModel: '', formIn: '', formOut: '', formCost: '', formAccountIndex: 0 })
  },
  closeForm() { this.setData({ showForm: false }) },
  noop() {},
  onFormAccount(e) { this.setData({ formAccountIndex: Number(e.detail.value) }) },
  onFormModel(e) { this.setData({ formModel: e.detail.value }) },
  onFormIn(e) { this.setData({ formIn: e.detail.value }) },
  onFormOut(e) { this.setData({ formOut: e.detail.value }) },
  onFormCost(e) { this.setData({ formCost: e.detail.value }) },

  saveRecord() {
    const { accounts, formAccountIndex, formModel, formIn, formOut, formCost } = this.data
    const acc = accounts[formAccountIndex]
    if (!acc) { wx.showToast({ title: '请选择账户', icon: 'none' }); return }
    const inT = Math.max(0, Number(formIn) || 0)
    const outT = Math.max(0, Number(formOut) || 0)
    if (inT + outT <= 0 && !formCost) { wx.showToast({ title: '请填写 Tokens 或费用', icon: 'none' }); return }
    const state = load()
    const full = state.accounts.find(a => a.id === acc.id)
    const price = UNIT_PRICE[full ? full.providerId : ''] || UNIT_PRICE.default
    const cost = formCost !== '' && !isNaN(Number(formCost)) ? Number(formCost) : (inT + outT) * price
    state.usage.push({
      id: 'u_' + Date.now(), accountId: acc.id, date: today(),
      inputTokens: inT, outputTokens: outT, estimatedCost: Math.round(cost * 1000) / 1000,
      model: formModel || undefined,
    })
    save(state)
    this.setData({ showForm: false })
    wx.showToast({ title: '已记录', icon: 'success' })
    this.refresh()
  },

  removeRecord(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除记录', content: '确定删除这条用量记录？',
      success: (res) => {
        if (!res.confirm) return
        const state = load()
        state.usage = (state.usage || []).filter(u => u.id !== id)
        save(state)
        this.refresh()
      },
    })
  },
})
