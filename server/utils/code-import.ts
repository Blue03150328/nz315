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
import type { ImportResult } from '#shared/types/code-import'
import { validateImportRows } from './import-validation'
import { loadImportContext } from './import-context'
import { assertBindingAllowed } from './binding-guard'
import { isInputDate } from '../../shared/utils/input-date'
import { getPool, query } from './db'
import { sendMessage } from './notify'
import { adminLinks } from '#shared/utils/admin-navigation'
import type { AuthUser } from './auth'


// 日期入参格式（YYYY-MM-DD，与批次页 UInput type=date 口径一致）
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
  if (!isInputDate(produceDate)) throw createError({ statusCode: 400, statusMessage: '请选择有效生产日期（与产品标签喷码一致）' })
  if (!qualityCertNo) throw createError({ statusCode: 400, statusMessage: '请输入质量合格证号' })
  if (expireDate && !isInputDate(expireDate)) throw createError({ statusCode: 400, statusMessage: '有效期至不是有效日期' })

  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  const [prod] = await query<any[]>(
    'SELECT id, enterprise_id FROM product WHERE id = ?' + (fid ? ' AND enterprise_id = ?' : ''),
    fid ? [productId, fid] : [productId])
  if (!prod) throw createError({ statusCode: 400, statusMessage: '产品不存在' })
  const enterpriseId = Number(prod.enterprise_id)

  let rows: ReturnType<typeof validateImportRows> | undefined
  let result: ImportResult
  // 事务：自动建批/校验批次 + 分块插码，原子执行
  const pool = getPool()
  const conn = await pool.getConnection()
  let batchId: number | null = null
  let batchCreated = false
  let inserted = 0
  let uploadBatchId = 0
  let transactionOpen = false
  try {
    await conn.beginTransaction()
    transactionOpen = true
    // 同产品的上传串行校验：等待前次提交后重新查重，避免重复写码或产生空批次。
    await conn.query('SELECT id FROM product WHERE id = ? FOR UPDATE', [productId])
    const { context } = await loadImportContext(codes, enterpriseId, conn)
    rows = validateImportRows(codes, context, productId)
    const finalCodes = rows.accepted
    if (finalCodes.length) {

      // 1) 批次：按 同产品+同批号 查找 → 命中校验复用 / 未命中自动创建
      const batchCond = fid ? ' AND b.enterprise_id = ?' : ''
      const [exist] = await conn.query<any[]>(
        'SELECT b.* FROM batch b WHERE b.product_id = ? AND b.batch_no = ?' + batchCond + ' FOR UPDATE',
        fid ? [productId, batchNo, fid] : [productId, batchNo])
      if (exist.length > 0) {
        const b = exist[0]
        assertBindingAllowed(b, productId, enterpriseId)
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
        assertBindingAllowed({ product_id: productId, enterprise_id: enterpriseId, batch_no: batchNo, produce_date: produceDate, quality_cert_no: qualityCertNo, qc_result: 1 }, productId, enterpriseId)
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
    result = { ok: true, imported: inserted, skippedInvalid: rows.invalid, skippedDup: rows.duplicate, ignored: rows.ignored, total: rows.total, notWritten: 0, batchId, batchNo, batchCreated, uploadBatchId: uploadBatchId || null, fileName }
    await conn.commit()
    transactionOpen = false
  } catch (e: any) {
    await conn.rollback()
    transactionOpen = false
    const message = e?.statusCode ? String(e.statusMessage || '导入未完成') : '导入失败，数据未写入，请重新解析后重试'
    console.error('[import] 导入事务未完成:', e?.message || e)
    result = { ok: false, imported: 0, skippedInvalid: rows?.invalid || 0, skippedDup: rows?.duplicate || 0, ignored: rows?.ignored || 0, total: rows?.total ?? codes.length, notWritten: rows?.accepted.length ?? codes.length, batchId: null, batchNo, batchCreated: false, uploadBatchId: null, fileName, error: message }
  } finally {
    try { if (transactionOpen) await conn.rollback() } finally { conn.release() }
  }

  // 通知只在实际入库后发送；失败不改变已经提交的业务结果。
  if (result.imported > 0) {
    await sendMessage({ enterpriseId, type: 'upload_done', title: '生产采集导入完成', content: '成功导入 ' + result.imported + ' 条追溯码（' + fileName + '）', link: adminLinks.uploadBatch(result.uploadBatchId!), attempts: 3 })
  }
  return result
}
