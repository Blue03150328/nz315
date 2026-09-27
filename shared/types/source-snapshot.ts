// 外页声明、登记比对与历史快照分开保存，禁止把候选原药当作实际来源。
export interface SourceDeclaration {
  sourceUrl: string
  platform: string
  code: string
  pageCode?: string
  productName?: string
  /** 商品名 / 品种名（来源页常写作「品种名称」）。**只作展示**：它通常不是登记库里的农药名称，
   *  一旦并入 `productName` 参与「产品名称」一致性比对，正规药会被误报成「与登记资料不一致」。
   *  （2026-09-27 新增，实例 cx.jilinhengda.com 写「亨达美田」，见 39 号） */
  commodityName?: string
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
  /** 失败原因分类：把「打不开页面」与「页面读不出内容」分开，好给消费者不同指引（旧快照无此字段） */
  issue?: SourceIssue
  /** 失败的技术原因原文，仅供后台排查，不面向消费者展示 */
  detail?: string
  /** 来源网址：抓取或解析失败时仍提供原页入口。 */
  sourceUrl?: string
  /** 来源平台域名，用于原页链接文案。 */
  platform?: string
  source?: SourceDeclaration
  comparisons: SourceComparison[]
  saved: boolean
}

/**
 * 外页取数失败的原因分类（仅影响文案，不影响任何判定与预警）。
 * - blocked-address：网址不可访问（SSRF 拦截、非 http(s)、跳转过多）
 * - empty-shell：抓到了页面但读不到内容（JS 空壳）
 * - code-mismatch：来源页声明的码与本次查询不一致
 * - busy：并发闸门满
 * - unreachable：其余（超时、非 200、非网页、超大小等）
 */
export type SourceIssue = 'blocked-address' | 'empty-shell' | 'code-mismatch' | 'busy' | 'unreachable'
