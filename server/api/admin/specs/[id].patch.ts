// PATCH /api/admin/specs/:id —— 编辑规格 / 停用启用（PRD 5.3）
import { query, execute } from '../../../utils/db'
import { requireWritableUser } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: '无效的规格ID' })
  const body = await readBody(event).catch(() => ({}))

  // 企业校验（平台管理员可管理任意企业规格）
  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  const [spec] = await query<any[]>(
    'SELECT * FROM product_spec WHERE id = ?' + (fid ? ' AND enterprise_id = ?' : ''), fid ? [id, fid] : [id])
  if (!spec) throw createError({ statusCode: 404, statusMessage: '规格不存在' })

  // 仅状态变更
  if (body?.status !== undefined && Object.keys(body).length === 1) {
    await execute('UPDATE product_spec SET status = ? WHERE id = ?', [Number(body.status) ? 1 : 0, id])
    return { ok: true }
  }

  const specName = String(body?.specName || '').trim()
  const netContent = body?.netContent
  const contentUnit = String(body?.contentUnit || '').trim()
  const packUnit = String(body?.packUnit || '').trim()
  const specCode = String(body?.specCode || '').trim()
  const dosageForms = Array.isArray(body?.dosageForms) ? body.dosageForms : []

  if (!specName) throw createError({ statusCode: 400, statusMessage: '请输入规格名称' })
  if (!/^\d{3}$/.test(specCode)) throw createError({ statusCode: 400, statusMessage: '企业规格码必须为 3 位数字' })

  // 规格码已被追溯码使用的不可修改（PRD 5.3 业务规则2）
  if (specCode !== spec.spec_code) {
    const [used] = await query<any[]>(
      'SELECT COUNT(*) AS c FROM trace_code WHERE enterprise_id = ? AND code LIKE ?',
      [spec.enterprise_id, '%' + spec.spec_code + '%'])
    if (Number(used?.c || 0) > 0) {
      throw createError({ statusCode: 400, statusMessage: '该规格码已被追溯码使用，不可修改' })
    }
  }

  // 名称唯一（排除自身）
  const [dupName] = await query<any[]>(
    'SELECT id FROM product_spec WHERE enterprise_id = ? AND spec_name = ? AND id <> ? LIMIT 1',
    [spec.enterprise_id, specName, id])
  if (dupName) throw createError({ statusCode: 400, statusMessage: '该规格名称已存在' })
  const [dupCode] = await query<any[]>(
    'SELECT id FROM product_spec WHERE enterprise_id = ? AND spec_code = ? AND id <> ? LIMIT 1',
    [spec.enterprise_id, specCode, id])
  if (dupCode) throw createError({ statusCode: 400, statusMessage: '该企业规格码已存在' })

  await execute(
    'UPDATE product_spec SET spec_name = ?, net_content = ?, content_unit = ?, pack_unit = ?, spec_code = ?, dosage_forms = ? WHERE id = ?',
    [specName, netContent ?? null, contentUnit, packUnit, specCode, JSON.stringify(dosageForms), id]
  )
  return { ok: true }
})
