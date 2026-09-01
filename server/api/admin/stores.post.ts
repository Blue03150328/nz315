// 后台门店管理：新增
import { requireWritableUser } from '../../utils/auth'
import { execute } from '../../utils/db'
import { logOperation } from '../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const b = await readBody(event)
  const name = String(b?.name || '').trim()
  if (!name) throw createError({ statusCode: 400, statusMessage: '门店名称必填' })

  // 经纬度可留空（后续补录），填了就必须在合法范围内，避免脏坐标污染附近查询
  const lng = b?.lng === '' || b?.lng === null || b?.lng === undefined ? null : Number(b.lng)
  const lat = b?.lat === '' || b?.lat === null || b?.lat === undefined ? null : Number(b.lat)
  if (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) throw createError({ statusCode: 400, statusMessage: '经度不合法（应在 -180 ~ 180）' })
  if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) throw createError({ statusCode: 400, statusMessage: '纬度不合法（应在 -90 ~ 90）' })

  const res = await execute(
    `INSERT INTO agro_store (name, contact, phone, province, city, district, address, lng, lat, license_no, is_authorized, enterprise_id, business_hours, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [name, b?.contact || null, b?.phone || null, b?.province || null, b?.city || null, b?.district || null,
     b?.address || null, lng, lat, b?.licenseNo || null, Number(b?.isAuthorized || 0),
     b?.isAuthorized ? (user.enterprise_id ?? null) : null, b?.businessHours || null, Number(b?.status ?? 1)])

  await logOperation(event, { module: '门店管理', action: '新增', content: '新增农资店：' + name })
  return { id: Number(res.insertId) }
})