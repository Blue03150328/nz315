// DELETE /api/admin/codes/:id —— 删除单条追溯码（2026-09-04 新增）
// 页面：批次码明细弹窗（码库管理批次列表【详细】）行操作【删除】——仅删除当前这一条码，
// 不影响同批次其他码与上传批次（upload_batch）。
// 约束（与明细行按钮置灰同语义，服务端强制防绕过）：
//   ① 码状态为已绑定（status=2）→ 拒绝删除——已绑定码已流向市场/扫码可追溯，删除会破坏合规可查性；
//      仅未绑定（status=1）码允许删除（冻结/作废但未绑定的码同样可删，删除为物理清除）；
//   ② 企业隔离：厂家/码管理员只能删除本企业码（platform_admin 全量）；
//   ③ 生产批次（batch）与扫码历史（scan_log）不随删（独立概念，无外键约束）。
import { query, execute } from '../../../utils/db'
import { requireBackendUser } from '../../../utils/auth'
import { logOperation } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: '无效的追溯码ID' })

  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  // 码存在性 + 归属校验
  const [code] = await query<any[]>(
    'SELECT id, code, status, abnormal_flag FROM trace_code WHERE id = ?' + (fid ? ' AND enterprise_id = ?' : ''),
    fid ? [id, fid] : [id])
  if (!code) throw createError({ statusCode: 404, statusMessage: '追溯码不存在' })

  // ① 已绑定保护：已绑定码不可删除（服务端强制，与前端置灰同语义）
  if (Number(code.status) === 2) {
    throw createError({ statusCode: 400, statusMessage: '该追溯码已绑定，不允许删除（已绑定码扫码可追溯，删除会破坏合规可查性）' })
  }

  const result = await execute('DELETE FROM trace_code WHERE id = ?', [id])
  if (Number(result.affectedRows || 0) === 0) {
    throw createError({ statusCode: 404, statusMessage: '追溯码不存在' })
  }

  await logOperation(event, {
    module: '码库管理',
    action: '删除追溯码',
    content: JSON.stringify({ id, code: code.code, flag: Number(code.abnormal_flag) }),
  })
  return { ok: true }
})
