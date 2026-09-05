// 扫码查询页（/trace?code=）结果类型，对齐 PRD 5.9 展示结构与 7.5 追溯码表
export type TraceResultType =
  | 'genuine'        // 正常（正品）
  | 'not-found'      // 查无此码（8类异常-2）
  | 'reg-expired'    // 登记证已过期（8类异常-4）
  | 'expired'        // 产品已过有效期
  | 'repeat'         // 重复查询（8类异常-1）
  | 'frozen'         // 已冻结（异常标记）
  | 'voided'         // 已作废（异常标记）
  | 'mismatch'       // 扫码信息与标签不符（8类异常-7）

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
  originals?: { regNo: string; company: string }[]  // 原药（母药）信息多行（复配产品多条）
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

export interface TraceOutcome {
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
}
