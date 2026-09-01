// 微信公众号网页授权：第一步——跳转微信授权页（PRD 公众端消费者登录）
// 凭据未配置时直接报错，不做任何形式的模拟登录
import { getWechatConfig } from '~~/server/utils/consumer-auth'

export default defineEventHandler((event) => {
  const cfg = getWechatConfig()
  if (!cfg) {
    throw createError({ statusCode: 503, statusMessage: '微信登录尚未配置（需设置 WECHAT_APP_ID / WECHAT_APP_SECRET）' })
  }
  const q = getQuery(event)
  // 授权后回跳的站内路径，限制为站内相对路径，避免开放重定向
  const rawRedirect = String(q.redirect || '/profile')
  const redirect = rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : '/profile'

  const proto = getHeader(event, 'x-forwarded-proto') || 'https'
  const host = getHeader(event, 'host') || ''
  const callback = proto + '://' + host + '/api/consumer/wechat/callback'

  const url = 'https://open.weixin.qq.com/connect/oauth2/authorize'
    + '?appid=' + encodeURIComponent(cfg.appId)
    + '&redirect_uri=' + encodeURIComponent(callback)
    + '&response_type=code'
    // snsapi_userinfo：需要昵称与头像展示在个人中心（snsapi_base 拿不到）
    + '&scope=snsapi_userinfo'
    + '&state=' + encodeURIComponent(redirect)
    + '#wechat_redirect'

  return sendRedirect(event, url, 302)
})
