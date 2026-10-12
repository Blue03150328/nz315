// PATCH /api/admin/specs/:id —— 编辑规格 / 停用启用（PRD 5.3）
import { query, execute } from '../../../utils/db'
import { requireWritableUser } from '../../../utils/auth'
import { parseSpecCode, parseSpecInput } from '../../../utils/spec-input'

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: '无效的规格ID' })
  const body = await readBody(event).catch(() => ({}))

  // 企业校验（平台管理员可管理任意企业规格）
  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  if (user.role !== 'platform_admin' && !fid) throw createError({ statusCode: 403, statusMessage: '当前账号未绑定企业' })
  const [spec] = await query<any[]>(
    'SELECT * FROM product_spec WHERE id = ?' + (fid ? ' AND enterprise_id = ?' : ''), fid ? [id, fid] : [id])
  if (!spec) throw createError({ statusCode: 404, statusMessage: '规格不存在' })
  const specCode = parseSpecCode(body?.specCode)
  if (specCode !== undefined && specCode !== spec.spec_code) throw createError({ statusCode: 400, statusMessage: '规格码创建后不可修改' })

  // 仅状态变更（停用/启用；已被产品引用的规格仅可停用，不可删除）
  if (body?.status !== undefined && Object.keys(body).length === 1) {
    await execute('UPDATE product_spec SET status = ? WHERE id = ?', [Number(body.status) ? 1 : 0, id])
    return { ok: true }
  }

  const { specName, netContent, contentUnit, packUnit, packQuantity } = parseSpecInput(body, Number(spec.pack_quantity ?? 1))

  // 名称唯一（排除自身）；规格码创建后固定，防止已有追溯码与规格主数据不一致。
  const [dupName] = await query<any[]>(
    'SELECT id FROM product_spec WHERE enterprise_id = ? AND spec_name = ? AND id <> ? LIMIT 1',
    [spec.enterprise_id, specName, id])
  if (dupName) throw createError({ statusCode: 400, statusMessage: '该规格名称已存在' })

  // 常规编辑同时落状态（编辑弹窗内开关），避免「开关勾选后保存不生效」的既有缺陷；
  // 未携带 status 时保留原值（Number(undefined)=NaN 会误判为停用，与 products 的 patch 语义一致）
  const nextStatus = body?.status === undefined ? (Number(spec.status) ? 1 : 0) : (Number(body.status) ? 1 : 0)
  try {
    await execute(
      'UPDATE product_spec SET spec_name = ?, net_content = ?, content_unit = ?, pack_unit = ?, pack_quantity = ?, status = ? WHERE id = ?',
      [specName, netContent, contentUnit, packUnit, packQuantity, nextStatus, id])
  } catch (error: any) {
    if (error?.code === 'ER_DUP_ENTRY') throw createError({ statusCode: 409, statusMessage: '该规格名称已存在' })
    throw error
  }
  return { ok: true }
})
