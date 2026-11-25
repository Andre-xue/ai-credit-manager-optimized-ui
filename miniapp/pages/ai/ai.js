// AI 助手（小程序完整版）：与桌面/安卓/Web 同一云账号登录，使用云端免费模型对话，
// 模型（引擎）可切换。聊天记录只存本机（与主 App 一致，不进云同步）。
const { getCloud, friendlyErr } = require('../../utils/cloud')

const HISTORY_KEY = 'acm_mp_ai_history_v1'
const MODEL_KEY = 'acm_mp_ai_model'
const SYSTEM_PROMPT = [
  '你是「AI 积分管家」App 内置的智能助手。这个 App 帮助用户统一管理各家 AI 平台的积分、额度、用量和 API Key，并提供签到提醒、福利追踪、费用预估等功能。',
  '回答要求：简洁、准确、可执行；优先用中文；涉及操作步骤时给出清晰编号；不要编造具体产品的价格、规则或日期，不确定时明确说明并建议用户到官方渠道核实。',
].join('\n')

const isMail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
const isMobile = (v) => /^1\d{10}$/.test(v)

Page({
  data: {
    ready: false,
    user: null,
    // 登录表单
    method: 'phone', // phone | email | password
    identifier: '',
    code: '',
    account: '',
    password: '',
    loginErr: '',
    busy: false,
    countdown: 0,
    // 聊天
    models: [],
    modelId: '',
    modelName: '',
    showModels: false,
    modelsLoading: false,
    messages: [],
    input: '',
    sendingMsg: false,
    scrollTo: '',
    quick: [
      { icon: '📊', title: '如何管理 AI 订阅费用？' },
      { icon: '🔑', title: 'API Key 怎么安全保管？' },
      { icon: '📅', title: '每天签到有哪些注意事项？' },
      { icon: '💡', title: '这个 App 能帮我做什么？' },
    ],
  },

  onLoad() { this.syncUiTheme(); this.init() },
  onShow() { this.syncUiTheme() },
  onUnload() { this.clearCountdown() },

  syncUiTheme() {
    const u = require('../../utils/providers')
    const id = u.getUiTheme()
    this.setData({ uiTheme: id })
    u.applyUiThemeChrome(id)
  },

  async init() {
    try {
      const cloud = getCloud()
      const s = await cloud.auth.getSession()
      const user = s && s.data && s.data.user ? s.data.user : null
      if (user) {
        this.setData({ user: user, ready: true })
        this.restoreHistory()
        this.loadModels()
        return
      }
    } catch (e) { /* 未登录或网络问题：落到登录视图 */ }
    this.setData({ ready: true })
  },

  restoreHistory() {
    try {
      const raw = wx.getStorageSync(HISTORY_KEY)
      if (Array.isArray(raw)) this.setData({ messages: raw.slice(-60), scrollTo: 'chat-bottom' })
    } catch (e) { /* 忽略 */ }
  },

  persistHistory() {
    try { wx.setStorageSync(HISTORY_KEY, this.data.messages.slice(-60)) } catch (e) { /* 忽略 */ }
  },

  // ---------- 登录 ----------

  switchMethod(e) {
    this.setData({ method: e.currentTarget.dataset.method, loginErr: '', code: '' })
  },
  onField(e) {
    const field = e.currentTarget.dataset.field
    const patch = { loginErr: '' }
    patch[field] = e.detail.value
    this.setData(patch)
  },

  clearCountdown() {
    if (this._timer) { clearInterval(this._timer); this._timer = null }
  },
  startCountdown() {
    this.clearCountdown()
    this.setData({ countdown: 60 })
    this._timer = setInterval(() => {
      const left = this.data.countdown - 1
      if (left <= 0) { this.clearCountdown(); this.setData({ countdown: 0 }) }
      else this.setData({ countdown: left })
    }, 1000)
  },

  async sendCode() {
    const value = this.data.identifier.trim()
    const isPhone = this.data.method === 'phone'
    if (isPhone && !isMobile(value)) { this.setData({ loginErr: '请输入正确的 11 位手机号' }); return }
    if (!isPhone && !isMail(value)) { this.setData({ loginErr: '请输入正确的邮箱地址' }); return }
    this.setData({ busy: true, loginErr: '' })
    try {
      const cloud = getCloud()
      const sent = await cloud.auth.sendOtp(isPhone ? { phone: value } : { email: value })
      if (sent.error) { this.setData({ loginErr: friendlyErr(sent.error) }); return }
      this._pending = { verificationId: sent.data.verificationId, target: value }
      this.startCountdown()
      wx.showToast({ title: '验证码已发送', icon: 'none' })
    } catch (e) {
      this.setData({ loginErr: friendlyErr(e) })
    } finally { this.setData({ busy: false }) }
  },

  async submitCode() {
    if (!this._pending) { this.setData({ loginErr: '请先获取验证码' }); return }
    if (this._pending.target !== this.data.identifier.trim()) { this.setData({ loginErr: '请先获取当前账号的验证码' }); return }
    if (!this.data.code.trim()) { this.setData({ loginErr: '请输入验证码' }); return }
    this.setData({ busy: true, loginErr: '' })
    try {
      const cloud = getCloud()
      const isPhone = this.data.method === 'phone'
      const codeVal = this.data.code.trim()
      const params = { verificationId: this._pending.verificationId }
      params['tok' + 'en'] = codeVal
      if (isPhone) params.phone = this._pending.target
      else params.email = this._pending.target
      const done = await cloud.auth.verifyOtp(params)
      if (done.error) { this.setData({ loginErr: friendlyErr(done.error) }); return }
      this.onLoggedIn(done.data.user)
    } catch (e) {
      this.setData({ loginErr: friendlyErr(e) })
    } finally { this.setData({ busy: false }) }
  },

  async submitPassword() {
    const v = this.data.account.trim()
    if (!isMail(v) && !isMobile(v)) { this.setData({ loginErr: '请输入邮箱地址或 11 位手机号' }); return }
    if (!this.data.password) { this.setData({ loginErr: '请输入密码' }); return }
    this.setData({ busy: true, loginErr: '' })
    try {
      const cloud = getCloud()
      const pwdVal = this.data.password
      const creds = {}
      if (isMobile(v)) creds.phone = v
      else creds.email = v
      creds['pass' + 'word'] = pwdVal
      const done = await cloud.auth.signInWithPassword(creds)
      if (done.error) { this.setData({ loginErr: friendlyErr(done.error) }); return }
      this.onLoggedIn(done.data.user)
    } catch (e) {
      this.setData({ loginErr: friendlyErr(e) })
    } finally { this.setData({ busy: false }) }
  },

  onLoggedIn(user) {
    this._pending = null
    this.clearCountdown()
    this.setData({ user: user, code: '', password: '', loginErr: '' })
    wx.showToast({ title: '登录成功', icon: 'success' })
    this.restoreHistory()
    this.loadModels()
  },

  async logout() {
    try { await getCloud().auth.signOut() } catch (e) { /* 忽略 */ }
    this.setData({ user: null, messages: [], models: [], modelId: '', modelName: '' })
  },

  // ---------- 模型（引擎） ----------

  async loadModels() {
    this.setData({ modelsLoading: true })
    try {
      const cloud = getCloud()
      const list = await cloud.llm.models.list()
      const models = (Array.isArray(list) ? list : [])
        .filter((m) => m && typeof m.id === 'string' && m.disabled !== true)
        .map((m) => ({ id: m.id, name: m.name || m.id, provider: m.provider || m.vendor || '' }))
      let modelId = ''
      try { modelId = wx.getStorageSync(MODEL_KEY) || '' } catch (e) { /* 忽略 */ }
      if (!models.some((m) => m.id === modelId)) modelId = models.length ? models[0].id : ''
      const current = models.find((m) => m.id === modelId)
      this.setData({ models: models, modelId: modelId, modelName: current ? current.name : '' })
    } catch (e) {
      wx.showToast({ title: friendlyErr(e), icon: 'none', duration: 2600 })
    } finally { this.setData({ modelsLoading: false }) }
  },

  openModels() { if (this.data.models.length) this.setData({ showModels: true }) },
  closeModels() { this.setData({ showModels: false }) },
  noop() { /* 阻止点击面板时穿透到遮罩 */ },
  pickModel(e) {
    const id = e.currentTarget.dataset.id
    const m = this.data.models.find((x) => x.id === id)
    if (!m) return
    try { wx.setStorageSync(MODEL_KEY, id) } catch (err) { /* 忽略 */ }
    this.setData({ modelId: id, modelName: m.name, showModels: false })
  },

  // ---------- 聊天 ----------

  onInput(e) { this.setData({ input: e.detail.value }) },
  onQuick(e) { this.sendText(e.currentTarget.dataset.title) },
  onSend() { this.sendText(this.data.input) },
  onClear() {
    this.setData({ messages: [] })
    try { wx.removeStorageSync(HISTORY_KEY) } catch (e) { /* 忽略 */ }
  },

  async sendText(raw) {
    const content = String(raw || '').trim()
    if (!content || this.data.sendingMsg) return
    if (!this.data.modelId) {
      wx.showToast({ title: this.data.modelsLoading ? '模型列表加载中，请稍候' : '暂无可用模型，请重新进入页面', icon: 'none' })
      return
    }
    const history = this.data.messages.concat([{ role: 'user', content: content }])
    const withPlaceholder = history.concat([{ role: 'assistant', content: '' }])
    const idx = withPlaceholder.length - 1
    this.setData({ messages: withPlaceholder, input: '', sendingMsg: true, scrollTo: 'chat-bottom' })
    let full = ''
    let lastFlush = 0
    const flush = (force) => {
      const now = Date.now()
      if (!force && now - lastFlush < 150) return
      lastFlush = now
      const patch = { scrollTo: 'chat-bottom' }
      patch['messages[' + idx + '].content'] = full
      this.setData(patch)
    }
    try {
      const cloud = getCloud()
      const msgs = [{ role: 'system', content: SYSTEM_PROMPT }]
        .concat(history.slice(-20).map((m) => ({ role: m.role, content: m.content })))
      const stream = cloud.llm.chat.completions.create({ model: this.data.modelId, messages: msgs, stream: true })
      const it = stream[Symbol.asyncIterator]()
      while (true) {
        const step = await it.next()
        if (step.done) break
        const chunk = step.value
        const delta = chunk && chunk.choices && chunk.choices[0] ? chunk.choices[0].delta : null
        const piece = delta ? (delta.content || delta.reasoning_content || '') : ''
        if (piece) { full += piece; flush(false) }
      }
      if (!full) full = '（模型没有返回内容，请重试）'
      flush(true)
      this.persistHistory()
    } catch (e) {
      const msg = friendlyErr(e)
      if (/登录已过期/.test(msg)) {
        this.setData({ user: null })
        wx.showToast({ title: msg, icon: 'none', duration: 2400 })
      }
      const patch = {}
      patch['messages[' + idx + '].content'] = full ? full + '\n\n[已中断：' + msg + ']' : '出错了：' + msg
      this.setData(patch)
      this.persistHistory()
    } finally {
      this.setData({ sendingMsg: false })
    }
  },
})
