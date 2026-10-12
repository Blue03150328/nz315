// GET /api/admin/codes/usage-batches —— 码库管理列表：一次「完成本次上传」= 一条记录（2026-10-12 去子批次改造）
//
// 列表主体由总批次（upload_batch）改为上传批次（code_usage_batch），只列「已完成」的采集上传：
// 扫描仪点「完成本次上传」处划界，未完成的上传与未采集上传的码均不出现在码库。
// 码数量 = 该次上传成功写入的码（trace_code.usage_batch_id = 本行 id）。
// 码状态 = 这些码的异常标记汇总：正常 / 部分冻结 / 全部冻结 / 部分作废 / 全部作废（作废优先级高于冻结）。
//
// 企业隔离与码作用域解析（server/utils/code-scope.ts）保持一致，走 upload_batch.enterprise_id，
// 保证列表里可见的行必然可以被冻结/作废/修正等写接口按同一作用域处理。
import { query } from '../../../utils/db'
import { requireBackendUser } from '../../../utils/auth'
import { usageBatchSchemaAvailable } from '../../../utils/usage-batch-schema'
import { taskProduction } from '../../../utils/task-production'

const DEFAULT_PAGE_SIZE = 20

// 数据库会话时区保存的 NOW() 收据换算为北京时间（与全库口径一致：见 code-batch-usage.ts）。
const beijing = (field: string) => `DATE_FORMAT(TIMESTAMPADD(SECOND,28800-TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(),NOW()),${field}),'%Y-%m-%d %H:%i:%s')`
// 生产批号优先取任务快照（整任务更正后的口径），未更正时回退共享业务批次。
const batchNoExpr = "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(t.production_snapshot,'$.batch_no')),b.batch_no)"
const produceDateExpr = "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(t.production_snapshot,'$.produce_date')),b.produce_date)"

