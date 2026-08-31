// POST /api/admin/specs —— 新增产品规格（PRD 5.3）
import { query, execute } from '../../utils/db'
import { requireWritableUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const body = await readBody(event).catch(() => ({}))
  const specName = String(body?.specName || '').trim()
  const netContent = body?.netContent
  const contentUnit = String(body?.contentUnit || '').trim()
  const packUnit = String(body?.packUnit || '').trim()
  const specCode = String(body?.specCode || '').trim()
  const dosageForms = Array.isArray(body?.dosageForms) ? body.dosageForms : []
  const status = body?.status === 0 ? 0 : 1

  // 校验
  if (!specName) throw createError({ statusCode: 400, statusMessage: '请输入规格名称' })
  if (!/^\d{3}$/.test(specCode)) throw createError({ statusCode: 400, statusMessage: '企业规格码必须为 3 位数字' })
  if (!contentUnit) throw createError({ statusCode: 400, statusMessage: '请选择含量单位' })
  if (!packUnit) throw createError({ statusCode: 400, statusMessage: '请选择包装单位' })

  let fid: number | null = user.enterprise_id
  if (user.role === 'platform_admin') {
    fid = Number(body?.enterpriseId)
    if (!Number.isInteger(fid) || (fid as number) <= 0) {
      throw createError({ statusCode: 400, statusMessage: '请指定有效的企业ID' })
    }
  }

  // 唯一性校验：名称与规格码企业内唯一
  const [dupName] = await query<any[]>(
    'SELECT id FROM product_spec WHERE enterprise_id = ? AND spec_name = ? LIMIT 1', [fid, specName])
  if (dupName) throw createError({ statusCode: 400, statusMessage: '该规格名称已存在' })
  const [dupCode] = await query<any[]>(
    'SELECT id FROM product_spec WHERE enterprise_id = ? AND spec_code = ? LIMIT 1', [fid, specCode])
  if (dupCode) throw createError({ statusCode: 400, statusMessage: '该企业规格码已存在' })

  const result = await execute(
    'INSERT INTO product_spec (enterprise_id, spec_name, net_content, content_unit, pack_unit, spec_code, dosage_forms, status) VALUES (?,?,?,?,?,?,?,?)',
    [fid, specName, netContent ?? null, contentUnit, packUnit, specCode, JSON.stringify(dosageForms), status]
  )
  return { ok: true, id: result.insertId }
})