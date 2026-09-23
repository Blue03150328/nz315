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
//
// 加固（2026-09-23，缺陷清单 N6 ①②③；三项均无 DDL / 无依赖 / 无 env 变更）：
//   ① 缓存加 `CACHE_MAX` 上限 + 淘汰 —— 原实现 `cache` 无上限，匿名随机坐标连刷会让 Map 无界增长
//      （线上 PM2 `max_memory_restart` 仅 800M ⇒ 会周期性重启）
//   ② 坐标范围校验（lng ±180 / lat ±90），非法即短路 ⇒ **0 次外部调用**
//      （原实现只判 `Number.isFinite`，`lng=999&lat=999` 同样能推动 2 次高德调用）
//   ③ 同 IP 轻量限流（30 次/分钟）—— 本接口是**公众功能，不能加登录门槛**（加了等于砍功能），
//      防的是「滥用」不是「未授权访问」，故只能用限流 + 缓存 + 范围校验
//
// ⚠️ 已知未做（用户 2026-09-23 决定暂缓，因该模块可能整体下架、改为农资记账功能）：
//   - 搜索框生效：服务端**从未读取** `keyword`（第 66-69 行写死「农药」「农资」）⇒ 页面输入无任何效果
//   - 与 `ip-geo.ts` 拆分高德 key：现共用 `amapWebKey` ⇒ POI 配额被打爆时 `ip-geo` 会静默返 null，
//     进而让 `scan_log.province` 写不进去、「重复查询」退化（P1-1 的死穴）
import { clientIpOf } from '../../utils/audit'
import { allowRequest } from '../../utils/rate-limit'

// ---------- 简易内存缓存（网格取整 0.01° ≈ 1km，TTL 10 分钟；条数封顶防无界增长） ----------
const cache = new Map<string, { at: number; data: any[] }>()
const CACHE_TTL = 10 * 60 * 1000
/** 缓存条数上限（超限丢弃最早插入的一半，参照 `ip-geo.ts` 的既有写法，保持项目风格一致） */
const CACHE_MAX = 5000
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
  // ③ 同 IP 限流：阈值刻意给得宽松（30 次/分钟）—— 同一出口 IP 背后可能是公司/校园 NAT 或
  // 运营商 CGNAT 下的大量正常用户，**宁可放过也不要让正常用户看到 429**。
  // 正常用户靠 1km 网格缓存，远达不到这个量级。
  const ip = clientIpOf(event) || 'unknown'
  if (!allowRequest('nearby:' + ip, 30, 60 * 1000)) {
    throw createError({ statusCode: 429, statusMessage: '访问过于频繁，请稍后再试' })
  }

  const q = getQuery(event)
  const lng = Number(q.lng)
  const lat = Number(q.lat)
  // ② 坐标校验：**必须先卡范围再打外部调用**（原实现只判 isFinite ⇒ 非法坐标也照样烧配额）。
  // 非法坐标沿用「未定位」契约（`located:false`）而不是 400：前端是 `stores = data.rows || []`，
  // `located:false` 走「未定位」引导分支；改成 400 会让页面进 error 态、显示报错，属不必要的体验退化。
  // POI 搜索必须以位置为中心：未授权定位时不下发任何数据，前端引导用户开启定位
  const inRange = lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || !inRange) {
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
      phone: (String(p.tel || '').split(';')[0] || '').trim() || null,
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
  // ① 缓存封顶：满则丢弃最早插入的一半（Map 保持插入序），避免内存无界增长
  if (cache.size >= CACHE_MAX) {
    let removed = 0
    for (const k of cache.keys()) {
      cache.delete(k)
      if (++removed >= Math.floor(CACHE_MAX / 2)) break
    }
  }
  return { located: true, rows: data }
})
