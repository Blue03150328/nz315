// POST /api/auth/logout —— 只注销当前会话，避免旧设备误踢新设备。
import { getCookie } from 'h3'
import { clearAuthCookie, verifySessionToken, endBackendSession, assertSameOrigin } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const session = verifySessionToken(getCookie(event, 'nz315_user') || '')
  if (session) await endBackendSession(session)
  clearAuthCookie(event)
  return { ok: true }
})
