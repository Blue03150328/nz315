// 微信公众号网页授权：第二步——用 code 换取 openid 与用户信息，落库并种消费者会话
import { getWechatConfig, setConsumerCookie } from '~~/server/utils/consumer-auth'
import { query } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  const cfg = getWechatConfig()
  if (!cfg) {
    throw createError({ statusCode: 503, statusMessage: '微信登录尚未配置（需设置 WECHAT_APP_ID / WECHAT_APP_SECRET）' })
  }
  const q = getQuery(event)
  const code = String(q.code || '')
  const state = String(q.state || '/profile')
  const redirect = state.startsWith('/') && !state.startsWith('//') ? state : '/profile'
  if (!code) {
    throw createError({ statusCode: 400, statusMessage: '微信授权失败：缺少 code' })
  }

  // 1) code 换 access_token 与 openid
  const tokenRes = await $fetch<any>('https://api.weixin.qq.com/sns/oauth2/access_token', {
    query: { appid: cfg.appId, secret: cfg.appSecret, code, grant_type: 'authorization_code' },
  })
  if (!tokenRes?.openid) {
    throw createError({ statusCode: 502, statusMessage: '微信授权失败：' + (tokenRes?.errmsg || '未返回 openid') })
  }
  const openid: string = tokenRes.openid
  const unionid: string | null = tokenRes.unionid || null

  // 2) 拉取用户信息（scope=snsapi_userinfo 才有昵称头像；失败不阻断登录）
  let nickname: string | null = null
  let avatar: string | null = null
  try {
    const info = await $fetch<any>('https://api.weixin.qq.com/sns/userinfo', {
      query: { access_token: tokenRes.access_token, openid, lang: 'zh_CN' },
    })
    if (info?.nickname) nickname = String(info.nickname)
    if (info?.headimgurl) avatar = String(info.headimgurl)
  } catch {
    // 用户信息拉取失败时仅记录 openid，个人中心显示「微信用户」
  }

  // 3) 落库：openid 唯一，存在则更新资料与登录时间
  const rows = await query<any[]>('SELECT id FROM consumer WHERE openid = ? LIMIT 1', [openid])
  let consumerId: number
  if (rows[0]) {
    consumerId = Number(rows[0].id)
    await query(
      'UPDATE consumer SET unionid = COALESCE(?, unionid), nickname = COALESCE(?, nickname), avatar = COALESCE(?, avatar), last_login_at = NOW() WHERE id = ?',
      [unionid, nickname, avatar, consumerId],
    )
  } else {
    const res = await query<any>(
      'INSERT INTO consumer (openid, unionid, nickname, avatar, last_login_at) VALUES (?,?,?,?,NOW())',
      [openid, unionid, nickname, avatar],
    )
    consumerId = Number(res.insertId)
  }

  setConsumerCookie(event, consumerId)
  return sendRedirect(event, redirect, 302)
})