// 汇总判定：全部作废 > 部分作废 > 全部冻结 > 部分冻结 > 正常
function summaryOf(total: number, frozen: number, voided: number) {
  if (total <= 0) return '空批次'
  if (voided >= total) return '全部作废'
  if (voided > 0) return '部分作废'
  if (frozen >= total) return '全部冻结'
  if (frozen > 0) return '部分冻结'
  return '正常'
}
const text = (value: unknown) => value === null || value === undefined || String(value).trim() === '' ? null : String(value)

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const q = getQuery(event)
  const page = Math.max(1, parseInt(String(q.page || '1')))
  const pageSize = Math.min(100, Math.max(1, parseInt(String(q.pageSize || String(DEFAULT_PAGE_SIZE)))))

  if (user.role !== 'platform_admin' && !user.enterprise_id) {
    throw createError({ statusCode: 403, statusMessage: '账号未关联企业' })
  }
  // 旧库尚未安装采集上传结构时明确降级，不伪装成空列表。
  if (!await usageBatchSchemaAvailable()) {
    return {
      total: 0, page, pageSize, rows: [], productionRecordsAvailable: false,
      unavailableReason: '采集上传批次结构尚未安装，请管理员完成数据库升级后再查看码库',
    }
  }

  const conds: string[] = ["u.state = 'completed'"]
  const params: any[] = []
  if (user.role !== 'platform_admin') { conds.push('ub.enterprise_id = ?'); params.push(user.enterprise_id) }
  // 筛选：关联产品 / 生产批号 / 上传来源 / 上传时间范围
  if (q.productId) { conds.push('t.product_id = ?'); params.push(Number(q.productId)) }
  if (q.batchNo) { conds.push(`${batchNoExpr} LIKE ?`); params.push('%' + String(q.batchNo).trim().slice(0, 64) + '%') }
  if (q.uploader) {
    conds.push("COALESCE(NULLIF(u.uploader_username,''),NULLIF(u.uploader_name,''),NULLIF(s.device,'')) LIKE ?")
    params.push('%' + String(q.uploader).trim().slice(0, 64) + '%')
  }
  if (q.dateFrom) { conds.push(`${beijing('u.completed_at')} >= ?`); params.push(String(q.dateFrom) + ' 00:00:00') }
  if (q.dateTo) { conds.push(`${beijing('u.completed_at')} <= ?`); params.push(String(q.dateTo) + ' 23:59:59') }
  // 保留指定总批次的筛选能力（接口兼容；码库界面不再按总批次呈现）
  if (q.uploadBatchId) { conds.push('cb.parent_upload_batch_id = ?'); params.push(Number(q.uploadBatchId)) }

  const FROM = `FROM code_usage_batch cb
    JOIN production_collection_upload u ON u.id = cb.upload_id AND u.state = 'completed'
    JOIN production_task t ON t.id = cb.task_id
    LEFT JOIN batch b ON b.id = t.batch_id
    LEFT JOIN product p ON p.id = t.product_id
    LEFT JOIN upload_batch ub ON ub.id = cb.parent_upload_batch_id
    LEFT JOIN production_collection_session s ON s.id = u.session_id`
  const whereSql = 'WHERE ' + conds.join(' AND ')

  const [cntRow] = await query<any[]>('SELECT COUNT(*) AS c ' + FROM + ' ' + whereSql, params)
  // 先取当前页上传批次，再汇总这些批次的码，避免每次刷新扫描全库。
  const selected = await query<any[]>(
    'SELECT cb.id ' + FROM + ' ' + whereSql + ' ORDER BY cb.id DESC LIMIT ? OFFSET ?',
    [...params, pageSize, (page - 1) * pageSize])
  const ids = selected.map(row => Number(row.id))
  const rows = ids.length ? await query<any[]>(
    `SELECT cb.id, cb.parent_upload_batch_id, cb.upload_id, cb.task_id, cb.spec_name_snapshot,
       t.name AS task_name, t.product_id, t.production_snapshot,
       p.name AS product_name,
       ${batchNoExpr} AS batch_no, ${produceDateExpr} AS produce_date,
       ${beijing('u.completed_at')} AS completed_at,
       u.uploader_id, u.uploader_username, u.uploader_name, s.device AS device_name,
       COUNT(c.id) AS code_total,
       COALESCE(SUM(c.abnormal_flag = 1), 0) AS frozen_count,
       COALESCE(SUM(c.abnormal_flag = 2), 0) AS voided_count,
       COALESCE(SUM(c.status = 2), 0) AS bound_count
     FROM code_usage_batch cb
     JOIN production_collection_upload u ON u.id = cb.upload_id
     JOIN production_task t ON t.id = cb.task_id
     LEFT JOIN batch b ON b.id = t.batch_id
     LEFT JOIN product p ON p.id = t.product_id
     LEFT JOIN production_collection_session s ON s.id = u.session_id
     LEFT JOIN trace_code c ON c.usage_batch_id = cb.id AND c.upload_batch_id = cb.parent_upload_batch_id
     WHERE cb.id IN (${ids.map(() => '?').join(',')})
     GROUP BY cb.id, cb.parent_upload_batch_id, cb.upload_id, cb.task_id, cb.spec_name_snapshot,
       t.name, t.product_id, t.production_snapshot, p.name,
       b.batch_no, b.produce_date, u.completed_at,
       u.uploader_id, u.uploader_username, u.uploader_name, s.device
     ORDER BY cb.id DESC`, ids) : []

  return {
    total: Number(cntRow?.c || 0),
    page,
    pageSize,
    productionRecordsAvailable: true,
    unavailableReason: null,
    rows: rows.map((r: any) => {
      // 生产日期/批号统一走任务快照回退业务批次，与扫码结果页口径一致。
      const production = taskProduction(r, { batch_no: r.batch_no, produce_date: r.produce_date })
      const codeTotal = Number(r.code_total || 0)
      const frozenCount = Number(r.frozen_count || 0)
      const voidedCount = Number(r.voided_count || 0)
      const uploaderUsername = text(r.uploader_username)
      const uploaderName = text(r.uploader_name)
      const deviceName = text(r.device_name)
      return {
        id: Number(r.id),
        uploadId: r.upload_id,
        parentUploadBatchId: Number(r.parent_upload_batch_id),
        taskId: Number(r.task_id),
        taskName: r.task_name || null,
        productId: Number(r.product_id),
        productName: r.product_name || null,
        // 规格为生成时的包装快照；未记录时前端展示「原规格资料未记录」。
        specName: text(r.spec_name_snapshot),
        batchNo: text(production.batch_no),
        produceDate: production.produce_date ? String(production.produce_date).slice(0, 10) : null,
        codeTotal,
        frozenCount,
        voidedCount,
        boundCount: Number(r.bound_count || 0),
        normalCount: Math.max(0, codeTotal - frozenCount - voidedCount),
        summary: summaryOf(codeTotal, frozenCount, voidedCount),
        uploadAt: r.completed_at || null,
        // 上传来源：账号优先，无账号回退设备（用户 2026-10-12 确认口径）
        uploaderId: r.uploader_id ? Number(r.uploader_id) : null,
        uploaderUsername,
        uploaderName,
        deviceName,
        uploadSource: uploaderUsername || uploaderName || deviceName || '上传账号未记录',
        // 可冻结数（作废为终态，不计入）
        flagableCount: Math.max(0, codeTotal - voidedCount),
        // 修正生产信息：含冻结/作废码时先在明细内处理
        canCorrect: codeTotal > 0 && frozenCount === 0 && voidedCount === 0,
        canExport: codeTotal > 0,
      }
    }),
  }
})
