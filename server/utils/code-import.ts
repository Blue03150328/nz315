// POST /api/admin/codes/import —— 追溯码入库并绑定批次（PRD 5.5.3 / 5.7 生产采集）
// 2026-09-04 流程改造（用户决策 B）：批次三要素（生产日期/批号/质量合格证号）必填，
// 由本接口自动「创建或匹配」批次——批号不存在则自动建批（质检默认合格），已存在则校验一致后归并
// （天然支持分次补采）；码一律置「已绑定」。生产批次新建入口已收敛到生产采集，批次页只读管理。
// 2026-09-04 码库聚合改造：同一事务内为本次导入创建「上传文件批次」记录（upload_batch，一份上传
// 文件=一行，fileName 取生产采集页的原始文件名，缺省自动命名），trace_code.upload_batch_id 关联，
// 码库管理页面按此维度聚合展示；响应新增 uploadBatchId 供前端回显。
// 安全防线（合并 0a40d76 的导入防护，勿回退）：
//   ① 逐条结构校验（cleanLine+validateCode，与 parse 同口径）——import 是公共接口，只查重不校验结构
//      时客户端可绕过 parse 直接灌任意字符串/错构码（如 abc、规格码 999 假 32 位码），污染合规数据；
//   ② 码归属产品校验——码第 2-7 位匹配的产品须与所选 productId 一致，防跨产品错码入库；
//   ③ 分块写入 5000/批，防 max_allowed_packet 超限；
//   ④ 批号已存在但三要素不一致 → 拒绝（防输错串批）；质检不合格批次 → 拒绝绑定（PRD 5.6）；
//   ⑤ 自动建批 + 批量插码在同一数据库事务内，失败整体回滚，不留孤儿批次。
import { MAX_CODES_PER_WRITE, WRITE_QUANTITY_ERROR } from '#shared/utils/code-limits'
import { createHash, randomUUID } from 'node:crypto'
import type { ImportResult } from '#shared/types/import-report'
import { validateImportRows } from './import-validation'
import { loadImportContext } from './import-context'
import { getPool, query } from './db'
import { sendMessage } from './notify'
import type { AuthUser } from './auth'


// 日期入参格式（YYYY-MM-DD，与批次页 UInput type=date 口径一致）
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// 单批写入上限（防 max_allowed_packet 超限；50 万条上限下分 100 批）
// 注意：此处只能减不能加——MySQL 预处理语句占位符上限 65535，现 5000 × 11 列 = 55000 已近顶
const CHUNK = 5000

