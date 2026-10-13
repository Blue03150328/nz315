import type { AuthUser } from './auth'
import { query } from './db'
import { requireUsageBatchSchema } from './usage-batch-schema'

export interface CodeScope { uploadBatchId?: number; usageBatchId?: number; remaining?: boolean }
export function validScopeId(value: unknown) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id < 1) throw createError({ statusCode: 400, statusMessage: '码批次编号无效' })
  return id
}
export function codeScopeSql(scope: CodeScope, alias = 'c') {
  const prefix = alias ? `${alias}.` : ''
  const conditions = [`${prefix}upload_batch_id=?`], values: number[] = [scope.uploadBatchId!]
  if (scope.usageBatchId) { conditions.push(`${prefix}usage_batch_id=?`); values.push(scope.usageBatchId) }
  if (scope.remaining) conditions.push(`${prefix}status=1 AND NOT EXISTS (SELECT 1 FROM production_task_code used WHERE used.code_id=${prefix}id AND used.state='used')`)
  return { sql: conditions.join(' AND '), values }
}
export async function resolveCodeScope(user: AuthUser, selection: CodeScope) {
  if (selection.usageBatchId && selection.remaining) throw createError({ statusCode: 400, statusMessage: '已用子批次与剩余范围不能同时选择' })
  if (selection.usageBatchId || selection.remaining) await requireUsageBatchSchema()
  if (user.role !== 'platform_admin' && !user.enterprise_id) throw createError({ statusCode: 403, statusMessage: '账号未关联企业' })
  const conditions = user.role === 'platform_admin' ? '' : ' AND ub.enterprise_id=?'
  const values = user.role === 'platform_admin' ? [] : [user.enterprise_id]
  const [row] = selection.usageBatchId
    ? await query<any[]>('SELECT ub.*,cb.id AS child_id,cb.task_id FROM code_usage_batch cb JOIN upload_batch ub ON ub.id=cb.parent_upload_batch_id WHERE cb.id=?' + conditions, [validScopeId(selection.usageBatchId), ...values])
    : await query<any[]>('SELECT ub.* FROM upload_batch ub WHERE ub.id=?' + conditions, [validScopeId(selection.uploadBatchId), ...values])
  if (!row) throw createError({ statusCode: 404, statusMessage: '码批次不存在或不属于本企业' })
  if (selection.usageBatchId && selection.uploadBatchId && Number(row.id) !== Number(selection.uploadBatchId)) throw createError({ statusCode: 404, statusMessage: '子批次不属于指定的总批次' })
  return { row, scope: { uploadBatchId: Number(row.id), ...(selection.usageBatchId ? { usageBatchId: Number(row.child_id) } : {}), ...(selection.remaining ? { remaining: true } : {}) } as CodeScope }
}
