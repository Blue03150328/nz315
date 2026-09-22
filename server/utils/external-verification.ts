// 外部二维码核验：来源适配、前 8 位解析、登记资料和本平台档案比对
import { lookup } from 'node:dns/promises'
import { query } from './db'
import { regCategoryOf, normalizeOrgName } from './regdata'
import { extractTraceCode, isHttpUrl, isTraceCode } from '#shared/utils/trace-code'
import { parseUnitCode } from '#shared/utils/unit-code'
import type { ExternalSourceData, ExternalVerificationResult, VerificationItem, VerificationItemStatus } from '#shared/types/external-verification'

const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)$/i

function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/[\s　、，。,.：:；;（）()［］\[\]「」]/g, '').trim()
}

function cleanDate(value: unknown): string | undefined {
  const text = String(value ?? '').trim()
  return text && !/^见|未知|无$/i.test(text) ? text.slice(0, 32) : undefined
}

/**
 * 产品名归一（仅用于「是否同一登记产品」的判断）：
 * 外部平台常把有效成分含量写进产品名（如「2.85%硝钠·萘乙酸」），而登记资料库只写成分名（「硝钠·萘乙酸」），
 * 严格比对会误报「产品名不一致」。故这里先剥掉含量标注再比，含量本身的差异由核验说明提示人工复核。
 */
function normalizeProductName(value: unknown): string {
  return normalizeText(String(value ?? '').replace(/[\d．.]+[%％]/g, '')).toLowerCase()
}

// 32 位码结构解析已抽到 server/utils/unit-code.ts（公众端 /api/trace 的登记库兜底比对共用同一套规则）
export const parseExternalCode = parseUnitCode

async function assertSafeUrl(input: string): Promise<URL> {
  let url: URL
  try { url = new URL(input) } catch { throw createError({ statusCode: 400, statusMessage: '二维码内容不是有效网址或追溯码' }) }
  if (!['http:', 'https:'].includes(url.protocol)) throw createError({ statusCode: 400, statusMessage: '只支持 HTTP 或 HTTPS 来源网址' })
  if (PRIVATE_HOST.test(url.hostname)) throw createError({ statusCode: 400, statusMessage: '来源网址不可访问本地或内网地址' })
  const records = await lookup(url.hostname, { all: true }).catch(() => [])
  if (records.some(r => PRIVATE_HOST.test(r.address) || r.address === '::1')) throw createError({ statusCode: 400, statusMessage: '来源网址解析到受限网络地址' })
  return url
}

// ---------- 通用来源字段提取 ----------
// 目标：不针对任何单一外部平台写死解析规则，而是把「任意来源文本 / 内嵌脚本数据」归一到 1049 六项所需字段。
// 覆盖四类常见写法：① 表格单元格相邻（td/th）② 同一格「标签：值」③ 同一行多格 ④ 标签与值分行；
// 另覆盖 JS / JSON 键值对（外部平台常把数据放在页面脚本里，如 goodsName:"xxx"）。

/** 剥标签：块级元素结束换行、单元格边界制表符，顺带去掉脚本/样式与 HTML 实体 */
export function stripHtmlToText(html: string): string {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<!--[\s\S]*?-->/g, '\n')
    .replace(/<\/(td|th|dt|dd)\s*>/gi, '\t')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(tr|p|div|li|h[1-6]|label|caption|section|article)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_all, d: string) => String.fromCharCode(Number(d)))
    .replace(/[ \u00a0]{2,}/g, ' ')
}

