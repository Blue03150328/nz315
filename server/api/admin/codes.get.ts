// GET /api/admin/codes —— 码列表查询（PRD 5.5.7：筛选/分页/搜索）
// 2026-09-04 码库聚合改造：新增可选参数 uploadBatchId——码库管理「详细」弹窗按上传批次查看单条明细
// （原单条列表逻辑不变，未传该参数时行为与改造前一致）
import { query } from '../../utils/db'
import { requireBackendUser } from '../../utils/auth'
import { resolveCodeScope, codeScopeSql } from '../../utils/code-scope'
import { usageBatchSchemaAvailable } from '../../utils/usage-batch-schema'
import { checkCodeBatchUsageSchema } from '../../utils/code-batch-usage'
import { remainingScope } from '../../utils/code-scope-management'

const STATUS_LABEL: Record<number, string> = { 1: '已生成', 2: '已绑定' }
const FLAG_LABEL: Record<number, string> = { 0: '正常', 1: '已冻结', 2: '已作废' }

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const q = getQuery(event)
  const isPlatform = user.role === 'platform_admin'
  const fid = user.enterprise_id
  if (!isPlatform && !fid) throw createError({ statusCode: 403, statusMessage: '账号未关联企业' })
  const childrenAvailable = await usageBatchSchemaAvailable()
  const productionAvailable = childrenAvailable || await checkCodeBatchUsageSchema()

  const conds: string[] = []
  const params: any[] = []
  if (!isPlatform) { conds.push('t.enterprise_id = ?'); params.push(fid) }
  if (q.keyword) {
    const kw = '%' + String(q.keyword).trim().slice(0, 64) + '%'
    conds.push("(t.code LIKE ? OR COALESCE(NULLIF(t.batch_no, ''), b.batch_no) LIKE ? OR p.name LIKE ?)")
    params.push(kw, kw, kw)
  }
  if (q.status) { conds.push('t.status = ?'); params.push(Number(q.status)) }
  if (q.abnormalFlag !== undefined && q.abnormalFlag !== '') { conds.push('t.abnormal_flag = ?'); params.push(Number(q.abnormalFlag)) }
  if (q.productId) { conds.push('t.product_id = ?'); params.push(Number(q.productId)) }
  const remaining = remainingScope(q.scope)
  if (remaining && !q.uploadBatchId) throw createError({ statusCode: 400, statusMessage: '查询剩余码须指定总批次' })
  if (q.usageBatchId || remaining) {
    const { scope } = await resolveCodeScope(user, { uploadBatchId: q.uploadBatchId ? Number(q.uploadBatchId) : undefined, usageBatchId: q.usageBatchId ? Number(q.usageBatchId) : undefined, remaining })
    const selected = codeScopeSql(scope, 't'); conds.push(selected.sql); params.push(...selected.values)
  } else if (q.uploadBatchId) { conds.push('t.upload_batch_id = ?'); params.push(Number(q.uploadBatchId)) }
  if (q.dateFrom) { conds.push('t.created_at >= ?'); params.push(String(q.dateFrom) + ' 00:00:00') }
  if (q.dateTo) { conds.push('t.created_at <= ?'); params.push(String(q.dateTo) + ' 23:59:59') }

  const whereSql = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const page = Math.max(1, parseInt(String(q.page || '1')))
  const pageSize = Math.min(100, Math.max(1, parseInt(String(q.pageSize || '20'))))
  const offset = (page - 1) * pageSize

  const [cntRow] = await query<any[]>(
    'SELECT COUNT(*) AS c FROM trace_code t LEFT JOIN product p ON t.product_id = p.id LEFT JOIN batch b ON b.id = t.batch_id ' + whereSql, params)
  const rows = await query<any[]>(
    `SELECT t.id, t.code, t.status, t.abnormal_flag, t.abnormal_reason, t.product_id,
       COALESCE(t.produce_date,b.produce_date) AS produce_date, COALESCE(t.expire_date,b.expire_date) AS expire_date,
       COALESCE(NULLIF(t.batch_no,''),b.batch_no) AS batch_no, COALESCE(NULLIF(t.quality_cert_no,''),b.quality_cert_no) AS quality_cert_no,
       COALESCE(t.qc_result,b.qc_result) AS qc_result,t.batch_id,t.created_at,t.bound_at,
       ${childrenAvailable ? 't.usage_batch_id' : 'NULL'} AS usageBatchId,
       ${productionAvailable ? '(SELECT a.task_id FROM production_task_code a WHERE a.active_code_id=t.id)' : 'NULL'} AS taskId,
       ${childrenAvailable ? 'ub.spec_name_snapshot' : 'NULL'} AS specName,p.name AS product_name
     FROM trace_code t LEFT JOIN product p ON t.product_id = p.id LEFT JOIN upload_batch ub ON ub.id=t.upload_batch_id LEFT JOIN batch b ON b.id=t.batch_id ` + whereSql +
    ' ORDER BY t.id DESC LIMIT ? OFFSET ?', [...params, pageSize, offset])

  return {
    total: Number(cntRow?.c || 0),
    page,
    pageSize,
    rows: rows.map(r => ({
      ...r,
      statusLabel: STATUS_LABEL[Number(r.status)] || '未知',
      flagLabel: FLAG_LABEL[Number(r.abnormal_flag)] || '未知',
    })),
  }
})
