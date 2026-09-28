// 广州慧翼「农药防伪溯源系统」来源页适配器（zp.hyny168.cn / www.hyny168.cn）。
//
// 为什么需要（2026-09-28 实测，反了原判）：
//   查询页 `/ny?c=<32位码>` 是**纯前端空壳**：HTTP 200 只有约 12 KB 的 Vue 壳
//   （`<div id=app>` + 「正在加载系统资源，请耐心等待」），产品 / 生产 / 原药三类信息
//   全部由运行时 XHR 回填。通用解析剥掉 `<script>` 后只剩那句加载文案
//   ⇒ 必然命中「页面由脚本加载」。
//   ⚠️ 浏览器里能看见完整表格，是因为**浏览器替它调了接口**，不是服务端渲染 ——
//      这一点曾把排查带偏到「补字段别名」，别名再多也救不了：爬下来的 HTML 里根本没有那些标签。
//
// 做法（照抄原页脚本，不自行发明）：
//   该站 axios 实例 baseURL = `/prod-api`，`/ny` 页调 `getTrace2()`：`GET /trace/{码}?reauth=`
//   ⇒ 复用为 `GET {页 origin}/prod-api/trace/{码}`（实测无需登录、无鉴权头、无 Referer 校验）。
//   字段名全部抄自该站页面 chunk 里的 `fieldMap`（label ↔ 字段一一对应），不靠猜：
//     产品：productName 产品名称 / spec 产品规格 / specCode 规格码 / categoryName 农药类别 /
//           dosageForm 产品剂型 / totlaPackingUnit 总含量（对方字段名拼写如此，勿改）/
//           toxicity 毒性 / packingUnit 净含量 / activeIngredientContent 成分含量 /
//           scanNum 查询次数 / codeUrl 追溯网址
//     生产：code 单元识别码 / qualityCheck 质检结果 / batch 批次 / productionDate 生产日期 /
//           validityPeriodDate 有效期 / permitNumber 登记证号 / clientName 持有人 /
//           licenseNumber 许可证号 / produceType 生产类型
//     原药：rawName 原药名称 / permitNumber 登记证号 / rawCompanyName 生产企业
//
// 🔴 代价（与 nyzs315 同族，必须知情）：
//   每成功调用一次，都会在**对方系统里留下一次扫码记录**（实测响应里带回 `scanNum`/`firstScanTime`，
//   对方同时写出了 `scanLogId`）；对**不存在的码**同样会写。故只在宿主白名单命中时才启用，
//   且与快照本身共用 10 分钟缓存（同码同址 10 分钟内不重复调用）。
//   ⚠️ 若要停止污染对方统计：删掉 source-adapters/index.ts 里那一行登记即可整体下线。
//
// 降级（适配器永远不是唯一失败点）：
//   任何异常 / `exists≠true` / `status≠'1'` / 核心字段全空 ⇒ 返回 null
//   ⇒ 调用方自动退回「抓页面 + 通用解析」，再失败仍有「查看原查询页」入口。
//   ⚠️ 已知取舍：对方**查无此码**时返回 `exists:false`，我们同样返回 null，
//      于是消费者看到的是兜底文案「这个来源页面要靠浏览器才能显示内容」——
//      文案不精准，但绝不显示假数据；真码路径不受影响。
import { fetchSourceDocument } from '../source-fetch'
import type { SourceDeclaration } from '#shared/types/source-snapshot'

/** 该站 axios 实例 baseURL + /ny 页 getTrace2() 的路径（照抄页面 chunk） */
const API_PATH = '/prod-api/trace/'

/** 去噪取值：空、纯横线占位一律当「没有」 */
function text(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value).trim()
  return !s || /^[-—]+$/.test(s) ? '' : s
}

/** 该站日期形如 `2026-07-03 00:00:00`，只取日期段并校验日历；不合法一律丢弃，绝不臆造。 */
function dateOnly(value: unknown): string | undefined {
  const m = text(value).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!m) return undefined
  const v = `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`
  const d = new Date(v + 'T00:00:00Z')
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : undefined
}

/**
 * 把该站 `/prod-api/trace/{码}` 的 `data` 映射成本平台来源声明（纯函数，便于回归）。
 * 判定门槛照抄对方页面自己：`exists === true && status == '1'` 才展示「正品标识」分支。
 */
