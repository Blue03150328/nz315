// GET /api/admin/logs —— 操作日志（PRD 5.12.4）
// 2026-09-09 改造：按厂家/平台分组——一行=一个厂家（平台日志=平台操作组 id=0），展开查看该组明细；
// 筛选（keyword/module/action/result/date）命中分组自动返回（filtered=true）；
// 两种模式：①无 entId=分组列表（外层分页=厂家分组分页，rows 含 log_count 全量口径与 hit_count 过滤口径）；
// ②带 entId & dPage & dPageSize=该组过滤后明细页（内部可分页），rows 为日志明细（原字段不变）。
// 权限：platform_admin 全量（含平台组）；厂家/码管理员仅本企业一组（无平台组）。
import { query } from '../../utils/db'
import { requireBackendUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const q = getQuery(event)
  const conds: string[] = []
  const params: any[] = []

  // 企业过滤：非总部只能看本企业日志
  const isPlat = user.role === 'platform_admin'
  if (!isPlat) {
    conds.push('l.enterprise_id = ?'); params.push(user.enterprise_id)
  }
  // 通用筛选（与改造前同口径）
  if (q.keyword) {
    const kw = '%' + String(q.keyword).trim() + '%'
    conds.push('(u.username LIKE ? OR l.module LIKE ? OR l.action LIKE ? OR l.content LIKE ?)'); params.push(kw, kw, kw, kw)
  }
  if (q.module) { conds.push('l.module = ?'); params.push(String(q.module)) }
  if (q.action) { conds.push('l.action LIKE ?'); params.push('%' + String(q.action) + '%') }
  if (q.result !== undefined && q.result !== '') { conds.push('l.result = ?'); params.push(Number(q.result)) }
  if (q.dateFrom) { conds.push('l.created_at >= ?'); params.push(String(q.dateFrom) + ' 00:00:00') }
  if (q.dateTo) { conds.push('l.created_at <= ?'); params.push(String(q.dateTo) + ' 23:59:59') }
  const whereSql = conds.length ? 'WHERE ' + conds.join(' AND ') : ''

  const LOG_SELECT = 'l.*, u.username, u.role, e.name AS enterprise_name'
  const LOG_JOIN = 'FROM operation_log l LEFT JOIN \`user\` u ON l.user_id = u.id LEFT JOIN enterprise e ON l.enterprise_id = e.id '
  const hasFilter = !!(String(q.keyword || '').trim() || q.module || q.action || (q.result !== undefined && q.result !== '') || q.dateFrom || q.dateTo)

  // ========== 模式②：组内明细分页（前端展开分组时调用） ==========
  const entIdRaw = q.entId
  if (entIdRaw !== undefined && entIdRaw !== '') {
    const entId = Number(entIdRaw)
    const dPage = Math.max(1, parseInt(String(q.dPage || '1')))
    const dPageSize = Math.min(100, Math.max(1, parseInt(String(q.dPageSize || '10'))))
    if (!Number.isInteger(entId) || entId < 0) throw createError({ statusCode: 400, statusMessage: '无效的分组ID' })
    // 组限定（0=平台组 enterprise_id IS NULL）——企业账号访问他组明细由上方企业过滤兜底（同时加组条件也安全）
    conds.push(entId === 0 ? 'l.enterprise_id IS NULL' : 'l.enterprise_id = ?')
    if (entId !== 0) params.push(entId)
    const dWhere = 'WHERE ' + conds.join(' AND ')
    const [cnt] = await query<any[]>('SELECT COUNT(*) AS c ' + LOG_JOIN + dWhere, params)
    const dOffset = (dPage - 1) * dPageSize
    const detailRows = await query<any[]>(
      'SELECT ' + LOG_SELECT + ' ' + LOG_JOIN + dWhere + ' ORDER BY l.id DESC LIMIT ? OFFSET ?', [...params, dPageSize, dOffset])
    return { detail: true, entId, page: dPage, pageSize: dPageSize, total: Number(cnt?.c || 0), rows: detailRows }
  }

  // ========== 模式①：厂家分组列表 ==========
  // 全量口径：每企业日志总数（行头展示，与筛选无关）
  const cntAll = await query<any[]>('SELECT enterprise_id, COUNT(*) AS c FROM operation_log GROUP BY enterprise_id')
  const allByEnt = new Map<number, number>()
  for (const r of cntAll) allByEnt.set(r.enterprise_id === null ? 0 : Number(r.enterprise_id), Number(r.c))

  // 过滤口径：命中日志按企业聚合（NULL=平台组）
  const cntHit = await query<any[]>(
    'SELECT l.enterprise_id, COUNT(*) AS c ' + LOG_JOIN + (whereSql ? whereSql : 'WHERE 1=1') + ' GROUP BY l.enterprise_id', params)
  const hitByEnt = new Map<number, number>()
  for (const r of cntHit) hitByEnt.set(r.enterprise_id === null ? 0 : Number(r.enterprise_id), Number(r.c))

  // 组清单：筛选态=命中组（企业 id 升序 + 平台组最后）；无条件=全部企业 + 平台组（platform_admin）
  let groupIds: number[] = []
  const PLATFORM_GID = 0
  if (hasFilter) {
    groupIds = [...hitByEnt.keys()].filter((g) => g !== PLATFORM_GID).sort((a, b) => a - b)
    if (isPlat && hitByEnt.has(PLATFORM_GID)) groupIds.push(PLATFORM_GID)
  } else {
    if (isPlat) {
      const ents = await query<any[]>('SELECT id FROM enterprise ORDER BY id ASC')
      groupIds = ents.map((e: any) => Number(e.id))
      groupIds.push(PLATFORM_GID)
    } else {
      groupIds = [Number(user.enterprise_id)]
    }
  }

  // 组名（企业名 / 平台组固定名「平台操作」）
  const realIds = groupIds.filter((g) => g !== PLATFORM_GID)
  const nameMap = new Map<number, string>()
  if (realIds.length) {
    const ents = await query<any[]>('SELECT id, name FROM enterprise WHERE id IN (?)', [realIds])
    for (const e of ents) nameMap.set(Number(e.id), e.name)
  }

  const totalLogs = [...hitByEnt.values()].reduce((s, n) => s + n, 0)
  const total = groupIds.length
  const page = Math.max(1, parseInt(String(q.page || '1')))
  const pageSize = Math.min(100, Math.max(1, parseInt(String(q.pageSize || '20'))))
  const offset = (page - 1) * pageSize
  const rows = groupIds.slice(offset, offset + pageSize).map((gid: number) => ({
    id: gid,
    name: gid === PLATFORM_GID ? '平台操作' : (nameMap.get(gid) || '未知企业'),
    log_count: allByEnt.get(gid) || 0,      // 该厂家日志总条数（全量口径）
    hit_count: hitByEnt.get(gid) || 0,      // 当前筛选命中条数（明细可分页 total）
  }))

  return { total, totalLogs, filtered: hasFilter, page, pageSize, rows }
})
