// POST /api/auth/logout —— 退出登录（2026-09-19：新增服务端会话吊销 + 跨站校验）
import { clearAuthCookie, getCurrentUser, revokeUserSessions, assertSameOrigin } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  // 服务端吊销：刷新 user.session_epoch，使此前签发的 token 立即失效。
  // 仅清 cookie 是客户端动作——token 本身仍在 7 天有效期内，被复制后依旧可用（本项即修此缺陷）
  const user = await getCurrentUser(event).catch(() => null)
  if (user) await revokeUserSessions(user.id).catch(() => { /* 吊销失败不阻塞登出，客户端 cookie 照清 */ })
  clearAuthCookie(event)
  return { ok: true }
})