export function mapHyny168(data: any, sourceUrl: string, code: string): SourceDeclaration | null {
  if (!data || data.exists !== true) return null
  if (String(data.status ?? '') !== '1') return null
  const productName = text(data.productName)
  const holderName = text(data.clientName)
  const registrationNo = text(data.permitNumber)
  // 三个核心字段全空 ⇒ 视为适配失败：宁可不展示，也不把空壳数据当「来源页已核对」。
  if (!productName && !holderName && !registrationNo) return null
  // 厂商信息：照抄原页取法 —— 有 rawCompany 用它的 name，否则退回 traceCompany。
  const manufacturer = text(data.rawCompany?.name) || text(data.traceCompany)
  // 对方自有「是否展示批次 / 生产日期」开关，页面上关掉即显示「详见包装」⇒ 我们同步不声明，
  // 避免把厂家刻意不公开的批次当成已核对内容。
  const showBatch = data.showBatchNo !== false
  const showDate = data.showProduceTime !== false
  const fields: { label: string; value: string }[] = []
  const push = (label: string, value: string) => { if (value) fields.push({ label, value }) }
  push('产品名称', productName)
  push('商品名称', text(data.goodsName))
  push('农药登记证号', registrationNo)
  push('登记证持有人', holderName)
  push('生产企业', manufacturer)
  push('剂型', text(data.dosageForm))
  push('毒性', text(data.toxicity))
  push('总有效成分含量', text(data.totlaPackingUnit))
  push('有效成分及含量', text(data.activeIngredientContent))
  push('净含量', text(data.packingUnit))
  push('规格', text(data.spec))
  push('规格码', text(data.specCode))
  push('农药类别', text(data.categoryName))
  push('生产许可证', text(data.licenseNumber))
  push('质检结果', text(data.qualityCheck))
  push('生产类型', text(data.produceType))
  push('企业地址', text(data.traceCompanyAddress))
  return {
    sourceUrl,
    platform: new URL(sourceUrl).hostname,
    // code 保持「本次查询用的码」；接口自报的码放 pageCode ⇒ 调用方既有的「码是否一致」校验照常生效。
    code,
    pageCode: /^\d{32}$/.test(text(data.code)) ? text(data.code) : undefined,
    productName: productName || undefined,
    commodityName: text(data.goodsName) || undefined,
    registrationNo: registrationNo || undefined,
    holderName: holderName || undefined,
    manufacturer: manufacturer || undefined,
    formulation: text(data.dosageForm) || undefined,
    toxicity: text(data.toxicity) || undefined,
    content: text(data.totlaPackingUnit) || undefined,
    ingredients: text(data.activeIngredientContent) || undefined,
    spec: text(data.spec) || undefined,
    produceDate: showDate ? dateOnly(data.productionDate) : undefined,
    batchNo: showBatch ? text(data.batch) || undefined : undefined,
    shelfLife: text(data.validity) || undefined,
    productExpiry: dateOnly(data.validityPeriodDate),
    productFields: fields,
    originals: Array.isArray(data.rawMaterials)
      ? data.rawMaterials.slice(0, 50).map((m: any) => ({
          ingredient: text(m?.rawName) || undefined,
          regNo: text(m?.permitNumber),
          company: text(m?.rawCompanyName),
        }))
      : [],
  }
}

export async function hyny168Adapter(sourceUrl: string, code: string): Promise<{ source: SourceDeclaration; document: string } | { notFound: true } | null> {
  const url = new URL(sourceUrl)
  // 该页把码写在 `?c=`；取不到就退回调用方给的码。要求标准 32 位，不猜、不截。
  const unit = text(url.searchParams.get('c')) || text(code)
  if (!/^\d{32}$/.test(unit)) return null
  const api = `${url.protocol}//${url.host}${API_PATH}${unit}`
  const fetched = await fetchSourceDocument(api, { 'Content-Type': 'application/json' })
  let payload: any
  try { payload = JSON.parse(fetched.body) } catch { return null }
  // 对方明说「没有这个码」（`exists:false`，实测各业务字段全 null、HTTP 仍 200）⇒ 交给调用方出正确文案，
  // 不要退到通用抓取 —— 那会撞上空壳页，把对方的答复说成「页面要靠浏览器才能显示内容」。
  if (payload?.data && payload.data.exists === false) return { notFound: true }
  const source = mapHyny168(payload?.data, sourceUrl, unit)
  if (!source) return null
  // raw_document 存接口原文（约 2.2 KB），比抓 12 KB 空壳页更小，也便于日后核对。
  return { source, document: fetched.body }
}
