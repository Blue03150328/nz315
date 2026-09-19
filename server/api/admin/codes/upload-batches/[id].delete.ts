// DELETE /api/admin/codes/upload-batches/:id —— 删除上传批次及其全部追溯码（2026-09-04 新增）
// 页面：码库管理-上传批次列表操作列【删除】
// 约束（与列表行 canDelete/置灰同语义，服务端强制防绕过）：
//   ① 批次内任意追溯码为「已绑定」（status=2）→ 拒绝删除——已绑定码已流向市场/扫码可查，
//      删除码会破坏 1049 追溯可查性；全部未绑定（status=1）才允许删除；
//   ② 事务内先删 trace_code 再删 upload_batch 行，失败整体回滚；
//   ③ 企业隔离：厂家/码管理员只能删除本企业上传批次（platform_admin 全量）；
//   ④ 生产批次（batch）与扫码历史（scan_log）不随删除——上传批次是文件维度，二者是独立概念。
import { getPool, query } from '../../../../utils/db'
import { requireWritableUser } from '../../../../utils/auth'
import { logOperation } from '../../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const ubId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(ubId) || ubId <= 0) throw createError({ statusCode: 400, statusMessage: '无效的上传批次ID' })

  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  // 上传批次归属校验（防跨企业操作）
  const [ub] = await query<any[]>(
    'SELECT id, file_name, enterprise_id FROM upload_batch WHERE id = ?' + (fid ? ' AND enterprise_id = ?' : ''),
    fid ? [ubId, fid] : [ubId])
  if (!ub) throw createError({ statusCode: 404, statusMessage: '上传批次不存在' })
  const enterpriseId = Number(ub.enterprise_id)

  // ① 已绑定保护：批次内存在已绑定码 → 拒绝（服务端强制，与前端置灰同语义）
  const [bd] = await query<any[]>(
    'SELECT COUNT(*) AS c FROM trace_code WHERE upload_batch_id = ? AND status = 2' + (fid ? ' AND enterprise_id = ?' : ''),
    fid ? [ubId, fid] : [ubId])
  if (Number(bd?.c || 0) > 0) {
    throw createError({ statusCode: 400, statusMessage: '该批次存在已绑定追溯码，无法删除（已绑定码扫码可追溯，删除会破坏合规可查性）' })
  }

  // ② 事务删除：先删码再删批次行
  const pool = getPool()
  const conn = await pool.getConnection()
  let deletedCodes = 0
  try {
    await conn.beginTransaction()
    const [dc] = await conn.query(
      'DELETE FROM trace_code WHERE upload_batch_id = ?' + (fid ? ' AND enterprise_id = ?' : ''),
      fid ? [ubId, fid] : [ubId]) as unknown as [{ affectedRows: number }, unknown]
    deletedCodes = Number(dc.affectedRows || 0)
    const [ubr] = await conn.query(
      'DELETE FROM upload_batch WHERE id = ? AND enterprise_id = ?',
      [ubId, enterpriseId]) as unknown as [{ affectedRows: number }, unknown]
    if (Number(ubr.affectedRows || 0) === 0) {
      throw createError({ statusCode: 404, statusMessage: '上传批次不存在' })
    }
    await conn.commit()
  } catch (e: any) {
    await conn.rollback()
    if (e?.statusCode) throw e
    console.error('[upload-batches] 删除失败:', e?.message || e)
    throw createError({ statusCode: 500, statusMessage: '删除失败，数据未变更，请重试' })
  } finally {
    conn.release()
  }

  await logOperation(event, {
    module: '码库管理',
    action: '删除上传批次',
    content: JSON.stringify({ uploadBatchId: ubId, fileName: ub.file_name, deletedCodes }),
  })
  return { ok: true, deletedCodes }
})
