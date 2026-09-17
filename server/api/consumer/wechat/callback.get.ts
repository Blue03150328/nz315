// 微信公众号网页授权：第二步——用 code 换取 openid 与用户信息，落库并种消费者会话
import { getWechatConfig, setConsumerCookie } from '~~/server/utils/consumer-auth'
import { query } from '~~/server/utils/db'

/**
 * 调用微信接口并稳健解析响应。
 *
 * 背景：微信响应体的 Content-Type 会因接入层/机房不同而变化（本项目本机实测为
 * `application/json`，但历史上存在 `text/plain` 的情况）。ofetch 对非 JSON 的
 * Content-Type 会把响应**原样返回成字符串**，此时 `res.openid`、`res.errmsg` 全为
 * undefined —— 真实错误（invalid appsecret / code been used / invalid code 等）会被
 * 静默成一句「未返回 openid」，线上完全无法定位。
 *
 * 因此这里统一按文本取回后手动解析，并把原始响应保留在 `__raw` 中用于报错与日志。
 * 注意：解析成功但内容不是对象时（如字符串 "ok"），也走 `__raw` 分支。
 */
async function callWechatApi(url: string, params: Record<string, string>) {
  const raw = await $fetch<any>(url, { query: params, responseType: 'text' })
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '')
  if (!text.trim()) return { __empty: true, __raw: '' } as any
  try {
    const parsed = JSON.parse(text)
    return (parsed && typeof parsed === 'object') ? parsed : { __raw: text.slice(0, 300) }
  } catch {
    return { __raw: text.slice(0, 300) } as any
  }
}

/** 把微信的失败反馈整理成可读文案（页面提示与服务端日志共用，避免丢失原始信息） */
function describeWechatFailure(res: any): string {
  if (res?.errmsg) return String(res.errmsg) + (res?.errcode !== undefined ? '（errcode=' + res.errcode + '）' : '')
  if (res?.__empty) return '微信接口返回空响应'
  return '微信未返回 openid，原始响应：' + String(res?.__raw || JSON.stringify(res || {}).slice(0, 300))
}

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
  const tokenRes = await callWechatApi('https://api.weixin.qq.com/sns/oauth2/access_token', {
    appid: cfg.appId, secret: cfg.appSecret, code, grant_type: 'authorization_code',
  })
  if (!tokenRes?.openid) {
    // 失败详情同时写入服务端日志（PM2 error log），便于线上排查；页面提示只做截断展示
    const detail = describeWechatFailure(tokenRes)
    console.error('[微信授权] code 换 openid 失败 | appid=' + cfg.appId + ' | ' + detail)
    throw createError({ statusCode: 502, statusMessage: '微信授权失败：' + detail })
  }
  const openid: string = String(tokenRes.openid)
  const unionid: string | null = tokenRes.unionid || null

  // 2) 拉取用户信息（scope=snsapi_userinfo 才有昵称头像；失败不阻断登录）
  let nickname: string | null = null
  let avatar: string | null = null
  try {
    const info = await callWechatApi('https://api.weixin.qq.com/sns/userinfo', {
      access_token: String(tokenRes.access_token), openid, lang: 'zh_CN',
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
