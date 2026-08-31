// 追溯码生成引擎（PRD 3.1/3.2/5.5.1）
// 32 位结构：第1位登记类别 + 第2-7位登记证号后6位 + 第8位生产类型 + 第9-11位规格码（强制，不可配置）
//           第12位后 21 位自定义段：时间戳段 + 随机段 + 流水填充 + 校验位段（可选，占末 2 位）
// 自定义段配置对齐 PRD 3.2 表：时间戳段 / 随机数字段 / 校验位段
import { createHash, randomInt } from 'node:crypto'

export type TimestampType = 'none' | 'ymd' | 'sec' | 'ms'   // 时间戳段（PRD 3.2）
export type RandomType = 'none' | 'rand8' | 'rand6c2'       // 随机段：不使用 / 8位随机 / 6位随机+2位校验
export type ChecksumType = 'none' | 'md5' | 'crc16'         // 校验位段：不使用 / MD5取后2位 / CRC16取后2位

export interface GenerateConfig {
  timestampType: TimestampType
  randomType: RandomType
  checksumType: ChecksumType
}

export const DEFAULT_CONFIG: GenerateConfig = { timestampType: 'ms', randomType: 'none', checksumType: 'md5' }

// 合法取值表（API 层校验用）
export const TIMESTAMP_TYPES: TimestampType[] = ['none', 'ymd', 'sec', 'ms']
export const RANDOM_TYPES: RandomType[] = ['none', 'rand8', 'rand6c2']
export const CHECKSUM_TYPES: ChecksumType[] = ['none', 'md5', 'crc16']

export interface GenerateContext {
  regCategory: number    // 登记类别 1=PD 2=WP（第1位）
  regLast6: string       // 登记证号后6位（第2-7位）
  produceType: number    // 生产类型 1/2/3（第8位）
  specCode: string       // 规格码 3 位（第9-11位）
  existingSet?: Set<string>  // 系统内已有码（重码检测）
}

/**
 * 校验位计算（PRD 3.2：校验位段；32 位码必须为纯数字，故校验结果取模转 2 位数字 00-99）
 * @param s 参与校验的内容（生成时取前 30 位；校验时按同规则重算比对）
 * @param algo 算法：md5（MD5 后 4 位 hex 取模）/ crc16（CRC16-CCITT 取模）
 */
export function checksumValue(s: string, algo: ChecksumType): string {
  if (algo === 'none') return ''
  let v = 0
  if (algo === 'md5') {
    const hex = createHash('md5').update(s).digest('hex')
    v = parseInt(hex.slice(-4), 16) % 100
  } else {
    // CRC16-CCITT（poly 0x1021，初值 0xFFFF，输入按 ASCII 数字逐字节处理）
    let crc = 0xffff
    for (let i = 0; i < s.length; i++) {
      crc ^= (s.charCodeAt(i) & 0xff) << 8
      for (let b = 0; b < 8; b++) {
        crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
      }
    }
    v = crc % 100
  }
  return String(v).padStart(2, '0')
}

// 时间戳段（PRD 3.2：毫秒级 / 秒级 / 年月日 / 不使用）
function timestampPart(type: TimestampType, now: Date): string {
  if (type === 'ymd') {
    return String(now.getFullYear()) + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0')
  }
  if (type === 'sec') return String(Math.floor(now.getTime() / 1000))
  if (type === 'ms') return String(now.getTime())
  return ''
}

// 随机数字段（PRD 3.2：8位随机数字 / 6位随机+2位校验 / 不使用）；rand6c2 的 2 位校验对"前置内容+随机6位"独立计算
function randomPart(type: RandomType, prefix: string): string {
  if (type === 'rand8') {
    return String(randomInt(0, 100000000)).padStart(8, '0')
  }
  if (type === 'rand6c2') {
    const r6 = String(randomInt(0, 1000000)).padStart(6, '0')
    return r6 + checksumValue(prefix + r6, 'md5')
  }
  return ''
}

/**
 * 生成单条码
 * @param ctx 码头上下文（第 1-11 位来源）
 * @param seq 流水号（自定义段填充，保证同批唯一）
 * @param cfg 自定义段配置
 */
export function generateOne(ctx: GenerateContext, seq: number, cfg: GenerateConfig): string {
  const head = String(ctx.regCategory) + ctx.regLast6 + String(ctx.produceType) + ctx.specCode
  if (head.length !== 11) throw new Error('码头结构错误：' + head)

  const now = new Date()
  const withChecksum = cfg.checksumType !== 'none'
  const contentLen = withChecksum ? 19 : 21 // 校验位段占用末 2 位

  // 内容 = 时间戳段 + 随机段 + 流水号填充（超长时截断末尾，优先保留时间戳）
  let custom = timestampPart(cfg.timestampType, now) + randomPart(cfg.randomType, head)
  if (custom.length > contentLen) {
    custom = custom.slice(0, contentLen)
  } else if (custom.length < contentLen) {
    const seqStr = String(seq).padStart(contentLen - custom.length, '0')
    custom += seqStr.slice(-(contentLen - custom.length))
  }

  let code = head + custom
  if (withChecksum) {
    // 整体校验位：前 30 位按所选算法计算（校验时重算比对）
    code = code.slice(0, 30) + checksumValue(code.slice(0, 30), cfg.checksumType)
  }
  if (!/^\d{32}$/.test(code)) throw new Error('生成码非 32 位数字：' + code)
  return code
}

/**
 * 批量生成：本地去重 + 系统内重码检测（PRD 5.5.1 重码检测，重复则重新生成该条，最多重试 5 次）
 * 返回含耗时统计（参考离线工具：总数/唯一/重码/耗时）
 */
export function generateBatch(ctx: GenerateContext, quantity: number, cfg: GenerateConfig): { codes: string[]; duplicates: number; elapsedMs: number } {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
    throw new Error('生成数量须为 1-10000')
  }
  const start = Date.now()
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
  return { codes, duplicates, elapsedMs: Date.now() - start }
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
