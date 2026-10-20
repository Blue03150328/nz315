import { PRODUCT_IMPORT_HEADERS } from './product-import'
import { productWithSpec } from './product-name'
import { specExportValues } from './spec-transfer'
export const PRODUCT_EXPORT_HEADERS = [...PRODUCT_IMPORT_HEADERS, '备注']
const PRODUCE_TYPES: Record<string, string> = { '1': '持有人生产', '2': '委托加工', '3': '委托分装' }

export function productExportValues(product: any, originals: string[]) {
  return [
    PRODUCE_TYPES[String(product.produce_type)] ?? String(product.produce_type ?? ''),
    String(product.registration_no ?? ''), String(product.trademark ?? ''), String(product.spec_code ?? ''),
    ...[0, 1, 2].map(index => String(originals[index] ?? '')),
    String(product.name ?? '').trim() || String(product.spec_name ?? '').trim()
      ? productWithSpec({ name: product.name, spec_name: specExportValues(product)[0] || product.spec_name }) : '',
  ]
}
