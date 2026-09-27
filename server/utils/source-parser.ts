import type { SourceDeclaration } from '../../shared/types/source-snapshot'

// 🔴 2026-09-27.4：兜底③「标签与值分行」从纯文本放开到含标签路径（修「td 内包 div 致标签与值
// 被拆两行、整页字段全丢」的盲区，实例 cx.jilinhengda.com）；并新增只作展示的 commodityName。
// 改了解析口径就必须升版 —— 快照缓存键含本版本号，不升版会复用旧结果（见 39 号）。
export const SOURCE_PARSER_VERSION = '2026-09-27.4'
export function sourceText(html: string): string {
  const input = String(html || '')
  // 🔴 换行处理分两种输入，绝不能一刀切压平（2026-09-24 合并后实测踩到，属真回归）：
  //   · 含标签 ⇒ 按 HTML 处理：源码里的换行是排版噪声，先压成空格；行结构只由下面的块级标签产生。
  //   · 不含标签 ⇒ 手工粘贴的纯文本：换行**本身就是「标签 / 值」的分隔依据**
  //     （后台核验页的失败提示原文即写「标签与值之间用冒号、Tab 或换行分隔」），
  //     一旦压成空格，多行粘贴的登记证号 / 持有人会全部取不到、整段并成一行。
  const flat = /<[a-zA-Z!/][^>]*>/.test(input) ? input.replace(/\r?\n/g, ' ') : input
  return flat.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/(td|th|dt|dd)>/gi, '\t').replace(/<br\s*\/?\s*>|<\/(tr|p|div|li|h[1-6]|section)>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, v) => { const n = v[0].toLowerCase() === 'x' ? parseInt(v.slice(1), 16) : Number(v); return n <= 0x10ffff ? String.fromCodePoint(n) : '' })
}
const labelKey = (s: string) => s.replace(/[\s：:（）()]/g, '')

