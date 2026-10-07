import { fetchSourceDocument } from '../utils/source-fetch'
import { frameAllowed } from '../utils/source-frame'
import { allowRequest } from '../utils/rate-limit'
import { clientIpOf } from '../utils/audit'

const cache = new Map<string, { expires: number; result: { allowed: boolean; url?: string; message: string } }>()

// 只检查响应头，原页始终在独立沙箱中加载，不把外站脚本代理进本站。
export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'no-store')
  const unavailable = (message: string) => ({ allowed: false, message })
  const input = String(getQuery(event).url || '')
  if (!allowRequest('source-frame:' + clientIpOf(event), 20, 60000) || !allowRequest('source-frame-global', 60, 60000)) return unavailable('当前查询较多，请直接打开厂家原页。')
  let url: URL
  try { url = new URL(input) } catch { return unavailable('来源网址不完整，请核对包装二维码。') }
  if (url.protocol !== 'https:' || url.username || url.password || input.length > 2048) return unavailable('这个厂家网址未使用安全连接，请通过原页入口查看。')
  // 来源由当前请求的Host确定，不接受客户端指定的父页面或转发Host。
  const host = getHeader(event, 'host') || ''
  const origin = getRequestURL(event, { xForwardedHost: false, xForwardedProto: true }).protocol + '//' + host
  const key = origin + '\n' + input
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) return cached.result
  let result: { allowed: boolean; url?: string; message: string }
  try {
    const document = await fetchSourceDocument(input, undefined, { method: 'HEAD', httpsOnly: true })
    const allowed = frameAllowed(document.url, origin, document.frameOptions, document.framePolicy)
    result = allowed ? { allowed: true, url: document.url, message: '以下为厂家原查询页，内容由来源平台提供。' } : unavailable('厂家页面限制了站内展示，请打开厂家原页查看。')
  } catch { result = unavailable('暂时无法确认厂家原页能否在此显示，请使用原页入口，下方显示可读取的厂家资料。') }
  if (cache.size >= 200) cache.delete(cache.keys().next().value!)
  cache.set(key, { expires: Date.now() + (result.allowed ? 600000 : 120000), result })
  return result
})
