import { createHash, randomUUID } from 'node:crypto'
import { query, execute } from './db'
import { fetchSourceDocument } from './source-fetch'
import { parseSourceDocument, SOURCE_PARSER_VERSION } from './source-parser'
import { compareSource } from './source-compare'
import { adaptSourceDocument } from './source-adapters'
import { findRegistryRowsByUnitCode } from './registry-lookup'
import { capRawDocument, FAILURE_CACHE_MINUTES, SUCCESS_CACHE_MINUTES } from './source-raw-cap'
import { parseUnitCode } from '#shared/utils/unit-code'
import type { SourceDeclaration, SourceIssue, SourceSnapshot } from '../../shared/types/source-snapshot'

// 外页取数失败时，消费者看到的是人话，技术原文另存 `detail`（仅供后台排查）。
// 🔴 这里只做「错误原文 → 人话 + 原因分类」的映射，不改动任何抓取、解析与判定逻辑。
const ISSUES: { test: RegExp; issue: SourceIssue; message: string }[] = [
  { test: /不是可访问的公网地址|不受支持|跳转次数过多/, issue: 'blocked-address', message: '这个来源网址打不开，请核实二维码来源是否可靠' },
  { test: /繁忙/, issue: 'busy', message: '当前查询的人较多，请稍后再试' },
  { test: /未提取到产品信息|由脚本加载/, issue: 'empty-shell', message: '这个来源页面要靠浏览器才能显示内容，本平台读不到里面的资料' },
  { test: /单元识别码与本次查询不一致/, issue: 'code-mismatch', message: '来源页面显示的码与您查询的码不一致，请核对包装上的二维码' },
  // 2026-09-28 新增：来源平台**明确答复「没有这个码」**（适配器第三态，仅登记过的空壳站会走到）。
  // 与 empty-shell 分开：empty-shell 是「我们没读懂」，这条是「对方说没有」——把这两种说法混为一谈，
  // 消费者会照着错误指引去折腾浏览器。
  { test: /来源平台查无此码/, issue: 'source-not-found', message: '这个来源平台查不到该码，请核对包装上的二维码是否与本次扫描的一致' },
]

/** 登记资料参考行的完整列（比对需要 `ingredients`，而共用原语的 SELECT 里没有它） */
const PRODUCT_COLUMNS = 'registration_no, product_name, company, dosage, toxicity, content, ingredients, ingredient_main, ingredient_all, expire_date, created_at'

/**
 * 取「比对参考」用的登记资料行。
 * · 来源页声明了登记证号 ⇒ 直接用该证号取（原逻辑，一字未动）；
 * · 来源页**没声明证号**、但本次码是标准 32 位、且该声明来自**宿主适配器**时 ⇒ 用码内
 *   「后六位 + 类别」取登记候选当参考 —— 复用现成原语（`registry-lookup.ts` 的唯一实现），
 *   不自行切码、不自行判类别。不做这一步的话，空壳站适配进来后所有项目都会因「参考值取不到」
 *   而恒为「资料不足」（详见 docs/handover/36 号 §5.3.5）。
 * 🔴 两条边界：
 *   ① 只在**唯一候选**时才当参考 —— 后六位会撞车（可能跨 PD/WP 类），多候选时无法确定是哪张证，
 *      宁可全项「资料不足」，也不拿可能不相干的登记证去比出「存在差异」；
 *   ② 不扩展到「通用解析出来的、有名称没证号」的页面 —— 那类页面的名称常是商品名/商标，
 *      拿登记库的农药名称去比容易误报「存在差异」，故维持原口径。
 */
