// 后台门店管理：列表（PRD 925号公告定点经营方向，自建授权门店库）
import { requireBackendUser } from '../../utils/auth'
import { query } from '../../utils/db'

export default defineEventHandler(async (event) => {
  await requireBackendUser(event)
  const q = getQuery(event)
  const page = Math.max(1, Number(q.page || 1))
  const pageSize = Math.min(100, Math.max(1, Number(q.pageSize || 20)))
  const offset = (page - 1) * pageSize

  const where: string[] = ['1=1']
  const params: any[] = []
  if (q.keyword) { where.push('(name LIKE ? OR address LIKE ? OR phone LIKE ?)'); const k = '%' + q.keyword + '%'; params.push(k, k, k) }
  if (q.isAuthorized !== undefined && q.isAuthorized !== '') { where.push('is_authorized = ?'); params.push(Number(q.isAuthorized)) }
  if (q.status !== undefined && q.status !== '') { where.push('status = ?'); params.push(Number(q.status)) }
  const w = where.join(' AND ')

  const rows = await query<any[]>(
    `SELECT id, name, contact, phone, province, city, district, address, lng, lat,
            license_no, is_authorized, enterprise_id, business_hours, status, created_at
     FROM agro_store WHERE ${w} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset])
  const [cnt] = await query<any[]>('SELECT COUNT(*) AS total FROM agro_store WHERE ' + w, params)

  return { total: Number(cnt?.total || 0), page, pageSize, rows }
})