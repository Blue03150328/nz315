// GET /api/admin/codes/upload-batches —— 码库管理：按上传文件批次聚合列表（2026-09-04 改造）
// 每行 = 生产采集上传的一份追溯码文件（upload_batch）；不再按单条追溯码分页展示。
// 码状态汇总 = 该批次全部码的异常标记实时聚合：正常 / 部分冻结 / 全部冻结 / 部分作废 / 全部作废
// （作废优先级高于冻结：冻结+作废混合展示为「部分作废」，作废为终态最需关注）
import { query } from '../../../utils/db'
import { requireBackendUser } from '../../../utils/auth'
import { checkCodeBatchUsageSchema } from '../../../utils/code-batch-usage'
import { freeProductionCode } from '../../../utils/production-allocation'

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
  // 异常筛选按是否存在匹配码筛选批次，保留批次全部码汇总。
  if (q.abnormalFlag !== undefined) {
    const flag = Number(q.abnormalFlag)
    if (![0, 1, 2].includes(flag)) throw createError({ statusCode: 400, statusMessage: '异常标记无效' })
    conds.push('EXISTS (SELECT 1 FROM trace_code ft WHERE ft.upload_batch_id = ub.id AND ft.abnormal_flag = ?)')
    params.push(flag)
  }
  if (q.uploadBatchId) { conds.push('ub.id = ?'); params.push(Number(q.uploadBatchId)) }
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

  // 老库尚未安装生产模块时仍可查看码库，不能把未知占用数当成零。
  const productionRecordsAvailable = await checkCodeBatchUsageSchema()
  const usedSql = productionRecordsAvailable
    // 已用码保持唯一active_code_id占用，只有未用余码经审核才能释放。
    ? "(t.status = 2 OR COALESCE(a.state='used', 0))"
    : '(t.status = 2)'
  const availabilitySql = freeProductionCode.replace(/\bc\./g, 't.')
  const usedTimeSql = productionRecordsAvailable
    ? `MAX(CASE WHEN ${usedSql} THEN COALESCE(a.used_at,t.bound_at) END)`
    : 'MAX(t.bound_at)'
  const lastUsedTimeSql = `DATE_FORMAT(TIMESTAMPADD(SECOND, 28800 - TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()), ${usedTimeSql}), '%Y-%m-%d %H:%i:%s') AS last_used_at`
  const productionColumns = productionRecordsAvailable
    ? `COALESCE(SUM(NOT ${usedSql} AND a.active_code_id IS NOT NULL), 0) AS occupied_count,
       COALESCE(SUM(${availabilitySql}), 0) AS available_count,
       ${lastUsedTimeSql}`
    : `NULL AS occupied_count, NULL AS available_count, ${lastUsedTimeSql}`

  const [cntRow] = await query<any[]>(
    'SELECT COUNT(*) AS c FROM upload_batch ub ' + whereSql, params)
  // 先取得当前页批次，再汇总这些批次的码，避免定时刷新扫描其他页的库存。
  const selectedBatches = await query<any[]>(
    'SELECT ub.id FROM upload_batch ub ' + whereSql + ' ORDER BY ub.id DESC LIMIT ? OFFSET ?', [...params, pageSize, offset])
  const selectedIds = selectedBatches.map(row => Number(row.id))
  const rows = selectedIds.length ? await query<any[]>(
    `SELECT ub.id, ub.file_name, ub.product_id, ub.batch_no, ub.created_at, ub.created_by,
       p.name AS product_name,
       COUNT(t.id) AS code_total,
       COALESCE(SUM(t.abnormal_flag = 1), 0) AS frozen_count,
       COALESCE(SUM(t.abnormal_flag = 2), 0) AS voided_count,
       COALESCE(SUM(t.status = 2), 0) AS bound_count,
       COALESCE(SUM(${usedSql}), 0) AS used_count,
       ${productionColumns}
     FROM upload_batch ub
     LEFT JOIN product p ON p.id = ub.product_id
     LEFT JOIN trace_code t ON t.upload_batch_id = ub.id
     ${productionRecordsAvailable ? 'LEFT JOIN production_task_code a ON a.active_code_id=t.id' : ''}
     WHERE ub.id IN (${selectedIds.map(() => '?').join(',')})
     GROUP BY ub.id, ub.file_name, ub.product_id, ub.batch_no, ub.created_at, ub.created_by, p.name
     ORDER BY ub.id DESC`, selectedIds) : []

  return {
    total: Number(cntRow?.c || 0),
    page,
    pageSize,
    rows: rows.map((r: any) => {
      const codeTotal = Number(r.code_total || 0)
      const frozenCount = Number(r.frozen_count || 0)
      const voidedCount = Number(r.voided_count || 0)
      const boundCount = Number(r.bound_count || 0)
      const usedCount = Number(r.used_count || 0)
      return {
        ...r,
        codeTotal,
        frozenCount,
        voidedCount,
        boundCount,
        usedCount,
        remainingCount: Math.max(0, codeTotal - usedCount),
        occupiedCount: productionRecordsAvailable ? Number(r.occupied_count || 0) : null,
        availableCount: productionRecordsAvailable ? Number(r.available_count || 0) : null,
        lastUsedAt: r.last_used_at || null,
        productionRecordsAvailable,
        unavailableReason: productionRecordsAvailable ? null : '生产记录模块尚未安装完整，任务使用记录及占用数量暂不可查询；已使用数量按现有绑定状态统计',
        normalCount: Math.max(0, codeTotal - frozenCount - voidedCount),
        summary: summaryOf(codeTotal, frozenCount, voidedCount),
        // 行内可操作数（冻结/恢复不动作废终态）
        flagableCount: Math.max(0, codeTotal - voidedCount),
        // 删除约束：批次内存在已绑定码（status=2）时禁止删除；空批次（孤儿行）也可删
        canDelete: boundCount === 0,
      }
    }),
  }
})
