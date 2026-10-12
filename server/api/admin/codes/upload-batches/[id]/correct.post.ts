// 修正仅作用于所选范围，绑定守卫与原子更新统一由公共服务执行。
import { requireWritableUser } from '../../../../../utils/auth'
import { correctCodes } from '../../../../../utils/code-correction'
import { logOperation } from '../../../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const body = await readBody(event) || {}
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: '无效的上传批次ID' })
  const scope = body.scope ?? getQuery(event).scope
  if (scope !== undefined && scope !== 'remaining') throw createError({ statusCode: 400, statusMessage: '码范围无效' })
  const selection = { uploadBatchId: id, ...(scope === 'remaining' ? { remaining: true } : {}) }
  const { audit, ...result } = await correctCodes(user, body, selection)
  await logOperation(event, { module: '码库管理', action: selection.remaining ? '剩余码修正' : '整文件修正', content: JSON.stringify({ ...selection, ...audit }) })
  return result
})
