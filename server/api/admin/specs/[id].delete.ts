// DELETE /api/admin/specs/:id —— 删除规格（2026-09-07 新增，用户决策：规格列表操作列新增删除）
// 页面：规格列表操作列【删除】按钮（确认弹窗后调用）。
// 约束（与前端按钮置灰同语义，服务端强制防绕过）：
//   ① 被产品引用（product.spec_id）> 0 → 拒绝删除——规格被引用说明码生成/建档链路依赖它；
//      被引用 = 0 才允许物理删除（PRD 5.3 业务规则 3：被引用规格仅可停用，不可删除）；
//   ② 企业隔离：厂家/码管理员只能删除本企业规格（platform_admin 全量）；
//   ③ 追溯码不直接关联规格（码经产品引用规格，产品引用为 0 时不存在有效码依赖），无需额外检查。
import { query, execute } from '../../../utils/db'
import { requireWritableUser } from '../../../utils/auth'
import { logOperation } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: '无效的规格ID' })

  // 规格存在性 + 企业归属校验（platform_admin 可管理任意企业规格）
  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  const [spec] = await query<any[]>(
    'SELECT id, spec_name, spec_code, enterprise_id FROM product_spec WHERE id = ?' + (fid ? ' AND enterprise_id = ?' : ''),
    fid ? [id, fid] : [id])
  if (!spec) throw createError({ statusCode: 404, statusMessage: '规格不存在' })

  // ① 被引用保护：被产品引用的规格不可删除（与前端置灰同语义）
  const [ref] = await query<any[]>('SELECT COUNT(*) AS c FROM product WHERE spec_id = ?', [id])
  const refCount = Number(ref?.c || 0)
  if (refCount > 0) {
    throw createError({ statusCode: 400, statusMessage: '该规格已被 ' + refCount + ' 个产品引用，不可删除（请先调整产品规格）' })
  }

  const result = await execute('DELETE FROM product_spec WHERE id = ?', [id])
  if (Number(result.affectedRows || 0) === 0) {
    throw createError({ statusCode: 404, statusMessage: '规格不存在' })
  }

  await logOperation(event, {
    module: '规格管理',
    action: '删除规格',
    content: JSON.stringify({ id, specName: spec.spec_name, specCode: spec.spec_code }),
  })
  return { ok: true }
})
