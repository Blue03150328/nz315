// GET /api/admin/codes/upload-batches —— 码库管理：按上传文件批次聚合列表（2026-09-04 改造）
// 每行 = 生产采集上传的一份追溯码文件（upload_batch）；不再按单条追溯码分页展示。
// 码状态汇总 = 该批次全部码的异常标记实时聚合：正常 / 部分冻结 / 全部冻结 / 部分作废 / 全部作废
// （作废优先级高于冻结：冻结+作废混合展示为「部分作废」，作废为终态最需关注）
import { query } from '../../../utils/db'
import { requireBackendUser } from '../../../utils/auth'

// 汇总判定：全部作废 > 部分作废 > 全部冻结 > 部分冻结 > 正常
function summaryOf(total: number, frozen: number, voided: number) {
  if (total <= 0) return '空批次'
  if (voided >= total) return '全部作废'
  if (voided > 0) return '部分作废'
  if (frozen >= total) return '全部冻结'
  if (frozen > 0) return '部分冻结'
  return '正常'
}

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const q = getQuery(event)
  const conds: string[] = []
  const params: any[] = []

  // 多租户企业过滤（与全库范式一致）
  if (user.role !== 'platform_admin') {
    conds.push('ub.enterprise_id = ?')
    params.push(user.enterprise_id)
  }
  // 筛选：批次文件名 / 关联产品 / 生产批号 / 上传时间范围
  if (q.fileName) {
    conds.push('ub.file_name LIKE ?')
    params.push('%' + String(q.fileName).trim().slice(0, 64) + '%')
  }
  if (q.productId) { conds.push('ub.product_id = ?'); params.push(Number(q.productId)) }
  if (q.batchNo) {
    conds.push('ub.batch_no LIKE ?')
    params.push('%' + String(q.batchNo).trim().slice(0, 64) + '%')
  }
  if (q.dateFrom) { conds.push('ub.created_at >= ?'); params.push(String(q.dateFrom) + ' 00:00:00') }
  if (q.dateTo) { conds.push('ub.created_at <= ?'); params.push(String(q.dateTo) + ' 23:59:59') }

  const whereSql = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const page = Math.max(1, parseInt(String(q.page || '1')))
  const pageSize = Math.min(100, Math.max(1, parseInt(String(q.pageSize || '20'))))
  const offset = (page - 1) * pageSize

  const [cntRow] = await query<any[]>(
    'SELECT COUNT(*) AS c FROM upload_batch ub ' + whereSql, params)
  const rows = await query<any[]>(
    `SELECT ub.id, ub.file_name, ub.product_id, ub.batch_no, ub.created_at, ub.created_by,
       p.name AS product_name,
       COUNT(t.id) AS code_total,
       COALESCE(SUM(t.abnormal_flag = 1), 0) AS frozen_count,
       COALESCE(SUM(t.abnormal_flag = 2), 0) AS voided_count
     FROM upload_batch ub
     LEFT JOIN product p ON p.id = ub.product_id
     LEFT JOIN trace_code t ON t.upload_batch_id = ub.id
     ` + whereSql + `
     GROUP BY ub.id, ub.file_name, ub.product_id, ub.batch_no, ub.created_at, ub.created_by, p.name
     ORDER BY ub.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset])

  return {
    total: Number(cntRow?.c || 0),
    page,
    pageSize,
    rows: rows.map((r: any) => {
      const codeTotal = Number(r.code_total || 0)
      const frozenCount = Number(r.frozen_count || 0)
      const voidedCount = Number(r.voided_count || 0)
      return {
        ...r,
        codeTotal,
        frozenCount,
        voidedCount,
        normalCount: Math.max(0, codeTotal - frozenCount - voidedCount),
        summary: summaryOf(codeTotal, frozenCount, voidedCount),
        // 行内可操作数（冻结/恢复不动作废终态）
        flagableCount: Math.max(0, codeTotal - voidedCount),
      }
    }),
  }
})
