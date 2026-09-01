// 附近农资店（公众端）：自建门店库按距离排序
// 距离由服务端 haversine 计算，不依赖高德接口；高德仅在前端用于地图展示
// 坐标系约定：库中 lng/lat 为 GCJ-02（与高德一致），前端传入前需将浏览器 WGS-84 定位转换为 GCJ-02
import { query } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const lng = Number(q.lng)
  const lat = Number(q.lat)
  // 搜索半径（米），默认 20 公里，上限 100 公里
  const radius = Math.min(100000, Math.max(500, Number(q.radius || 20000)))
  const limit = Math.min(50, Math.max(1, Number(q.limit || 20)))
  const keyword = String(q.keyword || '').trim()

  const hasPos = Number.isFinite(lng) && Number.isFinite(lat)
  const params: any[] = []
  let sql: string

  if (hasPos) {
    // 先用外接矩形借助 idx_geo 缩小范围，再精算球面距离（避免全表 acos 运算）
    const latDelta = radius / 111320
    const lngDelta = radius / (111320 * Math.max(0.01, Math.cos(lat * Math.PI / 180)))
    sql = `SELECT id, name, contact, phone, province, city, district, address, lng, lat,
                  license_no, is_authorized, business_hours,
                  (6371000 * ACOS(LEAST(1, COS(RADIANS(?)) * COS(RADIANS(lat)) * COS(RADIANS(lng) - RADIANS(?)) + SIN(RADIANS(?)) * SIN(RADIANS(lat))))) AS distance
           FROM agro_store
           WHERE status = 1 AND lat IS NOT NULL AND lng IS NOT NULL
             AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`
    params.push(lat, lng, lat, lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta)
    if (keyword) { sql += ' AND (name LIKE ? OR address LIKE ?)'; params.push('%' + keyword + '%', '%' + keyword + '%') }
    sql += ' HAVING distance <= ? ORDER BY distance ASC LIMIT ?'
    params.push(radius, limit)
  } else {
    // 未授权定位时退化为「授权门店优先 + 最新录入」，仍可浏览
    sql = `SELECT id, name, contact, phone, province, city, district, address, lng, lat,
                  license_no, is_authorized, business_hours, NULL AS distance
           FROM agro_store WHERE status = 1`
    if (keyword) { sql += ' AND (name LIKE ? OR address LIKE ?)'; params.push('%' + keyword + '%', '%' + keyword + '%') }
    sql += ' ORDER BY is_authorized DESC, id DESC LIMIT ?'
    params.push(limit)
  }

  const rows = await query<any[]>(sql, params)
  return {
    located: hasPos,
    radius,
    rows: rows.map(r => ({
      id: Number(r.id),
      name: r.name,
      contact: r.contact,
      phone: r.phone,
      address: [r.province, r.city, r.district, r.address].filter(Boolean).join(''),
      lng: r.lng === null ? null : Number(r.lng),
      lat: r.lat === null ? null : Number(r.lat),
      licenseNo: r.license_no,
      isAuthorized: Number(r.is_authorized) === 1,
      businessHours: r.business_hours,
      distance: r.distance === null || r.distance === undefined ? null : Math.round(Number(r.distance)),
    })),
  }
})