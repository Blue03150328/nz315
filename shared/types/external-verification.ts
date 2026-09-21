// 外部二维码核验结果：只核验单元识别码前 8 位，后续码段仅留证不判定

export type VerificationItemStatus = 'match' | 'mismatch' | 'insufficient' | 'not-applicable'
export type VerificationOverallStatus = 'match' | 'mismatch' | 'insufficient'

export interface ExternalSourceData {
  sourceUrl: string
  platform: string
  code: string
  productName?: string
  registrationNo?: string
  holderName?: string
  productionType?: string
  spec?: string
  produceDate?: string
  batchNo?: string
  expireDate?: string
  raw?: Record<string, unknown>
}

export interface ExternalCodeParts {
  length: number
  categoryCode: string
  categoryLabel: string
  registrationLast6: string
  productionTypeCode: string
  productionTypeLabel: string
  suffix: string
  validLength: boolean
  validCategory: boolean
  validProductionType: boolean
}

export interface VerificationItem {
  key: string
  label: string
  status: VerificationItemStatus
  sourceValue?: string
  referenceValue?: string
  reason: string
}

export interface ExternalVerificationResult {
  id?: number
  source: ExternalSourceData
  codeParts: ExternalCodeParts
  registrationCandidates: Array<{
    registrationNo: string
    productName: string
    holderName: string
    expireDate?: string
    categoryCode: number
  }>
  matchedRegistration?: {
    registrationNo: string
    productName: string
    holderName: string
    expireDate?: string
    categoryCode: number
  }
  localProduct?: { id: number; name: string; registrationNo: string; holderName: string; enterpriseId: number }
  items: VerificationItem[]
  overallStatus: VerificationOverallStatus
  warnings: string[]
}
