import { requireBackendUser } from './auth'
import { query } from './db'
import type { ImportReport } from '#shared/types/import-report'

// 摘要、明细、下载统一走此权限检查，不接受客户端提供的企业归属。
export async function requireImportReport(event: any) {
  const user = await requireBackendUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isSafeInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: '报告编号无效' })
  const params = user.role === 'platform_admin' ? [id] : [id, user.enterprise_id]
  const [row] = await query<any[]>('SELECT r.*, e.name AS enterprise_name, u.name AS operator_name FROM import_report r JOIN enterprise e ON e.id = r.enterprise_id LEFT JOIN `user` u ON u.id = r.created_by WHERE r.id = ?' + (user.role === 'platform_admin' ? '' : ' AND r.enterprise_id = ?'), params)
  if (!row) throw createError({ statusCode: 404, statusMessage: '报告不存在或无权访问' })
  const result = typeof row.result_json === 'string' ? JSON.parse(row.result_json) : row.result_json
  return { ...result, reportId: id, fileName: row.file_name, version: row.version, state: row.state,
    createdAt: String(row.created_at), enterpriseName: row.enterprise_name, operatorName: row.operator_name || '原账号已删除' } as ImportReport
}
