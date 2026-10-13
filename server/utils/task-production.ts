import { query } from './db'

/** 旧生产结构继续读取原批次，新字段安装后才查询任务快照。 */
export async function taskProductionSnapshotsAvailable() {
  const rows = await query<any[]>("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='production_task' AND COLUMN_NAME='production_snapshot'")
  return rows.length > 0
}

/** 任务更正只覆盖本任务，保留共享生产批次和二维码身份。 */
export function taskProduction(task: any, batch: any) {
  const snapshot = typeof task.production_snapshot === 'string' ? JSON.parse(task.production_snapshot) : task.production_snapshot
  return { ...batch, ...(snapshot || {}), id: batch.id, product_id: batch.product_id, enterprise_id: batch.enterprise_id }
}

export function applyTaskProduction(row: any) {
  const snapshot = typeof row.production_snapshot === 'string' ? JSON.parse(row.production_snapshot) : row.production_snapshot
  return { ...row, ...(snapshot || {}) }
}
