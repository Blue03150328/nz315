import { query } from './db'

/** 新结构缺失时明确降级；查询失败不伪装成缺结构。 */
export async function usageBatchSchemaAvailable() {
  const required: Record<string, string[]> = {
    production_collection_upload: ['id', 'session_id', 'worker_session_id', 'device_name_snapshot', 'task_id', 'first_sequence', 'last_sequence', 'state', 'uploader_id', 'uploader_username', 'uploader_name', 'owner_user_id', 'device_id', 'completed_at'],
    code_usage_batch: ['id', 'parent_upload_batch_id', 'upload_id', 'task_id', 'spec_name_snapshot', 'product_id', 'production_snapshot'],
    trace_code: ['usage_batch_id'], upload_batch: ['spec_name_snapshot'],
    production_task: ['production_snapshot'], production_collection_event: ['upload_id'],
  }
  const rows = await query<any[]>('SELECT TABLE_NAME AS t,COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?)', [Object.keys(required)])
  const found = new Set(rows.map(row => `${row.t}.${row.c}`))
  return Object.entries(required).every(([table, columns]) => columns.every(column => found.has(`${table}.${column}`)))
}

export async function requireUsageBatchSchema() {
  if (!await usageBatchSchemaAvailable()) throw createError({ statusCode: 503, statusMessage: '上传子批次结构尚未安装，请管理员完成数据库升级' })
}
