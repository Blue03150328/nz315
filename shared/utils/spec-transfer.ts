import { parseSpecification } from './specification'

export const SPEC_TEMPLATE_HEADERS = ['规格']
export const SPEC_IMPORT_HEADERS = ['规格名称', '净含量', '含量单位', '包装单位', '数量']
export const SPEC_EXPORT_HEADERS = SPEC_TEMPLATE_HEADERS
export const SPEC_DETAIL_HEADERS = [...SPEC_IMPORT_HEADERS, '规格码', '状态', '归属企业']

/** 标准规格格式：500克×20瓶，数量优先取数据库实际字段。 */
export function specExportValues(row: any): string[] {
  const base = parseSpecification(`${row.net_content ?? ''}${row.content_unit ?? ''}/${row.pack_unit ?? ''}`)
    || parseSpecification(String(row.spec_name ?? ''))
  if (!base) return ['']
  const quantity = row.pack_quantity ?? base.quantity
  const parsed = parseSpecification(`${base.net}${base.unit}/${base.pack}x${quantity}`)
  return [parsed?.name || '']
}

/** 详情保留原名称、数量、规格码、状态和企业，供核对；不改写数据库。 */
export function specDetailValues(row: any) {
  return [String(row.spec_name ?? ''), row.net_content == null ? null : Number(row.net_content),
    String(row.content_unit ?? ''), String(row.pack_unit ?? ''), Number(row.pack_quantity ?? 1),
    String(row.spec_code ?? ''), Number(row.status) === 1 ? '启用' : '停用', String(row.enterprise_name ?? '')]
}
