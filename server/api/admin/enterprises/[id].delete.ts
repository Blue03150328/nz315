// DELETE /api/admin/enterprises/:id —— 删除厂家（2026-09-09）
// 总部管理员专用：删除厂家时同步级联清除该厂家下全部账号（user）；
// 业务数据保护：厂家存在 产品/规格/批次/上传批次/追溯码 任一引用即 400 拒绝（防数据孤儿，先迁移/清理再删）。
import { getPool } from '../../../utils/db'
import { requirePlatformAdmin } from '../../../utils/auth'
import { logOperation } from '../../../utils/audit'
import { enterpriseBusinessReferenceTables } from '../../../utils/enterprise-business-references'

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: '无效的企业ID' })

  // 级联删除：账号（user） + 企业本身（原子事务）
  const pool = getPool()
  const conn = await pool.getConnection()
  let deletedUsers = 0
  let ent: any
  try {
    await conn.beginTransaction()
    // 与外部采集新建批次共用企业行锁，引用检查与删除不能被新上传穿插。
    const [enterprises] = await conn.query<any[]>('SELECT id, name FROM enterprise WHERE id = ? FOR UPDATE', [id])
    ent = enterprises[0]
    if (!ent) throw createError({ statusCode: 404, statusMessage: '企业不存在' })
    const tables = await enterpriseBusinessReferenceTables(conn)
    const unions = tables.map(t => 'SELECT COUNT(*) AS c FROM ' + t + ' WHERE enterprise_id = ?').join(' UNION ALL ')
    const [references] = await conn.query<any[]>('SELECT SUM(c) AS ref FROM (' + unions + ') t', tables.map(() => id))
    if (Number(references[0]?.ref || 0) > 0) {
      throw createError({ statusCode: 400, statusMessage: '该厂家存在产品、追溯码或外部采集等业务数据，不可直接删除，请先迁移或清理数据' })
    }
    // mysql2 的 conn.query 返回 QueryResult 联合类型，实际 DELETE 运行时为 ResultSetHeader，需断言取 affectedRows
    // （与 upload-batches/[id].delete.ts 同范式）
    const [ur] = await conn.query('DELETE FROM \`user\` WHERE enterprise_id = ?', [id]) as unknown as [{ affectedRows: number }, unknown]
    deletedUsers = Number(ur?.affectedRows || 0)
    await conn.query('DELETE FROM enterprise WHERE id = ?', [id])
    await conn.commit()
  } catch (e) {
    await conn.rollback().catch(() => {})
    throw e
  } finally {
    conn.release()
  }

  // 审计日志
  await logOperation(event, {
    module: '系统设置',
    action: '删除厂家',
    content: JSON.stringify({ id, name: ent.name, deletedUsers }),
  })
  return { ok: true, deletedUsers }
})
