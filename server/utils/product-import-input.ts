import XLSX from 'xlsx'
import { PRODUCT_IMPORT_HEADERS, PRODUCT_IMPORT_REQUIRED_HEADERS, PRODUCT_TRADEMARK_HEADERS, PRODUCT_IMPORT_MAX_ROWS, PRODUCT_PRODUCE_TYPES, type ProductImportRow } from '#shared/utils/product-import'
import { parseProductOriginals } from './product-originals'
import { formatProductName } from '#shared/utils/product-name'
import { regCategoryOf } from './regdata'

const bad = (statusMessage: string): never => { throw createError({ statusCode: 400, statusMessage }) }

export function readProductImport(data: Buffer): ProductImportRow[] {
  let sheet: ReturnType<typeof XLSX.read>['Sheets'][string]
  try {
    const book = XLSX.read(data, { type: 'buffer', sheetRows: PRODUCT_IMPORT_MAX_ROWS + 2 })
    sheet = book.Sheets[book.SheetNames[0]!]!
    if (!sheet) return bad('Excel 中没有工作表')
  } catch { return bad('Excel 文件解析失败，请确认文件未损坏') }
  const range = XLSX.utils.decode_range(String(sheet['!fullref'] || sheet['!ref'] || 'A1'))
  if (range.e.r > PRODUCT_IMPORT_MAX_ROWS) return bad(`单次最多导入${PRODUCT_IMPORT_MAX_ROWS}行，请删除多余行或拆分文件`)
  if (range.e.c >= PRODUCT_IMPORT_HEADERS.length) return bad('Excel 超出七列模板范围，原药最多填写3种，请下载新版模板')
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '', raw: false, blankrows: true, range: 0 })
  const headers = (rows[0] || []).map(value => {
    const name = String(value).trim().replace(/^\uFEFF/, '')
    return Object.hasOwn(PRODUCT_TRADEMARK_HEADERS, name) ? PRODUCT_TRADEMARK_HEADERS[name]! : name
  })
  const missing = PRODUCT_IMPORT_REQUIRED_HEADERS.filter(name => !headers.includes(name))
  if (missing.length) return bad('表头缺少「' + missing.join('、') + '」，请使用七列产品导入模板')
  const used = headers.filter(Boolean)
  if (new Set(used).size !== used.length) return bad('Excel 表头存在重复列名（产标名、产品商标和商标为同一字段）')
  const unknown = used.filter(name => !PRODUCT_IMPORT_HEADERS.includes(name))
  if (unknown.length) return bad('无法识别列：' + unknown.join('、') + '；请使用七列模板，原药最多3种')
  for (let c = 0; c <= range.e.c; c++) if ((sheet[XLSX.utils.encode_cell({ r: 0, c })] as { f?: string } | undefined)?.f) return bad('表头包含公式，请粘贴为值后导入')
  const result: ProductImportRow[] = []
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i] || []
    const values: Record<string, string> = {}
    for (let c = 0; c < Math.max(headers.length, cells.length); c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: i, c })] as { f?: string; t?: string; v?: unknown } | undefined
      if (cell?.f) return bad(`第${i + 1}行包含公式，请粘贴为值后导入`)
      // 代码读取真实数值，防止显示格式把1.5取整为2后误关联规格。
      const value = String(cell?.t === 'n' ? cell.v : cells[c] ?? '').trim()
      if (!headers[c] && value) return bad(`第${i + 1}行有数据列缺少表头`)
      if (headers[c]) values[headers[c]!] = value
    }
    if (!Object.values(values).some(Boolean)) continue
    result.push({ row: i + 1, values })
  }
  if (!result.length) return bad('Excel 中没有产品数据，请从第2行开始填写')
  return result
}

function limited(value: unknown, label: string, max: number, required = false) {
  const text = String(value ?? '').trim()
  if (required && !text) return bad('请填写' + label)
  if (text.length > max) return bad(`${label}不能超过${max}字`)
  return text
}

export function normalizeProductSpecCode(value: unknown) {
  const code = String(value ?? '').trim()
  if (!/^\d{1,3}$/.test(code) || Number(code) < 1) return bad('规格代码须为001～999，可填写1表示001；请先在本企业规格库建档')
  return code.padStart(3, '0')
}

