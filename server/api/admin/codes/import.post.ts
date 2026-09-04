// POST /api/admin/codes/import —— 追溯码入库并绑定批次（PRD 5.5.3 / 5.7 生产采集）
// 2026-09-04 流程改造（用户决策 B）：批次三要素（生产日期/批号/质量合格证号）必填，
// 由本接口自动「创建或匹配」批次——批号不存在则自动建批（质检默认合格），已存在则校验一致后归并
// （天然支持分次补采）；码一律置「已绑定」。生产批次新建入口已收敛到生产采集，批次页只读管理。
// 校验防线：批号已存在但三要素不一致 → 拒绝（防输错串批）；质检不合格批次 → 拒绝绑定（PRD 5.6）。
// 自动建批 + 批量插码在同一数据库事务内，失败整体回滚，不留孤儿批次。
import { getPool, query } from '../../../utils/db'
import { sendMessage } from '../../../utils/notify'
import { requireBackendUser } from '../../../utils/auth'

// 日期入参格式（YYYY-MM-DD，与批次页 UInput type=date 口径一致）
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const body = await readBody(event) || {}
  const codes: string[] = (Array.isArray(body.codes) ? body.codes : []).map((c: any) => String(c))
  const productId = Number(body.productId)

  // 批次三要素（生产采集必填）
  const batchNo = String(body.batchNo || '').trim()
  const produceDate = String(body.produceDate || '').trim()
  const qualityCertNo = String(body.qualityCertNo || '').trim()
  const qcReportNo = String(body.qcReportNo || '').trim() || null
  const expireDate = String(body.expireDate || '').trim() || null

  if (codes.length === 0) throw createError({ statusCode: 400, statusMessage: '没有可导入的码' })
  if (codes.length > 100000) throw createError({ statusCode: 400, statusMessage: '单次最多 10 万条码' })
  if (!Number.isInteger(productId) || productId <= 0) throw createError({ statusCode: 400, statusMessage: '请选择关联产品' })
  if (!batchNo) throw createError({ statusCode: 400, statusMessage: '请输入生产批次号（与产品标签喷码一致）' })
  if (!DATE_RE.test(produceDate)) throw createError({ statusCode: 400, statusMessage: '请选择生产日期（与产品标签喷码一致）' })
  if (!qualityCertNo) throw createError({ statusCode: 400, statusMessage: '请输入质量合格证号' })
  if (expireDate && !DATE_RE.test(expireDate)) throw createError({ statusCode: 400, statusMessage: '有效期至格式不正确' })

  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  const [prod] = await query<any[]>(
    'SELECT id, enterprise_id FROM product WHERE id = ?' + (fid ? ' AND enterprise_id = ?' : ''),
    fid ? [productId, fid] : [productId])
  if (!prod) throw createError({ statusCode: 400, statusMessage: '产品不存在' })
  const enterpriseId = Number(prod.enterprise_id)

  // 去重检查（导入时再次校验；码全局唯一）
  const placeholders = codes.map(() => '?').join(',')
  const dupRows = await query<any[]>(
    'SELECT code FROM trace_code WHERE code IN (' + placeholders + ')', codes)
  const dupSet = new Set(dupRows.map((r: any) => String(r.code)))
  const finalCodes = codes.filter(c => !dupSet.has(c))
  if (finalCodes.length === 0) throw createError({ statusCode: 400, statusMessage: '所有码均已在系统中，无可导入' })

  // 事务：自动建批/校验批次 + 批量插码，原子执行
  const pool = getPool()
  const conn = await pool.getConnection()
  let batchId: number
  let batchCreated = false
  try {
    await conn.beginTransaction()

    // 1) 批次：按 同产品+同批号 查找 → 命中校验复用 / 未命中自动创建
    const batchCond = fid ? ' AND b.enterprise_id = ?' : ''
    const [exist] = await conn.query<any[]>(
      'SELECT b.id, b.produce_date, b.quality_cert_no, b.qc_result FROM batch b WHERE b.product_id = ? AND b.batch_no = ?' + batchCond,
      fid ? [productId, batchNo, fid] : [productId, batchNo])
    if (exist && exist.length > 0) {
      const b = exist[0]
      if (Number(b.qc_result) === 0) {
        throw createError({ statusCode: 400, statusMessage: '批次 ' + batchNo + ' 质检不合格，其追溯码不得绑定（请先在生产批次页处理）' })
      }
      const dbDate = b.produce_date ? String(b.produce_date).slice(0, 10) : ''
      const dbCert = String(b.quality_cert_no || '')
      if (dbDate !== produceDate || dbCert !== qualityCertNo) {
        throw createError({
          statusCode: 400,
          statusMessage: '批次 ' + batchNo + ' 已存在，生产日期/合格证号与本次填写不一致（库内 ' + (dbDate || '-') + ' / ' + (dbCert || '-') + '），请核对后再导入',
        })
      }
      batchId = Number(b.id)
    } else {
      // 自动创建批次：质检默认合格；有效期至选填（可稍后在批次页补填）；生产数量未知记 0，编辑时补填
      // mysql2 execute 返回类型为联合（QueryResult），实际 INSERT 运行时为 ResultSetHeader，断言取 insertId
      const [r] = await conn.execute(
        'INSERT INTO batch (enterprise_id, product_id, batch_no, produce_date, quality_cert_no, expire_date, qc_result, qc_report_no, quantity) VALUES (?,?,?,?,?,?,?,?,?)',
        [enterpriseId, productId, batchNo, produceDate, qualityCertNo, expireDate, 1, qcReportNo, 0]) as unknown as [{ insertId: number }, unknown]
      batchId = Number(r.insertId)
      batchCreated = true
    }

    // 2) 批量插码：批次三要素冗余 + 状态=2 已绑定（PRD 5.5.4：三要素齐全自动流转）
    const values: any[] = []
    const valuePlaceholders = finalCodes.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',')
    for (const code of finalCodes) {
      values.push(enterpriseId, code, productId, batchId, produceDate, batchNo, qualityCertNo, 2, 0, null)
    }
    await conn.execute(
      'INSERT INTO trace_code (enterprise_id, code, product_id, batch_id, produce_date, batch_no, quality_cert_no, status, abnormal_flag, abnormal_reason) VALUES ' + valuePlaceholders,
      values)

    await conn.commit()
  } catch (e: any) {
    await conn.rollback()
    if (e?.statusCode) throw e // 业务校验错误（批次不一致/质检不合格等）原样抛出
    console.error('[import] 导入事务失败:', e?.message || e)
    throw createError({ statusCode: 500, statusMessage: '导入失败，数据未写入，请重试' })
  } finally {
    conn.release()
  }

  // 站内消息：导入完成通知（PRD 5.11 上传完成）
  await sendMessage({
    enterpriseId, type: 'upload_done',
    title: '生产采集导入完成',
    content: '成功导入 ' + finalCodes.length + ' 条追溯码，已绑定批次 ' + batchNo + '（' + produceDate + '）',
    link: '/admin/codes',
  })

  return {
    ok: true,
    imported: finalCodes.length,
    skippedDup: codes.length - finalCodes.length,
    batchId,
    batchNo,
    batchCreated,
    status: '已绑定',
  }
})
