import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

// 规格快照绑定生成结果，不信任客户端自行填写的包装名称。
function codeDigest(codes: readonly string[]) {
  const hash = createHash('sha256')
  for (const code of codes) hash.update(code).update('\n')
  return hash.digest('hex')
}

export function issueCodeSpecSnapshot(productId: number, codes: readonly string[], specName: unknown, secret: string): string {
  if (!secret) throw new Error('服务端规格快照密钥未配置')
  const payload = Buffer.from(JSON.stringify({ version: 1, productId, count: codes.length, digest: codeDigest(codes), specName: typeof specName === 'string' && specName.trim() ? specName.trim().slice(0, 255) : null })).toString('base64url')
  const signature = createHmac('sha256', secret).update('code-spec-v1:' + payload).digest('base64url')
  return payload + '.' + signature
}

export function verifyCodeSpecSnapshot(token: unknown, productId: number, codes: readonly string[], secret: string): { specName: string | null } | null {
  if (typeof token !== 'string' || token.length > 2048 || !secret) return null
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  try {
    const expected = createHmac('sha256', secret).update('code-spec-v1:' + parts[0]).digest()
    const actual = Buffer.from(parts[1], 'base64url')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
    if (payload.version !== 1 || payload.productId !== productId || payload.count !== codes.length || payload.digest !== codeDigest(codes)) return null
    if (payload.specName !== null && (typeof payload.specName !== 'string' || !payload.specName.trim() || payload.specName.length > 255)) return null
    return { specName: payload.specName }
  } catch { return null }
}
