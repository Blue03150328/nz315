// 追溯码生成引擎（PRD 3.1/3.2/5.5.1）
// 32 位结构：第1位登记类别 + 第2-7位登记证号后6位 + 第8位生产类型 + 第9-11位规格码（强制，不可配置）
//           第12位后 21 位自定义段：时间戳 + 流水/随机 + 校验位（可选）
import { createHash } from 'node:crypto'

export interface GenerateConfig {
  timestampType: 'none' | 'ymd' | 'sec' | 'ms'   // 时间戳段
  checksum: boolean                                // 校验位段（MD5 取后 2 位）
}

export const DEFAULT_CONFIG: GenerateConfig = { timestampType: 'ms', checksum: true }

export interface GenerateContext {
  regCategory: number    // 登记类别 1=PD 2=WP（第1位）
  regLast6: string       // 登记证号后6位（第2-7位）
  produceType: number    // 生产类型 1/2/3（第8位）
  specCode: string       // 规格码 3 位（第9-11位）
  existingSet?: Set<string>  // 系统内已有码（重码检测）
}

// 校验位（PRD：32 位必须为纯数字）：MD5 后 4 位 hex 取模 100 → 2 位数字（00-99）
// 校验时按同规则重算比对
function checksumDigits(s: string): string {
  const hex = createHash('md5').update(s).digest('hex')
  return String(parseInt(hex.slice(-4), 16) % 100).padStart(2, '0')
}

/**
 * 生成单条码
 * @param ctx 码头上下文（第 1-11 位来源）
 * @param seq 流水号（用于自定义段填充，保证唯一）
 * @param cfg 自定义段配置
 */
export function generateOne(ctx: GenerateContext, seq: number, cfg: GenerateConfig): string {
  const head = String(ctx.regCategory) + ctx.regLast6 + String(ctx.produceType) + ctx.specCode
  if (head.length !== 11) throw new Error('码头结构错误：' + head)

  // 自定义段（21 位；启用校验位时内容 19 位 + 校验 2 位）
  let custom = ''
  const now = new Date()
  if (cfg.timestampType === 'ymd') {
    custom += now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0')
  } else if (cfg.timestampType === 'sec') {
    custom += String(Math.floor(now.getTime() / 1000))
  } else if (cfg.timestampType === 'ms') {
    custom += String(now.getTime())
  }

  const contentLen = cfg.checksum ? 19 : 21
  // 流水号填充剩余位（不足补 0，超出截断末位——配合时间戳可保证段内唯一）
  const remain = contentLen - custom.length
  if (remain > 0) {
    const seqStr = String(seq).padStart(remain, '0')
    custom += seqStr.slice(-remain)
  } else {
    custom = custom.slice(0, contentLen)
  }

  let code = head + custom
  if (cfg.checksum) {
    // 校验位：前 30 位算纯数字校验码（校验时重算比对）
    code = code.slice(0, 30) + checksumDigits(code.slice(0, 30))
  }
  if (!/^\d{32}$/.test(code)) throw new Error('生成码非 32 位数字：' + code)
  return code
}

/**
 * 批量生成：本地去重 + 系统内重码检测（PRD 5.5.1 重码检测，重复则重新生成该条，最多重试 5 次）
 */
export function generateBatch(ctx: GenerateContext, quantity: number, cfg: GenerateConfig): { codes: string[]; duplicates: number } {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
    throw new Error('生成数量须为 1-10000')
  }
  const codes: string[] = []
  const local = new Set<string>()
  let duplicates = 0
  let seq = Math.floor(Date.now() / 1000) % 100000000 // 流水起点（秒级时间戳低位）
  let attempts = 0
  while (codes.length < quantity && attempts < quantity * 6) {
    attempts++
    const code = generateOne(ctx, seq, cfg)
    seq++
    if (local.has(code) || ctx.existingSet?.has(code)) {
      duplicates++
      continue // 重码：重新生成（序号前进保证不同）
    }
    local.add(code)
    codes.push(code)
  }
  if (codes.length < quantity) {
    throw new Error('重码过多，生成失败，请调整自定义段配置或减少数量')
  }
  return { codes, duplicates }
}

/** 分段展示（PRD 3.2 码示例预览：彩色分段显示结构） */
export function segments(code: string): { label: string; value: string }[] {
  return [
    { label: '登记类别', value: code.slice(0, 1) },
    { label: '登记证后6位', value: code.slice(1, 7) },
    { label: '生产类型', value: code.slice(7, 8) },
    { label: '规格码', value: code.slice(8, 11) },
    { label: '自定义段', value: code.slice(11, 32) },
  ]
}