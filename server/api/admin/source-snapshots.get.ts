import { query } from '../../utils/db'
import { requirePlatformAdmin } from '../../utils/auth'
export default defineEventHandler(async event => {
  await requirePlatformAdmin(event)
  const input = getQuery(event)
  const page = Math.min(100000, Math.max(1, Math.floor(Number(input.page) || 1)))
  const code = String(input.code || '').trim()
  if (code && !/^\d{32}$/.test(code)) throw createError({ statusCode: 400, statusMessage: '请输入完整32位码' })
  const where = code ? ' WHERE code = ?' : ''
  const params = code ? [code] : []
  const [count] = await query<any[]>('SELECT COUNT(*) AS c FROM external_source_snapshot' + where, params)
  const rows = await query<any[]>('SELECT id, code, source_url, parser_version, created_at, JSON_UNQUOTE(JSON_EXTRACT(payload, \'$.status\')) AS status FROM external_source_snapshot' + where + ' ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET ?', [...params, (page - 1) * 20])
  return { total: Number(count?.c || 0), rows }
})
