// 附近农资店（公众端）：授权定位后按坐标实时检索高德 POI（周边搜索）
// 数据来源：高德 Web服务 place/around —— 返回的坐标即 GCJ-02（与页面/地图一致），
// 自带 distance（米）且按距离升序，无需再自行换算
//
// 已知数据特性（2026-09-02 实测济南）：
//   - keywords=农药：结果干净，全部为农药/农资/种子类门店
//   - keywords=农资：混入大量「农贸市场/市集」（如 汉峪社区农贸市场），需按名称过滤
//   - 返回字段含 name/location/address/tel/type/pname/cityname/adname，无许可证与授权属性
//     （这两个字段在页面按数据是否存在条件渲染，缺失时自然隐藏）
//
// 配额保护：
//   - 每次请求两个关键词各查 1 页（offset=25，已按距离升序），合并去重后截取最近 20 家
//   - 服务端按 1km 网格内存缓存 10 分钟（同区多次访问不重复计费，避免触发 QPS 上限）

// ---------- 简易内存缓存（网格取整 0.01° ≈ 1km，TTL 10 分钟） ----------
const cache = new Map<string, { at: number; data: any[] }>()
const CACHE_TTL = 10 * 60 * 1000
const cacheKey = (lng: number, lat: number) =>
  Math.round(lng * 100) + ',' + Math.round(lat * 100)

// 名称噪音过滤：农资搜索会带出「农贸市场/市集」，剔除不含农资相关词的市场类条目
const NOISE = /市场|市集|农贸/
const GOOD = /农资|农药|化肥|种子|植保|农化|农业/
const isUseful = (name: string) => !NOISE.test(name) || GOOD.test(name)

const fetchPoi = async (key: string, lng: number, lat: number, keyword: string) => {
  const res = await $fetch<any>('https://restapi.amap.com/v3/place/around', {
    query: {
      location: lng + ',' + lat,
      keywords: keyword,
      radius: 30000,
      offset: 25,
      page: 1,
      extensions: 'base',
      key,
    },
    timeout: 10000,
  })
  if (res?.status !== '1') {
    throw createError({ statusCode: 502, statusMessage: '门店检索失败：' + (res?.info || '高德服务异常') })
  }
  return Array.isArray(res.pois) ? res.pois : []
}

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const lng = Number(q.lng)
  const lat = Number(q.lat)
  // POI 搜索必须以位置为中心：未授权定位时不下发任何数据，前端引导用户开启定位
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return { located: false, rows: [] }
  }

  const key = String(useRuntimeConfig().amapWebKey || '')
  if (!key) {
    throw createError({ statusCode: 503, statusMessage: '附近门店服务未配置（缺少高德 Web服务 key）' })
  }

  const ck = cacheKey(lng, lat)
  const hit = cache.get(ck)
  if (hit && Date.now() - hit.at < CACHE_TTL) {
    return { located: true, rows: hit.data }
  }

  // 双关键词检索：农药（干净源）+ 农资（过滤市场类噪音）
  const [a, b] = await Promise.allSettled([
    fetchPoi(key, lng, lat, '农药'),
    fetchPoi(key, lng, lat, '农资'),
  ])
  const pois = [...(a.status === 'fulfilled' ? a.value : []), ...(b.status === 'fulfilled' ? b.value : [])]
  if (pois.length === 0) {
    // 两路都失败才整体报错；单路失败另一路可用时不阻断
    throw createError({ statusCode: 502, statusMessage: '附近门店查询暂不可用，请稍后重试' })
  }

  // 过滤噪音 → 按 location 去重 → 按距离升序 → 截取最近 20 家
  const seen = new Set<string>()
  const rows: any[] = []
  for (const p of pois) {
    if (!p?.location || !isUseful(String(p.name || ''))) continue
    const loc = String(p.location).split(',')
    const plng = Number(loc[0]), plat = Number(loc[1])
    if (!Number.isFinite(plng) || !Number.isFinite(plat)) continue
    const dedupe = Math.round(plng * 1000) + ',' + Math.round(plat * 1000)
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    rows.push({
      id: dedupe,
      name: String(p.name || '').trim(),
      // POI 地址可能只有区级，此时仅拼省市，避免出现「山东省济南市历城区 」空尾
      address: ([p.pname, p.cityname, p.adname, String(p.address || '').trim()].filter(Boolean).join('')) || '',
      lng: plng,
      lat: plat,
      phone: String(p.tel || '').split(';')[0].trim() || null,
      isAuthorized: false,
      licenseNo: null,
      businessHours: null,
      distance: Number.isFinite(Number(p.distance)) ? Math.round(Number(p.distance)) : null,
      source: 'poi',
    })
  }
  rows.sort((x, y) => (x.distance ?? Infinity) - (y.distance ?? Infinity))
  const data = rows.slice(0, 20)

  cache.set(ck, { at: Date.now(), data })
  return { located: true, rows: data }
})
