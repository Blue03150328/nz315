import type { TraceOutcome, TraceRegistryCandidate } from '../types/trace'

const normalize = (value: string) => value.normalize('NFKC').replace(/\s/g, '').toUpperCase()

// 完整证号优先消除后六位撞号；不替来源页选择另一张登记证。
export function selectExternalRegistry(outcome: TraceOutcome): TraceRegistryCandidate | undefined {
  const candidates = outcome.registryCandidates || []
  const registrationNo = outcome.sourceSnapshot?.source?.registrationNo
  const matches = registrationNo ? candidates.filter(item => normalize(item.registrationNo) === normalize(registrationNo)) : candidates
  return matches.length === 1 ? matches[0] : undefined
}

const ISSUE_HINTS: Record<string, string> = {
  'empty-shell': '暂未读到厂家页面中的产品资料，请打开厂家原页查看。',
  'unreachable': '厂家页面暂时无法读取，请稍后重试或打开厂家原页查看。',
  'blocked-address': '来源网址无法安全访问，请核实二维码来源。',
  'code-mismatch': '厂家页面显示的追溯码与本次扫描不一致，请核对包装二维码。',
  'source-not-found': '来源平台明确答复查无此码，请核对包装二维码并联系厂家。',
  'busy': '当前查询较多，请稍后重试。',
}

// 关键字段清单：全部一致时给出最强结论。
const REQUIRED_LABELS = ['来源页单元识别码', '完整登记证号', '码内登记类别及后六位', '产品名称（不含百分比标注）', '登记证持有人', '剂型', '总有效成分含量', '全部有效成分及含量']
// 核心项：来源页一旦提供就必须一致（不一致已在异常分支拦下）；来源页未提供不阻塞结论，只列入自核清单。
const CORE_LABELS = ['完整登记证号', '登记证持有人']
// 这两项只能靠来源页比对，用户翻包装也核不了，缺了只记“未核验”，不塞进自核清单。
const UNVERIFIED_LABELS = ['来源页单元识别码', '码内登记类别及后六位']

export function summarizeExternal(outcome: TraceOutcome, today: string) {
  const snapshot = outcome.sourceSnapshot
  const source = snapshot?.source
  const selected = selectExternalRegistry(outcome)
  const issues: string[] = []
  const parts = outcome.codeParts
  if (parts && (!parts.validLength || !parts.validCategory || !parts.validProductionType)) issues.push('追溯码编码结构不符合规则')
  if (snapshot?.issue === 'code-mismatch' || snapshot?.issue === 'source-not-found') issues.push(ISSUE_HINTS[snapshot.issue]!)
  if (source?.pageCode && source.pageCode !== outcome.code) issues.push('厂家页面追溯码与本次扫描不一致')
  if (selected?.expired || (selected?.expireDate && selected.expireDate < today)) issues.push('登记证当前已到期，请结合产品生产日期核实')
  // 只认真实日历日期；保质期年数和“见喷码”等原文不能当作到期日。
  const match = source?.productExpiry?.trim().match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/)
  if (match) {
    const date = `${match[1]}-${match[2]!.padStart(2, '0')}-${match[3]!.padStart(2, '0')}`
    const parsed = new Date(date + 'T00:00:00Z')
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date && date < today) issues.push('厂家标注的产品有效期已过')
  }
  for (const item of snapshot?.comparisons || []) {
    if (item.status === 'mismatch' || (item.status === 'review' && !['生产日期及批号', '实际生产企业', '登记证当前有效期'].includes(item.label))) issues.push(item.label + '需核实')
  }
  if (issues.length) return { tone: 'warning', title: '发现异常，需核实', detail: [...new Set(issues)].join('；') }
  const pending = (detail: string) => ({ tone: 'neutral', title: '暂无法完成比对', detail })
  if (!source || snapshot?.status === 'unavailable') return pending(ISSUE_HINTS[snapshot?.issue || ''] || '尚未取得厂家来源资料，请核对包装或打开厂家原页。')
  if (!selected) return pending('尚未唯一确定对应的登记证，请核对包装上的完整登记证号。')
  if (snapshot?.extractionMethod === 'vision') return pending('厂家资料由图片识别取得，关键字段仍需人工核对。')
  if (!snapshot?.extractionMethod) return pending('这份来源资料需重新读取后才能确认比对结果，请重新查询。')
  if (!parts || !source.pageCode || source.pageCode !== outcome.code || snapshot.status !== 'ok') return pending('厂家页面尚未提供可核对的完整追溯码，无法确认它对应本次扫描。')
  if (!selected.expireDate) return pending('登记资料未提供该登记证的有效日期，无法判断登记证当前是否在有效期内，请与包装标签核对。')
  const statusOf = (label: string) => snapshot.comparisons.find(item => item.label === label)?.status
  // 至少一项核心项对上才有资格给正面结论；来源页一条核心都不给时保持中性。
  const matchedCore = CORE_LABELS.filter(label => statusOf(label) === 'match')
  if (!matchedCore.length) return pending('来源页未提供登记证号与登记证持有人的可比对资料，无法核对是否对应同一登记证，请打开厂家原页或与包装标签核对。')
  // 资料缺失不再否定结论：来源页未提供只说明“没自动比对”，不等于异常。
  const missing = REQUIRED_LABELS.filter(label => statusOf(label) !== 'match')
  if (missing.length) {
    const selfCheck = missing.filter(label => !UNVERIFIED_LABELS.includes(label))
    const unverified = missing.filter(label => UNVERIFIED_LABELS.includes(label))
    const lines = ['已与登记资料一致：' + matchedCore.join('、') + '；登记证有效期至 ' + selected.expireDate + '，当前未到期。']
    if (selfCheck.length) lines.push('以下资料本次未能自动比对，请与包装标签自行核对：' + selfCheck.join('、') + '。')
    if (unverified.length) lines.push('来源页未提供、无法自动核验：' + unverified.join('、') + '。')
    return { tone: 'success', title: '未发现明显异常', detail: lines.join('') }
  }
  return { tone: 'success', title: '信息比对通过', detail: '厂家关键资料与登记资料一致。生产日期和批次仍需核对包装；此结果不代表产品质量或真伪鉴定。' }
}
