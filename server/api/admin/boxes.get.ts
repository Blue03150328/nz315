// GET /api/admin/boxes —— 外箱码列表（PRD 5.5.6：查询/解绑）
import { query } from '../../utils/db'
import { requireBackendUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const q = getQuery(event)
  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  const [fidSql, fidParams] = fid ? [' AND enterprise_id = ?', [fid]] : ['', []]

  const conds = ['t.outer_box_code IS NOT NULL AND t.outer_box_code <> \'\'']
  const params: any[] = []
  if (q.keyword) {
    conds.push('t.outer_box_code LIKE ?')
    params.push('%' + String(q.keyword).trim() + '%')
  }
  if (q.outer) { conds.push('t.outer_box_code = ?'); params.push(String(q.outer)) }

  const whereSql = 'WHERE ' + conds.join(' AND ') + fidSql
  const page = Math.max(1, parseInt(String(q.page || '1')))
  const pageSize = Math.min(100, Math.max(1, parseInt(String(q.pageSize || '20'))))
  const offset = (page - 1) * pageSize

  const [cntRow] = await query<any[]>(
    'SELECT COUNT(DISTINCT t.outer_box_code) AS c FROM trace_code t ' + whereSql, [...params, ...fidParams])
  const rows = await query<any[]>(
    `SELECT t.outer_box_code, COUNT(*) AS inner_count,
       MIN(t.produce_date) AS min_produce_date, MAX(t.abnormal_flag) AS max_flag,
       MAX(t.created_at) AS updated_at
     FROM trace_code t ` + whereSql +
    ' GROUP BY t.outer_box_code ORDER BY updated_at DESC LIMIT ? OFFSET ?', [...params, ...fidParams, pageSize, offset])

  return {
    total: Number(cntRow?.c || 0),
    page, pageSize,
    rows: rows.map(r => ({
      ...r,
      // 展示状态随箱内单品码最低状态联动（PRD 5.5.6：任一作废则整箱标红）
      flagLabel: Number(r.max_flag) === 2 ? '含作废码' : Number(r.max_flag) === 1 ? '含冻结码' : '正常',
    })),
  }
})
