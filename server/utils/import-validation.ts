import { cleanLine, validateCode } from './code-validator'

export interface ImportContext {
  regLast6Map: Map<string, number>
  specCodeSet: Set<string>
  existingSet: Set<string>
}

// 原始行号始终保留；表头和空行不计入待入库数据。
export function validateImportRows(rawLines: string[], ctx: ImportContext, productId?: number) {
  const accepted: string[] = []
  const preview: { code: string; valid: boolean; reason: string; lineNumber: number; matchedProductId?: number | null }[] = []
  const productGroups: Record<number, number> = {}
  const reasonCount: Record<string, number> = {}
  const seen = new Set<string>()
  let ignored = 0
  let duplicate = 0
  let invalid = 0
  rawLines.forEach((raw, i) => {
    const code = cleanLine(raw)
    if (!code || (!/^\d{32}$/.test(code) && /\bsn\b|农药名称|登记证号|质量合格证号|生产企业|规格码|绑定状态/i.test(raw))) { ignored++; return }
    const check = validateCode(code, ctx)
    let reason = check.reason
    let reasonCode = check.reasonCode || ''
    if (check.valid && seen.has(code)) { reason = '文件内重复码'; reasonCode = 'DUPLICATE_FILE' }
    if (!reason && productId !== undefined && check.matchedProductId !== productId) { reason = '码归属与所选产品不一致'; reasonCode = 'PRODUCT_MISMATCH' }
    seen.add(code)
    if (reason) {
      reasonCount[reason] = (reasonCount[reason] || 0) + 1
      if (reasonCode.startsWith('DUPLICATE_')) duplicate++
      else invalid++
    } else {
      accepted.push(code)
      const pid = check.matchedProductId!
      productGroups[pid] = (productGroups[pid] || 0) + 1
    }
    if (preview.length < 20) preview.push({ lineNumber: i + 1, code: code.slice(0, 255), valid: !reason, reason, matchedProductId: check.matchedProductId })
  })
  return { accepted, ignored, duplicate, invalid, total: accepted.length + duplicate + invalid, preview, productGroups, reasonCount }
}
