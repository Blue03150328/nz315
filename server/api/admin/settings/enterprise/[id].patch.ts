// PATCH /api/admin/settings/enterprise/:id —— 编辑企业信息（PRD 5.12.1）
import { query, execute } from '../../../../utils/db'
import { requireBackendUser } from '../../../../utils/auth'
import { logOperation } from '../../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: '无效的企业ID' })

  // 权限：平台管理员可改任意；厂家仅可改本企业且不可改状态
  if (user.role !== 'platform_admin' && user.enterprise_id !== id) {
    throw createError({ statusCode: 403, statusMessage: '无权修改其他企业信息' })
  }
  const [ent] = await query<any[]>('SELECT * FROM enterprise WHERE id = ?', [id])
  if (!ent) throw createError({ statusCode: 404, statusMessage: '企业不存在' })

  const body = await readBody(event) || {}
  const name = String(body.name || '').trim()
  if (!name) throw createError({ statusCode: 400, statusMessage: '请输入企业名称' })

  await execute(
    `UPDATE enterprise SET name=?, credit_code=?, unit_code=?, contact=?, phone=?, legal_person=?, website=?,
       address=?, logo=?, description=?, license_no=?, qualification_expire=?, status=?
     WHERE id=?`,
    [name,
     String(body.creditCode || '').trim() || null,
     String(body.unitCode || '').trim() || null,
     String(body.contact || '').trim() || null,
     String(body.phone || '').trim() || null,
     String(body.legalPerson || '').trim() || null,
     String(body.website || '').trim() || null,
     String(body.address || '').trim() || null,
     String(body.logo || '').trim() || null,
     String(body.description || '').trim() || null,
     String(body.licenseNo || '').trim() || null,
     body.qualificationExpire || null,
     user.role === 'platform_admin'
       ? (body.status === undefined || body.status === null ? (Number(ent.status) === 0 ? 0 : 1) : (Number(body.status) === 0 ? 0 : 1))
       : Number(ent.status),
     id]
  )
  // 审计日志（含修改前后摘要）
  await logOperation(event, {
    module: '系统设置',
    action: '修改企业信息',
    content: JSON.stringify({ id, before: { name: ent.name, contact: ent.contact }, after: { name, contact: body.contact || null } }),
  })
  return { ok: true }
})
