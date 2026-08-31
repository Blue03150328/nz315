// POST /api/auth/login —— 账号密码登录（PRD 5.1）
import { query } from '../../utils/db'
import { verifyPassword, setAuthCookie, getCurrentUser } from '../../utils/auth'
import { logLogin } from '../../utils/audit'

// 登录失败限速：同账号+IP 5 次/分钟，超限锁定 15 分钟（防暴力破解）
const MAX_FAILS = 5
const WINDOW_MS = 60 * 1000
const LOCK_MS = 15 * 60 * 1000
const failMap = new Map<string, { count: number; windowEnd: number; lockedUntil: number }>()

function clientIp(event: any): string {
  // 只信任反向代理写入的 x-real-ip；x-forwarded-for 仅作兜底（防客户端伪造审计日志）
  return (String(getHeader(event, 'x-real-ip') || getHeader(event, 'x-forwarded-for') || '').split(',')[0] || '').trim()
}

function checkLockout(key: string) {
  const rec = failMap.get(key)
  if (rec && rec.lockedUntil > Date.now()) {
    const mins = Math.ceil((rec.lockedUntil - Date.now()) / 60000)
    throw createError({ statusCode: 429, statusMessage: `失败次数过多，请 ${mins} 分钟后再试` })
  }
}

function recordFailure(key: string) {
  const now = Date.now()
  const rec = failMap.get(key)
  // 计数窗口过期（含锁定到期后）则重置
  if (!rec || now > rec.windowEnd) {
    failMap.set(key, { count: 1, windowEnd: now + WINDOW_MS, lockedUntil: 0 })
    return
  }
  rec.count += 1
  if (rec.count >= MAX_FAILS) rec.lockedUntil = now + LOCK_MS
}

function clearFailures(key: string) {
  failMap.delete(key)
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const username = String(body?.username || '').trim()
  const password = String(body?.password || '')
  if (!username || !password) {
    throw createError({ statusCode: 400, statusMessage: '请输入用户名和密码' })
  }

  const key = clientIp(event) + '|' + username
  checkLockout(key)

  const rows = await query<any[]>('SELECT * FROM `user` WHERE username = ? LIMIT 1', [username])
  const u = rows[0]
  if (!u) {
    recordFailure(key)
    throw createError({ statusCode: 401, statusMessage: '用户名或密码错误' })
  }
  if (Number(u.status) !== 1) {
    throw createError({ statusCode: 403, statusMessage: '账号已被禁用，请联系管理员' })
  }
  const ok = await verifyPassword(password, String(u.password))
  if (!ok) {
    recordFailure(key)
    throw createError({ statusCode: 401, statusMessage: '用户名或密码错误' })
  }

  clearFailures(key)
  setAuthCookie(event, u.id)
  // 记录最后登录时间与 IP（PRD 5.1 登录日志）
  const ip = clientIp(event)
  await query('UPDATE `user` SET last_login_at = NOW(), last_login_ip = ? WHERE id = ?', [ip, u.id])
  // 操作日志（PRD 5.12.4 登录日志：时间/IP/设备/结果）
  await logLogin(event, u.id, u.enterprise_id ?? null, true)
  const user = await getCurrentUser(event)
  return { ok: true, user }
})