// GET /api/admin/regdata/originals —— 原药（母药）候选查询
// 制剂产品按「有效成分名」匹配数据源中剂型=原药/母药 且有效期内的登记记录；
// 前端根据候选条数切换原药两字段的「只读回填 / 下拉选择 / 手动补充」状态
// 参数：ingredient（有效成分名，必填）
import { query } from '../../../utils/db'
import { requireBackendUser } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireBackendUser(event)
  const q = getQuery(event)
  const ingredient = String(q.ingredient || '').trim().slice(0, 120)
  if (!ingredient) throw createError({ statusCode: 400, statusMessage: '缺少有效成分名参数' })

  const rows = await query<any[]>(
    `SELECT registration_no, product_name, dosage, company, expire_date
       FROM pesticide_reg
      WHERE dosage IN ('原药','母药') AND ingredient_main = ?
        AND (expire_date IS NULL OR expire_date >= CURDATE())
      ORDER BY expire_date DESC
      LIMIT 50`,
    [ingredient]
  )
  return {
    total: rows.length,
    rows: rows.map((r: any) => ({
      registration_no: r.registration_no,
      product_name: r.product_name,
      dosage: r.dosage,
      company: r.company,
      expire_date: r.expire_date,
    })),
  }
})
