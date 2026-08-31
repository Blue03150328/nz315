// 认证工具：bcrypt 密码校验 + HMAC 签名会话 token（PRD 6.2：BCrypt 存储、JWT 风格鉴权、防 CSRF）
import { createHmac, timingSafeEqual } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { getCookie, setCookie, deleteCookie, getHeader, getMethod } from 'h3'
import { query } from './db'

// 平台角色（PRD 1.3 / 7.6）
export type PlatformRole = 'platform_admin' | 'enterprise_admin' | 'code_admin' | 'viewer'

export interface AuthUser {
  id: number
  enterprise_id: number | null
  username: string
  name: string | null
  phone: string | null
  role: PlatformRole
  status: number
}

/** 校验密码（bcrypt.compare，恒定时间） */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

/** 会话有效期：7 天 */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

function getSessionSecret(): string {
  const secret = String(useRuntimeConfig().sessionSecret || '')
  if (!secret) {
    throw createError({ statusCode: 500, statusMessage: '服务端会话密钥未正确配置' })
  }
  // 生产环境拒绝使用公开默认值签名（防会话伪造；配置缺失时 nuxt.config 已启动失败）
  if (process.env.NODE_ENV === 'production' && secret === 'dev-session-secret-change-me') {
    throw createError({ statusCode: 500, statusMessage: '生产环境必须配置独立 SESSION_SECRET' })
  }
  return secret
}

function sign(payload: string): string {
  return createHmac('sha256', getSessionSecret()).update(payload).digest('base64url')
}

/** 生成签名会话 token：base64url(userId.expiry).signature（防伪造提权） */
export function createSessionToken(userId: number | string): string {
  const exp = Date.now() + SESSION_TTL_MS
  const payload = String(userId) + '.' + exp
  const sig = sign(payload)
  return Buffer.from(payload).toString('base64url') + '.' + sig
}

/** 验证签名 token，返回 userId；无效/过期返回 null */
export function verifySessionToken(token: string): number | null {
  try {
    const [payloadB64, sig] = token.split('.')
    if (!payloadB64 || !sig) return null
    const payload = Buffer.from(payloadB64, 'base64url').toString('utf8')
    const expected = sign(payload)
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    const dot = payload.lastIndexOf('.')
    if (dot <= 0) return null
    const userId = Number(payload.slice(0, dot))
    const exp = Number(payload.slice(dot + 1))
    if (!Number.isInteger(userId) || userId <= 0) return null
    if (Date.now() > exp) return null
    return userId
  } catch {
    return null
  }
}

/** 当前登录用户（未登录返回 null；账号禁用视为未登录） */
export async function getCurrentUser(event: any): Promise<AuthUser | null> {
  const token = getCookie(event, 'nz315_user')
  if (!token) return null
  const userId = verifySessionToken(token)
  if (!userId) return null
  const rows = await query<any[]>(
    'SELECT id, enterprise_id, username, name, phone, role, status FROM `user` WHERE id = ? LIMIT 1',
    [userId],
  )
  const u = rows[0]
  if (!u || Number(u.status) !== 1) return null
  return u as AuthUser
}

/** 后台守卫：要求已登录（角色过滤由各业务接口按需处理） */
export async function requireBackendUser(event: any): Promise<AuthUser> {
  assertSameOrigin(event)
  const user = await getCurrentUser(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: '未登录' })
  }
  return user
}

/** 写操作守卫：viewer（只读账号）禁止一切写操作（防越权） */
export async function requireWritableUser(event: any): Promise<AuthUser> {
  const user = await requireBackendUser(event)
  if (user.role === 'viewer') {
    throw createError({ statusCode: 403, statusMessage: '只读账号无写权限' })
  }
  return user
}

/** 总部管理员守卫 */
export async function requirePlatformAdmin(event: any): Promise<AuthUser> {
  const user = await requireBackendUser(event)
  if (user.role !== 'platform_admin') {
    throw createError({ statusCode: 403, statusMessage: '需要总部管理员权限' })
  }
  return user
}

export function setAuthCookie(event: any, userId: number | string) {
  const token = createSessionToken(userId)
  const isHttps = getHeader(event, 'x-forwarded-proto') === 'https' || event.node?.req?.socket?.encrypted
  setCookie(event, 'nz315_user', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: !!isHttps,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    path: '/',
  })
}

export function clearAuthCookie(event: any) {
  deleteCookie(event, 'nz315_user', { path: '/' })
}

/** 跨站请求校验：非 GET 请求若携带 Origin 且与本站不符，拒绝（防 CSRF）
 * 无 Origin 的请求（curl/服务端调用/Node fetch）放行，保证开发与 API 客户端可用 */
export function assertSameOrigin(event: any) {
  const method = getMethod(event)
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return
  const origin = getHeader(event, 'origin')
  if (!origin) return
  const host = getHeader(event, 'host') || ''
  const allowed = origin.startsWith('http://' + host) || origin.startsWith('https://' + host)
  if (!allowed) {
    throw createError({ statusCode: 403, statusMessage: '跨站请求被拒绝' })
  }
}