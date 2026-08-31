// GET /api/admin/settings/enterprise —— 企业信息（PRD 5.12.1）
// platform_admin 可传 ?id= 查看任意企业；厂家账号查看本企业
import { query } from '../../../utils/db'
import { requireBackendUser } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const q = getQuery(event)
  let id: number | null = null
  if (user.role === 'platform_admin') {
    id = q.id ? Number(q.id) : (user.enterprise_id || 1)
  } else {
    id = user.enterprise_id
  }
  const [row] = await query<any[]>(
    'SELECT id, name, credit_code, unit_code, contact, phone, legal_person, website, address, logo, description, license_no, qualification_expire, status, created_at FROM enterprise WHERE id = ?',
    [id])
  if (!row) throw createError({ statusCode: 404, statusMessage: '企业信息不存在' })
  return row
})
