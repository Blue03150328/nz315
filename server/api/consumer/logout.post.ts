// 消费者退出登录：清除公众端会话 Cookie
import { clearConsumerCookie } from '~~/server/utils/consumer-auth'
import { assertSameOrigin } from '~~/server/utils/auth'

export default defineEventHandler((event) => {
  assertSameOrigin(event)
  clearConsumerCookie(event)
  return { ok: true }
})
