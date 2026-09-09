// POST /api/auth/login —— 账号密码登录（PRD 5.1）
import { query } from '../../utils/db'
import { verifyPassword, setAuthCookie, getCurrentUser } from '../../utils/auth'
import { clientIpOf } from '../../utils/audit'
import { logLogin } from '../../utils/audit'

// 登录失败限速：同账号+IP 5 次/分钟，超限锁定 15 分钟（防暴力破解）
const MAX_FAILS = 5
const WINDOW_MS = 60 * 1000
const LOCK_MS = 15 * 60 * 1000
const failMap = new Map<string, { count: number; windowEnd: number; lockedUntil: number }>()

function clientIp(event: any): string {
  // 只信任反向代理写入的 x-real-ip；x-forwarded-for 仅作兜底；直连时回退 socket 地址
  return clientIpOf(event)
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
  // 企业启停校验（2026-09-09）：厂家账号登录时校验所属企业——被禁用或续费到期（renew_expire 早于今天/NULL）一律拦截
  if (u.enterprise_id) {
    const [ent] = await query<any[]>('SELECT status, renew_expire, CURDATE() AS today FROM enterprise WHERE id = ? LIMIT 1', [u.enterprise_id])
    if (!ent || Number(ent.status) !== 1) {
      throw createError({ statusCode: 403, statusMessage: '企业已被平台停用，账号暂不可登录，请联系平台' })
    }
    if (!ent.renew_expire || String(ent.renew_expire).slice(0, 10) < String(ent.today)) {
      throw createError({ statusCode: 403, statusMessage: '厂家服务已到期未续费，账号暂不可登录使用，请联系平台续费' })
    }
  }
  setAuthCookie(event, u.id)
  // 记录最后登录时间与 IP（PRD 5.1 登录日志）
  const ip = clientIp(event)
  await query('UPDATE `user` SET last_login_at = NOW(), last_login_ip = ? WHERE id = ?', [ip, u.id])
  // 操作日志（PRD 5.12.4 登录日志：时间/IP/设备/结果）
  await logLogin(event, u.id, u.enterprise_id ?? null, true)
  const user = await getCurrentUser(event)
  return { ok: true, user }
})