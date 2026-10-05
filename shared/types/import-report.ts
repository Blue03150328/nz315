export interface CodeImportForm {
  productId: number | null
  batchNo: string
  produceDate: string
  qualityCertNo: string
  qcReportNo: string
  expireDate: string
}

export interface CodeImportPreview {
  fileName: string
  total: number
  validCount: number
  invalidCount: number
  reasonCount: Record<string, number>
  productGroups: { productId: number; productName: string; count: number }[]
  preview: { lineNumber: number; code: string; valid: boolean; reason: string; matchedProductId?: number | null }[]
}

export interface ImportResult {
  ok: boolean
  reportId: number
  imported: number
  skippedInvalid: number
  skippedDup: number
  ignored: number
  total: number
  notWritten: number
  batchId: number | null
  batchNo: string
  batchCreated: boolean
  uploadBatchId: number | null
  fileName: string
  error?: string
  notificationState?: 'sent' | 'failed'
}
export interface ImportReport extends ImportResult {
  version: number
  state: 'completed' | 'failed' | 'pending'
  createdAt: string
  enterpriseName: string
  operatorName: string
}
export interface ImportRejection {
  lineNumber: number
  code: string
  reasonCode: string
  reason: string
}
