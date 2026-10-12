// 认证工具：bcrypt 密码校验 + HMAC 签名会话 token（PRD 6.2：BCrypt 存储、JWT 风格鉴权、防 CSRF）
import { createHmac, timingSafeEqual } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { getCookie, setCookie, deleteCookie, getHeader, getMethod } from 'h3'
import { query, execute, getPool } from './db'

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
  device_id?: number
  device_line?: string
  device_hash?: string
  enterprise_name?: string
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

/** 会话签名（供消费者会话复用同一密钥；两者 payload 命名空间不同，token 不可互换） */
export function signSessionPayload(payload: string): string {
  return sign(payload)
}

/** 第三段保存数据库分配的会话版本；只有与账号当前版本完全一致的登录有效。 */
export function createSessionToken(userId: number | string, sessionVersion: number): string {
  const now = Date.now()
  const exp = now + SESSION_TTL_MS
  const payload = String(userId) + '.' + exp + '.' + sessionVersion
  const sig = sign(payload)
  return Buffer.from(payload).toString('base64url') + '.' + sig
}

/** 沿用三段格式及 issuedAt 字段名，第三段现为单调递增的会话版本。 */
export interface SessionInfo { userId: number; issuedAt: number }

/** 验证签名 token；无效/过期/旧格式（无签发时间）返回 null */
export function verifySessionToken(token: string): SessionInfo | null {
  try {
    const [payloadB64, sig] = token.split('.')
    if (!payloadB64 || !sig) return null
    const payload = Buffer.from(payloadB64, 'base64url').toString('utf8')
    const expected = sign(payload)
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    // 仅接受三段新格式 userId.expiry.issuedAt；旧两段格式无法承载签发时间，
    // 服务端无从判断其是否已被登出吊销 → 一律拒绝（升级后需重新登录一次，2026-09-19）
    const parts = payload.split('.')
    if (parts.length !== 3) return null
    const userId = Number(parts[0])
    const exp = Number(parts[1])
    const issuedAt = Number(parts[2])
    if (!Number.isInteger(userId) || userId <= 0) return null
    if (!Number.isFinite(exp) || !Number.isSafeInteger(issuedAt) || issuedAt <= 0) return null
    if (Date.now() > exp) return null
    return { userId, issuedAt }
  } catch {
    return null
  }
}

/** 登录串行锁定账号并分配唯一版本，避免并发登录或同毫秒登录产生两个有效会话。 */
export async function startBackendSession(userId: number, verifiedPassword: string, ip: string): Promise<{ user: AuthUser; sessionVersion: number }> {
  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()
    const [rows] = await conn.query<any[]>(
      'SELECT id, enterprise_id, username, name, phone, role, status, password, session_epoch FROM `user` WHERE id = ? FOR UPDATE',
      [userId],
    )
    const u = rows[0]
    // 密码校验期间可能发生改密或禁用，锁内重验，不能让旧密码重新取得有效会话。
    if (!u || u.password !== verifiedPassword) throw createError({ statusCode: 401, statusMessage: '账号信息已变更，请重新登录' })
    if (Number(u.status) !== 1) throw createError({ statusCode: 403, statusMessage: '账号已被禁用，请联系管理员' })
    const sessionVersion = Math.max(Date.now(), Number(u.session_epoch || 0) + 1)
    await conn.execute('UPDATE `user` SET session_epoch = ?, last_login_at = NOW(), last_login_ip = ? WHERE id = ?', [sessionVersion, ip, userId])
    await conn.commit()
    // 登录响应仅返回公开账号字段，不返回密码散列或会话版本。
    const user: AuthUser = { id: u.id, enterprise_id: u.enterprise_id, username: u.username, name: u.name, phone: u.phone, role: u.role, status: u.status }
    return { user, sessionVersion }
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}

/** 只注销指定会话；旧设备迟到的退出请求不会注销新设备。 */
export async function endBackendSession(session: SessionInfo): Promise<void> {
  await execute('UPDATE `user` SET session_epoch = GREATEST(session_epoch + 1, ?) WHERE id = ? AND session_epoch = ?', [Date.now(), session.userId, session.issuedAt])
}

