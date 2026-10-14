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
import { uploadCorrectionBlock } from '../../../utils/upload-correction-rules'
import { usageBatchFilter, usageFrom, usageBeijing as beijing, usageBatchNo as batchNoExpr, usageProduceDate as produceDateExpr, usageLine } from '../../../utils/usage-batch-list'

const DEFAULT_PAGE_SIZE = 20

// 数据库会话时区保存的 NOW() 收据换算为北京时间（与全库口径一致：见 code-batch-usage.ts）。

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

  const { sql, params, filters: selectionFilters } = usageBatchFilter(user, q)
  const FROM = usageFrom
  const whereSql = 'WHERE ' + sql

  const [cntRow] = await query<any[]>('SELECT COUNT(*) AS c ' + FROM + ' ' + whereSql, params)
  // 先取当前页上传批次，再汇总这些批次的码，避免每次刷新扫描全库。
  const selected = await query<any[]>(
    'SELECT cb.id ' + FROM + ' ' + whereSql + ' ORDER BY cb.id DESC LIMIT ? OFFSET ?',
    [...params, pageSize, (page - 1) * pageSize])
  const ids = selected.map(row => Number(row.id))
  const rows = ids.length ? await query<any[]>(
    `SELECT cb.id, cb.parent_upload_batch_id, cb.upload_id, cb.task_id, cb.spec_name_snapshot,
       t.name AS task_name, COALESCE(cb.product_id,t.product_id) AS product_id, COALESCE(cb.production_snapshot,t.production_snapshot) AS production_snapshot, cb.product_id AS stock_product_id,
       p.name AS product_name,
       ${batchNoExpr} AS batch_no, ${produceDateExpr} AS produce_date,
       ${beijing('u.completed_at')} AS completed_at,
       u.uploader_id, u.uploader_username, u.uploader_name, COALESCE(u.device_name_snapshot,s.device) AS device_name, ${usageLine} AS line_name,
       t.created_by AS task_created_by,t.status AS task_status,t.ended_at,u.state AS upload_state,u.source_kind,s.state AS legacy_session_state,
       ws.state AS worker_session_state,ws.last_sequence,ws.final_sequence,wr.state AS run_state,
       COUNT(c.id) AS code_total,
       COALESCE(SUM(c.abnormal_flag = 1), 0) AS frozen_count,
       COALESCE(SUM(c.abnormal_flag = 2), 0) AS voided_count,
       COALESCE(SUM(c.status = 2), 0) AS bound_count
     FROM code_usage_batch cb
     JOIN production_collection_upload u ON u.id = cb.upload_id
     JOIN production_task t ON t.id = cb.task_id
     LEFT JOIN batch b ON b.id = t.batch_id
     LEFT JOIN product p ON p.id = COALESCE(cb.product_id,t.product_id)
     LEFT JOIN production_collection_session s ON s.id = u.session_id
     LEFT JOIN worker_session ws ON ws.id = u.worker_session_id
     LEFT JOIN worker_run wr ON wr.id = ws.run_id
     LEFT JOIN trace_code c ON c.usage_batch_id = cb.id AND c.upload_batch_id = cb.parent_upload_batch_id
     WHERE cb.id IN (${ids.map(() => '?').join(',')})
     GROUP BY cb.id, cb.parent_upload_batch_id, cb.upload_id, cb.task_id, cb.spec_name_snapshot,
       t.name, t.product_id, t.production_snapshot, cb.product_id,cb.production_snapshot,p.name,
       b.batch_no, b.produce_date, u.completed_at,
       u.uploader_id, u.uploader_username, u.uploader_name, s.device,u.device_name_snapshot,s.line_snapshot,t.line_name,wr.device_snapshot,
       t.created_by,t.status,t.ended_at,u.state,u.source_kind,s.state,ws.state,ws.last_sequence,ws.final_sequence,wr.state
     ORDER BY cb.id DESC`, ids) : []

  return {
    total: Number(cntRow?.c || 0),
    page,
    pageSize,
    productionRecordsAvailable: true,
    selectionFilters,
    unavailableReason: null,
    rows: rows.map((r: any) => {
      // 生产日期/批号使用本次上传快照，历史记录兼容任务与业务批次。
      const production = taskProduction(r, { batch_no: r.batch_no, produce_date: r.produce_date })
      const codeTotal = Number(r.code_total || 0)
      const frozenCount = Number(r.frozen_count || 0)
      const voidedCount = Number(r.voided_count || 0)
      const uploaderUsername = text(r.uploader_username)
      const uploaderName = text(r.uploader_name)
      const deviceName = text(r.device_name)
      const correctionReason = uploadCorrectionBlock(user, r)
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
        lineName: text(r.line_name),
        uploadSource: uploaderUsername || uploaderName || deviceName || '上传账号未记录',
        // 可冻结数（作废为终态，不计入）
        flagableCount: Math.max(0, codeTotal - voidedCount),
        // 修正生产信息：含冻结/作废码时先在明细内处理
        canCorrect: !correctionReason,
        correctionReason,
        canExport: codeTotal > 0,
      }
    }),
  }
})
