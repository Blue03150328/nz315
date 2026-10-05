import { requireBackendUser } from '../../../utils/auth'
import { query } from '../../../utils/db'
export default defineEventHandler(async event => {
  const user = await requireBackendUser(event)
  const page = Math.max(1, Math.floor(Number(getQuery(event).page) || 1))
  const params = user.role === 'platform_admin' ? [] : [user.enterprise_id]
  const where = user.role === 'platform_admin' ? '' : ' WHERE r.enterprise_id = ?'
  const [count] = await query<any[]>('SELECT COUNT(*) AS total FROM import_report r' + where, params)
  const rows = await query<any[]>('SELECT r.id, r.file_name, r.state, r.created_at, e.name AS enterprise_name FROM import_report r JOIN enterprise e ON e.id = r.enterprise_id' + where + ' ORDER BY r.id DESC LIMIT 20 OFFSET ?', [...params, (page - 1) * 20])
  return { rows, total: Number(count.total), page, pageSize: 20 }
})
