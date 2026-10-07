// 外部二维码核验：来源适配、前 8 位解析、登记资料和本平台档案比对
//
// 🔴 2026-09-24 合并解析器（本次改动）：本文件原自带一套 HTML 解析实现 —— stripHtmlToText /
//    normalizeLabel / FIELD_ALIASES / cleanFieldValue / extractLabeledFields / extractOriginals /
//    normalizeProduceDate，与 server/utils/source-parser.ts（公众端 /api/trace 的外页快照用）功能重复，
//    且两侧口径已经分叉：
//      · 原药三字段配对用的是**下标拼装**（Math.max 取长度 + 同下标拼装），而公众侧早已改成
//        **组边界配对**（缺字段不串组）—— 缺证号时会把企业与证号错配；
//      · 生产日期口径更宽松；
//      · 吃不到 SOURCE_PARSER_VERSION ⇒ 核验工单无法追溯当时用的是哪版解析规则。
//    ⇒ 通用 HTML 抓取与「手工粘贴页面内容」两条输入现统一走 parseSourceDocument；本文件只保留
//      「平台专用适配器（wla1 结构化接口）+ 6 项判定规则 + 触发预警」，不再自建解析。
//    来源域名及解析地址共用source-fetch的公网规则，实际连接仍固定已校验地址。
//
// 🔴 2026-09-24 收口（第二笔）：登记库候选取数不再在本文件内联 SQL，改调
//    `registry-lookup.ts` 的 `findRegistryRowsByUnitCode()`（与公众端 /api/trace 兜底共用同一
//    「后六位 + 类别过滤」实现）。理由与影响面见该函数文档与下方调用点注释（实测零截断）。
//    刻意**不用** `lookupRegistryByCode()`：那个带展示口径的 `slice(0,5)` 与进程内缓存，
//    本端需要完整候选集做「证号完全相等」匹配 —— 截断会造成误判不一致。
//
// 判定边界（保持合并前不变）：只核验单元识别码前 8 位（登记类别 + 登记证后六位 + 生产类型），
// 第 9 位以后保留原码但不参与判定；原药信息**不参与判定**，仅随来源声明展示与留档。
import { fetchSourceDocument, isPublicAddress } from './source-fetch'
import { lookup } from 'node:dns/promises'
import { query } from './db'
import { normalizeOrgName } from './regdata'
import { findRegistryRowsByUnitCode } from './registry-lookup'
import { parseSourceDocument } from './source-parser'
import { extractTraceCode, isHttpUrl, isTraceCode } from '#shared/utils/trace-code'
import { parseUnitCode } from '#shared/utils/unit-code'
import type { SourceDeclaration } from '#shared/types/source-snapshot'
import type { ExternalSourceData, ExternalVerificationResult, VerificationItem, VerificationItemStatus } from '#shared/types/external-verification'

const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local)$/i

function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/[\s　、，。,.：:；;（）()［］\[\]「」]/g, '').trim()
}

/**
 * 产品名归一（仅用于「是否同一登记产品」的判断）：
 * 外部平台常把有效成分含量写进产品名（如「2.85%硝钠·萘乙酸」），而登记资料库只写成分名（「硝钠·萘乙酸」），
 * 严格比对会误报「产品名不一致」。故这里先剥掉含量标注再比，含量本身的差异由核验说明提示人工复核。
 */
function normalizeProductName(value: unknown): string {
  return normalizeText(String(value ?? '').replace(/[\d．.]+[%％]/g, '')).toLowerCase()
}

function cleanDate(value: unknown): string | undefined {
  const text = String(value ?? '').trim()
  // “见喷码/见瓶盖”等是来源页面的有效业务文案，必须原样保留。
  return text && !/^未知|无$/i.test(text) ? text.slice(0, 32) : undefined
}

/** 生产日期标签口径（wla1 结构化字段用）：有具体日期就保留；写“见喷码/见瓶盖”等时显示“见喷码”。 */
function normalizeProduceDate(value: unknown): string | undefined {
  const text = String(value ?? '').trim()
  if (!text) return undefined
  if (/\d{4}[年./-]\d{1,2}[月./-]\d{1,2}日?/.test(text) || /^\d{4}-\d{2}-\d{2}$/.test(text)) return text.slice(0, 32)
  if (/喷码|瓶盖|瓶体|包装|标签/.test(text)) return '见喷码'
  return cleanDate(text)
}

/** 生产日期展示口径（通用解析路径用）：优先严格日期；无具体日期时沿用来源页“见喷码”类业务文案。
 *  与合并前的 normalizeProduceDate 展示效果一致，但日期本体来自 source-parser 的严格校验。 */
