// 内部码按扫码网址识别；是否已有生产记录由查询和采集流程分别核对。
export const DEFAULT_TRACE_BASE_URL = 'https://www.nz315.cn/trace?code='
const PLATFORM_HOSTS = new Set(['www.nz315.cn', 'nz315.cn'])

function httpUrl(value: unknown): URL | null {
  const raw = String(value ?? '').trim()
  const parts = raw.match(/^https?:\/\/([^/?#]+)([^?#]*)(?:\?[^#]*)?$/i)
  // 拒绝浏览器会自动修正的特殊写法，与扫描仪的 URI 解析保持一致。
  if (!parts || /[@%\u0080-\uFFFF]/.test(parts[1]!) || /[\s\\#]/.test(raw) || /%(?![\da-f]{2})/i.test(raw)) return null
  try {
    const url = new URL(raw)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash ? url : null
  } catch { return null }
}

/** 本站来源即使码参数无效也不能按外站抓取，避免反复抓取自己的扫码页。 */
export function isTraceWebsiteUrl(value: unknown, baseUrl = DEFAULT_TRACE_BASE_URL): boolean {
  try {
    const url = new URL(String(value ?? '').trim())
    const configured = httpUrl(baseUrl)
    return ['http:', 'https:'].includes(url.protocol) &&
      ((PLATFORM_HOSTS.has(url.hostname) && !url.port) || !!(configured && url.origin === configured.origin))
  } catch { return false }
}

/** 精确匹配域名、路径、端口及唯一的32位码参数，不依赖码库记录。 */
export function internalTraceCodeOf(value: unknown, baseUrl = DEFAULT_TRACE_BASE_URL): string | null {
  const url = httpUrl(value)
  if (!url) return null
  const rawPath = String(value).trim().match(/^https?:\/\/[^/?#]+([^?#]*)/i)?.[1] || '/'
  if (rawPath !== url.pathname) return null
  const configured = httpUrl(baseUrl)
  const platform = PLATFORM_HOSTS.has(url.hostname) && url.pathname === '/trace' && !url.port
  const custom = configured && url.origin === configured.origin && url.pathname === configured.pathname
  if (!platform && !custom) return null
  const codes = url.searchParams.getAll('code')
  return codes.length === 1 && /^\d{32}$/.test(codes[0]!) ? codes[0]! : null
}

/** 分类只回答网址归属，不把内部网址解释为正品或生产完成。 */
export function traceUrlClassification(value: unknown, baseUrl = DEFAULT_TRACE_BASE_URL): 'internal' | 'external' | 'unparsed' {
  if (internalTraceCodeOf(value, baseUrl)) return 'internal'
  return httpUrl(value) ? 'external' : 'unparsed'
}