/** 管理操作吊销全部会话，版本必须递增，不能因同毫秒或时钟回拨恢复旧登录。 */
export async function revokeUserSessions(userId: number): Promise<void> {
  await execute('UPDATE `user` SET session_epoch = GREATEST(session_epoch + 1, ?) WHERE id = ?', [Date.now(), userId])
}

/** 当前登录用户（未登录返回 null；账号禁用视为未登录） */
export async function getCurrentUser(event: any): Promise<AuthUser | null> {
  const token = getCookie(event, 'nz315_user')
  if (!token) return null
  const session = verifySessionToken(token)
  if (!session) return null
  const rows = await query<any[]>(
    'SELECT id, enterprise_id, username, name, phone, role, status, session_epoch FROM `user` WHERE id = ? LIMIT 1',
    [session.userId],
  )
  const u = rows[0]
  if (!u || Number(u.status) !== 1) return null
  if (session.issuedAt !== Number(u.session_epoch || 0)) {
    event.context.sessionInvalidated = true
    return null
  }
  // 挂到请求上下文：操作日志（audit.logOperation）由此取操作人与所属企业，
  // 否则所有业务操作日志的 user_id/enterprise_id 均为 NULL，违反 PRD 5.12.4 与 8.4 审计完整性要求
  event.context.authUser = u
  return { id: u.id, enterprise_id: u.enterprise_id, username: u.username, name: u.name, phone: u.phone, role: u.role, status: u.status }
}

/** 后台守卫：要求已登录（角色过滤由各业务接口按需处理） */
export async function requireBackendUser(event: any): Promise<AuthUser> {
  assertSameOrigin(event)
  const user = await getCurrentUser(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: event.context.sessionInvalidated ? '账号已在其他设备登录或登录已失效，请重新登录' : '未登录' })
  }
  // 企业启停校验（2026-09-09）：厂家账号每次业务请求校验所属企业——被禁用或续费到期（renew_expire 早于今天/NULL）
  // 一律 403，保证「到期后不可使用系统功能」对已登录会话同样生效（7 天会话可能横跨到期点）
  if (user.enterprise_id) {
    const [ent] = await query<any[]>('SELECT status, renew_expire, CURDATE() AS today FROM enterprise WHERE id = ? LIMIT 1', [user.enterprise_id])
    if (!ent || Number(ent.status) !== 1) {
      throw createError({ statusCode: 403, statusMessage: '企业已被平台停用，账号暂不可使用，请联系平台' })
    }
    if (!ent.renew_expire || String(ent.renew_expire).slice(0, 10) < String(ent.today)) {
      throw createError({ statusCode: 403, statusMessage: '厂家服务已到期未续费，账号暂不可使用，请联系平台续费' })
    }
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

export function setAuthCookie(event: any, userId: number | string, sessionVersion: number) {
  const token = createSessionToken(userId, sessionVersion)
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
 * 无 Origin 的请求（curl/服务端调用/Node fetch）放行，保证开发与 API 客户端可用
 * 2026-09-19 修正：由 startsWith 前缀比较改为「完整 origin 精确比对」——
 * 旧写法下 `https://www.nz315.cn.evil.com` 能通过前缀校验（CSRF 绕过面），且 https/http 混用时会误拒同站请求 */
export function assertSameOrigin(event: any) {
  const method = getMethod(event)
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return
  const origin = getHeader(event, 'origin')
  if (!origin) return
  // 只信请求Host；客户端可伪造转发头，不能拿它作为跨站校验依据。
  const host = String(getHeader(event, 'host') || '')
  if (!host) throw createError({ statusCode: 403, statusMessage: '跨站请求被拒绝' })
  const normalized = origin.replace(/\/+$/, '')
  if (normalized !== 'http://' + host && normalized !== 'https://' + host) {
    throw createError({ statusCode: 403, statusMessage: '跨站请求被拒绝' })
  }
}
