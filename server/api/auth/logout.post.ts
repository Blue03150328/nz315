// POST /api/auth/logout —— 退出登录
import { clearAuthCookie } from '../../utils/auth'

export default defineEventHandler((event) => {
  clearAuthCookie(event)
  return { ok: true }
})
