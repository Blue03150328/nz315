import type { TraceBatch } from '../types/trace'

/** 仅对已有生产记录的公众扫码资料补默认值，不代替后台质检审核或写回数据库。 */
export function traceQualityDefaults(batch: TraceBatch): TraceBatch {
  const failed = batch.qualityStatus === 'failed' || batch.qcResult === '不合格'
  return {
    ...batch,
    qcResult: failed ? '不合格' : batch.qcResult?.trim() || '合格',
    qualityCertNo: batch.qualityCertNo?.trim() || '见质量合格检测证卡片',
    qualityStatus: failed ? 'failed' : undefined,
  }
}
