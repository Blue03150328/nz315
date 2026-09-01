// 后台门店管理：按地址自动获取坐标（高德 Web服务 地理编码）
// 高德返回的即为 GCJ-02 坐标，与门店库约定一致，无需再转换
// 未配置 Web服务 key 时明确报错，不返回任何猜测坐标
import { requireBackendUser } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireBackendUser(event)
  const key = String(useRuntimeConfig().amapWebKey || '')
  if (!key) {
    throw createError({ statusCode: 503, statusMessage: '未配置高德 Web服务 key，无法自动解析坐标，请手工填写经纬度' })
  }
  const q = getQuery(event)
  const address = String(q.address || '').trim()
  // 用户填写的省/市，用于校验高德返回结果是否落在同一行政区（高德为模糊匹配，见下方说明）
  const province = String(q.province || '').trim()
  const city = String(q.city || '').trim()
  if (!address) {
    throw createError({ statusCode: 400, statusMessage: '请先填写省市区与详细地址' })
  }

  let res: any
  try {
    res = await $fetch<any>('https://restapi.amap.com/v3/geocode/geo', {
      query: { address, key, output: 'JSON' },
      timeout: 10000,
    })
  } catch {
    throw createError({ statusCode: 502, statusMessage: '高德服务暂不可用，请稍后重试或手工填写坐标' })
  }

  // 高德约定：status='1' 为成功；失败时 info 含原因（如 INVALID_USER_KEY / DAILY_QUERY_OVER_LIMIT）
  if (res?.status !== '1') {
    throw createError({ statusCode: 502, statusMessage: '地址解析失败：' + (res?.info || '未知错误') })
  }
  const first = Array.isArray(res.geocodes) ? res.geocodes[0] : null
  if (!first?.location) {
    throw createError({ statusCode: 404, statusMessage: '未能解析该地址，请补充更完整的地址信息' })
  }

  const [lngStr, latStr] = String(first.location).split(',')
  const lng = Number(lngStr)
  const lat = Number(latStr)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw createError({ statusCode: 502, statusMessage: '高德返回的坐标格式异常' })
  }

  const level = String(first.level || '')
  // 高德返回的行政区字段：直辖市的 city 可能是空数组，需归一为字符串
  const pick = (v: any) => (typeof v === 'string' ? v : '')
  const norm = (s: string) => s.replace(/(省|市|自治区|特别行政区|自治州|地区)$/g, '')

  // 【关键校验】高德地理编码是**模糊匹配**：传入无效地址也会返回其它省市的兴趣点
  // （实测「zzzz不存在的地址xxxx」→ 湖南省怀化市某针织店，level 仍为「兴趣点」）。
  // 若不校验，会把完全错误的坐标静默写入门店库。故要求返回结果与用户填写的省/市一致。
  const gotProvince = pick(first.province)
  const gotCity = pick(first.city)
  if (province && gotProvince && norm(gotProvince) !== norm(province)) {
    throw createError({
      statusCode: 404,
      statusMessage: '地址解析结果落在「' + gotProvince + gotCity + '」，与所填省份不一致，请检查地址是否填写有误',
    })
  }
  if (city && gotCity && norm(gotCity) !== norm(city)) {
    throw createError({
      statusCode: 404,
      statusMessage: '地址解析结果落在「' + gotProvince + gotCity + '」，与所填城市不一致，请检查地址是否填写有误',
    })
  }
  // 省/市级结果对门店而言精度不足（会落到行政中心点），拒绝写入
  if (['省', '市'].includes(level)) {
    throw createError({ statusCode: 404, statusMessage: '仅解析到「' + level + '」级别，精度不足，请补充区县与详细地址' })
  }

  return {
    lng: Number(lng.toFixed(6)),
    lat: Number(lat.toFixed(6)),
    formattedAddress: first.formatted_address || address,
    level,
    // 达到门牌号/单元号级别才视为精确，其余（区县/道路/兴趣点）提示人工复核
    exact: ['门牌号', '单元号'].includes(level),
  }
})
