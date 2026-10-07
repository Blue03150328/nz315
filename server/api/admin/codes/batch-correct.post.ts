// 修正仅作用于所选范围，绑定守卫与原子更新统一由公共服务执行。
import { requireWritableUser } from '../../../utils/auth'
import { correctCodes } from '../../../utils/code-correction'
import { logOperation } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const body = await readBody(event) || {}
  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(Number))] as number[]
  if (!ids.length || ids.some(id => !Number.isInteger(id) || id <= 0)) throw createError({ statusCode: 400, statusMessage: '请选择有效的追溯码' })
  if (ids.length > 5000) throw createError({ statusCode: 400, statusMessage: '单次最多5000条' })
  const selection = { ids }
  const { audit, ...result } = await correctCodes(user, body, selection)
  await logOperation(event, { module: '码库管理', action: '批量修正', content: JSON.stringify({ ...selection, ...audit }) })
  return result
})