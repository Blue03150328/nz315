// GET /api/admin/users —— 用户列表（厂家分组结构，PRD 5.12.3）
// 2026-09-08 改造：一行=一个厂家（含平台总部虚拟组），展开查看该厂家下属用户明细；
// 筛选（keyword/role/status）作用于用户维度——命中厂家自动返回并带 hit 标记，组内 users 为命中用户；
// 外层分页 = 厂家分页；用户明细不单独分页。
// 规模假设：SaaS 初期用户总量数千~数万、企业数百，一次性取池内存分组足够；
// 若未来用户量级大幅增长，需改为 SQL 层 GROUP BY enterprise_id 后再按组取明细。
import { query } from '../../utils/db'
import { requireBackendUser } from '../../utils/auth'

const ROLE_LABEL: Record<string, string> = { platform_admin: '总部管理员', enterprise_admin: '厂家主账号', code_admin: '码管理员', viewer: '只读账号' }

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const q = getQuery(event)
  const page = Math.max(1, parseInt(String(q.page || '1')))
  const pageSize = Math.min(100, Math.max(1, parseInt(String(q.pageSize || '20'))))
  const offset = (page - 1) * pageSize
  const hasFilter = !!(String(q.keyword || '').trim() || q.role || (q.status !== undefined && q.status !== ''))

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

  // —— 筛选（keyword 兼容原 LIKE 大小写不敏感语义：统一小写比对）——
  let pool = allUsers
  if (hasFilter) {
    const kw = String(q.keyword || '').trim().toLowerCase()
    if (kw) {
      pool = pool.filter((r: any) =>
        String(r.username || '').toLowerCase().includes(kw)
        || String(r.name || '').toLowerCase().includes(kw)
        || String(r.phone || '').toLowerCase().includes(kw))
    }
    if (q.role) { const role = String(q.role); pool = pool.filter((r: any) => r.role === role) }
    if (q.status !== undefined && q.status !== '') { const st = Number(q.status); pool = pool.filter((r: any) => Number(r.status) === st) }
  }

  // —— 每企业用户全量数（行头「用户总数」与筛选无关，恒为全量口径）——
  const cntRows = await query<any[]>('SELECT enterprise_id, COUNT(*) AS c FROM \`user\` GROUP BY enterprise_id')
  const userCntByEnt = new Map<number, number>()
  for (const r of cntRows) userCntByEnt.set(r.enterprise_id === null ? 0 : Number(r.enterprise_id), Number(r.c))

  // —— 有序组清单：筛选态=命中用户所在企业（去重，按用户 id 序）；无条件=企业全量+平台总部组（仅 platform_admin）——
  const PLATFORM_GID = 0 // 虚拟组：enterprise_id IS NULL 的总部账号
  let entNameMap = new Map<number, string>()
  let groupIds: number[] = []
  if (hasFilter) {
    groupIds = [...new Set(pool.map((u: any) => u.enterprise_id === null ? PLATFORM_GID : Number(u.enterprise_id)))]
    if (groupIds.length) {
      const ids = groupIds.filter((g) => g !== PLATFORM_GID)
      if (ids.length) {
        const ents = await query<any[]>('SELECT id, name FROM enterprise WHERE id IN (?)', [ids])
        for (const e of ents) entNameMap.set(Number(e.id), e.name)
      }
    }
  } else {
    if (user.role === 'platform_admin') {
      if (q.enterpriseId) {
        // 指定企业时仅返回该企业一组（平台组不参与）
        const [ent] = await query<any[]>('SELECT id, name FROM enterprise WHERE id = ?', [Number(q.enterpriseId)])
        if (ent) { entNameMap.set(Number(ent.id), ent.name); groupIds = [Number(ent.id)] }
      } else {
        const ents = await query<any[]>('SELECT id, name FROM enterprise ORDER BY id ASC')
        for (const e of ents) entNameMap.set(Number(e.id), e.name)
        groupIds = ents.map((e: any) => Number(e.id))
        groupIds.push(PLATFORM_GID) // 平台总部组（如 admin）排最后
      }
    } else {
      // 厂家/码管理员：仅本企业一组
      groupIds = [Number(user.enterprise_id)]
      const [ent] = await query<any[]>('SELECT id, name FROM enterprise WHERE id = ?', [Number(user.enterprise_id)])
      if (ent) entNameMap.set(Number(ent.id), ent.name)
    }
  }

  // —— 组装行（外层厂家分页；组内用户不单独分页）——
  const total = groupIds.length
  const pageGroupIds = groupIds.slice(offset, offset + pageSize)
  const rows = pageGroupIds.map((gid: number) => {
    const users = pool
      .filter((u: any) => (u.enterprise_id === null ? PLATFORM_GID : Number(u.enterprise_id)) === gid)
      .map((u: any) => ({ ...u, roleLabel: ROLE_LABEL[u.role] || u.role }))
    return {
      id: gid,
      name: gid === PLATFORM_GID ? '平台总部' : (entNameMap.get(gid) || '未知企业'),
      user_count: userCntByEnt.get(gid) || 0,
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
