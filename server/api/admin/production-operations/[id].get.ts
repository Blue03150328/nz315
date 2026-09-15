import { requireBackendUser } from '../../../utils/auth'
import { transaction, positiveId } from '../../../utils/production-workflow'
import { jsonValue } from '../../../utils/production-values'
export default defineEventHandler(async event => {
  const user = await requireBackendUser(event)
  const id = positiveId(getRouterParam(event, 'id'))
  return transaction(async conn => {
    const [records]: any = await conn.query('SELECT * FROM production_operation WHERE id=?', [id])
    const operation = records[0]
    if (!operation || (user.role !== 'platform_admin' && Number(operation.enterprise_id) !== Number(user.enterprise_id))) throw createError({ statusCode: 404, statusMessage: '记录不存在' })
    const [changes]: any = await conn.query('SELECT code_id, before_value, after_value FROM production_change WHERE operation_id=? ORDER BY id LIMIT 100', [id])
    return { ...operation, payload: jsonValue(operation.payload), result: jsonValue(operation.result), changes: changes.map((r: any) => ({ ...r, before_value: jsonValue(r.before_value), after_value: jsonValue(r.after_value) })) }
  })
})
