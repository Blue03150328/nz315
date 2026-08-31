// 与前端组件共享的查询结果类型（参考农码查 shared/types/compare.ts）
export interface ICompareItem {
  key: string
  label: string
  result: 'pass' | 'fail' | 'warning'
  scannedValue?: string
  dbValue?: string
  description: string
}

export interface ICompareResult {
  riskLevel: 'safe' | 'warning' | 'danger'
  found: boolean
  registration?: any
  items: ICompareItem[]
  passCount: number
  totalCount: number
}

export type QueryResultType = 'genuine' | 'abnormal' | 'expired' | 'not-found'

export interface QueryOutcome {
  resultType: QueryResultType
  traceCode: string
  formattedCode: string
  formatValid: boolean
  found: boolean
  queryCount: number
  firstQuery: boolean
  product?: any
  registration?: any
  compare?: ICompareResult
  expiredText?: string
  provinces?: string[]
  reasons: string[]
  generatedReport?: { reportNo: string } | null
}
