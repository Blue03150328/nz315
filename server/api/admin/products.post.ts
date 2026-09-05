// POST /api/admin/products —— 新增产品（PRD 5.4）
// 原药（母药）信息多行化（2026-09-04）：body.originals = [{ regNo, company }]，
// 至少 1 行且每行两字段必填；写入 product + product_original（事务）
import { getPool, query } from '../../utils/db'
import { requireWritableUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const body = await readBody(event) || {}

  const name = String(body.name || '').trim()
  const registrationNo = String(body.registrationNo || '').trim().toUpperCase()
  if (!registrationNo) throw createError({ statusCode: 400, statusMessage: '请输入登记证号' })
  if (!name) throw createError({ statusCode: 400, statusMessage: '请输入农药名称' })
  if (!body.specId) throw createError({ statusCode: 400, statusMessage: '请选择规格（来自产品规格主数据）' })
  if (!String(body.category || '').trim()) throw createError({ statusCode: 400, statusMessage: '请选择产品类别' })

  // 原药行校验：至少 1 行，每行登记证号与企业名称必填（含手动输入的自定义内容，需非空）
  const originals = Array.isArray(body.originals) ? body.originals : []
  if (!originals.length) throw createError({ statusCode: 400, statusMessage: '原药信息至少保留 1 行' })
  for (const row of originals) {
    if (!String(row.regNo || '').trim()) throw createError({ statusCode: 400, statusMessage: '原药登记证号不能为空（每行必填）' })
    if (!String(row.company || '').trim()) throw createError({ statusCode: 400, statusMessage: '原药生产企业名称不能为空（每行必填）' })
  }

  // 登记证号全局唯一（PRD 5.4 业务规则1）
  const [dup] = await query<any[]>('SELECT id FROM product WHERE registration_no = ? LIMIT 1', [registrationNo])
  if (dup) throw createError({ statusCode: 400, statusMessage: '该登记证号已存在' })

  let fid: number | null = user.enterprise_id
  if (user.role === 'platform_admin') {
    fid = Number(body.enterpriseId)
    if (!Number.isInteger(fid) || (fid as number) <= 0) {
      throw createError({ statusCode: 400, statusMessage: '请指定有效的企业ID' })
    }
  }

  const pool = getPool()
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [result]: any[] = await conn.query(
      `INSERT INTO product (enterprise_id, trademark, name, registration_no, registration_expire, reg_category,
         holder_name, produce_type, dosage, content, spec_id,
         category, toxicity, is_restricted, label_image, manual_image, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [fid,
       String(body.trademark || '').trim(),
       name, registrationNo,
       body.registrationExpire || null,
       body.regCategory !== undefined ? Number(body.regCategory) : 1,
       String(body.holderName || '').trim(),
       body.produceType !== undefined ? Number(body.produceType) : 1,
       String(body.dosage || '').trim(), String(body.content || '').trim(),
       Number(body.specId),
       String(body.category || '').trim(), String(body.toxicity || '').trim(),
       body.isRestricted ? 1 : 0,
       String(body.labelImage || '').trim() || null,
       String(body.manualImage || '').trim() || null,
       body.status === 0 ? 0 : 1]
    )
    // 原药行批量写入
    for (const row of originals) {
      await conn.query(
        'INSERT INTO product_original (product_id, reg_no, company) VALUES (?,?,?)',
        [result.insertId, String(row.regNo).trim(), String(row.company).trim()]
      )
    }
    await conn.commit()
    return { ok: true, id: result.insertId }
  } catch (e: any) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
})
