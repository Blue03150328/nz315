// 后台门店管理：编辑（含启用/停用）
import { requireWritableUser } from '../../../utils/auth'
import { query, execute } from '../../../utils/db'
import { logOperation } from '../../../utils/audit'

const FIELDS: Record<string, string> = {
  name: 'name', contact: 'contact', phone: 'phone', province: 'province', city: 'city',
  district: 'district', address: 'address', licenseNo: 'license_no',
  businessHours: 'business_hours',
}

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: '门店 ID 不合法' })
  const rows = await query<any[]>('SELECT id, name FROM agro_store WHERE id = ? LIMIT 1', [id])
  if (!rows[0]) throw createError({ statusCode: 404, statusMessage: '门店不存在' })

  const b = await readBody(event)
  const sets: string[] = []
  const params: any[] = []
  for (const [key, col] of Object.entries(FIELDS)) {
    if (b?.[key] !== undefined) { sets.push(col + ' = ?'); params.push(b[key] === '' ? null : b[key]) }
  }
  if (b?.lng !== undefined) {
    const lng = b.lng === '' || b.lng === null ? null : Number(b.lng)
    if (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) throw createError({ statusCode: 400, statusMessage: '经度不合法（应在 -180 ~ 180）' })
    sets.push('lng = ?'); params.push(lng)
  }
  if (b?.lat !== undefined) {
    const lat = b.lat === '' || b.lat === null ? null : Number(b.lat)
    if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) throw createError({ statusCode: 400, statusMessage: '纬度不合法（应在 -90 ~ 90）' })
    sets.push('lat = ?'); params.push(lat)
  }
  // 授权状态变更时同步「授权归属企业」，与 POST 行为保持一致：
  // 授权时记为当前操作人所属企业（总部管理员无所属企业则为 NULL），取消授权时清空
  if (b?.isAuthorized !== undefined) {
    const authorized = Number(b.isAuthorized) ? 1 : 0
    sets.push('is_authorized = ?'); params.push(authorized)
    sets.push('enterprise_id = ?'); params.push(authorized ? (user.enterprise_id ?? null) : null)
  }
  if (b?.status !== undefined) { sets.push('status = ?'); params.push(Number(b.status) ? 1 : 0) }
  if (!sets.length) throw createError({ statusCode: 400, statusMessage: '没有需要修改的字段' })

  params.push(id)
  await execute('UPDATE agro_store SET ' + sets.join(', ') + ' WHERE id = ?', params)
  await logOperation(event, { module: '门店管理', action: '修改', content: '修改农资店：' + rows[0].name })
  return { ok: true }
})