function produceDateLabel(decl: SourceDeclaration): string | undefined {
  if (decl.produceDate) return decl.produceDate
  const note = String(decl.productionNote || '').trim()
  return /喷码|瓶盖|瓶体|包装|标签/.test(note) ? '见喷码' : undefined
}

// 32 位码结构解析已抽到 server/utils/unit-code.ts（公众端 /api/trace 的登记库兜底比对共用同一套规则）
export const parseExternalCode = parseUnitCode

async function assertSafeUrl(input: string): Promise<URL> {
  let url: URL
  try { url = new URL(input) } catch { throw createError({ statusCode: 400, statusMessage: '二维码内容不是有效网址或追溯码' }) }
  if (!['http:', 'https:'].includes(url.protocol)) throw createError({ statusCode: 400, statusMessage: '只支持 HTTP 或 HTTPS 来源网址' })
  if (PRIVATE_HOST.test(url.hostname)) throw createError({ statusCode: 400, statusMessage: '来源网址不可访问本地或内网地址' })
  const records = await lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true }).catch(() => [])
  if (!records.length || records.some(r => !isPublicAddress(r.address))) throw createError({ statusCode: 400, statusMessage: '来源网址解析到受限网络地址或无法解析' })
  return url
}

/**
 * 统一来源声明（SourceDeclaration）→ 后台核验页字段集（ExternalSourceData）。
 * 🔴 字段名与语义**必须保持合并前不变**：`app/pages/admin/external-verify/index.vue` 逐项展示
 *    `spec` / `produceDate` / `batchNo` / `registrationNo` / `formulation` / `toxicity` / `expireDate`，
 *    丢任何一个该页就显示“来源页面未提供”。两个名字不同的同义字段在此处显式映射：
 *    `productExpiry`（公众侧）→ `expireDate`（后台侧）。
 */
function toExternalSource(decl: SourceDeclaration, extra: { productionType?: string; raw: Record<string, unknown> }): ExternalSourceData {
  return {
    sourceUrl: decl.sourceUrl,
    platform: decl.platform,
    code: decl.code,
    productName: decl.productName,
    registrationNo: decl.registrationNo,
    holderName: decl.holderName,
    productionType: extra.productionType,
    spec: decl.spec,
    formulation: decl.formulation,
    toxicity: decl.toxicity,
    produceDate: produceDateLabel(decl),
    batchNo: decl.batchNo,
    expireDate: decl.productExpiry,
    productFields: decl.productFields,
    originals: decl.originals,
    raw: extra.raw,
  }
}

/**
 * 从来源 JSON 文本提取原药三字段（**仅 wla1 专用接口使用**：其响应是结构化 JSON，不走 HTML 解析管线）。
 * 配对采用**组边界**语义（与 source-parser 一致）：按出现顺序归组，缺字段不跨组补位
 * —— 合并前这里是 `Math.max(names, companies, regNos)` + 同下标拼装，缺字段时会串组。
 */