async function referenceProductFor(source: SourceDeclaration, fromAdapter: boolean): Promise<any | undefined> {
  if (source.registrationNo) {
    const [row] = await query<any[]>(`SELECT ${PRODUCT_COLUMNS} FROM pesticide_reg WHERE registration_no = ? LIMIT 1`, [source.registrationNo])
    return row
  }
  if (!fromAdapter || !/^\d{32}$/.test(source.code || '')) return undefined
  const rows = await findRegistryRowsByUnitCode(parseUnitCode(source.code))
  if (rows.length !== 1) return undefined
  const [row] = await query<any[]>(`SELECT ${PRODUCT_COLUMNS} FROM pesticide_reg WHERE registration_no = ? LIMIT 1`, [rows[0]!.registration_no])
  return row
}

const pending = new Map<string, Promise<SourceSnapshot>>()
const json = (v: any) => typeof v === 'string' ? JSON.parse(v) : v
function hostOf(sourceUrl: string): string | undefined {
  try { return new URL(sourceUrl).hostname } catch { /* 非标准网址不提供平台名 */ }
}
export async function collectSourceSnapshot(sourceUrl: string, code: string): Promise<SourceSnapshot> {
  const key = createHash('sha256').update(sourceUrl + '\n' + code + '\n' + SOURCE_PARSER_VERSION).digest('hex')
  const existing = pending.get(key)
  if (existing) return existing
  if (pending.size >= 8) return { fetchedAt: new Date().toISOString(), parserVersion: SOURCE_PARSER_VERSION, status: 'unavailable', message: '当前查询的人较多，请稍后再试', issue: 'busy', comparisons: [], saved: false, sourceUrl, platform: hostOf(sourceUrl) }
  const work = collect(key, sourceUrl, code)
  pending.set(key, work)
  try { return await work } finally { pending.delete(key) }
}
async function collect(key: string, sourceUrl: string, code: string): Promise<SourceSnapshot> {
  // 复用同一次已保存的快照，避免重复扫描外站和反复写库。
  // 🔴 2026-09-28 存储放大收口：**失败快照也复用**，只是 TTL 更短（见 source-raw-cap.ts）。
  //    从前这里带 `status <> 'unavailable'` 把失败行整条排除 ⇒ 每次重试都重新抓外站、再落一行，
  //    正是放大的主因。现在按行自身的 status 选 TTL：失败 → FAILURE_CACHE_MINUTES，成功 → SUCCESS_CACHE_MINUTES。
  //    注：`created_at > IF(...)` 是非 sargable 条件，但 `cache_key` 是索引前导列，仍先按 key 收敛，无性能问题。
  try {
    const [cached] = await query<any[]>("SELECT payload FROM external_source_snapshot WHERE cache_key = ? AND created_at > IF(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.status')) = 'unavailable', DATE_SUB(NOW(), INTERVAL ? MINUTE), DATE_SUB(NOW(), INTERVAL ? MINUTE)) ORDER BY created_at DESC LIMIT 1", [key, FAILURE_CACHE_MINUTES, SUCCESS_CACHE_MINUTES])
    if (cached) return json(cached.payload)
  } catch { /* 未迁移时仍能查询，但明确告知没有保存历史 */ }
  const snapshot: SourceSnapshot = { id: randomUUID(), fetchedAt: new Date().toISOString(), parserVersion: SOURCE_PARSER_VERSION, status: 'unavailable', message: '', comparisons: [], saved: false }
  // 无论抓取或解析成败，都保留用户前往原查询页的入口。
  snapshot.sourceUrl = sourceUrl
  snapshot.platform = hostOf(sourceUrl)
  let document = ''
  let references: unknown = null
  // 是否走到了「解析出声明」这一步 —— 决定原文要不要落库（失败一律不落，见 source-raw-cap.ts）
  let succeeded = false
  try {
    // ① 宿主专用适配器先行：登记在案的空壳站（通用解析必然读不到值）走它自己的结构化接口；
    //    未登记宿主返回 null ⇒ 与从前完全一致，走「抓页面 + 通用解析」。
    const adapted = await adaptSourceDocument(sourceUrl, code)
    // 适配器第三态：对方平台**明确答复「查无此码」** ⇒ 直接出正确文案，不再退回通用抓取
    // （退回会撞上空壳页，把对方的答复误说成「页面要靠浏览器才能显示内容」）。
    if (adapted && 'notFound' in adapted) throw new Error('来源平台查无此码')
    let source: SourceDeclaration
    if (adapted) {
      source = adapted.source
      document = adapted.document
    } else {
      const fetched = await fetchSourceDocument(sourceUrl)
      document = fetched.body
      source = parseSourceDocument(document, fetched.url, code)
    }
    if (source.originals.length > 50) throw new Error('来源原药记录过多，需人工核实')
    // 短链接必须从页面明确的码字段识别；不从任意长数字猜测码值。
    if (!code && /^\d{32}$/.test(source.pageCode || '')) source.code = source.pageCode!
    if (source.pageCode && source.code && source.pageCode !== source.code) throw new Error('来源页面的单元识别码与本次查询不一致，未展示产品声明')
    // 「读不出内容」判据：原只看 productName / registrationNo / originals 三项，
    // 会把「只给了商品名与生产企业」的页面也误判成空壳（实例 cx.jilinhengda.com）。
    // 现加入 commodityName —— 仍保持「读到展示字段也算读到内容」，不放松到任意单字段。
    if (!source.productName && !source.commodityName && !source.registrationNo && !source.originals.length) throw new Error('来源页面未提取到产品信息，可能需要平台适配或页面由脚本加载')
    snapshot.source = source
    const product = await referenceProductFor(source, Boolean(adapted))
    const nos = [...new Set(source.originals.map(o => o.regNo).filter(Boolean))].slice(0, 50)
    const originals = nos.length ? await query<any[]>('SELECT registration_no, company, dosage, ingredient_main, expire_date, created_at FROM pesticide_reg WHERE registration_no IN (?)', [nos]) : []
    references = { product: product || null, originals }
    snapshot.comparisons = compareSource(source, product, originals)
    snapshot.status = source.pageCode && source.code === source.pageCode ? 'ok' : 'partial'
    snapshot.message = snapshot.status === 'ok' ? '已获取来源页声明；登记比对不代表商品真伪鉴定' : '已提取来源内容，但页面未提供可核对的单元识别码，请核实对应关系'
    succeeded = true
  } catch (error) {
    const raw = error instanceof Error ? error.message : '来源查询暂不可用'
    const hit = ISSUES.find(item => item.test.test(raw))
    snapshot.issue = hit?.issue || 'unreachable'
    snapshot.message = hit?.message || '暂时打不开这个来源页面'
    // 技术原文只放在 detail 里供后台排查，公众端展示的是上面的 message。
    snapshot.detail = raw
  }
  try {
    snapshot.saved = true
    // 🔴 2026-09-28 存储放大收口（详见 source-raw-cap.ts）：失败时**不落原文** ——
    //    抓取/解析失败的页面恰恰是读不出内容的那类，原样留 1MB 纯属占盘；
    //    成功时按 64KB 上限截断，并按字符边界切，不产生半个乱码字符。
    const rawDocument = succeeded ? (capRawDocument(document) || null) : null
    await execute('INSERT INTO external_source_snapshot (id, cache_key, code, source_url, parser_version, raw_document, reference_data, payload) VALUES (?,?,?,?,?,?,?,?)', [snapshot.id, key, snapshot.source?.code || code, sourceUrl, SOURCE_PARSER_VERSION, rawDocument, JSON.stringify(references), JSON.stringify(snapshot)])
  } catch {
    snapshot.saved = false
    delete snapshot.id
    snapshot.message += '（本次结果未能存档）'
    // 存档失败属运维问题，同样只进 detail，不打扰消费者。
    snapshot.detail = [snapshot.detail, '历史快照保存失败：请检查迁移或数据库状态'].filter(Boolean).join('；')
  }
  return snapshot
}
