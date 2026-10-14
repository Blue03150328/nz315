import type { AuthUser } from './auth'

export const usageBeijing = (field: string) => `DATE_FORMAT(TIMESTAMPADD(SECOND,28800-TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(),NOW()),${field}),'%Y-%m-%d %H:%i:%s')`
const productionExpr = (field: string) => `CASE WHEN JSON_CONTAINS(cb.production_snapshot,JSON_QUOTE('${field}'),'$.mixed_fields') THEN NULL ELSE COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(cb.production_snapshot,'$.${field}')),'null'),NULLIF(JSON_UNQUOTE(JSON_EXTRACT(t.production_snapshot,'$.${field}')),'null'),b.${field}) END`
export const usageBatchNo = productionExpr('batch_no')
export const usageProduceDate = productionExpr('produce_date')
export const usageLine = "COALESCE(NULLIF(s.line_snapshot,''),NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(wr.device_snapshot,'$.lineName')),'null'),''),NULLIF(t.line_name,''))"
const usageDevice = "COALESCE(NULLIF(u.device_name_snapshot,''),s.device)"
export const usageFrom = `FROM code_usage_batch cb
  JOIN production_collection_upload u ON u.id=cb.upload_id AND u.state='completed'
  JOIN production_task t ON t.id=cb.task_id
  LEFT JOIN batch b ON b.id=t.batch_id
  LEFT JOIN product p ON p.id=COALESCE(cb.product_id,t.product_id)
  JOIN upload_batch ub ON ub.id=cb.parent_upload_batch_id
  LEFT JOIN production_collection_session s ON s.id=u.session_id
  LEFT JOIN worker_session ws ON ws.id=u.worker_session_id
  LEFT JOIN worker_run wr ON wr.id=ws.run_id`

/** 列表、全选、导出及写操作共用筛选与企业边界。 */
export function usageBatchFilter(user: AuthUser, input: Record<string, any> = {}) {
  if (user.role !== 'platform_admin' && !user.enterprise_id) throw createError({ statusCode: 403, statusMessage: '账号未关联企业' })
  const clauses = ["u.state='completed'"], params: any[] = [], filters: Record<string, string | number> = {}
  if (user.role !== 'platform_admin') { clauses.push('ub.enterprise_id=?'); params.push(user.enterprise_id) }
  for (const key of ['productId', 'uploadBatchId'] as const) {
    if (input[key] === undefined || input[key] === '') continue
    const id = Number(input[key])
    if (!Number.isSafeInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: '产品或上传批次筛选无效' })
    filters[key] = id; clauses.push((key === 'productId' ? 'COALESCE(cb.product_id,t.product_id)' : 'cb.parent_upload_batch_id') + '=?'); params.push(id)
  }
  const searchColumns = { batchNo: usageBatchNo, lineName: usageLine, deviceName: usageDevice, uploader: "COALESCE(NULLIF(u.uploader_username,''),NULLIF(u.uploader_name,''),NULLIF(u.device_name_snapshot,''),NULLIF(s.device,''))" }
  for (const [key, column] of Object.entries(searchColumns)) {
    if (input[key] === undefined || input[key] === '') continue
    if (typeof input[key] !== 'string') throw createError({ statusCode: 400, statusMessage: '筛选文字无效' })
    const value = input[key].trim().slice(0, 100)
    if (!value) continue
    filters[key] = value; clauses.push(`${column} LIKE ? ESCAPE '!'`); params.push('%' + value.replace(/[!%_]/g, (char: string) => '!' + char) + '%')
  }
  for (const key of ['dateFrom', 'dateTo'] as const) {
    if (!input[key]) continue
    const date = String(input[key])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw createError({ statusCode: 400, statusMessage: '上传日期筛选无效' })
    filters[key] = date; clauses.push(`${usageBeijing('u.completed_at')} ${key === 'dateFrom' ? '>=' : '<='} ?`); params.push(date + (key === 'dateFrom' ? ' 00:00:00' : ' 23:59:59'))
  }
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) throw createError({ statusCode: 400, statusMessage: '开始日期不能晚于结束日期' })
  return { sql: clauses.join(' AND '), params, filters }
}
