// PATCH /api/admin/settings/enterprise/:id —— 编辑企业信息（PRD 5.12.1）
import { query, execute } from '../../../../utils/db'
import { requireWritableUser } from '../../../../utils/auth'
import { logOperation } from '../../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: '无效的企业ID' })

  // 权限（2026-09-19 收紧）：企业信息含法人/许可证号/资质到期日等合规字段，编辑仅总部管理员与厂家主账号；
  // 平台管理员可改任意企业（含状态），厂家仅可改本企业且不可改状态；码管理员/只读账号由写守卫与角色判断双重拦截
  if (user.role !== 'platform_admin' && user.role !== 'enterprise_admin') {
    throw createError({ statusCode: 403, statusMessage: '需要厂家主账号权限' })
  }
  if (user.role !== 'platform_admin' && user.enterprise_id !== id) {
    throw createError({ statusCode: 403, statusMessage: '无权修改其他企业信息' })
  }
  const [ent] = await query<any[]>('SELECT * FROM enterprise WHERE id = ?', [id])
  if (!ent) throw createError({ statusCode: 404, statusMessage: '企业不存在' })

  const body = await readBody(event) || {}
  const name = String(body.name || '').trim()
  const creditCode = String(body.creditCode || '').trim()
  const unitCode = String(body.unitCode || '').trim()
  const contact = String(body.contact || '').trim()
  const phone = String(body.phone || '').trim()
  const legalPerson = String(body.legalPerson || '').trim()
  const licenseNo = String(body.licenseNo || '').trim()
  const qualificationExpire = String(body.qualificationExpire || '').slice(0, 10).trim()

  // 必填校验（2026-09-08 与前端同口径）：名称/信用代码/联系人/电话/法人/许可证号/资质到期日；单元识别码保留可空
  const requiredFields = [
    { label: '企业名称', val: name },
    { label: '统一社会信用代码', val: creditCode },
    { label: '联系人', val: contact },
    { label: '联系电话', val: phone },
    { label: '法定代表人', val: legalPerson },
    { label: '农药生产许可证号', val: licenseNo },
    { label: '资质到期日', val: qualificationExpire },
  ]
  const emptyField = requiredFields.find((f) => !f.val)
  if (emptyField) throw createError({ statusCode: 400, statusMessage: '请填写：' + emptyField.label })

  // 2026-09-08 精简：不再写回 企业官网/注册地址/企业简介（列保留于库，存量值不受影响）
  await execute(
    `UPDATE enterprise SET name=?, credit_code=?, unit_code=?, contact=?, phone=?, legal_person=?,
       logo=?, license_no=?, qualification_expire=?, status=?
     WHERE id=?`,
    [name,
     creditCode || null,
     unitCode || null,
     contact || null,
     phone || null,
     legalPerson || null,
     String(body.logo || '').trim() || null,
     licenseNo || null,
     qualificationExpire || null,
     user.role === 'platform_admin'
       ? (body.status === undefined || body.status === null ? (Number(ent.status) === 0 ? 0 : 1) : (Number(body.status) === 0 ? 0 : 1))
       : Number(ent.status),
     id]
  )
  // 审计日志（含修改前后摘要）
  await logOperation(event, {
    module: '系统设置',
    action: '修改企业信息',
    content: JSON.stringify({ id, before: { name: ent.name, contact: ent.contact }, after: { name, contact } }),
  })
  return { ok: true }
})
