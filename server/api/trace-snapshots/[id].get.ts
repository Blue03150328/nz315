// 随机快照链接只返回当次公开查询结果，不返回原始 HTML、数据库行或用户资料。
import { query } from '../../utils/db'
import { allowRequest } from '../../utils/rate-limit'
import { clientIpOf } from '../../utils/audit'
export default defineEventHandler(async event => {
  if (!allowRequest('snapshot-read:' + clientIpOf(event), 60, 60000)) throw createError({ statusCode: 429, statusMessage: '查询过于频繁，请稍后重试' })
  const id = getRouterParam(event, 'id') || ''
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id)) throw createError({ statusCode: 404, statusMessage: '快照不存在' })
  const [row] = await query<any[]>('SELECT payload FROM external_source_snapshot WHERE id = ?', [id])
  if (!row) throw createError({ statusCode: 404, statusMessage: '快照不存在' })
  return typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload
})
