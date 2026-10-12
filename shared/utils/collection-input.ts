const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
export function collectionId(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) throw new Error('采集会话或事件标识格式不正确')
  return value.toLowerCase()
}
export function collectionCode(raw: string): string | null {
  let text = raw.trim()
  // 仅比对完整码值，网址可以缺少协议或带有任意参数；不要截取更长数字串。
  try { text = decodeURIComponent(text) } catch { /* 不完整的百分号编码保留原文。 */ }
  const candidates = new Set(text.match(/(?<![0-9])[0-9]{32}(?![0-9])/g) || [])
  return candidates.size === 1 ? [...candidates][0]! : null
}
export function collectionEvents(body: Record<string, any>) {
  if (!Array.isArray(body.events) || !body.events.length || body.events.length > 50) throw new Error('每次同步应包含1至50条采集事件')
  const ids = new Set<string>(), sequences = new Set<number>()
  return body.events.map((row: any) => {
    const eventId = collectionId(row?.eventId), sequence = Number(row?.sequence)
    if (!Number.isSafeInteger(sequence) || sequence <= 0 || sequence > 10000000 || ids.has(eventId) || sequences.has(sequence)) throw new Error('事件序号不正确或本次请求重复')
    ids.add(eventId); sequences.add(sequence)
    if (typeof row.rawCode !== 'string' || row.rawCode.length > 4096 || !['valid', 'duplicate', 'invalid'].includes(row.kind)) throw new Error('采集原文或类别不正确')
    if (typeof row.capturedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.capturedAt) || !Number.isFinite(Date.parse(row.capturedAt)) || new Date(row.capturedAt).toISOString() !== row.capturedAt) throw new Error('采集时间格式不正确')
    const code = collectionCode(row.rawCode)
    if (row.code !== undefined && row.code !== null && row.code !== code) throw new Error('原始扫码内容与解析码不一致')
    return { eventId, sequence, rawCode: row.rawCode, code, kind: row.kind as 'valid' | 'duplicate' | 'invalid', capturedAt: row.capturedAt, reason: String(row.reason || '').slice(0, 500) }
  }).sort((a: any, b: any) => a.sequence - b.sequence)
}