export async function importCodes(user: AuthUser, body: Record<string, any>): Promise<ImportResult> {
  const codes: string[] = typeof body.content === 'string' ? body.content.split(/\r?\n/) : (Array.isArray(body.codes) ? body.codes : []).map((c: any) => String(c))
  const productId = Number(body.productId)

  // 批次三要素（生产采集必填）
  const batchNo = String(body.batchNo || '').trim()
  const produceDate = String(body.produceDate || '').trim()
  const qualityCertNo = String(body.qualityCertNo || '').trim()
  const qcReportNo = String(body.qcReportNo || '').trim() || null
  const expireDate = String(body.expireDate || '').trim() || null
  // 上传文件批次名称 = 原始文件名（码库管理聚合行名）；粘贴导入等无文件场景自动命名
  const rawFileName = String(body.fileName || '').trim().slice(0, 255)
  const nowTs = new Date()
  const pad2 = (n: number) => String(n).padStart(2, '0')
  const fileName = rawFileName || ('手动导入 ' + nowTs.getFullYear() + '-' + pad2(nowTs.getMonth() + 1) + '-' + pad2(nowTs.getDate()) + ' ' + pad2(nowTs.getHours()) + ':' + pad2(nowTs.getMinutes()))

  if (codes.length === 0) throw createError({ statusCode: 400, statusMessage: '没有可导入的码' })
  if (codes.length > MAX_CODES_PER_WRITE) throw createError({ statusCode: 400, statusMessage: WRITE_QUANTITY_ERROR })
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

  // 请求标识与内容指纹共同保证重试只返回同一报告，不能用旧标识提交新内容。
  const requestKey = String(body.requestKey || randomUUID())
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(requestKey)) throw createError({ statusCode: 400, statusMessage: '上传请求标识无效' })
  const requestHash = createHash('sha256').update(JSON.stringify({ codes, productId, batchNo, produceDate, qualityCertNo, qcReportNo, expireDate, rawFileName })).digest('hex')
  await query('INSERT INTO import_report (enterprise_id, created_by, request_key, request_hash, file_name) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)', [enterpriseId, user.id, requestKey, requestHash, fileName])
  const [report] = await query<any[]>('SELECT id, request_hash FROM import_report WHERE created_by = ? AND request_key = ?', [user.id, requestKey])
  if (report.request_hash !== requestHash) throw createError({ statusCode: 409, statusMessage: '上传内容已变化，请重新解析后提交' })
  const reportId = Number(report.id)
  let rows: ReturnType<typeof validateImportRows> | undefined
  let result: ImportResult
  const saveRejections = async (connection: any) => {
    const rejected = rows?.rejected || []
    for (let i = 0; i < rejected.length; i += 5000) {
      const chunk = rejected.slice(i, i + 5000)
      await connection.execute('INSERT INTO import_rejection (report_id, line_number, code, reason_code, reason) VALUES ' + chunk.map(() => '(?,?,?,?,?)').join(','), chunk.flatMap(r => [reportId, r.lineNumber, r.code, r.reasonCode, r.reason]))
    }
  }
  // 事务：自动建批/校验批次 + 分块插码，原子执行
  const pool = getPool()
  const conn = await pool.getConnection()
  let batchId: number | null = null
  let batchCreated = false
  let inserted = 0
  let uploadBatchId = 0
  let claimed = false
  let transactionOpen = false
  try {
    await conn.beginTransaction()
    transactionOpen = true
    // 同一请求的并发提交在报告行上串行化；业务数据和报告一起提交。
    const [locked] = await conn.query<any[]>('SELECT state, result_json FROM import_report WHERE id = ? FOR UPDATE', [reportId])
    if (locked[0].state !== 'pending') {
      await conn.commit()
    transactionOpen = false
      return typeof locked[0].result_json === 'string' ? JSON.parse(locked[0].result_json) : locked[0].result_json
    }
    await conn.query('SAVEPOINT import_business')
    claimed = true
    const { context } = await loadImportContext(codes, enterpriseId, conn)
    rows = validateImportRows(codes, context, productId)
    const finalCodes = rows.accepted
    await saveRejections(conn)
    if (finalCodes.length) {

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

    // 2) 上传文件批次建档（码库管理聚合维度：一份上传文件 = 一行 upload_batch，与插码同事务，
    //    失败整体回滚不留孤儿批次行）
    const [ubRes] = await conn.execute(
      'INSERT INTO upload_batch (enterprise_id, file_name, product_id, batch_id, batch_no, produce_date, quality_cert_no, created_by) VALUES (?,?,?,?,?,?,?,?)',
      [enterpriseId, fileName, productId, batchId, batchNo, produceDate, qualityCertNo, user.id]) as unknown as [{ insertId: number }, unknown]
    uploadBatchId = Number(ubRes.insertId)

    // 3) 分块批量插码：批次三要素冗余 + 状态=2 已绑定（PRD 5.5.4：三要素齐全自动流转）+ 上传批次归属
    for (let i = 0; i < finalCodes.length; i += CHUNK) {
      const chunk = finalCodes.slice(i, i + CHUNK)
      const values: any[] = []
      const valuePlaceholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?)').join(',')
      for (const code of chunk) {
        values.push(enterpriseId, code, productId, batchId, produceDate, batchNo, qualityCertNo, 2, 0, null, uploadBatchId)
      }
      const [r] = await conn.execute(
        'INSERT INTO trace_code (enterprise_id, code, product_id, batch_id, produce_date, batch_no, quality_cert_no, status, abnormal_flag, abnormal_reason, upload_batch_id) VALUES ' + valuePlaceholders,
        values) as unknown as [{ affectedRows: number }, unknown]
      inserted += Number(r.affectedRows || 0)
    }

    }
    result = { ok: true, reportId, imported: inserted, skippedInvalid: rows.invalid, skippedDup: rows.duplicate, ignored: rows.ignored, total: rows.total, notWritten: 0, batchId, batchNo, batchCreated, uploadBatchId: uploadBatchId || null, fileName }
    await conn.execute("UPDATE import_report SET state = 'completed', upload_batch_id = ?, result_json = ? WHERE id = ?", [uploadBatchId || null, JSON.stringify(result), reportId])
    await conn.commit()
    transactionOpen = false
  } catch (e: any) {
    if (!claimed) { await conn.rollback(); throw e }
    await conn.query('ROLLBACK TO SAVEPOINT import_business')
    const message = e?.statusCode ? String(e.statusMessage || '导入未完成') : '导入失败，数据未写入，请重新解析后重试'
    console.error('[import] 导入事务未完成:', e?.message || e)
    result = { ok: false, reportId, imported: 0, skippedInvalid: rows?.invalid || 0, skippedDup: rows?.duplicate || 0, ignored: rows?.ignored || 0, total: rows?.total ?? codes.length, notWritten: rows?.accepted.length ?? codes.length, batchId: null, batchNo, batchCreated: false, uploadBatchId: null, fileName, error: message }
    // 仅回滚业务写入，保留报告锁；并发重试不能覆盖刚提交的结果。
    await saveRejections(conn)
    await conn.execute("UPDATE import_report SET state = 'failed', result_json = ? WHERE id = ?", [JSON.stringify(result), reportId])
    await conn.commit()
    transactionOpen = false
  } finally {
    try { if (transactionOpen) await conn.rollback() } finally { conn.release() }
  }

  // 通知失败不改变已提交的导入结果；报告地址也用于站内消息。
  if (result.imported > 0) {
    try {
      const sent = await sendMessage({ enterpriseId, type: 'upload_done', title: '生产采集导入完成', content: '成功导入 ' + result.imported + ' 条追溯码（' + fileName + '）', link: '/admin/import-reports/' + reportId, attempts: 3 })
      result.notificationState = sent ? 'sent' : 'failed'
      await query("UPDATE import_report SET result_json = JSON_SET(result_json, '$.notificationState', ?) WHERE id = ?", [result.notificationState, reportId])
    } catch (error) { console.error('[import] 完成通知发送失败:', error) }
  }
  return result
}
