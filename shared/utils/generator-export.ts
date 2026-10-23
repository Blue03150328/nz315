/** 分文件仅切分当前批次中的连续码，不重新生成，也不补齐或丢弃码。 */
export const MAX_EXPORT_FILES = 1000
export type GeneratorExportFormat = 'txt' | 'urls' | 'csv'

export function planGeneratorExport(available: number, fileCount: number, codesPerFile: number) {
  if (!Number.isSafeInteger(fileCount) || fileCount < 1 || fileCount > MAX_EXPORT_FILES) {
    throw new Error(`文件数量须为 1-${MAX_EXPORT_FILES} 的整数`)
  }
  if (!Number.isSafeInteger(codesPerFile) || codesPerFile < 1) {
    throw new Error('每个文件的追溯码数量须为正整数')
  }
  const total = fileCount * codesPerFile
  if (!Number.isSafeInteger(total) || total > available) {
    throw new Error(`需要 ${total.toLocaleString()} 条码，当前可导出 ${available.toLocaleString()} 条，请调整文件数量或每文件码数`)
  }
  return { fileCount, codesPerFile, total, remaining: available - total }
}

export function generatorExportText(codes: string[], format: GeneratorExportFormat, context: {
  traceBaseUrl: string
  product: { name?: string; registrationNo?: string; specCode?: string }
  companyName?: string
  generatedAt: string
}) {
  if (format === 'txt') return '\uFEFF' + codes.join('\n')
  if (format === 'urls') return '\uFEFF' + codes.map(code => context.traceBaseUrl + code).join('\n')
  const quote = (value: unknown) => '"' + String(value ?? '').replace(/"/g, '""') + '"'
  const produceTypes: Record<string, string> = { '1': '持有人生产', '2': '委托加工', '3': '委托分装' }
  const { product } = context
  const lines = ['sn,农药名称,登记证号,生产企业,生产类型,规格码,生成时间,绑定状态,登记类别,登记证后6位,自定义段']
  for (const code of codes) {
    lines.push([
      code, quote(product.name), quote(product.registrationNo), quote(context.companyName),
      quote(produceTypes[code.charAt(7)] || code.charAt(7)), quote(product.specCode), quote(context.generatedAt),
      '未绑定', code.slice(0, 1), code.slice(1, 7), code.slice(11, 32),
    ].join(','))
  }
  return '\uFEFF' + lines.join('\r\n')
}
