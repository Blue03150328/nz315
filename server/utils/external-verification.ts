// 外部二维码核验：来源适配、前 8 位解析、登记资料和本平台档案比对
import { lookup } from 'node:dns/promises'
import { query } from './db'
import { regCategoryOf, normalizeOrgName } from './regdata'
import type { ExternalCodeParts, ExternalSourceData, ExternalVerificationResult, VerificationItem, VerificationItemStatus } from '#shared/types/external-verification'

const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)$/i

function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/[\s　、，。,.：:；;（）()［］\[\]「」]/g, '').trim()
}

function cleanDate(value: unknown): string | undefined {
  const text = String(value ?? '').trim()
  return text && !/^见|未知|无$/i.test(text) ? text.slice(0, 32) : undefined
}

export function extractExternalCode(input: string): string {
  const text = String(input || '').trim()
  const urlMatch = text.match(/[?&#](?:code|id|sn|traceCode)=([0-9]{32,})(?:&|#|$)/i)
  if (urlMatch?.[1]) return urlMatch[1]
  const direct = text.match(/(?<![0-9])[0-9]{32,}(?![0-9])/) 
  return direct?.[0] || ''
}

export function parseExternalCode(code: string): ExternalCodeParts {
  const value = String(code || '')
  const categoryCode = value.slice(0, 1)
  const productionTypeCode = value.slice(7, 8)
  return {
    length: value.length,
    categoryCode,
    categoryLabel: categoryCode === '1' ? 'PD' : categoryCode === '2' ? 'WP' : '未知',
    registrationLast6: value.slice(1, 7),
    productionTypeCode,
    productionTypeLabel: productionTypeCode === '1' ? '登记证持有人生产' : productionTypeCode === '2' ? '委托加工' : productionTypeCode === '3' ? '委托分装' : '未知',
    suffix: value.slice(8),
    validLength: /^\d{32,}$/.test(value),
    validCategory: categoryCode === '1' || categoryCode === '2',
    validProductionType: ['1', '2', '3'].includes(productionTypeCode),
  }
}

async function assertSafeUrl(input: string): Promise<URL> {
  let url: URL
  try { url = new URL(input) } catch { throw createError({ statusCode: 400, statusMessage: '二维码内容不是有效网址或追溯码' }) }
  if (!['http:', 'https:'].includes(url.protocol)) throw createError({ statusCode: 400, statusMessage: '只支持 HTTP 或 HTTPS 来源网址' })
  if (PRIVATE_HOST.test(url.hostname)) throw createError({ statusCode: 400, statusMessage: '来源网址不可访问本地或内网地址' })
  const records = await lookup(url.hostname, { all: true }).catch(() => [])
  if (records.some(r => PRIVATE_HOST.test(r.address) || r.address === '::1')) throw createError({ statusCode: 400, statusMessage: '来源网址解析到受限网络地址' })
  return url
}

async function fetchWla1(url: URL, code: string): Promise<ExternalSourceData> {
  const apiUrl = new URL('/api/index/code/codeScan', url.origin)
  apiUrl.searchParams.set('code', code)
  const response = await fetch(apiUrl, { signal: AbortSignal.timeout(12000), redirect: 'error', headers: { accept: 'application/json' } })
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

async function fetchGenericPage(url: URL, code: string): Promise<ExternalSourceData> {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: 'error', headers: { accept: 'text/html,application/xhtml+xml' } })
  if (!response.ok) throw new Error('来源页面返回 HTTP ' + response.status)
  const html = await response.text()
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim()
  return { sourceUrl: url.toString(), platform: url.hostname, code, productName: title, raw: { htmlLength: html.length } }
}

export async function fetchExternalSource(sourceUrl: string, code: string): Promise<ExternalSourceData> {
  const url = await assertSafeUrl(sourceUrl)
  if (url.hostname.toLowerCase() === 'www.wla1.cn' || url.hostname.toLowerCase() === 'wla1.cn') return fetchWla1(url, code)
  return fetchGenericPage(url, code)
}

function item(key: string, label: string, status: VerificationItemStatus, sourceValue: unknown, referenceValue: unknown, reason: string): VerificationItem {
  return { key, label, status, sourceValue: sourceValue ? String(sourceValue) : undefined, referenceValue: referenceValue ? String(referenceValue) : undefined, reason }
}

export async function verifyExternalCode(input: { sourceUrl?: string; code?: string; enterpriseId?: number | null; userId?: number | null }): Promise<ExternalVerificationResult> {
  const sourceUrl = String(input.sourceUrl || '').trim()
  const code = extractExternalCode(input.code || sourceUrl)
  if (!/^\d{32,}$/.test(code)) throw createError({ statusCode: 400, statusMessage: '未识别到至少32位数字单元识别代码' })
  const codeParts = parseExternalCode(code)
  const source = sourceUrl ? await fetchExternalSource(sourceUrl, code) : { sourceUrl: '', platform: '未提供来源页面', code }
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
  items.push(item('product-name', '产品名称', source.productName && matchedRegistration ? (normalizeText(source.productName) === normalizeText(matchedRegistration.productName) ? 'match' : 'mismatch') : 'insufficient', source.productName, matchedRegistration?.productName, source.productName ? (matchedRegistration ? '与登记资料比对' : '尚未确定登记对象') : '来源页面未提供'))
  items.push(item('holder-name', '登记持有人', source.holderName && matchedRegistration ? (normalizeOrgName(source.holderName) === normalizeOrgName(matchedRegistration.holderName) ? 'match' : 'mismatch') : 'insufficient', source.holderName, matchedRegistration?.holderName, source.holderName ? (matchedRegistration ? '与登记资料比对' : '尚未确定登记对象') : '来源页面未提供'))
  items.push(item('production-type', '生产类型', codeParts.validProductionType ? 'match' : 'mismatch', codeParts.productionTypeLabel, source.productionType, source.productionType ? '来源页面已提供生产类型，可人工复核' : '仅核验编码中的生产类型'))
  const localProductRows = source.registrationNo ? await query<any[]>('SELECT id, enterprise_id, name, registration_no, holder_name FROM product WHERE registration_no = ? LIMIT 1', [source.registrationNo]) : []
  const localProduct = localProductRows[0] ? { id: Number(localProductRows[0].id), name: String(localProductRows[0].name), registrationNo: String(localProductRows[0].registration_no), holderName: String(localProductRows[0].holder_name || ''), enterpriseId: Number(localProductRows[0].enterprise_id) } : undefined
  const mismatch = items.some(i => i.status === 'mismatch')
  const checked = items.some(i => i.status === 'match' || i.status === 'mismatch')
  const overallStatus = mismatch ? 'mismatch' : checked && items.some(i => i.status === 'insufficient') ? 'insufficient' : checked ? 'match' : 'insufficient'
  return { source, codeParts, registrationCandidates, matchedRegistration, localProduct, items, overallStatus, warnings: source.platform === '未提供来源页面' ? ['未抓取来源页面，只完成编码和本地登记资料核验'] : [] }
}
