// GET /api/admin/users —— 用户列表（厂家分组结构，PRD 5.12.3）
// 2026-09-08：一行=一个厂家（含平台总部虚拟组 id=0），展开查看用户明细；筛选命中厂家自动返回；外层分页=厂家分页。
// 2026-09-09：厂家行新增 续费状态（renew_status/renew_label，SQL CURDATE 口径）与 can_delete（无业务数据引用才可删）；
// keyword 支持双通道——账号信息（登录名/姓名/手机号）与厂家名称（名称命中则该厂家整组返回，组内明细仍按 role/status 过滤）。
// 规模假设：初期用户数千~数万、企业数百，一次性取池内存分组足够；量大改 SQL 分组分页。
import { query } from '../../utils/db'
import { requireBackendUser } from '../../utils/auth'

const ROLE_LABEL: Record<string, string> = { platform_admin: '总部管理员', enterprise_admin: '厂家主账号', code_admin: '码管理员', viewer: '只读账号' }

// 厂家业务数据引用表（删除厂家前置检查：任一命中即不可删，防数据孤儿）
const ENT_REF_TABLES = ['product', 'product_spec', 'batch', 'upload_batch', 'trace_code']

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const q = getQuery(event)
  const page = Math.max(1, parseInt(String(q.page || '1')))
  const pageSize = Math.min(100, Math.max(1, parseInt(String(q.pageSize || '20'))))
  const offset = (page - 1) * pageSize
  const kw = String(q.keyword || '').trim()
  const hasFilter = !!(kw || q.role || (q.status !== undefined && q.status !== ''))

  // —— 权限内可见用户池（platform_admin 全量可 ?enterpriseId= 限定；厂家/码管理员仅本企业）——
  const conds: string[] = []
  const params: any[] = []
  if (user.role === 'platform_admin') {
    if (q.enterpriseId) { conds.push('u.enterprise_id = ?'); params.push(Number(q.enterpriseId)) }
  } else {
    conds.push('u.enterprise_id = ?'); params.push(user.enterprise_id)
  }
  const whereSql = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const allUsers = await query<any[]>(
    `SELECT u.id, u.enterprise_id, u.username, u.name, u.phone, u.role, u.status, u.last_login_at, u.last_login_ip, u.created_at,
       e.name AS enterprise_name
     FROM \`user\` u LEFT JOIN enterprise e ON u.enterprise_id = e.id ` + whereSql +
    ' ORDER BY u.id ASC', params)

  // —— 账号维度筛选（keyword 兼容原 LIKE 大小写不敏感：统一小写比对）——
  let pool = allUsers
  if (hasFilter) {
    const kwl = kw.toLowerCase()
    if (kwl) {
      pool = pool.filter((r: any) =>
        String(r.username || '').toLowerCase().includes(kwl)
        || String(r.name || '').toLowerCase().includes(kwl)
        || String(r.phone || '').toLowerCase().includes(kwl))
    }
    if (q.role) { const role = String(q.role); pool = pool.filter((r: any) => r.role === role) }
    if (q.status !== undefined && q.status !== '') { const st = Number(q.status); pool = pool.filter((r: any) => Number(r.status) === st) }
  }

  // —— 每企业用户全量数（行头「用户总数」恒为全量口径）——
  const cntRows = await query<any[]>('SELECT enterprise_id, COUNT(*) AS c FROM \`user\` GROUP BY enterprise_id')
  const userCntByEnt = new Map<number, number>()
  for (const r of cntRows) userCntByEnt.set(r.enterprise_id === null ? 0 : Number(r.enterprise_id), Number(r.c))

  // —— 企业元数据（名称/续费到期/续费有效标记），enterprise 查询统一带 renew 字段 ——
  const ENT_SELECT = 'id, name, renew_expire, (renew_expire IS NOT NULL AND renew_expire >= CURDATE()) AS renew_active'
  const PLATFORM_GID = 0 // 虚拟组：enterprise_id IS NULL 的总部账号
  type EntMeta = { name: string; renew_expire: string | null; renew_active: boolean }
  const entMeta = new Map<number, EntMeta>()
  let groupIds: number[] = []

  if (hasFilter) {
    // 1) 账号命中组
    groupIds = [...new Set(pool.map((u: any) => u.enterprise_id === null ? PLATFORM_GID : Number(u.enterprise_id)))]
    // 2) keyword 厂家名通道（名称 LIKE 命中 → 整厂返回，追加到组清单末尾）
    if (kw && user.role === 'platform_admin') {
      const entHits = await query<any[]>('SELECT ' + ENT_SELECT + " FROM enterprise WHERE name LIKE ? ORDER BY id ASC", ['%' + kw + '%'])
      for (const e of entHits) {
        const id = Number(e.id)
        entMeta.set(id, { name: e.name, renew_expire: e.renew_expire ? String(e.renew_expire).slice(0, 10) : null, renew_active: Number(e.renew_active) === 1 })
        if (!groupIds.includes(id)) groupIds.push(id)
      }
    }
    // 组名补查（账号命中组的企业）
    const ids = groupIds.filter((g) => g !== PLATFORM_GID && !entMeta.has(g))
    if (ids.length) {
      const ents = await query<any[]>('SELECT ' + ENT_SELECT + ' FROM enterprise WHERE id IN (?)', [ids])
      for (const e of ents) {
        const id = Number(e.id)
        entMeta.set(id, { name: e.name, renew_expire: e.renew_expire ? String(e.renew_expire).slice(0, 10) : null, renew_active: Number(e.renew_active) === 1 })
      }
    }
  } else {
    if (user.role === 'platform_admin') {
      if (q.enterpriseId) {
        const [ent] = await query<any[]>('SELECT ' + ENT_SELECT + ' FROM enterprise WHERE id = ?', [Number(q.enterpriseId)])
        if (ent) {
          entMeta.set(Number(ent.id), { name: ent.name, renew_expire: ent.renew_expire ? String(ent.renew_expire).slice(0, 10) : null, renew_active: Number(ent.renew_active) === 1 })
          groupIds = [Number(ent.id)]
        }
      } else {
        const ents = await query<any[]>('SELECT ' + ENT_SELECT + ' FROM enterprise ORDER BY id ASC')
        for (const e of ents) entMeta.set(Number(e.id), { name: e.name, renew_expire: e.renew_expire ? String(e.renew_expire).slice(0, 10) : null, renew_active: Number(e.renew_active) === 1 })
        groupIds = ents.map((e: any) => Number(e.id))
        groupIds.push(PLATFORM_GID) // 平台总部组（如 admin）排最后
      }
    } else {
      // 厂家/码管理员：仅本企业一组
      groupIds = [Number(user.enterprise_id)]
      const [ent] = await query<any[]>('SELECT ' + ENT_SELECT + ' FROM enterprise WHERE id = ?', [Number(user.enterprise_id)])
      if (ent) entMeta.set(Number(ent.id), { name: ent.name, renew_expire: ent.renew_expire ? String(ent.renew_expire).slice(0, 10) : null, renew_active: Number(ent.renew_active) === 1 })
    }
  }

  // —— 组装行（外层厂家分页；组内用户不单独分页）——
  const total = groupIds.length
  const pageGroupIds = groupIds.slice(offset, offset + pageSize)

  // can_delete：本页厂家逐一查 5 张业务表引用（UNION ALL 一次查询）
  const refSet = new Set<number>()
  const realIds = pageGroupIds.filter((g) => g !== PLATFORM_GID)
  if (realIds.length) {
    const unions = ENT_REF_TABLES.map((t) => 'SELECT enterprise_id, COUNT(*) AS c FROM ' + t + ' WHERE enterprise_id IN (?) GROUP BY enterprise_id').join(' UNION ALL ')
    const refRows = await query<any[]>('SELECT enterprise_id, SUM(c) AS ref FROM (' + unions + ') t GROUP BY enterprise_id', ENT_REF_TABLES.map(() => realIds).flat())
    for (const r of refRows) {
      const id = Number(r.enterprise_id)
      if (Number(r.ref) > 0) refSet.add(id)
    }
  }

  const rows = pageGroupIds.map((gid: number) => {
    const users = pool
      .filter((u: any) => (u.enterprise_id === null ? PLATFORM_GID : Number(u.enterprise_id)) === gid)
      .map((u: any) => ({ ...u, roleLabel: ROLE_LABEL[u.role] || u.role }))
    const isPlat = gid === PLATFORM_GID
    const meta = entMeta.get(gid)
    return {
      id: gid,
      name: isPlat ? '平台总部' : (meta?.name || '未知企业'),
      user_count: userCntByEnt.get(gid) || 0,
      // 续费状态：平台组无续费概念（null）；厂家组 active=有效期内 / expired=到期未续费（NULL 或已过期）
      renew_expire: isPlat ? null : (meta?.renew_expire || null),
      renew_status: isPlat ? null : (meta?.renew_active ? 'active' : 'expired'),
      renew_label: isPlat ? null : (meta?.renew_active ? '有效期内' : '到期未续费'),
      can_delete: !isPlat && !refSet.has(gid),
      users,
    }
  })

  return {
    total,
    totalUsers: pool.length,
    filtered: hasFilter,
    page,
    pageSize,
    rows,
  }
})
