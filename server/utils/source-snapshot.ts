import { createHash, randomUUID } from 'node:crypto'
import { query, execute } from './db'
import { fetchSourceDocument } from './source-fetch'
import { parseSourceDocument, SOURCE_PARSER_VERSION } from './source-parser'
import { compareSource } from './source-compare'
import type { SourceSnapshot } from '../../shared/types/source-snapshot'

const pending = new Map<string, Promise<SourceSnapshot>>()
const json = (v: any) => typeof v === 'string' ? JSON.parse(v) : v
function hostOf(sourceUrl: string): string | undefined {
  try { return new URL(sourceUrl).hostname } catch { /* 非标准网址不提供平台名 */ }
}
export async function collectSourceSnapshot(sourceUrl: string, code: string): Promise<SourceSnapshot> {
  const key = createHash('sha256').update(sourceUrl + '\n' + code + '\n' + SOURCE_PARSER_VERSION).digest('hex')
  const existing = pending.get(key)
  if (existing) return existing
  if (pending.size >= 8) return { fetchedAt: new Date().toISOString(), parserVersion: SOURCE_PARSER_VERSION, status: 'unavailable', message: '来源查询繁忙，请稍后重试', comparisons: [], saved: false, sourceUrl, platform: hostOf(sourceUrl) }
  const work = collect(key, sourceUrl, code)
  pending.set(key, work)
  try { return await work } finally { pending.delete(key) }
}
async function collect(key: string, sourceUrl: string, code: string): Promise<SourceSnapshot> {
  // 十分钟内复用同一次已保存的快照，避免重复扫描外站和反复写库。
  try {
    const [cached] = await query<any[]>("SELECT payload FROM external_source_snapshot WHERE cache_key = ? AND created_at > DATE_SUB(NOW(), INTERVAL 10 MINUTE) AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.status')) <> 'unavailable' ORDER BY created_at DESC LIMIT 1", [key])
    if (cached) return json(cached.payload)
  } catch { /* 未迁移时仍能查询，但明确告知没有保存历史 */ }
  const snapshot: SourceSnapshot = { id: randomUUID(), fetchedAt: new Date().toISOString(), parserVersion: SOURCE_PARSER_VERSION, status: 'unavailable', message: '', comparisons: [], saved: false }
  // 无论抓取或解析成败，都保留用户前往原查询页的入口。
  snapshot.sourceUrl = sourceUrl
  snapshot.platform = hostOf(sourceUrl)
  let document = ''
  let references: unknown = null
  try {
    const fetched = await fetchSourceDocument(sourceUrl)
    document = fetched.body
    const source = parseSourceDocument(document, fetched.url, code)
    if (source.originals.length > 50) throw new Error('来源原药记录过多，需人工核实')
    // 短链接必须从页面明确的码字段识别；不从任意长数字猜测码值。
    if (!code && /^\d{32}$/.test(source.pageCode || '')) source.code = source.pageCode!
    if (source.pageCode && source.code && source.pageCode !== source.code) throw new Error('来源页面的单元识别码与本次查询不一致，未展示产品声明')
    if (!source.productName && !source.registrationNo && !source.originals.length) throw new Error('来源页面未提取到产品信息，可能需要平台适配或页面由脚本加载')
    snapshot.source = source
    const [product] = source.registrationNo ? await query<any[]>('SELECT registration_no, product_name, company, dosage, toxicity, content, ingredients, ingredient_main, ingredient_all, expire_date, created_at FROM pesticide_reg WHERE registration_no = ? LIMIT 1', [source.registrationNo]) : []
    const nos = [...new Set(source.originals.map(o => o.regNo).filter(Boolean))].slice(0, 50)
    const originals = nos.length ? await query<any[]>('SELECT registration_no, company, dosage, ingredient_main, expire_date, created_at FROM pesticide_reg WHERE registration_no IN (?)', [nos]) : []
    references = { product: product || null, originals }
    snapshot.comparisons = compareSource(source, product, originals)
    snapshot.status = source.pageCode && source.code === source.pageCode ? 'ok' : 'partial'
    snapshot.message = snapshot.status === 'ok' ? '已获取来源页声明；登记比对不代表商品真伪鉴定' : '已提取来源内容，但页面未提供可核对的单元识别码，请核实对应关系'
  } catch (error) {
    snapshot.message = error instanceof Error ? error.message : '来源查询暂不可用'
  }
  try {
    snapshot.saved = true
    await execute('INSERT INTO external_source_snapshot (id, cache_key, code, source_url, parser_version, raw_document, reference_data, payload) VALUES (?,?,?,?,?,?,?,?)', [snapshot.id, key, snapshot.source?.code || code, sourceUrl, SOURCE_PARSER_VERSION, document || null, JSON.stringify(references), JSON.stringify(snapshot)])
  } catch {
    snapshot.saved = false
    delete snapshot.id
    snapshot.message += '；历史快照保存失败，请联系管理员检查迁移或数据库状态'
  }
  return snapshot
}
