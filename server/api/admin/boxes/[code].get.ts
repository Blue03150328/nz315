// GET /api/admin/boxes/:code —— 箱内单品码列表（PRD 5.5.6）
import { query } from '../../../utils/db'
import { requireBackendUser } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const code = String(getRouterParam(event, 'code') || '')
  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  const rows = await query<any[]>(
    `SELECT t.id, t.code, t.status, t.abnormal_flag, t.abnormal_reason, t.produce_date, t.batch_no,
       p.name AS product_name
     FROM trace_code t LEFT JOIN product p ON t.product_id = p.id
     WHERE t.outer_box_code = ?` + (fid ? ' AND t.enterprise_id = ?' : '') + ' ORDER BY t.id',
    fid ? [code, fid] : [code])
  if (rows.length === 0) throw createError({ statusCode: 404, statusMessage: '外箱码不存在' })
  return {
    outerBoxCode: code,
    count: rows.length,
    rows: rows.map(r => ({
      ...r,
      statusLabel: Number(r.status) === 2 ? '已绑定' : '已生成',
      flagLabel: Number(r.abnormal_flag) === 2 ? '已作废' : Number(r.abnormal_flag) === 1 ? '已冻结' : '正常',
    })),
  }
})
