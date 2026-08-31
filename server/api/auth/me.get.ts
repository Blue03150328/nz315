// GET /api/auth/me —— 当前登录用户
import { getCurrentUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await getCurrentUser(event)
  return { user }
})
