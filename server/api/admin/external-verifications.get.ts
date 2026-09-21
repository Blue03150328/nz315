// GET /api/admin/external-verifications：外部核验历史
import { query } from '../../utils/db'
import { requireBackendUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const page = Math.max(1, Number(getQuery(event).page || 1))
  const pageSize = Math.min(50, Math.max(1, Number(getQuery(event).pageSize || 20)))
  const where = user.role === 'platform_admin' ? '' : ' WHERE enterprise_id = ?'
  const params = user.role === 'platform_admin' ? [] : [user.enterprise_id]
  const [count] = await query<any[]>('SELECT COUNT(*) AS c FROM external_verification' + where, params)
  const rows = await query<any[]>('SELECT id, source_url, source_platform, code, overall_status, created_at FROM external_verification' + where + ' ORDER BY id DESC LIMIT ? OFFSET ?', [...params, pageSize, (page - 1) * pageSize])
  return { total: Number(count?.c || 0), page, pageSize, rows }
})
