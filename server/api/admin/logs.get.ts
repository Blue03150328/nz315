// GET /api/admin/logs —— 操作日志（PRD 5.12.4：操作人/模块/类型/日期筛选）
import { query } from '../../utils/db'
import { requireBackendUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const q = getQuery(event)
  const conds: string[] = []
  const params: any[] = []

  if (user.role !== 'platform_admin') {
    conds.push('l.enterprise_id = ?'); params.push(user.enterprise_id)
  }
  if (q.keyword) {
    const kw = '%' + String(q.keyword).trim() + '%'
    conds.push('(u.username LIKE ? OR l.module LIKE ? OR l.action LIKE ? OR l.content LIKE ?)'); params.push(kw, kw, kw, kw)
  }
  if (q.module) { conds.push('l.module = ?'); params.push(String(q.module)) }
  if (q.action) { conds.push('l.action LIKE ?'); params.push('%' + String(q.action) + '%') }
  if (q.result !== undefined && q.result !== '') { conds.push('l.result = ?'); params.push(Number(q.result)) }
  if (q.dateFrom) { conds.push('l.created_at >= ?'); params.push(String(q.dateFrom) + ' 00:00:00') }
  if (q.dateTo) { conds.push('l.created_at <= ?'); params.push(String(q.dateTo) + ' 23:59:59') }

  const whereSql = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const page = Math.max(1, parseInt(String(q.page || '1')))
  const pageSize = Math.min(100, Math.max(1, parseInt(String(q.pageSize || '20'))))
  const offset = (page - 1) * pageSize

  const [cntRow] = await query<any[]>(
    'SELECT COUNT(*) AS c FROM operation_log l LEFT JOIN \`user\` u ON l.user_id = u.id ' + whereSql, params)
  const rows = await query<any[]>(
    `SELECT l.*, u.username, u.role, e.name AS enterprise_name
     FROM operation_log l
     LEFT JOIN \`user\` u ON l.user_id = u.id
     LEFT JOIN enterprise e ON l.enterprise_id = e.id ` + whereSql +
    ' ORDER BY l.id DESC LIMIT ? OFFSET ?', [...params, pageSize, offset])

  return {
    total: Number(cntRow?.c || 0),
    page, pageSize,
    rows,
  }
})
