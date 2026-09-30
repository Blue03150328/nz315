// 食安佳 H5 农药追溯页适配器（h5.shiaj.com）。
//
// 该站的结果页是前端空壳：HTML 只有模板，浏览器加载后再调用两个 JSON 接口：
//   POST /api/data/CheckTraceCodeAllInOne/{门店编号}
//   POST /api/data/ProductCertificate/{门店编号}
// 页面脚本固定带 `X-Source: H5`，接口响应中的 ResData 才是实际来源资料。
// 因此这里优先读取站方接口，避免把空壳 HTML 交给通用解析或视觉模型后得到假空数据。
import { fetchSourceDocument } from '../source-fetch'
import type { SourceDeclaration } from '#shared/types/source-snapshot'

const API_HEADER = { 'X-Source': 'H5', 'Content-Type': 'application/json' }
const MODULES = 'Product,CodeValidCount,Produce,StoreInfo,Package,Sale,TemplateNo'

function text(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value).trim()
  return !s || /^[-—]+$/.test(s) ? '' : s
}

function dateOnly(value: unknown): string | undefined {
  const m = text(value).match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (!m) return undefined
  const valueText = `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`
  const date = new Date(`${valueText}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === valueText ? valueText : undefined
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function jsonArray(value: unknown): any[] {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function originalsFrom(value: unknown): { ingredient?: string; regNo: string; company: string }[] {
  return jsonArray(value).map((item: any) => ({
    ingredient: text(item?.Name || item?.name) || undefined,
    regNo: text(item?.Num || item?.num || item?.RegistrationNo || item?.registrationNo),
    company: text(item?.Company || item?.company || item?.Producer || item?.producer),
  })).filter(item => item.ingredient || item.regNo || item.company)
}

function uniqueOriginals(product: any, trace: any): { ingredient?: string; regNo: string; company: string }[] {
  const productTags = jsonObject(product?.CustomTags)
  const traceTags = jsonObject(trace?.BatchCustomTags)
  const values = [
    ...originalsFrom(productTags['-_PesticideSource']),
    ...originalsFrom(traceTags['原药信息']),
  ]
  const seen = new Set<string>()
  return values.filter(item => {
    const key = `${item.ingredient || ''}\u0000${item.regNo}\u0000${item.company}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 50)
}

/** 把药剂型的英文代码去掉，保留登记库可比对的中文剂型；页面完整写法仍进入 productFields。 */
function formulation(value: unknown): string {
  const s = text(value)
  const index = s.lastIndexOf('-')
  return index >= 0 ? text(s.slice(index + 1)) : s
}

function apiErrorIsNotFound(payload: any): boolean {
  return /查无|不存在|不正确|无效|没有该码|未找到/.test(text(payload?.ResDesc || payload?.message))
}

async function postJson(url: string, body: Record<string, unknown>): Promise<{ payload: any; raw: string }> {
  const fetched = await fetchSourceDocument(url, API_HEADER, { method: 'POST', body: JSON.stringify(body) })
  let payload: any
  try { payload = JSON.parse(fetched.body) } catch { throw new Error('来源接口返回的不是 JSON') }
  return { payload, raw: fetched.body }
}

