import { query } from './db'

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

// 2026-10-12 码库去子批次：原「批次使用记录」（codeBatchUsage + CodeBatchUsageRow）随
// upload-batches/[id]/usage 接口一并下线；本文件只保留生产记录结构自检（codes.get.ts 仍在使用）。
