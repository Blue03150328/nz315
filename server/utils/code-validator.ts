// 追溯码解析校验（PRD 3.1 编码规则 + 5.5.2 校验项）
// 32 位结构：第1位登记类别(1=PD/2=WP)、2-7位登记证号后6位、第8位生产类型(1/2/3)、9-11位规格码、12位后自定义

export interface CodeCheckResult {
  line: string          // 原始行（可能含空白）
  code: string          // 清洗后的码
  valid: boolean
  reason: string        // 失败原因（空串=通过）
  reasonCode?: string   // 稳定原因代码，报告和界面文案可独立更新
  matchedProductId?: number | null  // 按第2-7位匹配的产品
}

// 行内「独立」32 位数字串（边界断言避免从更长数字串中截取 32 位子串，如 40 位序列号）
const CODE_RE = /(?<![0-9])[0-9]{32}(?![0-9])/
// 表头关键词（生成页导出的 sn 清单 CSV 首行等）：提取不到码但命中这些词 → 视为表头静默跳过
const HEADER_HINT = /\bsn\b|农药名称|登记证号|质量合格证号|生产企业|规格码|绑定状态/i

/**
 * 单行清洗 + 智能提取 32 位追溯码（2026-09-10 易用性增强）
 * 支持三种常见输入格式（用户拿生成页导出的任意文件都能直接上传）：
 *   ① 完整扫码链接：https://www.nz315.cn/trace?code=xxx（取 code 参数，兼容 ?code= / &code= / #code=）
 *   ② 纯 32 位码：整行仅数字（允许引号/逗号/空白/BOM 包裹）
 *   ③ 表格/CSV 行内独立 32 位数字串（如 sn 清单 CSV 的首列）
 * 三者都不是时返回清洗后原文，由 validateCode 报「未识别到 32 位追溯码」
 */
export function cleanLine(raw: string): string {
  const s = String(raw).replace(/^\uFEFF/, '').trim()
  if (!s) return ''
  // ① 扫码链接：优先取 code 参数（URL 中可能还有其它数字，参数最可靠）
  const mParam = s.match(/[?&#]code=([0-9]{32})(?![0-9])/i)
  if (mParam) return mParam[1] as string
  // ② 剥离常见分隔符后整行即 32 位码（纯码文件 / 带引号逗号包裹的单码）
  const stripped = s.replace(/[\s"',，;；]/g, '')
  if (/^[0-9]{32}$/.test(stripped)) return stripped
  // ③ 行内独立的 32 位数字串（CSV sn 清单首列、带前后缀的表格导出等）
  const mAny = s.match(CODE_RE)
  if (mAny) return mAny[0] as string
  // ④ 无法提取：返回清洗后原文（交由校验给出明确失败原因）
  return stripped || s
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
  if (!code) { base.reason = '空行'; base.reasonCode = 'EMPTY_LINE'; return base }

  // 长度与数字
  if (!/^\d{32}$/.test(code)) { base.reason = '未识别到 32 位追溯码'; base.reasonCode = 'INVALID_CODE'; return base }

  // 第1位：登记类别
  const first = code[0]
  if (first !== '1' && first !== '2') { base.reason = '第1位登记类别无效'; base.reasonCode = 'INVALID_CATEGORY'; return base }

  // 第8位：生产类型
  const eighth = code[7]
  if (eighth !== '1' && eighth !== '2' && eighth !== '3') { base.reason = '第8位生产类型无效'; base.reasonCode = 'INVALID_PRODUCTION'; return base }

  // 第9-11位：规格码
  const specCode = code.slice(8, 11)
  if (!ctx.specCodeSet.has(specCode)) { base.reason = '规格码(' + specCode + ')未登记'; base.reasonCode = 'UNKNOWN_SPEC'; return base }

  // 第2-7位：登记证号后6位匹配产品
  const regLast6 = code.slice(1, 7)
  const matchedProductId = ctx.regLast6Map.get(regLast6)
  if (matchedProductId === undefined) { base.reason = '登记证后6位(' + regLast6 + ')未匹配产品'; base.reasonCode = 'UNKNOWN_PRODUCT'; return base }

  // 系统内重复
  if (ctx.existingSet.has(code)) { base.reason = '重复码'; base.reasonCode = 'DUPLICATE_DATABASE'; return base }

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
    // 表头行跳过（生成页导出的 sn 清单 CSV 首行是列名，无码属正常）：提取不到码但含表头关键词
    // → 静默跳过不计入失败，避免用户上传 CSV 时看到「1 条失败」的困惑
    if (!/^\d{32}$/.test(code) && HEADER_HINT.test(String(raw))) continue
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