function extractOriginalsFromJson(text: string): Array<{ ingredient?: string; regNo: string; company: string }> {
  const lines = String(text || '')
    .replace(/<\/?(td|th|dt|dd)>/gi, '\t')
    .replace(/<\/(tr|p|div|li)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .split(/[\r\n\t]+| {2,}/)
    .map(v => v.trim().replace(/^["'\s,{]+|["'\s,}]+$/g, ''))
    .filter(Boolean)
  const fieldOf = (line: string): 'ingredient' | 'regNo' | 'company' | undefined => {
    const key = line.replace(/[\s：:（）()]/g, '')
    if (/^(原药名称|原药母药名称)$/.test(key)) return 'ingredient'
    if (/^(原药证件号|原药登记证号|原药母药登记证号)$/.test(key)) return 'regNo'
    if (/^(原药厂家名称|原药生产企业名称)$/.test(key)) return 'company'
    return undefined
  }
  const out: Array<{ ingredient?: string; regNo: string; company: string }> = []
  let current: { ingredient?: string; regNo: string; company: string } | undefined
  let pending: 'ingredient' | 'regNo' | 'company' | undefined
  for (const line of lines) {
    const field = fieldOf(line)
    if (field) { pending = field; continue }
    if (!pending) continue
    // 「原药名称」是组边界：遇到新的一组名称就先把上一组落定
    if (pending === 'ingredient' && current) { out.push(current); current = undefined }
    current ||= { regNo: '', company: '' }
    if (pending === 'ingredient') current.ingredient = line
    else if (pending === 'regNo') current.regNo = line
    else current.company = line
    pending = undefined
  }
  if (current) out.push(current)
  return out
}

async function fetchWla1(url: URL, code: string): Promise<ExternalSourceData> {
  const apiUrl = new URL('/api/index/code/codeScan', url.origin)
  apiUrl.searchParams.set('code', code)
  // 用 follow 而不是 error：来源站点若把 http 301 到 https（或对 /api 前缀做跳转），error 会当场抛错、接口变 500。
  // apiUrl 由 url.origin 构造（必然同源），且调用前已过 assertSafeUrl，跟随后不会引入内网访问风险。
  const fetched = await fetchSourceDocument(apiUrl.href)
  const response = new Response(fetched.body, { status: 200 })
  if (!response.ok) throw new Error('来源平台接口返回 HTTP ' + response.status)
  const body = await response.json() as any
  const result = body?.result
  if (!result?.heProduct) throw new Error('来源平台未返回产品信息')
  const product = result.heProduct
  return {
    sourceUrl: url.toString(), platform: url.hostname, code,
    productName: product.productname, registrationNo: product.fullproductnum,
    holderName: product.ownername, productionType: product.createtype,
    spec: result.heSpec?.specname, produceDate: normalizeProduceDate(result.productdate),
    batchNo: cleanDate(result.batch), expireDate: cleanDate(result.losedate),
    originals: extractOriginalsFromJson(JSON.stringify(result)),
    raw: { product, spec: result.heSpec, code: result.heQrcodeD, attributes: result.heProductAttributes },
  }
}

/**
 * 抓来源页面，允许「同站一次重定向」。
 * 原先用 redirect:'error'，现实里 http→https 的 301 极常见 → 直接抛 `unexpected redirect` 变成 500。
 * 跨站重定向仍一律拒绝，避免被用来探测内网。
 */
async function fetchSourcePage(url: URL, _accept: string): Promise<Response> {
  const result = await fetchSourceDocument(url.href)
  return new Response(result.body, { status: 200 })
}

async function fetchGenericPage(url: URL, code: string): Promise<ExternalSourceData> {
  let response: Response
  try {
    response = await fetchSourcePage(url, 'text/html,application/xhtml+xml')
  } catch (e) {
    // 业务错误（如跨站跳转）原样上抛；其余网络异常归为「来源页面不可访问」，不要以 500 暴露给前端
    const err = e as { statusCode?: number; message?: string }
    if (err?.statusCode) throw e
    throw createError({ statusCode: 502, statusMessage: `无法访问来源页面（${err?.message || '网络请求失败'}）` })
  }
  if (!response.ok) throw createError({ statusCode: 502, statusMessage: `来源页面返回 HTTP ${response.status}` })
  const html = await response.text()
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim()
  // 刻意不用「页面标题」兜底当产品名：外部平台标题多为平台名（如「农药追溯二维码管理平台」），
  // 拿它当产品名会让「产品名称」核验项得出假结论 —— 宁可为空并由上层给出明确提示。
  const decl = parseSourceDocument(html, url.toString(), code)
  return toExternalSource(decl, { raw: { htmlLength: html.length, pageTitle: title, extracted: decl.productFields.length } })
}

/** 由用户手工粘贴的来源页面内容解析（部分外部平台纯脚本异步渲染，服务端抓不到正文，用它兜底） */
function fetchFromProvidedText(sourceUrl: string, code: string, pageText: string): ExternalSourceData {
  let platform = '手工提供内容'
  let baseUrl = 'https://manual.invalid/'
  // parseSourceDocument 需要合法 URL 才能解析 platform ⇒ 有真实来源网址就用它，否则用占位域名再覆盖 platform
  try {
    if (sourceUrl) {
      const parsed = new URL(sourceUrl)
      platform = parsed.hostname
      baseUrl = parsed.toString()
    }
  } catch { /* 来源网址缺失或非法时保留默认平台名 */ }
  const decl = parseSourceDocument(pageText, baseUrl, code)
  return toExternalSource({ ...decl, sourceUrl, platform }, { raw: { manual: true, extracted: decl.productFields.length } })
}

export async function fetchExternalSource(sourceUrl: string, code: string, pageText = ''): Promise<ExternalSourceData> {
  // 用户提供了页面内容时优先用它：纯 JS 渲染的平台服务端抓不到正文，手工内容比抓取结果更完整
  if (String(pageText || '').trim()) return fetchFromProvidedText(sourceUrl, code, pageText)
  const url = await assertSafeUrl(sourceUrl)
  if (url.hostname.toLowerCase() === 'www.wla1.cn' || url.hostname.toLowerCase() === 'wla1.cn') return fetchWla1(url, code)
  return fetchGenericPage(url, code)
}

function item(key: string, label: string, status: VerificationItemStatus, sourceValue: unknown, referenceValue: unknown, reason: string): VerificationItem {
  return { key, label, status, sourceValue: sourceValue ? String(sourceValue) : undefined, referenceValue: referenceValue ? String(referenceValue) : undefined, reason }
}

export async function verifyExternalCode(input: { sourceUrl?: string; code?: string; pageText?: string; enterpriseId?: number | null; userId?: number | null }): Promise<ExternalVerificationResult> {
  const sourceUrl = String(input.sourceUrl || '').trim()
  const pageText = String(input.pageText || '').trim()
  // 码可以从「来源链接」「码值」「手工粘贴的页面内容」任一处识别，三者都不含时才报错
  const code = extractTraceCode(input.code || sourceUrl || pageText)
  if (!isTraceCode(code)) throw createError({ statusCode: 400, statusMessage: '未识别到至少32位数字单元识别代码' })
  const codeParts = parseExternalCode(code)
  // 「来源链接」必须是 http(s) 网址才值得去抓。扫码到别人平台的裸码值时前端会填进码值框，
  // 但「手工把裸码粘进链接框」也很常见 —— 那种输入按「未提供来源页面」处理（编码结构与登记库核验照做），
  // 不要用 400 把用户堵死：否则「扫到/拿到别人的裸码」这条最常见路径直接走不通。
  const hasUrlSource = isHttpUrl(sourceUrl)
  const pageFetched = Boolean(pageText) || hasUrlSource
  const source: ExternalSourceData = pageFetched
    ? await fetchExternalSource(sourceUrl, code, pageText)
    : { sourceUrl, platform: '未提供来源页面', code }
  // 2026-09-24 收口：「后六位 + 类别过滤」取候选改为共用原语 findRegistryRowsByUnitCode
  //   （与公众端 /api/trace 的登记库兜底 registry-lookup.ts 同一实现）。
  //   原先本文件内联 SQL：SELECT ... WHERE RIGHT(registration_no, 6) = ? —— 无 LIMIT、无 ORDER BY、
  //   无缓存，且与公众端各写一遍同样的 regCategoryOf 过滤 ⇒ 一处改另一处忘就会漂移。
  //   收口后本端行为差异仅两处（均已实测为**零影响**，2026-09-24 本机 97,471 行）：
  //     · 取数带上限 20（原无上限）：该上限管的是「仅按后六位」的桶，实测最大 **6 条**
  //       （分布 1条:66776 / 2条:9096 / 3条:3174 / 4条:720 / 5条:19 / 6条:1）⇒ 3 倍余量、零截断；
  //       ⚠️ 若将来登记库导入让某个后六位桶 >20 条，须同步上调 registry-lookup 的 MAX_ROW_SCAN。
  //     · 加 ORDER BY registration_no（原无序）：本端只用 `.find` 取「证号完全相等」那条，
  //       顺序无关；且桶 ≤6 条时排序不改变集合。
  //   刻意**不**改用 lookupRegistryByCode：那会把候选统一截到 5 条（展示口径），
  //   而本端要用**完整候选集**做精确匹配 —— 截断会让「真实证号排在 5 条之外」时把一致误判为不一致。
  const candidateRows = await findRegistryRowsByUnitCode(codeParts)
  const registrationCandidates = candidateRows.map(r => ({ registrationNo: String(r.registration_no), productName: String(r.product_name || ''), holderName: String(r.company || ''), expireDate: cleanDate(r.expire_date), categoryCode: Number(codeParts.categoryCode) }))
  const matchedRegistration = source.registrationNo
    ? registrationCandidates.find(r => normalizeText(r.registrationNo) === normalizeText(source.registrationNo))
    : registrationCandidates.length === 1 ? registrationCandidates[0] : undefined
  const items: VerificationItem[] = []
  items.push(item('code-format', '前8位编码结构', codeParts.validLength && codeParts.validCategory && codeParts.validProductionType ? 'match' : 'mismatch', code.slice(0, 8), '类别+登记证后六位+生产类型', codeParts.validLength ? '前8位格式可解析' : '码长度或数字格式不符合规则'))
  items.push(item('registration-suffix', '登记证后六位', registrationCandidates.length ? 'match' : 'insufficient', codeParts.registrationLast6, registrationCandidates.map(r => r.registrationNo).join('、'), registrationCandidates.length ? '已找到登记候选' : '登记资料库未找到对应后六位'))
  items.push(item('registration-no', '登记证号', source.registrationNo && matchedRegistration ? 'match' : source.registrationNo && registrationCandidates.length ? 'mismatch' : 'insufficient', source.registrationNo, matchedRegistration?.registrationNo || registrationCandidates.map(r => r.registrationNo).join('、'), source.registrationNo ? (matchedRegistration ? '来源登记证与候选一致' : '来源登记证未与编码候选对应') : '来源页面未提供完整登记证号'))
  // 产品名先严格比，再按「剥离含量标注」宽松比 —— 宽松命中仍判一致，但明确提示含量需人工复核
  const nameStrict = !!(source.productName && matchedRegistration) && normalizeText(source.productName) === normalizeText(matchedRegistration.productName)
  const nameLoose = !!(source.productName && matchedRegistration) && normalizeProductName(source.productName) === normalizeProductName(matchedRegistration.productName)
  const productNameReason = !source.productName
    ? '来源页面未提供'
    : !matchedRegistration
      ? '尚未确定登记对象'
      : nameStrict
        ? '与登记资料完全一致'
        : nameLoose
          ? '与登记资料为同一登记产品，仅含量标注写法不同（含量请人工复核）'
          : '来源产品名未与登记候选对应'
  items.push(item('product-name', '产品名称', source.productName && matchedRegistration ? (nameStrict || nameLoose ? 'match' : 'mismatch') : 'insufficient', source.productName, matchedRegistration?.productName, productNameReason))
  items.push(item('holder-name', '登记持有人', source.holderName && matchedRegistration ? (normalizeOrgName(source.holderName) === normalizeOrgName(matchedRegistration.holderName) ? 'match' : 'mismatch') : 'insufficient', source.holderName, matchedRegistration?.holderName, source.holderName ? (matchedRegistration ? '与登记资料比对' : '尚未确定登记对象') : '来源页面未提供'))
  items.push(item('production-type', '生产类型', codeParts.validProductionType ? 'match' : 'mismatch', codeParts.productionTypeLabel, source.productionType, source.productionType ? '来源页面已提供生产类型，可人工复核' : '仅核验编码中的生产类型'))
  const localProductRows = source.registrationNo ? await query<any[]>('SELECT id, enterprise_id, name, registration_no, holder_name FROM product WHERE registration_no = ? LIMIT 1', [source.registrationNo]) : []
  const localProduct = localProductRows[0] ? { id: Number(localProductRows[0].id), name: String(localProductRows[0].name), registrationNo: String(localProductRows[0].registration_no), holderName: String(localProductRows[0].holder_name || ''), enterpriseId: Number(localProductRows[0].enterprise_id) } : undefined
  const mismatch = items.some(i => i.status === 'mismatch')
  const checked = items.some(i => i.status === 'match' || i.status === 'mismatch')
  const overallStatus = mismatch ? 'mismatch' : checked && items.some(i => i.status === 'insufficient') ? 'insufficient' : checked ? 'match' : 'insufficient'
  const warnings: string[] = []
  if (!pageFetched) {
    warnings.push('未抓取来源页面，只完成编码结构与本地登记资料核验')
    // 用户把裸码（而不是网址）填进了「来源链接」栏 —— 明确告知已按仅码值核验处理，别让他以为系统坏了
    if (sourceUrl) warnings.push('「来源链接」里填的不是网址（已按仅码值核验）；如需核验页面信息，请把来源页面内容粘贴到下方输入框。')
  }
  if (!source.productName && !source.registrationNo && !source.holderName) {
    warnings.push(pageText
      // 已经粘贴了内容还提不到字段：此时再让他"去复制页面内容"只会把人带偏，给出真正可操作的原因
      ? '已从你粘贴的内容里提取不到产品字段：请确认内容中含「农药名称 / 登记证号 / 持有人」等标签，且标签与值之间用冒号、Tab 或换行分隔。'
      : '未从来源页面提取到产品字段：该页面很可能由脚本异步渲染（服务端只拿到空壳）。请在浏览器打开该二维码链接，把页面上的「基本信息 / 产品信息」文字整段复制到「粘贴来源页面内容」后重新核验 —— 解析走通用规则，不区分平台。')
  }
  return { source, codeParts, registrationCandidates, matchedRegistration, localProduct, items, overallStatus, warnings }
}