/** 将站方两个接口的 ResData 映射成本平台来源声明。 */
export function mapShiaj(trace: any, certificate: any, sourceUrl: string, code: string): SourceDeclaration | null {
  if (!trace || typeof trace !== 'object') return null
  const product = trace.Product || {}
  const cert = certificate && typeof certificate === 'object' ? certificate : {}
  const productName = text(cert.Name) || text(product.Name)
  const registrationNo = text(cert.Num)
  const holderName = text(cert.Holder)
  const manufacturer = text(trace.DelegationComplany) || text(product.Creater) || text(product.Adminer)
  if (!productName && !registrationNo && !holderName) return null
  const fullFormulation = text(cert.PotionType) || text(product.Type)
  const produceDate = dateOnly(trace.Produce?.CreateTime)
  const batchNo = text(trace.Produce?.BatchNo)
  const expiry = dateOnly(cert.ExpireETime)
  const packageSpec = text(trace.PackageName) || [text(trace.Package?.Weight), text(trace.Package?.WeightUnit), text(trace.Package?.PackageUnit)].filter(Boolean).join('')
  const originals = uniqueOriginals(product, trace)
  const fields: { label: string; value: string }[] = []
  const push = (label: string, value: string | undefined) => { if (value) fields.push({ label, value }) }
  push('产品名称', productName)
  push('商品名称', text(product.Name))
  push('农药登记证号', registrationNo)
  push('登记证持有人', holderName)
  push('生产企业', manufacturer)
  push('剂型', fullFormulation)
  push('毒性', text(cert.Toxicity))
  push('总有效成分含量', text(cert.TotalContent))
  push('规格', packageSpec)
  push('生产许可证', text(trace.ProductionLicenceNo))
  push('产品标准号', text(trace.CarriedStandardNo) || text(jsonObject(product.CustomTags)['产品标准号']))
  push('生产日期', produceDate)
  push('生产批次', batchNo)
  push('有效期至', expiry)
  return {
    sourceUrl,
    platform: new URL(sourceUrl).hostname,
    code,
    pageCode: /^\d{32}$/.test(text(trace.Code)) ? text(trace.Code) : undefined,
    productName: productName || undefined,
    commodityName: text(product.Name) || undefined,
    registrationNo: registrationNo || undefined,
    holderName: holderName || undefined,
    manufacturer: manufacturer || undefined,
    formulation: formulation(fullFormulation) || undefined,
    toxicity: text(cert.Toxicity) || undefined,
    content: text(cert.TotalContent) || undefined,
    ingredients: originals.map(item => [item.ingredient, item.regNo ? `(${item.regNo})` : ''].filter(Boolean).join('')).filter(Boolean).join('；') || undefined,
    spec: packageSpec || undefined,
    produceDate,
    batchNo: batchNo || undefined,
    productExpiry: expiry,
    productFields: fields,
    originals,
  }
}

export async function shiajAdapter(sourceUrl: string, code: string): Promise<{ source: SourceDeclaration; document: string } | { notFound: true } | null> {
  const url = new URL(sourceUrl)
  if (url.hostname.toLowerCase() !== 'h5.shiaj.com') return null
  const storeNum = text(url.pathname.split('/').filter(Boolean).pop())
  const unit = text(url.searchParams.get('c')) || text(code)
  if (!/^\d+$/.test(storeNum) || !/^\d{32}$/.test(unit)) return null
  const base = `${url.protocol}//${url.host}`
  const traceResult = await postJson(`${base}/api/data/CheckTraceCodeAllInOne/${storeNum}`, {
    Code: unit,
    Province: '', City: '', District: '', Address: '', Lng: 0, Lat: 0,
    IncludeFirst: 1, ST: 1, Module: MODULES,
  })
  if (traceResult.payload?.ResCode !== 0) return apiErrorIsNotFound(traceResult.payload) ? { notFound: true } : null
  const trace = traceResult.payload?.ResData
  if (!trace) return apiErrorIsNotFound(traceResult.payload) ? { notFound: true } : null
  let certificate: any = null
  let certificateRaw = ''
  const certificateId = Number(trace.Product?.CertificateID)
  if (Number.isInteger(certificateId) && certificateId > 0) {
    const result = await postJson(`${base}/api/data/ProductCertificate/${storeNum}`, { CertificateID: certificateId })
    if (result.payload?.ResCode !== 0) return apiErrorIsNotFound(result.payload) ? { notFound: true } : null
    certificate = result.payload?.ResData || null
    certificateRaw = result.raw
  }
  const source = mapShiaj(trace, certificate, sourceUrl, unit)
  if (!source) return null
  // 两份原文一起保存，既便于后台核对，也不会再次抓取页面空壳。
  return { source, document: JSON.stringify({ trace: traceResult.payload, certificate: certificate ? JSON.parse(certificateRaw) : null }) }
}

