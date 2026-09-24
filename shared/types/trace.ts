// 扫码查询页（/trace?code=）结果类型，对齐 PRD 5.9 展示结构与 7.5 追溯码表
export type TraceResultType =
  | 'genuine'        // 正常（正品）
  | 'not-found'      // 查无此码（8类异常-2）
  | 'external-reg'   // 非本平台码，但登记资料库比对到候选登记证（2026-09-22 新增）
  | 'reg-expired'    // 登记证已过期（8类异常-4）
  | 'expired'        // 产品已过有效期
  | 'repeat'         // 重复查询（8类异常-1）
  | 'frozen'         // 已冻结（异常标记）
  | 'voided'         // 已作废（异常标记）
  | 'mismatch'       // 扫码信息与标签不符（8类异常-7）
                     // ⚠️ 当前 `trace.get.ts` **不产出**该值 —— 消费者反馈走 `POST /api/feedback`
                     //    → 落 `risk_alert(alert_type=7)`，**不经过结果页类型**。
                     //    保留类型是为对齐 PRD 8 类异常清单；**别据此在页面上写 `resultType === 'mismatch'` 的 `v-if` 门** ——
                     //    2026-09-23 的 N2 缺陷就是被这一行骗的（按钮门挂在这里 ⇒ 永远不显示）。

// 码状态（PRD 5.5.4 两状态模型）
export type CodeStatus = 'generated' | 'bound' | null

export interface TraceScanRecord {
  time: string
  province: string
  city: string
}

export interface TraceProduct {
  trademark?: string
  name: string
  registrationNo?: string
  holderName?: string      // 登记证持有人名称（1049 扫码必显）
  formulation?: string
  toxicity?: string
  spec?: string
  netContent?: string
  content?: string
  category?: string
  originals?: { ingredient?: string; regNo: string; company: string }[]
  labelImage?: string
  manualImage?: string
}

export interface TraceBatch {
  batchNo: string
  produceDate: string
  expireDate: string
  qcResult?: string
  qualityCertNo?: string
  qcReportNo?: string
}

/**
 * 32 位单元识别代码前 8 位结构解析（非本平台码时随结果返回）。
 * 用途：让消费者自己看清这个码的编码结构是否合规 —— 例如第 1 位不是 1/2、第 8 位不是 1/2/3，
 * 就属于「结构非法」，比单纯一句「未查询到」更有判断价值。
 */
export interface TraceCodeParts {
  categoryLabel: string            // PD / WP / 未知
  registrationLast6: string
  productionTypeLabel: string
  validLength: boolean
  validCategory: boolean
  validProductionType: boolean
}

/** 登记资料库（pesticide_reg）比对到的候选登记证（resultType='external-reg' 时存在） */
export interface TraceRegistryCandidate {
  registrationNo: string
  productName: string
  commodityName?: string
  trademark?: string
  holderName: string
  formulation?: string
  toxicity?: string
  content?: string
  ingredientMain?: string
  expireDate?: string
  produceDate?: string
  batchNo?: string
  expired: boolean
  originals: { regNo: string; productName?: string; company: string; ingredient?: string }[]
}

export interface TraceOutcome {
  sourceSnapshot?: import('./source-snapshot').SourceSnapshot
  resultType: TraceResultType
  code: string
  formattedCode: string
  formatValid: boolean
  status: CodeStatus
  abnormalFlag: number      // 0正常 1已冻结 2已作废
  queryCount: number
  firstQuery: boolean
  product?: TraceProduct
  batch?: TraceBatch | null
  recentScans: TraceScanRecord[]
  reasons: string[]
  generatedReport?: { reportNo: string } | null
  /** 非本平台码：32 位码前 8 位结构解析 */
  codeParts?: TraceCodeParts
  /** 非本平台码：登记资料库比对到的候选登记证（0 条表示登记资料库也查不到对应登记证） */
  registryCandidates?: TraceRegistryCandidate[]
  /** 外部二维码来源页提取到的实际字段（登记库候选仅作参考） */
  externalSource?: {
    platform: string
    sourceUrl: string
    productName?: string
    registrationNo?: string
    holderName?: string
    spec?: string
    formulation?: string
    toxicity?: string
    expireDate?: string
    produceDate?: string
    batchNo?: string
    productFields?: { label: string; value: string }[]
    originals?: { ingredient?: string; regNo: string; company: string }[]
  }
}
