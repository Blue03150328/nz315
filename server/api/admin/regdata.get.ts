// GET /api/admin/regdata —— 农药登记数据源候选搜索（产品弹窗「登记产品」下拉）
// 业务规则：
//  - 生产类型=持有人生产(1)：仅返回「本厂」登记产品（按当前企业/指定企业与数据源生产厂家归一化名称相等匹配）
//  - 生产类型=委托加工(2)/委托分装(3)：返回全部厂家产品
//  - 仅返回登记证仍在有效期内的记录（过期登记证不进下拉，避免误建「登记证过期」产品）
//  - 登记类别代码随行返回（PD/PDN/LS/EX→1，WP/WPN/WL→2）
// 参数：keyword / produceType / enterpriseId(总部代选企业) / exact(精确核对某登记证是否在候选内，用于切换生产类型后的保留判断) / page / pageSize
import { query } from '../../utils/db'
import { requireBackendUser } from '../../utils/auth'
import { normalizeOrgName, regCategoryOf } from '../../utils/regdata'

/** SQL 侧企业名归一化（与 normalizeOrgName 规则一致，按序去后缀与空格） */
const COMPANY_NORM_SQL = `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(company,'股份有限公司',''),'有限责任公司',''),'有限公司',''),'集团',''),' ',''),'　','')`

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const q = getQuery(event)
  const keyword = String(q.keyword || '').trim().slice(0, 64)
  const produceType = Number(q.produceType ?? 1)
  const exact = String(q.exact || '').trim().toUpperCase()

  // 目标企业：厂家账号固定本企业；总部管理员可代选（表单提供企业下拉）
  let enterpriseId: number | null = user.enterprise_id
  if (user.role === 'platform_admin' && q.enterpriseId) {
    enterpriseId = Number(q.enterpriseId) || null
  }

  const conds: string[] = ['(expire_date IS NULL OR expire_date >= CURDATE())']
  const params: any[] = []

  // 「本厂产品」过滤：持有人生产必须归属本企业（按企业名称与数据源生产厂家归一化相等判定）
  if (produceType === 1) {
    let entName = ''
    if (enterpriseId) {
      const [ent] = await query<any[]>('SELECT name FROM enterprise WHERE id = ?', [enterpriseId])
      entName = ent?.name ? String(ent.name) : ''
    }
    if (!entName) {
      // 无归属企业（总部未选企业等）：直接返回空，提示选择企业
      return { total: 0, page: 1, pageSize: 0, rows: [], emptyReason: 'noEnterprise', hint: '请先选择归属企业（总部管理员）或确认本企业已设置企业名称' }
    }
    const norm = normalizeOrgName(entName)
    conds.push('(company IS NOT NULL AND ' + COMPANY_NORM_SQL + ' = ?)')
    params.push(norm)
  }

  if (exact) {
    // 精确核对模式：仅判断某登记证是否落在当前候选范围内
    conds.push('registration_no = ?')
    params.push(exact)
  } else if (keyword) {
    const like = '%' + keyword + '%'
    conds.push('(registration_no LIKE ? OR product_name LIKE ? OR company LIKE ?)')
    params.push(like, like, like)
  }

  const whereSql = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const page = Math.max(1, parseInt(String(q.page || '1')))
  const pageSize = Math.min(100, Math.max(1, parseInt(String(q.pageSize || '30'))))
  const offset = (page - 1) * pageSize

  if (exact) {
    // 精确核对：返回是否存在（供前端切换生产类型时判断是否保留当前选择）
    const [row] = await query<any[]>(
      'SELECT registration_no FROM pesticide_reg ' + whereSql + ' LIMIT 1', params)
    return { ok: Boolean(row), registrationNo: exact }
  }

  const [cntRow] = await query<any[]>(
    'SELECT COUNT(*) AS c FROM pesticide_reg ' + whereSql, params)
  // 排序：登记证号前缀 PD 优先（现行正式登记），其余按有效期倒序（新证在前）
  const rows = await query<any[]>(
    `SELECT registration_no, product_name, trademark, content, dosage, toxicity, expire_date, company,
            ingredients, ingredient_main, ingredient_all, category, mixture
       FROM pesticide_reg ` + whereSql +
    ` ORDER BY (LEFT(registration_no,2) IN ('PD','WP')) DESC, expire_date DESC, registration_no
      LIMIT ? OFFSET ?`,
    [...params, pageSize, offset])

  const total = Number(cntRow?.c || 0)
  return {
    total,
    page, pageSize,
    // 持有人生产过滤下无本厂登记产品（且无关键词时）→ 引导检查企业名称
    emptyReason: produceType === 1 && total === 0 && !keyword ? 'noOwn' : undefined,
    // 附登记类别代码与厂家名（回填用），便于前端零计算
    rows: rows.map((r: any) => ({
      registration_no: r.registration_no,
      product_name: r.product_name,
      trademark: r.trademark,
      content: r.content,
      dosage: r.dosage,
      toxicity: r.toxicity,
      expire_date: r.expire_date,
      company: r.company,
      ingredients: r.ingredients,
      ingredient_main: r.ingredient_main,
      ingredient_all: r.ingredient_all,
      category: r.category,
      mixture: r.mixture,
      reg_category: regCategoryOf(r.registration_no),
    })),
  }
})
