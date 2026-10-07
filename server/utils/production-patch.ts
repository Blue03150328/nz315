import { isInputDate } from '../../shared/utils/input-date'

/** 空白保持原值；仅返回本次明确填写并通过校验的字段。 */
export function productionPatch(body: Record<string, any>): Record<string, string | number> {
  const patch: Record<string, string | number> = {}
  for (const [key, column, label] of [['produceDate', 'produce_date', '生产日期'], ['expireDate', 'expire_date', '有效期至']] as const) {
    if (body[key] === undefined || body[key] === null || body[key] === '') continue
    if (typeof body[key] !== 'string' || !isInputDate(body[key])) throw new Error(label + '请输入有效日期，格式为 YYYY-MM-DD')
    patch[column] = body[key]
  }
  if (body.qcResult !== undefined && body.qcResult !== null && body.qcResult !== '') {
    if (![0, 1, '0', '1'].includes(body.qcResult)) throw new Error('质检结果只能为合格或不合格')
    patch.qc_result = Number(body.qcResult)
  }
  const cert = String(body.qualityCertNo ?? '').trim()
  if (cert) {
    if (cert.length > 100) throw new Error('质量合格证号不能超过100字')
    patch.quality_cert_no = cert
  }
  return patch
}
