// GET /api/admin/messages —— 消息列表（PRD 5.11）
import { query } from '../../utils/db'
import { requireBackendUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const q = getQuery(event)
  const conds: string[] = []
  const params: any[] = []

  if (user.role !== 'platform_admin') {
    conds.push('(m.enterprise_id = ? OR m.enterprise_id IS NULL)'); params.push(user.enterprise_id)
  }
  if (q.type) { conds.push('m.type = ?'); params.push(String(q.type)) }
  if (q.unread === '1') { conds.push('m.is_read = 0') }

  const whereSql = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const page = Math.max(1, parseInt(String(q.page || '1')))
  const pageSize = Math.min(100, Math.max(1, parseInt(String(q.pageSize || '20'))))
  const offset = (page - 1) * pageSize

  const [cntRow] = await query<any[]>(
    'SELECT COUNT(*) AS c FROM message m ' + whereSql, params)
  const [unreadRow] = await query<any[]>(
    user.role === 'platform_admin'
      ? 'SELECT COUNT(*) AS c FROM message m WHERE m.is_read = 0'
      : 'SELECT COUNT(*) AS c FROM message m WHERE m.is_read = 0 AND (m.enterprise_id = ? OR m.enterprise_id IS NULL)',
    user.role === 'platform_admin' ? [] : [user.enterprise_id])
  const rows = await query<any[]>(
    'SELECT m.* FROM message m ' + whereSql + ' ORDER BY m.id DESC LIMIT ? OFFSET ?', [...params, pageSize, offset])

  const TYPE_LABEL: Record<string, string> = {
    code_stock: '库存预警', upload_done: '上传完成', risk: '风险预警', account: '账号安全', other: '系统通知',
  }
  return {
    total: Number(cntRow?.c || 0),
    unread: Number(unreadRow?.c || 0),
    page, pageSize,
    rows: rows.map(r => ({ ...r, typeLabel: TYPE_LABEL[r.type] || '系统通知' })),
  }
})