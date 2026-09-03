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

  // 仅状态变更（停用/启用；已被产品引用的规格仅可停用，不可删除）
  if (body?.status !== undefined && Object.keys(body).length === 1) {
    await execute('UPDATE product_spec SET status = ? WHERE id = ?', [Number(body.status) ? 1 : 0, id])
    return { ok: true }
  }

  const specName = String(body?.specName || '').trim()
  const netContent = body?.netContent
  const contentUnit = String(body?.contentUnit || '').trim()
  const packUnit = String(body?.packUnit || '').trim()

  if (!specName) throw createError({ statusCode: 400, statusMessage: '请输入规格名称' })
  if (!contentUnit) throw createError({ statusCode: 400, statusMessage: '请选择含量单位' })
  if (!packUnit) throw createError({ statusCode: 400, statusMessage: '请选择包装单位' })

  // 名称唯一（排除自身）；规格码为系统自动分配，编辑不可修改
  const [dupName] = await query<any[]>(
    'SELECT id FROM product_spec WHERE enterprise_id = ? AND spec_name = ? AND id <> ? LIMIT 1',
    [spec.enterprise_id, specName, id])
  if (dupName) throw createError({ statusCode: 400, statusMessage: '该规格名称已存在' })

  // 常规编辑同时落状态（编辑弹窗内开关），避免「开关勾选后保存不生效」的既有缺陷；
  // 未携带 status 时保留原值（Number(undefined)=NaN 会误判为停用，与 products 的 patch 语义一致）
  const nextStatus = body?.status === undefined ? (Number(spec.status) ? 1 : 0) : (Number(body.status) ? 1 : 0)
  await execute(
    'UPDATE product_spec SET spec_name = ?, net_content = ?, content_unit = ?, pack_unit = ?, status = ? WHERE id = ?',
    [specName, netContent ?? null, contentUnit, packUnit, nextStatus, id]
  )
  return { ok: true }
})
