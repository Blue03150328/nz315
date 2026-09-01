// 当前登录消费者信息 + 微信登录是否已配置（供前端决定展示登录按钮还是配置提示）
import { getCurrentConsumer, isWechatConfigured } from '~~/server/utils/consumer-auth'

export default defineEventHandler(async (event) => {
  const c = await getCurrentConsumer(event)
  return {
    loggedIn: !!c,
    wechatConfigured: isWechatConfigured(),
    consumer: c ? { id: c.id, nickname: c.nickname, avatar: c.avatar } : null,
  }
})
