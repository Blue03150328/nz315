// 追溯码解析校验（PRD 3.1 编码规则 + 5.5.2 校验项）
// 32 位结构：第1位登记类别(1=PD/2=WP)、2-7位登记证号后6位、第8位生产类型(1/2/3)、9-11位规格码、12位后自定义

export interface CodeCheckResult {
  line: string          // 原始行（可能含空白）
  code: string          // 清洗后的码
  valid: boolean
  reason: string        // 失败原因（空串=通过）
  matchedProductId?: number | null  // 按第2-7位匹配的产品
}

// 单行清洗：去空白、去 BOM、去引号
export function cleanLine(raw: string): string {
  return String(raw).replace(/^\uFEFF/, '').replace(/[\s"'，,]/g, '').trim()
}

/**
 * 校验单行码（同步校验结构；产品/规格匹配由调用方传入上下文）
 * @param code 清洗后的码
 * @param regLast6Set 企业产品登记证号后6位集合 -> 产品ID
 * @param specCodeSet 企业规格码集合
 * @param existingSet 系统内已存在的码集合（重复校验）
 */
export function validateCode(
  code: string,
  ctx: { regLast6Map: Map<string, number>; specCodeSet: Set<string>; existingSet: Set<string> },
): CodeCheckResult {
  const base: CodeCheckResult = { line: code, code, valid: false, reason: '' }
  if (!code) { base.reason = '空行'; return base }

  // 长度与数字
  if (!/^\d{32}$/.test(code)) { base.reason = '非32位数字'; return base }

  // 第1位：登记类别
  const first = code[0]
  if (first !== '1' && first !== '2') { base.reason = '第1位登记类别无效'; return base }

  // 第8位：生产类型
  const eighth = code[7]
  if (eighth !== '1' && eighth !== '2' && eighth !== '3') { base.reason = '第8位生产类型无效'; return base }

  // 第9-11位：规格码
  const specCode = code.slice(8, 11)
  if (!ctx.specCodeSet.has(specCode)) { base.reason = '规格码(' + specCode + ')未登记'; return base }

  // 第2-7位：登记证号后6位匹配产品
  const regLast6 = code.slice(1, 7)
  const matchedProductId = ctx.regLast6Map.get(regLast6)
  if (matchedProductId === undefined) { base.reason = '登记证后6位(' + regLast6 + ')未匹配产品'; return base }

  // 系统内重复
  if (ctx.existingSet.has(code)) { base.reason = '重复码'; return base }

  base.valid = true
  base.matchedProductId = matchedProductId
  return base
}

/**
 * 批量校验：返回统计与明细
 */
export function validateBatch(
  rawLines: string[],
  ctx: { regLast6Map: Map<string, number>; specCodeSet: Set<string>; existingSet: Set<string> },
) {
  const results: CodeCheckResult[] = []
  const reasonCount: Record<string, number> = {}
  for (const raw of rawLines) {
    const code = cleanLine(raw)
    if (!code) {
      reasonCount['空行'] = (reasonCount['空行'] || 0) + 1
      continue
    }
    const r = validateCode(code, ctx)
    results.push(r)
    if (!r.valid) reasonCount[r.reason] = (reasonCount[r.reason] || 0) + 1
  }
  const valid = results.filter(r => r.valid)
  const invalid = results.filter(r => !r.valid)
  return {
    total: results.length,
    validCount: valid.length,
    invalidCount: invalid.length,
    reasonCount,
    results,
    // 按产品归组（用于自动匹配提示）
    productGroups: valid.reduce<Record<number, number>>((acc, r) => {
      const pid = r.matchedProductId ?? 0
      acc[pid] = (acc[pid] || 0) + 1
      return acc
    }, {}),
  }
}