/** 标签归一：全角转半角、去空白与常见标点，便于同义词比对 */
function normalizeLabel(value: unknown): string {
  return String(value ?? '')
    .replace(/[\uff01-\uff5e]/g, (ch: string) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\s\u3000:：,，.。;；、()\[\]{}（）【】「」《》"'`*_-]/g, '')
    .toLowerCase()
}

type ExtractableField = 'productName' | 'registrationNo' | 'holderName' | 'spec' | 'formulation' | 'toxicity' | 'produceDate' | 'batchNo' | 'expireDate'

// 同义词表：中文标签按优先级从高到低（先命中者胜），keys 为 JS / JSON 常见键名
const FIELD_ALIASES: Array<{ field: ExtractableField; labels: string[]; keys: string[] }> = [
  { field: 'productName', labels: ['农药名称', '产品名称', '农药商品名称', '商品名称', '品名', '产品名'], keys: ['productname', 'goodsname', 'product_name', 'goods_name', 'pname'] },
  { field: 'registrationNo', labels: ['农药登记证号', '农药登记证', '登记证号', '登记证号码', '农药登记证号码'], keys: ['fullproductnum', 'registrationno', 'registration_no', 'regno', 'reg_no', 'pesticideregno'] },
  { field: 'holderName', labels: ['登记证持有人名称', '登记证持有人', '持有人名称', '持有人', '委托生产企业名称', '生产企业名称', '生产企业', '生产厂家'], keys: ['ownername', 'owner_name', 'holdername', 'holder_name', 'company', 'companyname', 'enterprise'] },
  { field: 'spec', labels: ['产品规格', '规格', '净含量', '包装规格'], keys: ['specname', 'spec_name', 'spec', 'netcontent', 'net_content', 'package'] },
  { field: 'formulation', labels: ['剂型', '农药剂型'], keys: ['formulation', 'dosageform'] },
  { field: 'toxicity', labels: ['毒性', '毒性级别', '毒性等级'], keys: ['toxicity', 'toxicitylevel'] },
  { field: 'produceDate', labels: ['生产日期'], keys: ['productdate', 'produce_date', 'productiondate', 'manufacturedate', 'mfgdate'] },
  { field: 'batchNo', labels: ['生产批次', '生产批号', '批号', '批次'], keys: ['batch', 'batchno', 'batch_no', 'lotno', 'lot_no'] },
  { field: 'expireDate', labels: ['有效期至', '有效期', '保质期'], keys: ['losedate', 'expire_date', 'expiredate', 'validuntil', 'shelflife'] },
]

// 明确不属于目标字段的标签（多为说明书段落段标题），命中即不作为「标签 + 值」处理，避免把正文吞成字段值
const NOISE_LABELS = new Set([
  '使用方法', '产品性能', '使用技术要求', '中毒急救', '注意事项', '储存和运输', '储存运输', '警示',
  '执行标准', '农药生产许可证', '服务热线', '扫码位置', '扫描次数', '追溯网址', '单元识别代码', '质量检测',
])

/** 值清洗：去首尾噪声与包裹引号；段落级长文本、纯链接、无意义占位值一律丢弃 */
function cleanFieldValue(raw: unknown): string | undefined {
  const text = String(raw ?? '').replace(/^[\s:：\-—|\t]+/, '').replace(/[\s\t]+$/, '').replace(/^["'「『]+|["'」』]+$/g, '').trim()
  if (!text) return undefined
  if (/^(见(喷码|包装|标签|瓶身|实物)?|未知|未提供|不详|待补充|待定|无|-|—|\/)$/.test(text)) return undefined
  if (text.length > 80) return undefined
  if (/^https?:\/\//i.test(text)) return undefined
  return text.slice(0, 64)
}

/** 从任意来源文本（HTML 或纯文本）中按同义词表提取目标字段 */
export function extractLabeledFields(text: string): Partial<Record<ExtractableField, string>> {
  const out: Partial<Record<ExtractableField, string>> = {}
  if (!text) return out
  const labelIndex = new Map<string, ExtractableField>()
  const keyIndex = new Map<string, ExtractableField>()
  for (const group of FIELD_ALIASES) {
    for (const label of group.labels) {
      const k = normalizeLabel(label)
      if (!labelIndex.has(k)) labelIndex.set(k, group.field)
    }
    for (const key of group.keys) {
      const k = normalizeLabel(key)
      if (!keyIndex.has(k)) keyIndex.set(k, group.field)
    }
  }
  const put = (field: ExtractableField, raw: unknown) => {
    if (out[field] !== undefined) return // 同义词表按优先级排列，先命中者胜
    const value = cleanFieldValue(raw)
    if (value) out[field] = value
  }

  // ① JS / JSON 键值对：goodsName:"xxx" / "productname": "xxx"
  const keyRe = /["']?([A-Za-z_][A-Za-z0-9_]{1,40})["']?\s*[:=]\s*["']([^"'\n]{1,80})["']/g
  for (const m of text.matchAll(keyRe)) {
    const field = keyIndex.get(normalizeLabel(m[1]))
    if (field) put(field, m[2])
  }

  // ② 逐行解析「标签 + 值」
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split(/\t| {2,}/).map(s => s.trim()).filter(Boolean)
    for (let c = 0; c < cells.length; c++) {
      const cell = cells[c]
      // 形式 A：同一格内「标签：值」
      const inline = cell.match(/^([^:：]{1,20})[:：]\s*(.+)$/)
      if (inline) {
        const inlineField = labelIndex.get(normalizeLabel(inline[1]))
        if (inlineField) { put(inlineField, inline[2]); continue }
      }
      // 形式 B/C：本格是纯标签 → 值取同格右侧（表格 td 相邻），否则取下一非空行
      const field = labelIndex.get(normalizeLabel(cell))
      if (!field) continue
      const sameRow = cells[c + 1]
      if (sameRow) { put(field, sameRow); continue }
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const next = lines[j].trim()
        if (next) { put(field, next); break }
      }
    }
  }
  return out
}

async function fetchWla1(url: URL, code: string): Promise<ExternalSourceData> {
  const apiUrl = new URL('/api/index/code/codeScan', url.origin)
  apiUrl.searchParams.set('code', code)
  // 用 follow 而不是 error：来源站点若把 http 301 到 https（或对 /api 前缀做跳转），error 会当场抛错、接口变 500。
  // apiUrl 由 url.origin 构造（必然同源），且调用前已过 assertSafeUrl，跟随后不会引入内网访问风险。
  const response = await fetch(apiUrl, { signal: AbortSignal.timeout(12000), redirect: 'follow', headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error('来源平台接口返回 HTTP ' + response.status)
  const body = await response.json() as any
  const result = body?.result
  if (!result?.heProduct) throw new Error('来源平台未返回产品信息')
  const product = result.heProduct
  return {
    sourceUrl: url.toString(), platform: url.hostname, code,
    productName: product.productname, registrationNo: product.fullproductnum,
    holderName: product.ownername, productionType: product.createtype,
    spec: result.heSpec?.specname, produceDate: cleanDate(result.productdate),
    batchNo: cleanDate(result.batch), expireDate: cleanDate(result.losedate),
    raw: { product, spec: result.heSpec, code: result.heQrcodeD, attributes: result.heProductAttributes },
  }
}

/**
 * 抓来源页面，允许「同站一次重定向」。
 * 原先用 redirect:'error'，现实里 http→https 的 301 极常见 → 直接抛 `unexpected redirect` 变成 500。
 * 跨站重定向仍一律拒绝，避免被用来探测内网。
 */
async function fetchSourcePage(url: URL, accept: string): Promise<Response> {
  const headers = { accept }
  const first = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: 'manual', headers })
  if (first.status < 300 || first.status >= 400) return first
  const location = first.headers.get('location')
  if (!location) return first
  const next = new URL(location, url)
  const bare = (h: string) => h.toLowerCase().replace(/^www\./, '')
  if (bare(next.hostname) !== bare(url.hostname)) {
    throw createError({ statusCode: 400, statusMessage: `来源页面跳转到其他站点（${next.hostname}），已拒绝抓取` })
  }
  return await fetch(next, { signal: AbortSignal.timeout(12000), redirect: 'error', headers })
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
  const fields = extractLabeledFields(stripHtmlToText(html))
  // 刻意不用「页面标题」兜底当产品名：外部平台标题多为平台名（如「农药追溯二维码管理平台」），
  // 拿它当产品名会让「产品名称」核验项得出假结论 —— 宁可为空并由上层给出明确提示。
  return {
    sourceUrl: url.toString(), platform: url.hostname, code,
    productName: fields.productName,
    registrationNo: fields.registrationNo,
    holderName: fields.holderName,
    spec: fields.spec,
    formulation: fields.formulation,
    toxicity: fields.toxicity,
    produceDate: fields.produceDate,
    batchNo: fields.batchNo,
    expireDate: fields.expireDate,
    raw: { htmlLength: html.length, pageTitle: title, extracted: fields, rendered: Object.keys(fields).length > 0 },
  }
}

/** 由用户手工粘贴的来源页面内容解析（部分外部平台纯脚本异步渲染，服务端抓不到正文，用它兜底） */
function fetchFromProvidedText(sourceUrl: string, code: string, pageText: string): ExternalSourceData {
  const fields = extractLabeledFields(stripHtmlToText(pageText))
  let platform = '手工提供内容'
  try { if (sourceUrl) platform = new URL(sourceUrl).hostname } catch { /* 来源网址缺失或非法时保留默认平台名 */ }
  return {
    sourceUrl, platform, code,
    productName: fields.productName,
    registrationNo: fields.registrationNo,
    holderName: fields.holderName,
    spec: fields.spec,
    formulation: fields.formulation,
    toxicity: fields.toxicity,
    produceDate: fields.produceDate,
    batchNo: fields.batchNo,
    expireDate: fields.expireDate,
    raw: { manual: true, extracted: fields },
  }
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
  const candidatesRaw = codeParts.registrationLast6 && codeParts.validCategory
    ? await query<any[]>('SELECT registration_no, product_name, company, expire_date FROM pesticide_reg WHERE RIGHT(registration_no, 6) = ?', [codeParts.registrationLast6])
    : []
  const registrationCandidates = candidatesRaw.filter(r => regCategoryOf(String(r.registration_no)) === Number(codeParts.categoryCode)).map(r => ({ registrationNo: String(r.registration_no), productName: String(r.product_name || ''), holderName: String(r.company || ''), expireDate: cleanDate(r.expire_date), categoryCode: Number(codeParts.categoryCode) }))
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
