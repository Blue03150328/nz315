// 公众端外页请求：逐跳检查、公网地址固定连接、限制时间/大小/并发，不转发用户凭据。
import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

const blocked = new BlockList()
const blockedV6 = new BlockList()
for (const [ip, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['192.0.0.0', 24], ['192.0.2.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]] as const) blocked.addSubnet(ip, prefix, 'ipv4')
for (const [ip, prefix] of [['::', 96], ['::ffff:0:0', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32], ['2002::', 16], ['64:ff9b::', 96]] as const) blockedV6.addSubnet(ip, prefix, 'ipv6')
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip)
  return family === 4 ? !blocked.check(ip, 'ipv4') : family === 6 && !blockedV6.check(ip, 'ipv6')
}
let active = 0
/**
 * @param input 来源网址（调用方已做最基础的形状校验）
 * @param extraHeaders 宿主适配器需要的**固定**请求头（如某站的租户头 X-Tenant-ID）。
 *   🔴 只允许传适配器里写死的常量；**绝不能**把用户输入拼进请求头，否则等于开放请求头注入。
 *   向后兼容：不传时与既有行为逐字节一致。
 */
export async function fetchSourceDocument(input: string, extraHeaders?: Record<string, string>): Promise<{ url: string; body: string }> {
  if (active >= 4) throw new Error('来源查询繁忙，请稍后重试')
  active++
  const deadline = Date.now() + 8000
  try {
    let url = new URL(input)
    for (let jump = 0; jump <= 3; jump++) {
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port)) || url.href.length > 2048) throw new Error('来源网址不受支持')
      const host = url.hostname.replace(/^\[|\]$/g, '')
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error('来源页面请求超时')
      let timer: ReturnType<typeof setTimeout> | undefined
      const records = await Promise.race([
        lookup(host, { all: true }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('来源域名解析超时')), remaining) }),
      ]).finally(() => clearTimeout(timer))
      if (!records.length || records.some(r => !isPublicAddress(r.address))) throw new Error('来源网址不是可访问的公网地址')
      const chosen = records[0]!
      const response = await new Promise<{ location?: string; body: string }>((resolve, reject) => {
        const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
          headers: { accept: 'text/html,application/json', 'accept-encoding': 'identity', ...(extraHeaders || {}) },
          // 固定已校验地址，避免校验后再次解析指向内网。
          lookup: ((_name: string, options: any, cb: any) => options.all ? cb(null, [chosen]) : cb(null, chosen.address, chosen.family)) as any,
          agent: false,
        }, res => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
            res.resume(); resolve({ location: res.headers.location, body: '' }); return
          }
          if (res.statusCode !== 200) { res.resume(); reject(new Error('来源页面暂不可用')); return }
          if (!/text\/|json|xhtml/i.test(String(res.headers['content-type'] || ''))) { res.resume(); reject(new Error('来源不是可解析的网页')); return }
          let size = 0
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > 1024 * 1024) { req.destroy(new Error('来源页面超过大小限制')); return }
            chunks.push(chunk)
          })
          res.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8') }))
          res.on('error', reject)
        })
        const timeout = setTimeout(() => req.destroy(new Error('来源页面请求超时')), Math.max(1, deadline - Date.now()))
        req.on('close', () => clearTimeout(timeout))
        req.on('error', reject)
        req.end()
      })
      if (!response.location) return { url: url.href, body: response.body }
      url = new URL(response.location, url)
    }
    throw new Error('来源页面跳转次数过多')
  } finally { active-- }
}
