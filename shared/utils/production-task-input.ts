import { isInputDate } from './input-date'
import { productionAllocationInput } from './production-allocation-input'
export function productionTaskMetadata(body: Record<string, any>) {
  const productId = Number(body.productId)
  const name = String(body.name || '').trim()
  const lineName = body.lineName === undefined ? name : String(body.lineName || '').trim()
  const batchNo = String(body.batchNo || '').trim()
  const qualityCertNo = String(body.qualityCertNo || '').trim()
  const produceDate = String(body.produceDate || '')
  const expireDate = String(body.expireDate || '')
  if (!Number.isSafeInteger(productId) || productId <= 0) throw new Error('请选择产品')
  if (!name || name.length > 100 || !batchNo || batchNo.length > 64 || !qualityCertNo || qualityCertNo.length > 100) throw new Error('任务名称、批号、合格证号必填且不能超长')
  if (!lineName || lineName.length > 100) throw new Error('请填写100字以内的生产线名称')
  if (!isInputDate(produceDate) || !isInputDate(expireDate) || expireDate < produceDate) throw new Error('生产日期和有效期至必须有效，且有效期不能早于生产日期')
  if (body.qcResult !== 1) throw new Error('质检结果必须明确为合格才能开始生产')
  return { productId, name, lineName, batchNo, qualityCertNo, produceDate, expireDate, qcResult: 1 }
}
export function productionRequestId(body: Record<string, any>) {
  const requestId = String(body.requestId || '')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) throw new Error('任务提交标识无效，请刷新后重试')
  return requestId
}
export function productionTaskInput(body: Record<string, any>) {
  return { ...productionTaskMetadata(body), requestId: productionRequestId(body), ...productionAllocationInput(body) }
}
