// 修正仅作用于所选范围，绑定守卫与原子更新统一由公共服务执行。
import { requireWritableUser } from '../../../../utils/auth'
import { correctCodes } from '../../../../utils/code-correction'
import { logOperation } from '../../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const body = await readBody(event) || {}
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: '无效的码ID' })
  const selection = { ids: [id], single: true }
  const { audit, ...result } = await correctCodes(user, body, selection)
  await logOperation(event, { module: '码库管理', action: '单条修正', content: JSON.stringify({ ...selection, ...audit }) })
  return result
})