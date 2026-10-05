import { requireBackendUser } from '../../utils/auth'
import { query } from '../../utils/db'
import type { AdminOnboarding } from '#shared/types/admin-onboarding'

// 建档状态依据企业实际可用资料；总部必须明确选择企业。
export default defineEventHandler(async (event): Promise<AdminOnboarding> => {
  const user = await requireBackendUser(event)
  const requested = Number(getQuery(event).enterpriseId)
  const enterpriseId = user.role === 'platform_admin' ? requested : Number(user.enterprise_id)
  if (!Number.isSafeInteger(enterpriseId) || enterpriseId <= 0) {
    if (user.role !== 'platform_admin') throw createError({ statusCode: 403, statusMessage: '账号未关联企业' })
    return { enterpriseId: null, enterpriseName: '', specsReady: false, productsReady: false, codesReady: false, bindingReady: false }
  }
  const [enterprise] = await query<any[]>('SELECT name FROM enterprise WHERE id = ?', [enterpriseId])
  if (!enterprise) throw createError({ statusCode: 404, statusMessage: '企业不存在' })
  const [row] = await query<any[]>(`SELECT
    EXISTS(SELECT 1 FROM product_spec WHERE enterprise_id = ? AND status = 1) AS specsReady,
    EXISTS(SELECT 1 FROM product p JOIN product_spec s ON s.id = p.spec_id
      WHERE p.enterprise_id = ? AND p.status = 1 AND s.status = 1
      AND (p.registration_expire IS NULL OR p.registration_expire >= CURDATE())) AS productsReady,
    EXISTS(SELECT 1 FROM trace_code WHERE enterprise_id = ? AND abnormal_flag = 0) AS codesReady,
    EXISTS(SELECT 1 FROM trace_code WHERE enterprise_id = ? AND abnormal_flag = 0 AND status = 2) AS bindingReady`,
    [enterpriseId, enterpriseId, enterpriseId, enterpriseId])
  return { enterpriseId, enterpriseName: enterprise.name, specsReady: !!row.specsReady, productsReady: !!row.productsReady, codesReady: !!row.codesReady, bindingReady: !!row.bindingReady }
})
