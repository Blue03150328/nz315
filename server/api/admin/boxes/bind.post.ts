// POST /api/admin/boxes/bind —— 确认外箱码绑定（PRD 5.5.6：一对多关联，事务）
import { query, execute } from '../../../utils/db'
import { requireBackendUser } from '../../../utils/auth'
import { logOperation } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const body = await readBody(event) || {}
  // pairs: [{ outer, inner }]
  const pairs: { outer: string; inner: string }[] = Array.isArray(body.pairs) ? body.pairs : []
  if (pairs.length === 0) throw createError({ statusCode: 400, statusMessage: '没有可绑定的关联' })
  if (pairs.length > 50000) throw createError({ statusCode: 400, statusMessage: '单次最多 5 万条关联' })

  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()
    let bound = 0
    for (const p of pairs) {
      // 逐条校验并更新（事务内）
      // conn.query 返回 [rows, fields]，需先取 rows 再取第一行
      const [recRows] = await conn.query<any[]>(
        'SELECT id, abnormal_flag, outer_box_code FROM trace_code WHERE code = ?' + (fid ? ' AND enterprise_id = ?' : ''),
        fid ? [p.inner, fid] : [p.inner])
      const rec = recRows[0]
      if (!rec || Number(rec.abnormal_flag) !== 0 || rec.outer_box_code) continue
      // 外箱码唯一（同一批内自身除外——先检查库中其他记录）
      const [dupRows] = await conn.query<any[]>(
        'SELECT id FROM trace_code WHERE outer_box_code = ? AND code <> ? LIMIT 1', [p.outer, p.inner])
      const dup = dupRows[0]
      if (dup) continue
      await conn.query('UPDATE trace_code SET outer_box_code = ? WHERE id = ?', [p.outer, rec.id])
      bound++
    }
    await conn.commit()
    await logOperation(event, {
      module: '码库管理',
      action: '外箱码绑定',
      content: JSON.stringify({ boxes: new Set(pairs.map(p => p.outer)).size, bound }),
    })
    return { ok: true, bound, boxes: new Set(pairs.map(p => p.outer)).size }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
})