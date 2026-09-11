// PATCH /api/admin/products/:id —— 编辑产品 / 停用启用（PRD 5.4）
// 原药多行化（2026-09-04）：body.originals 全量替换 product_original（先删后插，事务）
import { getPool, query, execute } from '../../../utils/db'
import { requireWritableUser } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: '无效的产品ID' })
  const body = await readBody(event) || {}

  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  const [prod] = await query<any[]>(
    'SELECT * FROM product WHERE id = ?' + (fid ? ' AND enterprise_id = ?' : ''), fid ? [id, fid] : [id])
  if (!prod) throw createError({ statusCode: 404, statusMessage: '产品不存在' })

  // 仅状态变更
  if (body?.status !== undefined && Object.keys(body).length === 1) {
    await execute('UPDATE product SET status = ? WHERE id = ?', [Number(body.status) ? 1 : 0, id])
    return { ok: true }
  }

  const name = String(body.name || '').trim()
  const registrationNo = String(body.registrationNo || '').trim().toUpperCase()
  if (!registrationNo) throw createError({ statusCode: 400, statusMessage: '请输入登记证号' })
  if (!name) throw createError({ statusCode: 400, statusMessage: '请输入农药名称' })
  if (!body.specId) throw createError({ statusCode: 400, statusMessage: '请选择规格' })
  if (!String(body.category || '').trim()) throw createError({ statusCode: 400, statusMessage: '请选择产品类别' })

  // 原药行校验（同新增口径）
  const originals = Array.isArray(body.originals) ? body.originals : []
  if (!originals.length) throw createError({ statusCode: 400, statusMessage: '原药信息至少保留 1 行' })
  const validOriginals = originals.filter((row: any) => String(row.regNo || '').trim() || String(row.company || '').trim())
  if (!validOriginals.length) throw createError({ statusCode: 400, statusMessage: '原药信息至少保留 1 行有效记录' })
  for (const row of validOriginals) if (!String(row.regNo || '').trim() || !String(row.company || '').trim()) throw createError({ statusCode: 400, statusMessage: '原药登记证号与原药生产企业名称需同时填写' })

  const [dup] = await query<any[]>(
    'SELECT id FROM product WHERE registration_no = ? AND id <> ? LIMIT 1', [registrationNo, id])
  if (dup) throw createError({ statusCode: 400, statusMessage: '该登记证号已存在' })

  const pool = getPool()
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.execute(
      `UPDATE product SET trademark = ?, name = ?, registration_no = ?, registration_expire = ?, reg_category = ?,
         holder_name = ?, produce_type = ?, dosage = ?, content = ?,
         spec_id = ?, category = ?, toxicity = ?, is_restricted = ?, label_image = ?, manual_image = ?
       WHERE id = ?`,
      [String(body.trademark || '').trim(), name, registrationNo,
       body.registrationExpire || null,
       body.regCategory !== undefined ? Number(body.regCategory) : prod.reg_category,
       String(body.holderName || '').trim(),
       body.produceType !== undefined ? Number(body.produceType) : prod.produce_type,
       String(body.dosage || '').trim(), String(body.content || '').trim(),
       Number(body.specId),
       String(body.category || '').trim(), String(body.toxicity || '').trim(),
       body.isRestricted ? 1 : 0,
       String(body.labelImage || '').trim() || null,
       String(body.manualImage || '').trim() || null,
       id]
    )
    // 原药行全量替换（先删后插）
    await conn.execute('DELETE FROM product_original WHERE product_id = ?', [id])
    for (const row of validOriginals) {
      await conn.execute(
        'INSERT INTO product_original (product_id, ingredient, reg_no, company) VALUES (?,?,?,?)',
        [id, String(row.ingredient || '').trim() || null, String(row.regNo).trim(), String(row.company).trim()]
      )
    }
    await conn.commit()
    return { ok: true }
  } catch (e: any) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
})
