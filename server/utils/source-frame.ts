// 保守确认原页能否嵌入；未知或复杂的策略交给原页入口，不移除外站的限制。
export function frameAllowed(url: string, parentOrigin: string, frameOptions = '', framePolicy = ''): boolean {
  if (new URL(url).protocol !== 'https:' || frameOptions.trim()) return false
  const policies = framePolicy.split(',')
  return policies.every(policy => {
    const directive = policy.split(';').map(item => item.trim()).find(item => /^frame-ancestors(?:\s|$)/i.test(item))
    if (!directive) return true
    const entries = directive.split(/\s+/).slice(1)
    if (entries.includes("'none'")) return false
    return entries.some(entry => {
      if (entry === '*') return true
      if (entry === "'self'") return new URL(url).origin === parentOrigin
      if (entry === 'https:') return parentOrigin.startsWith('https://')
      // 仅识别完整来源的精确授权，通配符及路径策略不猜测。
      try { return !entry.includes('*') && new URL(entry).origin === parentOrigin && new URL(entry).pathname === '/' } catch { return false }
    })
  })
}
