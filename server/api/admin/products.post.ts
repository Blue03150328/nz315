// POST /api/admin/products —— 新增产品（PRD 5.4）
import { query, execute } from '../../utils/db'
import { requireWritableUser } from '../../utils/auth'
import { findOriginalCandidates } from '../../utils/regdata'

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const body = await readBody(event) || {}

  const name = String(body.name || '').trim()
  const registrationNo = String(body.registrationNo || '').trim().toUpperCase()
  if (!registrationNo) throw createError({ statusCode: 400, statusMessage: '请先从登记数据源选择产品' })
  if (!name) throw createError({ statusCode: 400, statusMessage: '请先从登记数据源选择产品并回填登记信息' })
  if (!body.specId) throw createError({ statusCode: 400, statusMessage: '请选择规格（来自产品规格主数据）' })

  // 登记证号全局唯一（PRD 5.4 业务规则1）
  const [dup] = await query<any[]>('SELECT id FROM product WHERE registration_no = ? LIMIT 1', [registrationNo])
  if (dup) throw createError({ statusCode: 400, statusMessage: '该登记证号已存在' })

  // 原药信息联动校验：填了原药登记证号则原药企业必填
  const originalRegNo = String(body.originalRegNo || '').trim()
  const originalCompany = String(body.originalCompany || '').trim()
  if (originalRegNo && !originalCompany) {
    throw createError({ statusCode: 400, statusMessage: '填写原药登记证号时，原药生产企业名称必填' })
  }
  // 制剂多原药必填（登记数据源校验）：数据源中该登记证为制剂且匹配到多条有效期内原药时，
  // 原药登记证号必须由用户选择，不允许空值提交（防止复配制剂漏填原药信息）
  if (!originalRegNo) {
    const { isOriginal, candidates } = await findOriginalCandidates(registrationNo)
    if (!isOriginal && candidates.length > 1) {
      throw createError({ statusCode: 400, statusMessage: '该产品匹配到多家原药登记，请选择原药登记证号' })
    }
  }

  let fid: number | null = user.enterprise_id
  if (user.role === 'platform_admin') {
    fid = Number(body.enterpriseId)
    if (!Number.isInteger(fid) || (fid as number) <= 0) {
      throw createError({ statusCode: 400, statusMessage: '请指定有效的企业ID' })
    }
  }
  const result = await execute(
    `INSERT INTO product (enterprise_id, trademark, name, registration_no, registration_expire, reg_category,
       holder_name, produce_type, original_company, original_reg_no, dosage, content, spec_id,
       category, toxicity, is_restricted, label_image, manual_image, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [fid,
     String(body.trademark || '').trim(),
     name, registrationNo,
     body.registrationExpire || null,
     body.regCategory !== undefined ? Number(body.regCategory) : 1,
     String(body.holderName || '').trim(),
     body.produceType !== undefined ? Number(body.produceType) : 1,
     originalCompany || null, originalRegNo || null,
     String(body.dosage || '').trim(), String(body.content || '').trim(),
     Number(body.specId),
     String(body.category || '').trim(), String(body.toxicity || '').trim(),
     body.isRestricted ? 1 : 0,
     String(body.labelImage || '').trim() || null,
     String(body.manualImage || '').trim() || null,
     body.status === 0 ? 0 : 1]
  )
  return { ok: true, id: result.insertId }
})