// GET /api/admin/codes —— 码列表查询（PRD 5.5.7：筛选/分页/搜索）
// 2026-09-04 码库聚合改造：新增可选参数 uploadBatchId——码库管理「详细」弹窗按上传批次查看单条明细
// （原单条列表逻辑不变，未传该参数时行为与改造前一致）
import { query } from '../../utils/db'
import { effectiveProduction } from '../../utils/production-values'
import { requireBackendUser } from '../../utils/auth'

const STATUS_LABEL: Record<number, string> = { 1: '已生成', 2: '已绑定' }
const FLAG_LABEL: Record<number, string> = { 0: '正常', 1: '已冻结', 2: '已作废' }

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const q = getQuery(event)
  const isPlatform = user.role === 'platform_admin'
  const fid = user.enterprise_id

  const conds: string[] = []
  const params: any[] = []
  if (!isPlatform) { conds.push('t.enterprise_id = ?'); params.push(fid) }
  if (q.keyword) {
    const kw = '%' + String(q.keyword).trim().slice(0, 64) + '%'
    conds.push('(t.code LIKE ? OR b.batch_no LIKE ? OR p.name LIKE ?)')
    params.push(kw, kw, kw)
  }
  if (q.status) { conds.push('t.status = ?'); params.push(Number(q.status)) }
  if (q.abnormalFlag !== undefined && q.abnormalFlag !== '') { conds.push('t.abnormal_flag = ?'); params.push(Number(q.abnormalFlag)) }
  if (q.productId) { conds.push('t.product_id = ?'); params.push(Number(q.productId)) }
  if (q.uploadBatchId) { conds.push('t.upload_batch_id = ?'); params.push(Number(q.uploadBatchId)) }
  if (q.dateFrom) { conds.push('t.created_at >= ?'); params.push(String(q.dateFrom) + ' 00:00:00') }
  if (q.dateTo) { conds.push('t.created_at <= ?'); params.push(String(q.dateTo) + ' 23:59:59') }

  const whereSql = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const page = Math.max(1, parseInt(String(q.page || '1')))
  const pageSize = Math.min(100, Math.max(1, parseInt(String(q.pageSize || '20'))))
  const offset = (page - 1) * pageSize

  const [cntRow] = await query<any[]>(
    'SELECT COUNT(*) AS c FROM trace_code t LEFT JOIN product p ON t.product_id = p.id LEFT JOIN batch b ON b.id=t.batch_id ' + whereSql, params)
  const rows = await query<any[]>(
    `SELECT t.id, t.code, t.status, t.abnormal_flag, t.abnormal_reason, t.product_id,
       t.*, b.batch_no AS current_batch_no, b.produce_date AS base_produce_date, b.expire_date AS base_expire_date, b.quality_cert_no AS base_quality_cert_no, b.qc_result AS base_qc_result,
       p.name AS product_name
     FROM trace_code t LEFT JOIN product p ON t.product_id = p.id LEFT JOIN batch b ON b.id=t.batch_id ` + whereSql +
    ' ORDER BY t.id DESC LIMIT ? OFFSET ?', [...params, pageSize, offset])

  return {
    total: Number(cntRow?.c || 0),
    page,
    pageSize,
    rows: rows.map(r => {
      const value = effectiveProduction(r, { produce_date:r.base_produce_date, expire_date:r.base_expire_date,
        quality_cert_no:r.base_quality_cert_no, qc_result:r.base_qc_result })
      return { id:r.id, code:r.code, status:r.status, abnormal_flag:r.abnormal_flag, abnormal_reason:r.abnormal_reason,
        product_id:r.product_id, product_name:r.product_name, batch_id:r.batch_id, batch_no:r.current_batch_no,
        produce_date:value.produceDate, expire_date:value.expireDate, quality_cert_no:value.qualityCertNo, qc_result:value.qcResult,
        created_at:r.created_at, bound_at:r.bound_at,
        statusLabel:STATUS_LABEL[Number(r.status)] || '未知', flagLabel:FLAG_LABEL[Number(r.abnormal_flag)] || '未知' }
    }),
  }
})
