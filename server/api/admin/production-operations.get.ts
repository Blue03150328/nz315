import { requireBackendUser } from '../../utils/auth'
import { query } from '../../utils/db'
import { jsonValue } from '../../utils/production-values'
export default defineEventHandler(async event => {
  const user = await requireBackendUser(event)
  const q = getQuery(event)
  const page = Math.max(1, Number(q.page) || 1)
  const where = user.role === 'platform_admin' ? '' : ' AND o.enterprise_id = ?'
  const args = user.role === 'platform_admin' ? [] : [user.enterprise_id]
  const [count] = await query<any[]>("SELECT COUNT(*) AS total FROM production_operation o WHERE o.kind IN ('correct','batch')" + where, args)
  const rows = await query<any[]>(`SELECT o.*, u.name AS actor_name, ub.file_name FROM production_operation o
    LEFT JOIN user u ON u.id=o.actor_id LEFT JOIN upload_batch ub ON ub.id=o.scope_id AND o.kind='correct' AND ub.enterprise_id=o.enterprise_id
    WHERE o.kind IN ('correct','batch')` + where + " ORDER BY (o.status='pending') DESC, o.id DESC LIMIT 20 OFFSET ?", [...args, (page - 1) * 20])
  return { total: Number(count.total), rows: rows.map(row => ({ ...row, payload: jsonValue(row.payload), result: jsonValue(row.result) })) }
})
