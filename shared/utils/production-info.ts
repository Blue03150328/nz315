import { isInputDate } from './input-date'

/** 北京时间自然日，避免凌晨仍按昨天判断有效期。 */
export function chinaDate(now = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function productionDate(value: unknown): string {
  const date = String(value ?? '').slice(0, 10)
  return isInputDate(date) ? date : ''
}

/** 展示和异常判断必须使用同一份最终生效的生产信息。 */
export function effectiveProduction(code: Record<string, any>, batch: Record<string, any>) {
  return {
    batchNo: batch.batch_no,
    produceDate: productionDate(code.produce_date) || productionDate(batch.produce_date),
    expireDate: productionDate(code.expire_date) || productionDate(batch.expire_date),
    qcResult: Number(code.qc_result ?? batch.qc_result) === 1 ? '合格' : '不合格',
    qualityCertNo: code.quality_cert_no || batch.quality_cert_no || '',
    qcReportNo: batch.qc_report_no || '',
  }
}

export function isExpired(date: unknown, today = chinaDate()): boolean {
  const normalized = productionDate(date)
  return !!normalized && normalized < today
}
