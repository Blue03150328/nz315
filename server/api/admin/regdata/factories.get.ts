// GET /api/admin/regdata/factories —— 登记数据源厂家列表（归属企业候选，2026-09-07 用户需求：
// 归属企业展示「农药登记全量数据」中全部生产厂家，非系统 enterprise 表）
// 参数：keyword（厂家名模糊）、page/pageSize；返回去重厂家名分页
import { query } from '../../../utils/db'
import { requireBackendUser } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireBackendUser(event)
  const q = getQuery(event)
  const keyword = String(q.keyword || '').trim().slice(0, 64)
  const conds: string[] = ["company IS NOT NULL AND company <> ''"]
  const params: any[] = []
  if (keyword) {
    conds.push('company LIKE ?')
    params.push('%' + keyword + '%')
  }
  const whereSql = 'WHERE ' + conds.join(' AND ')
  const [cntRow] = await query<any[]>(
    'SELECT COUNT(DISTINCT company) AS c FROM pesticide_reg ' + whereSql, params)
  const total = Number(cntRow?.c || 0)
  // 模糊搜索无法走 DISTINCT 索引，全表聚合后分页内存截取（3,637 家量级可控）
  const rows = await query<any[]>(
    'SELECT DISTINCT company FROM pesticide_reg ' + whereSql + ' ORDER BY company', params)
  const page = Math.max(1, parseInt(String(q.page || '1')))
  const pageSize = Math.min(200, Math.max(1, parseInt(String(q.pageSize || '100'))))
  const offset = (page - 1) * pageSize
  return {
    total,
    page, pageSize,
    rows: rows.slice(offset, offset + pageSize).map((r: any) => r.company),
  }
})
