// GET /api/admin/alerts —— 风险预警列表（PRD 5.9 风险预警中心）
import { query } from '../../utils/db'
import { requireBackendUser } from '../../utils/auth'
import { ALERT_TYPES } from '../../utils/risk-alert'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const q = getQuery(event)
  const conds: string[] = []
  const params: any[] = []

  if (user.role !== 'platform_admin') {
    conds.push('a.enterprise_id = ?'); params.push(user.enterprise_id)
  }
  if (q.alertType) { conds.push('a.alert_type = ?'); params.push(Number(q.alertType)) }
  if (q.status !== undefined && q.status !== '') { conds.push('a.handle_status = ?'); params.push(Number(q.status)) }
  if (q.keyword) {
    const kw = '%' + String(q.keyword).trim() + '%'
    conds.push('(t.code LIKE ? OR p.name LIKE ?)'); params.push(kw, kw)
  }
  if (q.dateFrom) { conds.push('a.trigger_time >= ?'); params.push(String(q.dateFrom) + ' 00:00:00') }
  if (q.dateTo) { conds.push('a.trigger_time <= ?'); params.push(String(q.dateTo) + ' 23:59:59') }

  const whereSql = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const page = Math.max(1, parseInt(String(q.page || '1')))
  const pageSize = Math.min(100, Math.max(1, parseInt(String(q.pageSize || '20'))))
  const offset = (page - 1) * pageSize

  const [cntRow] = await query<any[]>(
    'SELECT COUNT(*) AS c FROM risk_alert a LEFT JOIN trace_code t ON a.code_id = t.id LEFT JOIN product p ON a.product_id = p.id ' + whereSql,
    params)
  const rows = await query<any[]>(
    `SELECT a.*, t.code AS code, p.name AS product_name, u.name AS handler_name
     FROM risk_alert a
     LEFT JOIN trace_code t ON a.code_id = t.id
     LEFT JOIN product p ON a.product_id = p.id
     LEFT JOIN \`user\` u ON a.handler_id = u.id ` + whereSql +
    ' ORDER BY a.trigger_time DESC LIMIT ? OFFSET ?', [...params, pageSize, offset])

  // 待处理统计
  const [pendingRow] = await query<any[]>(
    'SELECT COUNT(*) AS c FROM risk_alert a WHERE a.handle_status = 0' + (user.role === 'platform_admin' ? '' : ' AND a.enterprise_id = ?'),
    user.role === 'platform_admin' ? [] : [user.enterprise_id])

  return {
    total: Number(cntRow?.c || 0),
    pending: Number(pendingRow?.c || 0),
    page, pageSize,
    rows: rows.map(r => ({
      ...r,
      alertTypeLabel: ALERT_TYPES[Number(r.alert_type)] || '未知(' + r.alert_type + ')',
      handleStatusLabel: Number(r.handle_status) === 1 ? '已核实合规' : Number(r.handle_status) === 2 ? '已确认违规' : '待处理',
      evidence: r.evidence ? (typeof r.evidence === 'string' ? JSON.parse(r.evidence) : r.evidence) : null,
    })),
  }
})
