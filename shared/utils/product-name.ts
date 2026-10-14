import { formatSpecification, parseSpecification } from './specification'

const text = (value: unknown) => String(value ?? '').trim()

/** 单剂与复配均保留完整登记名称，只补齐缺少的总含量、剂型、商标和规格。 */
export function formatProductName(input: { name: unknown; content?: unknown; dosage?: unknown; trademark?: unknown; spec?: any }) {
  let name = text(input.name)
  if (!name) return ''
  const content = text(input.content), dosage = text(input.dosage)
  const trademark = text(input.trademark).replace(/^[（(]|[）)]$/g, '')
  if (content && !name.startsWith(content)) name = content + name
  if (dosage && !name.endsWith(dosage)) name += dosage
  const spec = input.spec ? formatSpecification(input.spec.net_content, input.spec.content_unit, input.spec.pack_unit, input.spec.pack_quantity ?? 1) || text(input.spec.spec_name) : ''
  return (trademark ? `（${trademark}）` : '') + name + (spec ? ' ' + spec : '')
}

/** 下拉选项避免重复展示已包含在产品名中的规格；旧产品仍附上规格。 */
export function productWithSpec(product: any) {
  const name = text(product.name), originalSpec = text(product.spec_name)
  const spec = parseSpecification(originalSpec)?.name || originalSpec
  return spec && !name.endsWith(spec) && !name.endsWith(originalSpec) ? `${name} · ${spec}` : name || '产品未填写'
}
