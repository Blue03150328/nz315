// JSON 内只保留明确覆盖的字段；属性不存在表示跟随公共批次，null 表示明确清空。
export const productionFields = ['produceDate', 'expireDate', 'qualityCertNo', 'qcResult'] as const
export type ProductionField = typeof productionFields[number]
export function jsonValue(value: any): any {
  return typeof value === 'string' ? JSON.parse(value) : value
}
export function publicProduction(batch: any) {
  return { produceDate: batch.produce_date || null, expireDate: batch.expire_date || null,
    qualityCertNo: batch.quality_cert_no || null, qcResult: batch.qc_result == null ? null : Number(batch.qc_result) }
}
export function codeOverrides(code: any, batch: any): Record<string, any> {
  if (code.production_override != null) return jsonValue(code.production_override)
  // 历史值无法区分复制与人工更正，保守保留原显示值，后续可显式恢复使用批次资料。
  return { produceDate: code.produce_date || batch.produce_date || null,
    expireDate: code.expire_date || batch.expire_date || null,
    qualityCertNo: code.quality_cert_no || batch.quality_cert_no || null,
    qcResult: code.qc_result ?? batch.qc_result ?? null }
}
export function effectiveProduction(code: any, batch: any) {
  const result = { ...publicProduction(batch), ...codeOverrides(code, batch) }
  // 公共批次不合格不能被码级合格覆盖。
  if (Number(batch.qc_result) === 0 && batch.qc_result != null) result.qcResult = 0
  return result
}
