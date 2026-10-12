import type { ExternalCollectionEvent } from '../types/external-collection'

export const EXTERNAL_CODE_MAX_BYTES = 8192
export const EXTERNAL_EVENT_LIMIT = 20
export const EXTERNAL_SEQUENCE_MAX = 10000000

export function externalCollectionId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error('采集标识无效，请恢复原采集记录')
  return value.toLowerCase()
}

export function externalSequence(value: unknown, allowZero = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > EXTERNAL_SEQUENCE_MAX) throw new Error('采集序号无效')
  return value
}

/** 原文不裁剪、不拆参数、不补前缀；只拒绝无法逐行导出的内容。 */
export function externalRawCode(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('溯源码不能为空')
  if (/[\r\n\0]/.test(value)) throw new Error('溯源码不能包含换行或空字符')
  if (!value.isWellFormed()) throw new Error('溯源码包含无效字符')
  if (new TextEncoder().encode(value).byteLength > EXTERNAL_CODE_MAX_BYTES) throw new Error('溯源码不能超过8192字节')
  return value
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\r\n\0]/.test(value)) throw new Error(label + '请填写1至' + max + '字，不能包含换行')
  return value.trim()
}

export function externalStartInput(body: Record<string, unknown>) {
  return { batchId: externalCollectionId(body.batchId), workerNo: text(body.workerNo, '工号', 64), lineName: body.lineName === undefined ? undefined : text(body.lineName, '生产线', 100) }
}

/** 日期必须是UTC格式；以原字符串参与收据签名，重试不得改变采集时间。 */
export function externalEventInput(value: Record<string, unknown>): ExternalCollectionEvent {
  const eventId = externalCollectionId(value.eventId), sequence = externalSequence(value.sequence)
  const capturedAt = value.capturedAt
  if (typeof capturedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(capturedAt) || !Number.isFinite(Date.parse(capturedAt)) || new Date(capturedAt).toISOString().slice(0, 19) !== capturedAt.slice(0, 19)) throw new Error('采集时间必须为有效UTC时间')
  // 非法码仍须留下拒绝收据，原文字段的类型和大小在签名前校验。
  if (typeof value.rawCode !== 'string' || !value.rawCode.isWellFormed()) throw new Error('溯源码字段无效')
  return { eventId, sequence, rawCode: value.rawCode, capturedAt }
}

export function externalMetadataInput(body: Record<string, unknown>) {
  let productId: number | null = null
  if (body.productId !== null && body.productId !== undefined) {
    if (typeof body.productId !== 'number' || !Number.isSafeInteger(body.productId) || body.productId <= 0) throw new Error('请选择有效产品')
    productId = body.productId
  }
  const productName = productId ? '' : text(body.productName, '产品名称', 200)
  const batchNo = text(body.batchNo, '生产批号', 100)
  const produceDate = body.produceDate
  if (typeof produceDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(produceDate) || !Number.isFinite(Date.parse(produceDate + 'T00:00:00Z')) || new Date(produceDate + 'T00:00:00Z').toISOString().slice(0, 10) !== produceDate || produceDate < '1000-01-01') throw new Error('请填写有效生产日期')
  const quantity = body.productionQuantity
  if (quantity !== null && quantity !== undefined && (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 2147483647)) throw new Error('生产数量必须为1至2147483647的整数')
  return { productId, productName, batchNo, produceDate, productionQuantity: quantity === undefined || quantity === null ? null : quantity }
}

/** CSV按标准引用原值，避免网址逗号、引号改变列数；不改写原文。 */
export function externalCsvRow(rawCode: string): string {
  return '"' + rawCode.replace(/"/g, '""') + '"\r\n'
}
