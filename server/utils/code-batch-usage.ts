import { query } from './db'
import { usageBatchSchemaAvailable } from './usage-batch-schema'

const requiredColumns: Record<string, string[]> = {
  production_task: ['id', 'enterprise_id', 'batch_id', 'name', 'line_name'],
  production_task_code: ['task_id', 'code_id', 'code', 'state', 'active_code_id', 'used_by', 'device', 'used_at', 'used_line'],
  production_collection_session: ['id', 'task_id', 'user_id', 'device_id', 'device', 'line_snapshot', 'context_json'],
  production_collection_event: ['event_id', 'session_id', 'sequence_no', 'code', 'result_state', 'captured_at', 'received_at'],
}

/** 只读检查生产记录结构；缺表、缺列明确降级，其余数据库错误交给调用方。 */
export async function checkCodeBatchUsageSchema(): Promise<boolean> {
  const tables = Object.keys(requiredColumns)
  const columns = await query<Array<{ table_name: string; column_name: string }>>(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${tables.map(() => '?').join(',')})`, tables,
  )
  const present = new Set(columns.map(column => `${column.table_name}.${column.column_name}`))
  return Object.entries(requiredColumns).every(([table, names]) => names.every(name => present.has(`${table}.${name}`)))
}

export interface CodeBatchUsageRow {
  taskId: number
  taskName: string
  batchNo: string | null
  lineName: string
  usageDate: string | null
  count: number
  source: 'mobile' | 'online'
  sourceLabel: string
  firstReceivedAt: string | null
  lastReceivedAt: string | null
  firstCapturedAt: string | null
  lastCapturedAt: string | null
  uploaderType: 'user' | 'unknown'
  uploaderId: number | null
  uploaderUsername: string | null
  uploaderName: string | null
  deviceId: number | null
  deviceName: string | null
}

const nullableText = (value: unknown): string | null => value === null || value === undefined || value === '' ? null : String(value)

// 后台 NOW() 收据按数据库会话时区保存；采集时间由客户端 ISO UTC 保存，分别换算北京时间。
const receivedInBeijing = (field: string) => `TIMESTAMPADD(SECOND, 28800 - TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()), ${field})`

/** 只统计真实已用码；领用、待审核、释放、重复扫描和拒绝收据均不能扣减库存。 */
export async function codeBatchUsage(uploadBatchId: number, enterpriseId: number, page: number, pageSize: number) {
  const productionRecordsAvailable = await checkCodeBatchUsageSchema()
  const [summary] = await query<any[]>(
    `SELECT COUNT(DISTINCT c.id) AS code_total,
       COUNT(DISTINCT CASE WHEN c.status = 2${productionRecordsAvailable ? ' OR d.code_id IS NOT NULL' : ''} THEN c.id END) AS used_count,
       ${productionRecordsAvailable ? 'COUNT(DISTINCT d.code_id)' : '0'} AS task_used_count,
       COUNT(DISTINCT CASE WHEN c.status = 2${productionRecordsAvailable ? ' AND d.code_id IS NULL' : ''} THEN c.id END) AS legacy_bound_count
     FROM trace_code c
     ${productionRecordsAvailable ? "LEFT JOIN production_task_code d ON d.code_id = c.id AND d.state = 'used'" : ''}
     WHERE c.upload_batch_id = ? AND c.enterprise_id = ?`, [uploadBatchId, enterpriseId],
  )
  const codeTotal = Number(summary?.code_total || 0)
  const usedCount = Number(summary?.used_count || 0)
  const result = {
    uploadBatchId,
    codeTotal,
    usedCount,
    remainingCount: Math.max(0, codeTotal - usedCount),
    taskUsedCount: Number(summary?.task_used_count || 0),
    legacyBoundCount: Number(summary?.legacy_bound_count || 0),
    productionRecordsAvailable,
    unavailableReason: productionRecordsAvailable ? null : '生产记录结构尚未安装或升级，暂无法查询使用明细；当前显示历史已绑定数量，来源及上传账号未记录。',
    rows: [] as CodeBatchUsageRow[],
    total: 0,
    page,
    pageSize,
  }
  if (!productionRecordsAvailable) return result
  const taskSnapshotsAvailable = await usageBatchSchemaAvailable()

  // 先利用上传批次索引限定码，再仅访问这些码涉及的任务会话和 accepted 收据。
  // 同一个码若有多条 accepted 收据，只采用最早一条，避免跨日或跨账号重复计数。
  const rows = await query<any[]>(
    `WITH used_codes AS (
       SELECT d.task_id, d.code_id, c.code, d.used_by, d.device, d.used_line, d.used_at
       FROM trace_code c JOIN production_task_code d ON d.code_id = c.id AND d.state = 'used'
       WHERE c.upload_batch_id = ? AND c.enterprise_id = ?
     ), accepted_ranked AS (
       SELECT d.task_id, d.code_id, s.user_id AS collection_user_id, s.device_id,
         s.device AS collection_device, s.line_snapshot, s.context_json,
         e.received_at, e.captured_at,
         ROW_NUMBER() OVER (PARTITION BY d.task_id, d.code_id ORDER BY e.received_at, e.sequence_no, e.event_id) AS receipt_rank
       FROM (SELECT DISTINCT task_id FROM used_codes) involved
       STRAIGHT_JOIN production_collection_session s ON s.task_id = involved.task_id
       STRAIGHT_JOIN production_collection_event e ON e.session_id = s.id AND e.result_state = 'accepted'
       STRAIGHT_JOIN used_codes d ON d.task_id = s.task_id AND d.code = e.code
     ), receipts AS (
       SELECT * FROM accepted_ranked WHERE receipt_rank = 1
     ), usage_details AS (
       SELECT d.task_id, d.code_id,
         CASE WHEN r.code_id IS NULL THEN 'online' ELSE 'mobile' END AS source,
         CASE WHEN d.used_by > 0 THEN d.used_by ELSE NULL END AS uploader_id,
         CASE WHEN d.used_by > 0 AND d.used_by = r.collection_user_id
           THEN COALESCE(NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.context_json, '$.userUsername')), ''), 'null'), u.username)
           ELSE u.username END AS uploader_username,
         CASE WHEN d.used_by > 0 AND d.used_by = r.collection_user_id
           THEN COALESCE(NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.context_json, '$.userName')), ''), 'null'), u.name)
           ELSE u.name END AS uploader_name,
         r.device_id,
         COALESCE(r.collection_device, d.device) AS device_name,
         COALESCE(NULLIF(d.used_line, ''), NULLIF(r.line_snapshot, ''), NULLIF(t.line_name, ''), t.name) AS line_name,
         ${receivedInBeijing('COALESCE(r.received_at, d.used_at)')} AS received_at,
         TIMESTAMPADD(HOUR, 8, r.captured_at) AS captured_at
       FROM used_codes d JOIN production_task t ON t.id = d.task_id AND t.enterprise_id = ?
       LEFT JOIN receipts r ON r.task_id = d.task_id AND r.code_id = d.code_id
       LEFT JOIN user u ON u.id = d.used_by AND d.used_by > 0
     ), grouped AS (
       SELECT h.task_id, h.source, h.uploader_id, DATE(h.received_at) AS usage_date,
         COUNT(DISTINCT h.code_id) AS usage_count,
         MAX(h.uploader_username) AS uploader_username,
         MAX(h.uploader_name) AS uploader_name,
         GROUP_CONCAT(DISTINCT h.line_name ORDER BY h.line_name SEPARATOR '、') AS line_name,
         CASE WHEN COUNT(DISTINCT h.device_id) = 1 THEN MAX(h.device_id) ELSE NULL END AS device_id,
         GROUP_CONCAT(DISTINCT h.device_name ORDER BY h.device_name SEPARATOR '、') AS device_name,
         DATE_FORMAT(MIN(h.received_at), '%Y-%m-%d %H:%i:%s') AS first_received_at,
         DATE_FORMAT(MAX(h.received_at), '%Y-%m-%d %H:%i:%s') AS last_received_at,
         DATE_FORMAT(MIN(h.captured_at), '%Y-%m-%d %H:%i:%s') AS first_captured_at,
         DATE_FORMAT(MAX(h.captured_at), '%Y-%m-%d %H:%i:%s') AS last_captured_at
       FROM usage_details h
       GROUP BY h.task_id, h.source, h.uploader_id, DATE(h.received_at),
         CASE WHEN h.uploader_id IS NULL THEN h.device_id ELSE NULL END
     )
     SELECT totals.group_total, g.*, t.name AS task_name,
       ${taskSnapshotsAvailable ? "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(t.production_snapshot,'$.batch_no')),b.batch_no)" : 'b.batch_no'} AS batch_no
     FROM (SELECT COUNT(*) AS group_total FROM grouped) totals
     LEFT JOIN (
       SELECT * FROM grouped ORDER BY last_received_at DESC, task_id DESC, source, uploader_id, device_id
       LIMIT ? OFFSET ?
     ) g ON TRUE
     LEFT JOIN production_task t ON t.id = g.task_id
     LEFT JOIN batch b ON b.id = t.batch_id
     ORDER BY g.last_received_at DESC, g.task_id DESC, g.source, g.uploader_id, g.device_id`,
    [uploadBatchId, enterpriseId, enterpriseId, pageSize, (page - 1) * pageSize],
  )
  result.total = Number(rows[0]?.group_total || 0)
  result.rows = rows.filter(row => row.task_id !== null && row.task_id !== undefined).map(row => ({
    taskId: Number(row.task_id),
    taskName: String(row.task_name || '生产任务'),
    batchNo: nullableText(row.batch_no),
    lineName: String(row.line_name || '生产线未记录'),
    usageDate: nullableText(row.usage_date),
    count: Number(row.usage_count || 0),
    source: row.source === 'mobile' ? 'mobile' : 'online',
    sourceLabel: row.source === 'mobile' ? '移动端上传' : '在线扫码（客户端未记录）',
    firstReceivedAt: nullableText(row.first_received_at),
    lastReceivedAt: nullableText(row.last_received_at),
    firstCapturedAt: nullableText(row.first_captured_at),
    lastCapturedAt: nullableText(row.last_captured_at),
    uploaderType: Number(row.uploader_id) > 0 ? 'user' : 'unknown',
    uploaderId: Number(row.uploader_id) > 0 ? Number(row.uploader_id) : null,
    uploaderUsername: Number(row.uploader_id) > 0 ? nullableText(row.uploader_username) : null,
    uploaderName: Number(row.uploader_id) > 0 ? nullableText(row.uploader_name) : null,
    deviceId: Number(row.device_id) > 0 ? Number(row.device_id) : null,
    deviceName: nullableText(row.device_name),
  }))
  return result
}
