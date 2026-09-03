// PATCH /api/admin/products/:id —— 编辑产品 / 停用启用（PRD 5.4）
import { query, execute } from '../../../utils/db'
import { requireWritableUser } from '../../../utils/auth'
import { findOriginalCandidates } from '../../../utils/regdata'

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
  if (!registrationNo) throw createError({ statusCode: 400, statusMessage: '请先从登记数据源选择产品' })
  if (!name) throw createError({ statusCode: 400, statusMessage: '请先从登记数据源选择产品并回填登记信息' })
  if (!body.specId) throw createError({ statusCode: 400, statusMessage: '请选择规格' })

  const [dup] = await query<any[]>(
    'SELECT id FROM product WHERE registration_no = ? AND id <> ? LIMIT 1', [registrationNo, id])
  if (dup) throw createError({ statusCode: 400, statusMessage: '该登记证号已存在' })

  const originalRegNo = String(body.originalRegNo || '').trim()
  const originalCompany = String(body.originalCompany || '').trim()
  if (originalRegNo && !originalCompany) {
    throw createError({ statusCode: 400, statusMessage: '填写原药登记证号时，原药生产企业名称必填' })
  }
  // 制剂多原药必填（登记数据源校验，与新增一致）：制剂匹配到多条有效期内原药时必须选择，不允许空值提交
  if (!originalRegNo) {
    const { isOriginal, candidates } = await findOriginalCandidates(registrationNo)
    if (!isOriginal && candidates.length > 1) {
      throw createError({ statusCode: 400, statusMessage: '该产品匹配到多家原药登记，请选择原药登记证号' })
    }
  }

  await execute(
    `UPDATE product SET trademark = ?, name = ?, registration_no = ?, registration_expire = ?, reg_category = ?,
       holder_name = ?, produce_type = ?, original_company = ?, original_reg_no = ?, dosage = ?, content = ?,
       spec_id = ?, category = ?, toxicity = ?, is_restricted = ?, label_image = ?, manual_image = ?
     WHERE id = ?`,
    [String(body.trademark || '').trim(), name, registrationNo,
     body.registrationExpire || null,
     body.regCategory !== undefined ? Number(body.regCategory) : prod.reg_category,
     String(body.holderName || '').trim(),
     body.produceType !== undefined ? Number(body.produceType) : prod.produce_type,
     originalCompany || null, originalRegNo || null,
     String(body.dosage || '').trim(), String(body.content || '').trim(),
     Number(body.specId),
     String(body.category || '').trim(), String(body.toxicity || '').trim(),
     body.isRestricted ? 1 : 0,
     String(body.labelImage || '').trim() || null,
     String(body.manualImage || '').trim() || null,
     id]
  )
  return { ok: true }
})
