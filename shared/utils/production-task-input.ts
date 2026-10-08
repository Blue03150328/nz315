import { isInputDate } from './input-date'
export function productionTaskInput(body: Record<string, any>) {
  const productId = Number(body.productId)
  const name = String(body.name || '').trim()
  const batchNo = String(body.batchNo || '').trim()
  const qualityCertNo = String(body.qualityCertNo || '').trim()
  const produceDate = String(body.produceDate || '')
  const expireDate = String(body.expireDate || '')
  const requestId = String(body.requestId || '')
  if (!Number.isSafeInteger(productId) || productId <= 0) throw new Error('请选择产品')
  if (!name || name.length > 100 || !batchNo || batchNo.length > 64 || !qualityCertNo || qualityCertNo.length > 100) throw new Error('任务名称、批号、合格证号必填且不能超长')
  if (!isInputDate(produceDate) || !isInputDate(expireDate) || expireDate < produceDate) throw new Error('生产日期和有效期至必须有效，且有效期不能早于生产日期')
  if (body.qcResult !== 1) throw new Error('质检结果必须明确为合格才能开始生产')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) throw new Error('任务提交标识无效，请刷新后重试')
  const codes = [...new Set((Array.isArray(body.codes) ? body.codes : String(body.content || '').split(/\r?\n/)).map((v: unknown) => String(v).trim()).filter(Boolean))].sort() as string[]
  if (!codes.length || codes.length > 10000 || codes.some(c => !/^\d{32}$/.test(c))) throw new Error('请提供1至10000个具体的32位追溯码，不能仅填写数量')
  return { productId, name, batchNo, qualityCertNo, produceDate, expireDate, qcResult: 1, requestId, codes }
}