export function productImportToday(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

function registryExpiry(reg: any, label: string, today: string) {
  const expiry = reg.expire_date ? String(reg.expire_date).slice(0, 10) : ''
  if (expiry && (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || !Number.isFinite(Date.parse(expiry)) || new Date(expiry).toISOString().slice(0, 10) !== expiry || expiry < '1000-01-01')) return bad(label + '的登记库有效期无效，请先核实登记资料')
  if (expiry && expiry < today) return bad(label + '已过期（' + expiry + '），请核实或更新登记资料后重试')
  return expiry || null
}

function ingredientsOf(reg: any): string[] {
  const values = Array.isArray(reg.ingredient_all) && reg.ingredient_all.length ? reg.ingredient_all : [reg.ingredient_main]
  return [...new Set<string>(values.map((value: unknown) => String(value ?? '').replace(/\s/g, '')).filter(Boolean))]
}

/** 原药企业和有效成分来自厂家填写的精确证号，不按成分猜供应商。 */
export function prepareImportedProduct(values: Record<string, string>, registry: any, spec: any, registryMap: Map<string, any>, today = productImportToday()) {
  const registrationNo = limited(values['登记证号'], '登记证号', 32, true).toUpperCase()
  if (!registry) return bad('产品登记证号「' + registrationNo + '」未被登记资料库收录，请先核实或补录资料')
  const produceText = limited(values['生产类型'], '生产类型', 20, true)
  const produceType = PRODUCT_PRODUCE_TYPES.indexOf(produceText) + 1 || (/^[123]$/.test(produceText) ? Number(produceText) : 0)
  if (!produceType) return bad('生产类型请填写持有人生产、委托加工、委托分装或1、2、3')
  const registrationExpire = registryExpiry(registry, '产品登记证「' + registrationNo + '」', today)
  const originalNos = [1, 2, 3].map(i => limited(values[`原药登记证号${i}`], `原药登记证号${i}`, 40, i === 1).toUpperCase()).filter(Boolean)
  if (new Set(originalNos).size !== originalNos.length) return bad('同一产品的原药登记证号不能重复填写')
  const productIngredients = ingredientsOf(registry)
  const covered = new Set<string>()
  const warnings: string[] = []
  if (!registrationExpire) warnings.push('产品登记库未提供有效期，请核实')
  const originals = parseProductOriginals(originalNos.map(regNo => {
    const reg = registryMap.get(regNo)
    if (!reg) return bad('原药登记证号「' + regNo + '」未被登记资料库收录，请先核实或补录资料')
    if (!['原药', '母药'].includes(String(reg.dosage || '').trim())) return bad('登记证「' + regNo + '」对应的剂型不是原药或母药')
    if (!registryExpiry(reg, '原药登记证「' + regNo + '」', today)) warnings.push('原药登记证「' + regNo + '」未提供有效期，请核实')
    const originalIngredients = ingredientsOf(reg)
    if (!originalIngredients.length) return bad('原药登记证「' + regNo + '」缺少有效成分，无法自动补齐，请先完善登记资料')
    if (productIngredients.length && originalIngredients.some(name => !productIngredients.includes(name))) return bad('原药登记证「' + regNo + '」的有效成分与产品不匹配')
    originalIngredients.forEach(name => covered.add(name))
    return { regNo, company: limited(reg.company, '原药「' + regNo + '」登记企业', 255, true), ingredient: originalIngredients.join('、') }
  }))
  const missing = productIngredients.filter(name => !covered.has(name))
  if (missing.length) warnings.push('尚未填写以下成分的原药来源：' + missing.join('、') + '，请核对补全')
  if (!productIngredients.length) warnings.push('产品登记库缺少有效成分，未能核对原药成分，请核实')
  const trademark = limited(values['产标名'], '产标名（产品商标）', 100)
  const dosage = limited(registry.dosage, '登记库剂型', 50)
  const content = limited(registry.content, '登记库总含量', 50)
  const name = limited(formatProductName({ name: registry.product_name, trademark, dosage, content, spec }), '产品名称', 255, true)
  const category = limited(registry.category, '登记库产品类别', 50, true)
  const toxicity = limited(registry.toxicity, '登记库毒性', 20)
  const holderName = limited(registry.company, '登记持有人', 255, true)
  return { registrationNo, originals, trademark, name, category, dosage, content, toxicity, holderName, registrationExpire, produceType, isRestricted: 0, status: 1, regCategory: regCategoryOf(registrationNo), warnings }
}
