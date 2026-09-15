// 旧混合修正入口停用，避免绕过独立预览、审批与文件范围。
import { requireWritableUser } from '../../../../utils/auth'
export default defineEventHandler(async event => {
  await requireWritableUser(event)
  throw createError({ statusCode: 410, statusMessage: '请从码库的整批修正页面选择目标码；首次绑定请使用生产绑定页面' })
})
