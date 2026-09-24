import type { TraceOutcome } from '../types/trace'

// 只汇总外码页面的展示状态，不改变服务端核验和预警判定。
export function summarizeExternal(outcome: TraceOutcome, today: string) {
  const snapshot = outcome.sourceSnapshot
  const source = snapshot?.source
  const candidates = outcome.registryCandidates || []
  const selected = source?.registrationNo
    ? candidates.find(c => c.registrationNo === source.registrationNo)
    : candidates.length === 1 ? candidates[0] : undefined
  const issues: string[] = []
  const parts = outcome.codeParts
  if (parts && (!parts.validLength || !parts.validCategory || !parts.validProductionType)) issues.push('追溯码编码结构不符合规则')
  if (selected?.expired) issues.push('登记证当前已到期，请结合生产日期核实')
  // 只认完整且真实的日历日期；“2年”“见喷码”等资料不足不按过期处理。
  const match = source?.productExpiry?.trim().match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/)
  if (match) {
    const date = `${match[1]}-${match[2]!.padStart(2, '0')}-${match[3]!.padStart(2, '0')}`
    const parsed = new Date(date + 'T00:00:00Z')
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date && date < today) issues.push('来源页标注的产品有效期已过')
  }
  for (const item of snapshot?.comparisons || []) {
    // 批次与受托生产企业无登记参考，是人工核对项；明确的成分差异等仍需提示。
    if (item.status === 'mismatch' || (item.status === 'review' && !['生产日期及批号', '实际生产企业'].includes(item.label))) issues.push(item.label + '需核实')
  }
  if (issues.length) return { tone: 'warning', title: '本次比对发现需核实的问题', detail: [...new Set(issues)].join('；') }
  if (!source || snapshot?.status === 'unavailable' || !selected || !snapshot?.comparisons.some(item => item.status === 'match')) {
    return { tone: 'neutral', title: '外部产品资料待核对', detail: '当前资料尚不足以完成比对，请结合原查询页及包装标签核实。' }
  }
  return { tone: 'success', title: '本次比对未发现明显异常', detail: '资料不足项不计为异常；缺失的日期和批次仍需核对包装，本结果不代表质量或真伪鉴定。' }
}