// ---------- 同义词表 · 宽松归一 · 脚本键提取（2026-09-24 自 external-verification.ts 并入） ----------
// 为什么并入：后台「外部二维码核验」曾自带一套同功能实现（自造 stripHtmlToText / extractLabeledFields /
// extractOriginals），与本发明文重复，且那份原药配对还是**下标拼装**旧写法（本文件已改为组边界配对，
// 缺字段不再串组）。两套并存 ⇒ 口径分叉、改一处忘一处。现统一到本文件，后台侧改为调用。
// 保守点：以下能力**只作兜底**，精确 labelKey 命中时永远优先用精确值 —— 不改变既有解析结果。
function normalizeLabel(input: unknown): string {
  return String(input ?? '')
    .replace(/[\uff01-\uff5e]/g, (ch: string) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\s\u3000:：,，.。;；、()\[\]{}（）【】「」《》"'`*_-]/g, '')
    .toLowerCase()
}

/** 兜底字段集：比 SourceDeclaration 多出规格/净含量/执行标准/生产许可证/商品名（后台核验页要展示这些） */
type LooseField = 'productName' | 'commodityName' | 'registrationNo' | 'holderName' | 'spec' | 'netContent' | 'formulation' | 'toxicity' | 'produceDate' | 'batchNo' | 'expireDate' | 'executionStandard' | 'productionLicense'

// 中文标签按优先级从高到低（先命中者胜）；keys 为 JS / JSON 常见键名
const FIELD_ALIASES: Array<{ field: LooseField; labels: string[]; keys: string[] }> = [
  { field: 'productName', labels: ['农药名称', '产品名称', '农药商品名称', '商品名称', '品名', '产品名'], keys: ['productname', 'goodsname', 'product_name', 'goods_name', 'pname'] },
  // 🔴 商品名 / 品种名**单独一档，绝不并进 productName**（2026-09-27 引入）：
  //    农药包装上的「品种名称」通常是**商品名**（实例 cx.jilinhengda 写「亨达美田」，
  //    而该登记证 PD20241818 在登记库里的农药名称是「丙硫菌唑·戊唑醇」）⇒ 一旦并进 productName
  //    参与「产品名称」一致性比对，正规药会被误报成「与登记资料不一致」（详见 36 号 §11.3 边界 2）。
  //    本档**只作展示**，不进入 compareSource 的任何判定。
  { field: 'commodityName', labels: ['品种名称', '品种名'], keys: ['commodityname', 'commodity_name', 'varietyname', 'variety_name'] },
  { field: 'registrationNo', labels: ['农药登记证号', '农药登记证', '登记证号', '登记证号码', '农药登记证号码'], keys: ['fullproductnum', 'registrationno', 'registration_no', 'regno', 'reg_no', 'pesticideregno'] },
  { field: 'holderName', labels: ['登记证持有人名称', '登记证持有人', '持有人名称', '持有人', '委托生产企业名称', '生产企业名称', '生产企业', '生产厂家'], keys: ['ownername', 'owner_name', 'holdername', 'holder_name', 'company', 'companyname', 'enterprise'] },
  { field: 'spec', labels: ['产品规格', '规格', '包装规格'], keys: ['specname', 'spec_name', 'spec', 'package'] },
  { field: 'netContent', labels: ['净含量'], keys: ['netcontent', 'net_content'] },
  { field: 'formulation', labels: ['剂型', '农药剂型'], keys: ['formulation', 'dosageform'] },
  { field: 'toxicity', labels: ['毒性', '毒性级别', '毒性等级'], keys: ['toxicity', 'toxicitylevel'] },
  { field: 'produceDate', labels: ['生产日期'], keys: ['productdate', 'produce_date', 'productiondate', 'manufacturedate', 'mfgdate'] },
  { field: 'batchNo', labels: ['生产批次', '生产批号', '批号', '批次'], keys: ['batch', 'batchno', 'batch_no', 'lotno', 'lot_no'] },
  { field: 'expireDate', labels: ['有效期至', '有效期', '保质期', '质量保证期'], keys: ['losedate', 'expire_date', 'expiredate', 'validuntil', 'shelflife', 'qualityguarantee'] },
  { field: 'executionStandard', labels: ['执行标准'], keys: ['standard', 'executionstandard'] },
  { field: 'productionLicense', labels: ['生产许可证', '农药生产许可证'], keys: ['productionlicense', 'license'] },
]

/**
 * 已知标签集合（宽松归一后）：兜底③用它判断某一行是否本身就是个标签。
 * 除同义词表里的字段标签外，还要补上**不被 `pick()` 消费、但同样有「标签 / 值」形态**的标签
 * （单元识别码与原药六项各自有专用取值逻辑）—— 否则兜底③认不出它们，
 * 这些字段在「标签与值被块级标签拆行」的页面上照样全丢（实例 cx.jilinhengda.com 的「单元识别码」，
 * 取不到会让快照只能落到 partial、且首项「来源页单元识别码」比对恒为资料不足）。
 * 🔴 刻意**不含「追溯码」**：它过于宽泛，一旦允许分行配对，容易把非 32 位的值塞进 `pageCode`，
 *    再与本次查询的码比出 `code-mismatch` ⇒ 沿用既有的「只认同行写法」。
 */
const EXTRA_KNOWN_LABELS = [
  '单元识别码', '单元识别代码',
  '原药名称', '原药母药名称', '原药证件号', '原药登记证号', '原药母药登记证号', '原药厂家名称', '原药生产企业名称',
]
const KNOWN_LABELS = new Set([...FIELD_ALIASES.flatMap(group => group.labels.map(normalizeLabel)), ...EXTRA_KNOWN_LABELS.map(normalizeLabel)])

/** 值清洗：去噪声与包裹引号，丢弃占位值、超长段落、纯链接 */
function cleanLooseValue(raw: unknown): string | undefined {
  const value = String(raw ?? '').replace(/^[\s:：\-—|\t]+/, '').replace(/[\s\t]+$/, '').replace(/^["'「『]+|["'」』]+$/g, '').trim()
  if (!value || value.length > 64) return undefined
  if (/^(未知|未提供|不详|待补充|待定|无|-|—|\/)$/.test(value)) return undefined
  if (/^https?:\/\//i.test(value)) return undefined
  return value
}

/** 脚本 / JSON 键值对提取：外部平台常把产品数据放在页面脚本里（如 goodsName:"xxx"），页面上看不到。 */
export function extractScriptKeys(html: string): Partial<Record<LooseField, string>> {
  const out: Partial<Record<LooseField, string>> = {}
  const index = new Map<string, LooseField>()
  for (const group of FIELD_ALIASES) {
    for (const key of group.keys) {
      const k = normalizeLabel(key)
      if (!index.has(k)) index.set(k, group.field)
    }
  }
  const keyRe = /["']?([A-Za-z_][A-Za-z0-9_]{1,40})["']?\s*[:=]\s*["']([^"'\n]{1,80})["']/g
  for (const m of html.matchAll(keyRe)) {
    const field = index.get(normalizeLabel(m[1] || ''))
    if (!field || out[field] !== undefined) continue
    const value = cleanLooseValue(m[2])
    if (value) out[field] = value
  }
  return out
}

// 只取明确的日期字段，绝不拿保质期、核准日期补生产日期。
export function actualDate(s?: string): string | undefined {
  const m = s?.trim().match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/)
  if (!m) return undefined
  const value = `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`
  const date = new Date(value + 'T00:00:00Z')
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined
}
export function parseSourceDocument(html: string, sourceUrl: string, code: string): SourceDeclaration {
  const input = String(html || '')
  // 纯文本（手工粘贴、无标签）⇒ 行结构是用户自己敲的，四种分隔（冒号 / Tab / 2+空格 / 换行）全认 ——
  //   这是合并前后台核验页的原生用法，其失败提示原文即承诺「用冒号、Tab 或换行分隔」。
  // 含标签 ⇒ 行结构由块级标签产生，只认「标签：值」与「标签→Tab→值」，
  //   与公众端 /api/trace 外页快照路径**逐字节一致**（该路径只会拿到抓取来的 HTML）。
  const plain = !/<[a-zA-Z!/][^>]*>/.test(input)
  const text = sourceText(input)
  const lines = text.split(/\r?\n/)
  const pairs: [string, string][] = []
  const splitRow = (row: string) => (plain ? row.split(/\t| {2,}/) : row.split('\t')).map(s => s.trim()).filter(Boolean)
  for (let r = 0; r < lines.length; r++) {
    const cells = splitRow(lines[r]!)
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]!
      const inline = cell.match(/^([^：:]{1,30})[：:]\s*(.+)$/)
      if (inline) { pairs.push([labelKey(inline[1]!), inline[2]!.trim().slice(0, 500)]); continue }
      if (cells[i + 1]) { pairs.push([labelKey(cell), cells[++i]!.slice(0, 500)]); continue }
      // 兜底③「标签与值分行」：本行本身是已知标签时，取下方 1–2 行内首个非空行当值；
      // 下一行若本身是「标签：值」或纯标签则不给值（避免 productName 被写成「规格」这类串行）。
      // 🔴 2026-09-27 起**不再限于纯文本**（原写作 `plain && …`）：含标签页面里形如
      //    `<td><div>品种名称：</div></td><td><div>亨达美田</div></td>` 的结构，
      //    `sourceText()` 的 `</td>`→Tab 与 `</div>`→换行会把「标签：」与「值」拆到**两行**、
      //    每行只剩一格 ⇒ 同行「标签：值」与相邻单元格这两条路都不成立 ⇒ 整页字段全丢，
      //    最终被三空判据误判成「页面靠脚本加载（空壳）」（实例 cx.jilinhengda.com，见 39 号）。
      if (KNOWN_LABELS.has(normalizeLabel(cell))) {
        for (let j = r + 1; j <= r + 2 && j < lines.length; j++) {
          const nextRow = lines[j]!.trim()
          if (!nextRow) continue
          if (/[：:]/.test(nextRow) || KNOWN_LABELS.has(normalizeLabel(nextRow))) break
          // 只取该行的**第一个单元格**：含标签页面里下一行往往还带 Tab 分格，
          // 整行当值会把同一行的其它字段一并吞进来。
          const next = nextRow.split('\t').map(s => s.trim()).filter(Boolean)[0]
          if (!next || KNOWN_LABELS.has(normalizeLabel(next))) break
          pairs.push([labelKey(cell), next.slice(0, 500)])
          break
        }
      }
    }
  }
  const get = (...labels: string[]) => {
    for (const label of labels) {
      const value = pairs.find(([k]) => k === labelKey(label))?.[1]
      if (value && !/^[-—/无]+$/.test(value)) return value
    }
  }
  // 兜底层①：同义词表按「宽松归一后的标签」匹配别名（补精确匹配漏掉的写法，如「商品名称」「品名」）
  const looseLabels = pairs.map(([k]) => normalizeLabel(k))
  const looseField = (field: LooseField): string | undefined => {
    for (const group of FIELD_ALIASES) {
      if (group.field !== field) continue
      for (const label of group.labels) {
        const i = looseLabels.indexOf(normalizeLabel(label))
        const value = i >= 0 ? pairs[i]?.[1] : undefined
        if (value && !/^[-—/无]+$/.test(value)) return value
      }
    }
  }
  // 兜底层②：脚本 / JSON 键值对（数据只存在于页面脚本、可见文本里没有时）
  const scriptKeys = extractScriptKeys(html)
  // 三层取值：精确标签 → 同义词别名 → 脚本键；任一层拿到即止。精确层命中时结果与合并前完全一致。
  const pick = (field: LooseField, ...labels: string[]): string | undefined =>
    get(...labels) ?? looseField(field) ?? scriptKeys[field]
  const source: SourceDeclaration = {
    sourceUrl, platform: new URL(sourceUrl).hostname, code,
    pageCode: get('单元识别码', '单元识别代码', '追溯码'),
    productName: pick('productName', '产品名称', '农药名称'), commodityName: pick('commodityName', '品种名称'), registrationNo: pick('registrationNo', '农药登记证号', '登记证号'),
    holderName: pick('holderName', '登记证持有人', '登记证持有人名称'), manufacturer: get('生产企业', '生产企业名称', '生产厂家'),
    formulation: pick('formulation', '剂型'), toxicity: pick('toxicity', '毒性', '毒性及其标识'), content: get('总有效成分含量', '总含量'),
    ingredients: get('有效成分及其含量', '有效成分及含量', '有效成分'),
    produceDate: actualDate(pick('produceDate', '生产日期')), batchNo: pick('batchNo', '生产批号', '生产批次'),
    shelfLife: get('质量保证期', '保质期'), productExpiry: pick('expireDate', '有效期至', '产品有效期至'),
    spec: pick('spec', '规格', '产品规格'),
    productFields: [], originals: [],
  }
  // ddspp 将全部成分放在标题后的独立段落，限定到下一个业务标题，避免吞入说明书。
  if (!source.ingredients) {
    const section = text.match(/有效成分及(?:其)?含量[：:]\s*([\s\S]*?)(?=使用范围|使用方法|使用技术|产品性能|注意事项|$)/)?.[1]
    const value = section?.replace(/\s+/g, ' ').trim()
    if (value && value.length <= 500) source.ingredients = value
  }
  const combined = text.match(/生产日期及批号[：:]\s*([^\n\t]+)/)?.[1]?.trim()
  source.productionNote = combined || (!source.produceDate ? get('生产日期') : undefined)
  if (combined && source.shelfLife?.includes('生产日期')) source.shelfLife = source.shelfLife.split('生产日期')[0]!.trim()
  // 以原药名称/重复字段为组边界；不按三个独立数组下标拼装，缺字段时不会串组。
  let original: SourceDeclaration['originals'][number] | undefined
  const push = () => { if (original) source.originals.push(original); original = undefined }
  for (const [key, value] of pairs) {
    const field = /^(原药名称|原药母药名称)$/.test(key) ? 'ingredient' : /^(原药证件号|原药登记证号|原药母药登记证号)$/.test(key) ? 'regNo' : /^(原药厂家名称|原药生产企业名称)$/.test(key) ? 'company' : undefined
    if (!field) { push(); continue }
    if (original && (field === 'ingredient' || original[field])) push()
    original ||= { regNo: '', company: '' }
    original[field] = value
  }
  push()
  for (const [label, value] of [
    ['产品名称', source.productName], ['商品名称', source.commodityName], ['农药登记证号', source.registrationNo], ['登记证持有人', source.holderName],
    ['生产企业', source.manufacturer], ['剂型', source.formulation], ['毒性', source.toxicity],
    ['总有效成分含量', source.content], ['有效成分及含量', source.ingredients], ['净含量', pick('netContent', '净含量')],
    ['规格', source.spec ?? pick('spec', '规格', '产品规格')], ['执行标准', pick('executionStandard', '执行标准')], ['生产许可证', pick('productionLicense', '生产许可证', '农药生产许可证')],
  ]) if (value) source.productFields.push({ label: label!, value })
  return source
}
