// 规格展示及导入口径：含量单位统一保存为中文，数量表示一组内的包装件数。
export const SPEC_UNITS = ['毫升', '升', '克', '千克', '片', '包', '粒']
export const SPEC_PACKS = ['瓶', '袋', '桶', '盒', '罐', '支', '箱']
export const SPEC_CODES = Array.from({ length: 999 }, (_, index) => String(index + 1).padStart(3, '0'))
export const MAX_PACK_QUANTITY = 999999

export function availableSpecCodes(usedCodes: Iterable<string>): string[] {
  const used = new Set(usedCodes)
  return SPEC_CODES.filter(code => !used.has(code))
}

export function formatSpecification(netContent: unknown, contentUnit: string, packUnit: string, packQuantity: unknown = 1): string {
  const net = Number(netContent)
  const quantity = Number(packQuantity)
  if (!Number.isFinite(net) || net <= 0 || !contentUnit || !packUnit || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_PACK_QUANTITY) return ''
  return `${net}${contentUnit}×${quantity}${packUnit}`
}

/** 兼容旧单件规格及新增成组规格；英文单位和乘号别名在导入时统一为中文及×。 */
export function parseSpecification(value: string) {
  const normalized = value.replace(/\s/g, '')
    .replace(/^(.+?)[×✖x*](\d+)(瓶|袋|桶|盒|罐|支|箱)$/i, '$1/$3×$2')
  const match = normalized.match(/^(\d{1,9}(?:\.\d{1,3})?)(毫升|升|千克|克|片|包|粒|ml|kg|g|l)\/(瓶|袋|桶|盒|罐|支|箱)(?:[×✖x*](\d+))?$/i)
  if (!match) return null
  const net = Number(match[1])
  const quantity = match[4] === undefined ? 1 : Number(match[4])
  if (net <= 0 || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_PACK_QUANTITY) return null
  const aliases: Record<string, string> = { ml: '毫升', l: '升', g: '克', kg: '千克' }
  const unit = aliases[match[2]!.toLowerCase()] || match[2]!
  const pack = match[3]!
  return { name: formatSpecification(net, unit, pack, quantity), net, unit, pack, quantity }
}
