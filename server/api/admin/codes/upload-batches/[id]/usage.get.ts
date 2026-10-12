import { query } from '../../../../../utils/db'
import { requireBackendUser } from '../../../../../utils/auth'
import { codeBatchUsage } from '../../../../../utils/code-batch-usage'

function positiveInteger(value: unknown, label: string, fallback?: number, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw createError({ statusCode: 400, statusMessage: `${label}无效` })
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number > maximum) throw createError({ statusCode: 400, statusMessage: `${label}无效` })
  return number
}

/** 码库批次使用记录：后台读取权限，按所属企业隔离，不修改任何业务数据。 */
export default defineEventHandler(async event => {
  const user = await requireBackendUser(event)
  const uploadBatchId = positiveInteger(getRouterParam(event, 'id'), '上传批次编号')
  const parameters = getQuery(event)
  const page = positiveInteger(parameters.page, '页码', 1)
  const pageSize = positiveInteger(parameters.pageSize, '每页数量', 20, 100)
  if (!Number.isSafeInteger((page - 1) * pageSize)) throw createError({ statusCode: 400, statusMessage: '页码超出范围' })
  const [batch] = await query<any[]>(
    'SELECT id, enterprise_id FROM upload_batch WHERE id = ?' + (user.role === 'platform_admin' ? '' : ' AND enterprise_id = ?'),
    user.role === 'platform_admin' ? [uploadBatchId] : [uploadBatchId, user.enterprise_id],
  )
  if (!batch) throw createError({ statusCode: 404, statusMessage: '上传批次不存在或不属于本企业' })
  return codeBatchUsage(uploadBatchId, Number(batch.enterprise_id), page, pageSize)
})
