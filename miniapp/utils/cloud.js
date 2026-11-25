// WorkBuddy 云（小程序版官方 SDK）：与 Web / 桌面 / 安卓同一个云应用、同一账号体系，
// 登录后数据与模型都走同一网关。配置为公开配置（publishableKey 本身不含权限，
// 服务端按来源校验），与主 App 的 src/core/cloud.ts 保持一致。
const sdk = require('../vendor/workbuddy-cloud')

const CONFIG = {
  endpoint: 'https://wbapp-uxzyxkkqofad4mwe1lca5e.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_uxZyXKKqOfad4mWe1LCa5E_eay4EyhsGD7Qb3o46G1JqqvdU5VGfd7q',
}

let client = null

function getCloud() {
  if (client) return client
  try {
    if (typeof sdk.ensureMiniProgramPolyfills === 'function') sdk.ensureMiniProgramPolyfills()
  } catch (e) { /* polyfill 失败不阻断，创建客户端时再暴露问题 */ }
  client = sdk.createMiniProgramWorkBuddyCloud({
    endpoint: CONFIG.endpoint,
    oauthRelayBaseUrl: CONFIG.oauthRelayBaseUrl,
    publishableKey: CONFIG.publishableKey,
    wx: typeof wx !== 'undefined' ? wx : undefined,
  })
  return client
}

/** 把 SDK/网络错误翻译成可操作的中文提示（含小程序域名白名单这一必踩的坑） */
function friendlyErr(e) {
  const msg = (e && (e.message || e.errMsg)) || String(e || '未知错误')
  if (/domain|url not in|合法域名/i.test(msg)) {
    return '小程序尚未配置服务器域名：请到微信公众平台 → 开发 → 开发管理 → 开发设置 → 服务器域名，把 https://wbapp-uxzyxkkqofad4mwe1lca5e.app.workbuddy.host 加入「request 合法域名」后重试（开发者工具里也可勾选「不校验合法域名」先行调试）'
  }
  if (/401|login_required|unauthor|session.*(expired|invalid)/i.test(msg)) return '登录已过期，请重新登录'
  if (/password not set|no password/i.test(msg)) return '这个账号没有设置过密码，请用验证码登录'
  if (/invalid.*(password|credential)|wrong password/i.test(msg)) return '密码错误，请检查后重试'
  if (/too many|rate limit|429/i.test(msg)) return '尝试次数过多，请稍后再试'
  return msg
}

module.exports = { getCloud, friendlyErr }
