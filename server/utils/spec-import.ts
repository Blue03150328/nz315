import XLSX from 'xlsx'
import { SPEC_DETAIL_HEADERS } from '#shared/utils/spec-transfer'
import { formatSpecification, parseSpecification, MAX_PACK_QUANTITY } from '#shared/utils/specification'
import { parseSpecInput } from './spec-input'

const MAX_ROWS = 5000
const aliases: Record<string, string> = { 规格: '规格名称', 名称: '规格名称', 包装数量: '数量' }
const bad = (statusMessage: string): never => { throw createError({ statusCode: 400, statusMessage }) }

export function parseSpecImportRow(values: Record<string, string>) {
  const raw = String(values['规格名称'] || '').trim()
  const quantityText = values['数量'] ?? ''
  const quantity = quantityText === '' ? undefined : Number(quantityText)
  if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_PACK_QUANTITY)) return bad('数量须为1～999999之间的整数')
  const parsedName = parseSpecification(raw)
  const hasParts = ['净含量', '含量单位', '包装单位'].some(key => values[key])
  let parsed
  if (hasParts) {
    parsed = parseSpecification(`${values['净含量'] || ''}${values['含量单位'] || ''}/${values['包装单位'] || ''}`)
    if (!parsed) return bad('净含量、含量单位和包装单位须完整填写，如500、毫升、瓶')
    parsed.quantity = quantity ?? parsedName?.quantity ?? 1
    parsed.name = formatSpecification(parsed.net, parsed.unit, parsed.pack, parsed.quantity)
    if (parsedName && (parsedName.net !== parsed.net || parsedName.unit !== parsed.unit || parsedName.pack !== parsed.pack || (/[×✖x*]/i.test(raw) && parsedName.quantity !== parsed.quantity))) return bad('规格名称与净含量、单位或数量不一致，请核对')
    // 自定义名称与手动新增相同：允许保留；标准名称按新格式统一。
    if (raw && !parsedName) parsed.name = raw
  } else {
    if (!parsedName) return bad('规格格式无法识别，请填写如500毫升×10瓶，或按新模板填写净含量、单位和数量')
    if (quantity !== undefined && /[×✖x*]/i.test(raw) && parsedName.quantity !== quantity) return bad('规格名称内数量与数量列不一致，请核对')
    parsed = { ...parsedName, quantity: quantity ?? parsedName.quantity }
    parsed.name = formatSpecification(parsed.net, parsed.unit, parsed.pack, parsed.quantity)
  }
  parseSpecInput({ specName: parsed.name, netContent: parsed.net, contentUnit: parsed.unit, packUnit: parsed.pack, packQuantity: parsed.quantity })
  const statusText = values['状态'] || ''
  if (!['', '启用', '停用', '1', '0'].includes(statusText)) return bad('状态须填写启用或停用')
  return { ...parsed, status: ['停用', '0'].includes(statusText) ? 0 : 1 }
}

export function readSpecImport(data: Buffer) {
  let sheet: ReturnType<typeof XLSX.read>['Sheets'][string]
  try {
    const wb = XLSX.read(data, { type: 'buffer', cellDates: false, sheetRows: MAX_ROWS + 2 })
    sheet = wb.Sheets[wb.SheetNames[0] ?? '']!
    if (!sheet) return bad('Excel 中没有工作表')
  } catch { return bad('Excel 文件解析失败，请确认文件未损坏且为有效的工作簿') }
  const range = XLSX.utils.decode_range(String(sheet['!fullref'] || sheet['!ref'] || 'A1'))
  if (range.e.r > MAX_ROWS) return bad('单次最多5000行，请删除多余行或拆分文件')
  if (range.e.c >= SPEC_DETAIL_HEADERS.length) return bad('Excel 列超出模板范围，请使用规格导入模板')
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '', raw: false, blankrows: true, range: 0 })
  const first = (rows[0] || []).map(cell => String(cell).trim().replace(/^\uFEFF/, ''))
  const hasHeader = first.some(value => SPEC_DETAIL_HEADERS.includes(value) || Object.hasOwn(aliases, value))
  const headers = hasHeader ? first.map(value => Object.hasOwn(aliases, value) ? aliases[value]! : value) : ['规格名称']
  if (!hasHeader && range.e.c > 0) return bad('多列文件请保留模板表头')
  if (headers.filter(Boolean).some((value, index, all) => all.indexOf(value) !== index)) return bad('Excel 表头存在重复列名')
  const unknown = headers.filter(value => value && !SPEC_DETAIL_HEADERS.includes(value))
  if (unknown.length) return bad('无法识别列：' + unknown.join('、'))
  if (!headers.includes('规格名称') && !['净含量', '含量单位', '包装单位'].every(value => headers.includes(value))) return bad('请填写规格名称列，或保留净含量、含量单位和包装单位列')
  const errors: { row: number; value: string; reason: string }[] = []
  const okRows: (ReturnType<typeof parseSpecImportRow> & { row: number; raw: string })[] = []
  const seen = new Map<string, number>()
  let count = 0
  for (let i = hasHeader ? 1 : 0; i < rows.length; i++) {
    const cells = (rows[i] || []).map(value => String(value).trim())
    if (!cells.some(Boolean)) continue
    count++
    const values: Record<string, string> = {}
    for (let c = 0; c < Math.max(cells.length, headers.length); c++) {
      if (!headers[c] && cells[c]) return bad(`第${i + 1}行有数据列缺少表头`)
      const cell = sheet[XLSX.utils.encode_cell({ r: i, c })] as { f?: string; t?: string; v?: unknown } | undefined
      if (cell?.f) return bad(`第${i + 1}行包含公式，请粘贴为值后导入`)
      if (headers[c]) values[headers[c]!] = cells[c] || ''
      if (cell?.t === 'n' && ['净含量', '数量'].includes(headers[c] || '')) values[headers[c]!] = String(cell.v)
    }
    const raw = values['规格名称'] || [values['净含量'], values['含量单位'], values['包装单位'], values['数量']].filter(Boolean).join(' ')
    try {
      const parsed = parseSpecImportRow(values)
      if (seen.has(parsed.name)) {
        errors.push({ row: i + 1, value: raw, reason: `与文件中第${seen.get(parsed.name)}行规格重复` })
        continue
      }
      seen.set(parsed.name, i + 1)
      okRows.push({ ...parsed, row: i + 1, raw })
    } catch (e: any) {
      if (e?.statusCode !== 400) throw e
      errors.push({ row: i + 1, value: raw, reason: e.statusMessage })
    }
  }
  if (!count) return bad('Excel 中没有规格数据，请从表头下一行开始填写')
  return { errors, okRows }
}
