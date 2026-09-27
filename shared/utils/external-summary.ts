import type { TraceOutcome } from '../types/trace'

// 取不到来源资料时要分两种情形说清楚：**页面打不开** vs **打开了但读不出内容**（JS 空壳）。
// 分类来自 SourceSnapshot.issue，这里是面向消费者的说法，不出现技术术语。
const ISSUE_HINTS: Record<string, string> = {
  'empty-shell': '这个来源页面需要浏览器打开才能看到内容，本平台读不到里面的资料。可点下方链接自行查看；生产日期与批号请以包装标签实物为准。',
  'unreachable': '暂时打不开这个来源页面。可稍后重试，或点下方链接自行查看。',
  'blocked-address': '这个来源网址无法正常访问，请核实二维码来源是否可靠。',
  'code-mismatch': '来源页面显示的码与您查询的码不一致，请核对包装上的二维码。',
  'busy': '当前查询的人较多，请稍后重试。',
}

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
    return { tone: 'neutral', title: '暂未取得来源页资料', detail: ISSUE_HINTS[snapshot?.issue || ''] || '暂时无法读取这个来源页面的资料。生产日期与批号请以包装标签实物为准。' }
  }
  return { tone: 'success', title: '本次比对未发现明显异常', detail: '资料不足项不计为异常；缺失的日期和批次仍需核对包装，本结果不代表质量或真伪鉴定。' }
}
