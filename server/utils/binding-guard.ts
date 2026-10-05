import { isInputDate } from '../../shared/utils/input-date'

/** 正常码才可修正；恢复和作废仍由异常管理入口处理。 */
export function assertCodesCorrectable(codes: Record<string, any>[]): void {
  if (codes.some(c => Number(c.abnormal_flag) === 2)) throw createError({ statusCode: 400, statusMessage: '所选码包含已作废码（终态），不可修改或绑定' })
  if (codes.some(c => Number(c.abnormal_flag) !== 0)) throw createError({ statusCode: 400, statusMessage: '所选码包含冻结码，请先恢复正常再修改或绑定' })
}

/** 登记证过期允许绑定，扫码负责提示；租户、产品、质检和三要素必须真实满足。 */
export function assertBindingAllowed(batch: Record<string, any>, productId: number, enterpriseId: number): void {
  if (Number(batch.product_id) !== productId || Number(batch.enterprise_id) !== enterpriseId) throw createError({ statusCode: 400, statusMessage: '所选批次不属于当前产品或企业' })
  if (batch.qc_result === null || batch.qc_result === undefined || Number(batch.qc_result) !== 1) throw createError({ statusCode: 400, statusMessage: '批次质检不合格或结果未确认，不可绑定，请先在生产批次页处理' })
  if (!String(batch.batch_no ?? '').trim() || !isInputDate(String(batch.produce_date ?? '').slice(0, 10)) || !String(batch.quality_cert_no ?? '').trim()) throw createError({ statusCode: 400, statusMessage: '生产批号、生产日期、质量合格证号须完整后才能绑定' })
}
