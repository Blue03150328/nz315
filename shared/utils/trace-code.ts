// 追溯码文本提取规则（前后端共用的唯一来源）
//
// 背景：外部二维码核验既是「扫别人的码」也是「粘贴别人的页面内容」，两个入口都需要从任意文本里捞出 32 位单元识别码。
// 此前前端 useQrScanner 的 traceCodeOf 只认「^32 位纯数字」与「本站 trace?code=」，而后端 extractExternalCode 认 32+ 位
// 并会遍历 URL 查询参数 —— 两套规则漂移的直接后果是：**扫到别人平台的裸码时前端判不出「这不是本站码」，页面毫无反应**。
// 因此把规则收敛到这里，前后端一律引用本文件，不再各写一套。

/** 追溯码最少位数（PRD 3.3：32 位数字单元识别码） */
export const TRACE_CODE_MIN_LENGTH = 32

const DIGITS = `\\d{${TRACE_CODE_MIN_LENGTH},}`
/** 常见追溯参数名后的码值（?code=/?id=/?sn=/?traceCode=） */
const NAMED_PARAM_RE = new RegExp(`[?&#](?:code|id|sn|traceCode)=(${DIGITS})(?:&|#|$)`, 'i')
/** 整体即码值 */
const PURE_CODE_RE = new RegExp(`^${DIGITS}$`)
/** 文本中首段独立的 ≥32 位数字（左右不能再挨着数字） */
const BOUNDED_CODE_RE = new RegExp(`(?<!\\d)${DIGITS}(?!\\d)`)

/** 该字符串本身是否就是一个可用追溯码（≥32 位纯数字） */
export function isTraceCode(value: unknown): boolean {
  return PURE_CODE_RE.test(String(value ?? '').trim())
}

/**
 * 从任意文本 / 网址中提取追溯码，提取不到返回空串。
 * 三路兜底：① 常见参数名 ② 任意查询参数值本身是纯数字码 ③ 文本中首段 ≥32 位数字
 */
export function extractTraceCode(input: unknown): string {
  const text = String(input ?? '').trim()
  if (!text) return ''
  const named = text.match(NAMED_PARAM_RE)
  if (named?.[1]) return named[1]
  // 外部平台常用数字参数名（例如 ?47=码值），逐个检查查询参数而不是猜参数名
  try {
    const url = new URL(text)
    for (const value of url.searchParams.values()) {
      if (PURE_CODE_RE.test(value)) return value
    }
  } catch { /* 不是网址时继续按纯文本检查 */ }
  const direct = text.match(BOUNDED_CODE_RE)
  return direct?.[0] || ''
}

/** 是否为可直接抓取的 http(s) 网址（非网址输入不应被当成「来源页面」去抓） */
export function isHttpUrl(value: unknown): boolean {
  return /^https?:\/\//i.test(String(value ?? '').trim())
}
