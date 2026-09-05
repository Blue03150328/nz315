// GET /api/admin/regdata/originals —— 原药（母药）候选查询
// 两种模式：
//  - ?regNo=登记证号：按登记产品全有效成分合并候选池（原药多行 UI，含复配多成分；原药/母药产品自身必在池内）
//  - ?ingredient=有效成分名：单成分候选（向后兼容）
import { query } from '../../../utils/db'
import { requireBackendUser } from '../../../utils/auth'
import { findOriginalPool } from '../../../utils/regdata'

export default defineEventHandler(async (event) => {
  await requireBackendUser(event)
  const q = getQuery(event)
  const regNo = String(q.regNo || '').trim().toUpperCase()

  // 产品级模式：按登记证取全成分池
  if (regNo) {
    const { reg, isOriginal, ingredients, pool } = await findOriginalPool(regNo)
    if (!reg) throw createError({ statusCode: 404, statusMessage: '登记数据源中未找到该登记证号' })
    return {
      mode: 'pool',
      regNo,
      isOriginal,
      ingredients,
      total: pool.length,
      rows: pool.map((r: any) => ({
        registration_no: r.registration_no,
        product_name: r.product_name,
        dosage: r.dosage,
        company: r.company,
        expire_date: r.expire_date,
      })),
    }
  }

  // 单成分模式（向后兼容）
  const ingredient = String(q.ingredient || '').trim().slice(0, 120)
  if (!ingredient) throw createError({ statusCode: 400, statusMessage: '缺少有效成分名或登记证号参数' })
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
    mode: 'ingredient',
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
