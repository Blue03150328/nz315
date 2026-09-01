// 消费者认证：微信公众号网页授权登录后的会话管理（公众端，与后台 user 体系完全隔离）
// 安全要点：消费者 token 的 payload 带 "consumer:" 命名空间前缀，与后台 token（纯数字 id）不可互换——
//   后台 verifySessionToken 解析 "consumer:5" 得到 NaN 会直接拒绝；
//   本文件的校验强制要求前缀，后台 token 同样无法冒充消费者。
import { timingSafeEqual } from 'node:crypto'
import { getCookie, setCookie, deleteCookie, getHeader } from 'h3'
import { signSessionPayload } from './auth'
import { query } from './db'

/** 消费者会话有效期：30 天（消费者为低频使用场景，过短会反复要求授权） */
const CONSUMER_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** 会话 Cookie 名（与后台 nz315_user 区分） */
export const CONSUMER_COOKIE = 'nz315_consumer'

/** 命名空间前缀：确保与后台会话 token 不可互换 */
const NS = 'consumer:'

export interface ConsumerUser {
  id: number
  openid: string
  unionid: string | null
  nickname: string | null
  avatar: string | null
  status: number
}

/** 生成消费者会话 token：base64url("consumer:<id>.<exp>").签名 */
export function createConsumerToken(consumerId: number): string {
  const payload = NS + consumerId + '.' + (Date.now() + CONSUMER_TTL_MS)
  return Buffer.from(payload).toString('base64url') + '.' + signSessionPayload(payload)
}

/** 校验消费者 token，返回 consumerId；无效/过期/非消费者命名空间均返回 null */
export function verifyConsumerToken(token: string): number | null {
  try {
    const [payloadB64, sig] = token.split('.')
    if (!payloadB64 || !sig) return null
    const payload = Buffer.from(payloadB64, 'base64url').toString('utf8')
    // 必须带消费者命名空间前缀，杜绝后台 token 冒用
    if (!payload.startsWith(NS)) return null
    const expected = signSessionPayload(payload)
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    const body = payload.slice(NS.length)
    const dot = body.lastIndexOf('.')
    if (dot <= 0) return null
    const id = Number(body.slice(0, dot))
    const exp = Number(body.slice(dot + 1))
    if (!Number.isInteger(id) || id <= 0) return null
    if (Date.now() > exp) return null
    return id
  } catch {
    return null
  }
}

/** 当前登录消费者（未登录或已禁用返回 null） */
export async function getCurrentConsumer(event: any): Promise<ConsumerUser | null> {
  const token = getCookie(event, CONSUMER_COOKIE)
  if (!token) return null
  const id = verifyConsumerToken(token)
  if (!id) return null
  const rows = await query<any[]>(
    'SELECT id, openid, unionid, nickname, avatar, status FROM consumer WHERE id = ? LIMIT 1',
    [id],
  )
  const c = rows[0]
  if (!c || Number(c.status) !== 1) return null
  return c as ConsumerUser
}

/** 要求消费者已登录，否则 401 */
export async function requireConsumer(event: any): Promise<ConsumerUser> {
  const c = await getCurrentConsumer(event)
  if (!c) {
    throw createError({ statusCode: 401, statusMessage: '请先在微信中登录' })
  }
  return c
}

export function setConsumerCookie(event: any, consumerId: number) {
  const isHttps = getHeader(event, 'x-forwarded-proto') === 'https' || event.node?.req?.socket?.encrypted
  setCookie(event, CONSUMER_COOKIE, createConsumerToken(consumerId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: !!isHttps,
    maxAge: Math.floor(CONSUMER_TTL_MS / 1000),
    path: '/',
  })
}

export function clearConsumerCookie(event: any) {
  deleteCookie(event, CONSUMER_COOKIE, { path: '/' })
}

/** 微信公众号网页授权配置（凭据来自环境变量，缺失时功能整体不可用而非降级为假登录） */
export function getWechatConfig(): { appId: string; appSecret: string } | null {
  const cfg = useRuntimeConfig()
  const appId = String(cfg.wechatAppId || '')
  const appSecret = String(cfg.wechatAppSecret || '')
  if (!appId || !appSecret) return null
  return { appId, appSecret }
}

/** 是否已配置微信登录（供前端展示引导文案） */
export function isWechatConfigured(): boolean {
  return getWechatConfig() !== null
}
