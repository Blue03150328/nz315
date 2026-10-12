// 读取完整占用码池，不能依赖分页列表或状态筛选来判断号码是否可选。
import { query } from '../../../utils/db'
import { requireBackendUser } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const fid = Number(user.role === 'platform_admin' ? getQuery(event).enterpriseId : user.enterprise_id)
  if (!Number.isInteger(fid) || fid <= 0) throw createError({ statusCode: 400, statusMessage: '请选择有效的归属企业' })
  const [enterprise] = await query<any[]>('SELECT id FROM enterprise WHERE id = ?', [fid])
  if (!enterprise) throw createError({ statusCode: 404, statusMessage: '归属企业不存在' })
  const rows = await query<any[]>('SELECT spec_code FROM product_spec WHERE enterprise_id = ? ORDER BY spec_code', [fid])
  return { enterpriseId: fid, usedCodes: rows.map(row => String(row.spec_code)) }
})
