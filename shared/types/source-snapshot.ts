// 外页声明、登记比对与历史快照分开保存，禁止把候选原药当作实际来源。
export interface SourceDeclaration {
  sourceUrl: string
  platform: string
  code: string
  pageCode?: string
  productName?: string
  registrationNo?: string
  holderName?: string
  manufacturer?: string
  formulation?: string
  toxicity?: string
  content?: string
  ingredients?: string
  /** 产品规格（2026-09-24 新增：后台外部核验页需单独展示「规格」，此前只存在于 productFields） */
  spec?: string
  produceDate?: string
  productionNote?: string
  batchNo?: string
  shelfLife?: string
  productExpiry?: string
  productFields: { label: string; value: string }[]
  originals: { ingredient?: string; regNo: string; company: string }[]
}
export interface SourceComparison {
  label: string
  status: 'match' | 'mismatch' | 'insufficient' | 'review'
  sourceValue: string
  referenceValue: string
  reason: string
}
export interface SourceSnapshot {
  id?: string
  fetchedAt: string
  parserVersion: string
  status: 'ok' | 'partial' | 'unavailable'
  message: string
  source?: SourceDeclaration
  comparisons: SourceComparison[]
  saved: boolean
}
