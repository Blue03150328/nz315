// POST /api/admin/codes/upload-batches/:id/correct —— 整批修正（2026-09-04 码库聚合改造）
// 作用域 = 本上传批次（upload_batch）内全部追溯码；表单字段与批量修正工具（batch-correct）一致：
//   重新绑定批次（仅"已生成"码生效，绑定后自动置"已绑定"）/ 生产日期 / 有效期至 / 质检结果 / 质量合格证号
// 规则对齐 PRD 5.8 批量修正通用规则：
//   ① 异常标记优先——批次内含已冻结/已作废码时整批拒绝（需先在明细中单行处理），与单条批量修正同语义；
//   ② 批次字段修正按码所属生产批次（batch）分组更新，并同步 trace_code 冗余列（扫码页实时 JOIN batch）；
//   ③ 重新绑定批次时校验新批次产品与本上传批次产品一致；
//   ④ 企业隔离：厂家/码管理员只能操作本企业上传批次。
import { query, execute } from '../../../../../utils/db'
import { requireBackendUser } from '../../../../../utils/auth'
import { logOperation } from '../../../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const ubId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(ubId) || ubId <= 0) throw createError({ statusCode: 400, statusMessage: '无效的上传批次ID' })

  const body = await readBody(event) || {}
  const fid = user.role === 'platform_admin' ? null : user.enterprise_id

  // 上传批次归属校验 + 快照
  const [ub] = await query<any[]>(
    'SELECT id, file_name, product_id, batch_no, enterprise_id FROM upload_batch WHERE id = ?' + (fid ? ' AND enterprise_id = ?' : ''),
    fid ? [ubId, fid] : [ubId])
  if (!ub) throw createError({ statusCode: 404, statusMessage: '上传批次不存在' })
  const productId = Number(ub.product_id)
  const ubEnterpriseId = Number(ub.enterprise_id)

  const hasBatchRebind = body.batchId !== undefined && body.batchId !== null && body.batchId !== ''
  const hasBatchFields = body.produceDate || body.expireDate || body.qcResult !== undefined || body.qualityCertNo
  // 新建批次绑定模式（2026-09-04 方案 A）：生成入库的「已生成」码在此绑定生产批次——
  // 传 batchNo 即进入该模式（与生产采集 import 同款建批/匹配逻辑：批号不存在自动建档，质检默认合格）
  const newBatchNo = String(body.batchNo || '').trim()
  const isNewBatchMode = newBatchNo !== ''
  if (isNewBatchMode && hasBatchRebind) {
    throw createError({ statusCode: 400, statusMessage: '绑定已有批次与新建批次只能二选一' })
  }
  if (!hasBatchRebind && !hasBatchFields && !isNewBatchMode) {
    throw createError({ statusCode: 400, statusMessage: '请至少选择一个要修改的字段' })
  }

  // ① 异常标记优先：本批次含已冻结/已作废码 → 整批拒绝（与批量修正工具同语义）
  const [bad] = await query<any[]>(
    'SELECT COUNT(*) AS c FROM trace_code WHERE upload_batch_id = ? AND abnormal_flag > 0' + (fid ? ' AND enterprise_id = ?' : ''),
    fid ? [ubId, fid] : [ubId])
  if (Number(bad?.c || 0) > 0) {
    throw createError({ statusCode: 400, statusMessage: '本批次包含 ' + Number(bad?.c || 0) + ' 条已冻结/已作废的码，整批修正前请先在明细中处理（单行恢复/作废）' })
  }

  let rebound = 0
  let corrected = 0

  // ① 新建批次绑定（仅"已生成"码；生成入库留档的码在此完成生产绑定，与 import 建批/归并同口径）
  if (isNewBatchMode) {
    const newProduceDate = String(body.produceDate || '').trim()
    const newQualityCertNo = String(body.qualityCertNo || '').trim()
    const newQcReportNo = String(body.qcReportNo || '').trim() || null
    const newExpireDate = String(body.expireDate || '').trim() || null
    if (!newProduceDate || !newQualityCertNo) {
      throw createError({ statusCode: 400, statusMessage: '新建批次需同时填写生产日期与质量合格证号' })
    }
    // 本行须存在可绑定的"已生成"码（生产采集导入的行全为已绑定，无需此操作）
    const [unbound] = await query<any[]>(
      'SELECT COUNT(*) AS c FROM trace_code WHERE upload_batch_id = ? AND status = 1' + (fid ? ' AND enterprise_id = ?' : ''),
      fid ? [ubId, fid] : [ubId])
    if (Number(unbound?.c || 0) === 0) {
      throw createError({ statusCode: 400, statusMessage: '本批次没有「已生成（未绑定）」的码，无需新建批次绑定' })
    }
    // 查同产品同批号 → 命中校验一致复用 / 未命中自动建档（与 import 同规则：质检默认合格、quantity 记 0）
    // 注意：本文件用项目封装的 query()（返回「行数组」本身，非 [rows, fields] 二元组），
    // 多行结果必须整体接收后按数组使用；写成 const [exist] = await query(...) 会取到首行对象，
    // exist.length 恒为 undefined → 已存在批号也走 INSERT → 唯一键冲突 500（2026-09-10 实测修复）
    const batchCond = fid ? ' AND b.enterprise_id = ?' : ''
    const exist = await query<any[]>(
      'SELECT b.id, b.produce_date, b.quality_cert_no, b.qc_result FROM batch b WHERE b.product_id = ? AND b.batch_no = ?' + batchCond,
      fid ? [productId, newBatchNo, fid] : [productId, newBatchNo])
    let batchId: number
    let batchCreated = false
    if (exist && exist.length > 0) {
      const b = exist[0]
      if (Number(b.qc_result) === 0) {
        throw createError({ statusCode: 400, statusMessage: '批次 ' + newBatchNo + ' 质检不合格，其追溯码不得绑定（请先在生产批次页处理）' })
      }
      const dbDate = b.produce_date ? String(b.produce_date).slice(0, 10) : ''
      const dbCert = String(b.quality_cert_no || '')
      if (dbDate !== newProduceDate || dbCert !== newQualityCertNo) {
        throw createError({ statusCode: 400, statusMessage: '批次 ' + newBatchNo + ' 已存在，生产日期/合格证号不一致（库内 ' + (dbDate || '-') + ' / ' + (dbCert || '-') + '），请核对' })
      }
      batchId = Number(b.id)
    } else {
      // 注意：db.ts execute 返回 ResultSetHeader（非 mysql2 二元组），不可数组解构
      try {
        const r = await execute(
          'INSERT INTO batch (enterprise_id, product_id, batch_no, produce_date, quality_cert_no, expire_date, qc_result, qc_report_no, quantity) VALUES (?,?,?,?,?,?,?,?,?)',
          [ubEnterpriseId, productId, newBatchNo, newProduceDate, newQualityCertNo, newExpireDate, 1, newQcReportNo, 0])
        batchId = Number(r.insertId)
        batchCreated = true
      } catch (e: any) {
        // 唯一键竞态兜底（并发同时建同批号）：返回中文 400 而非 500 堆栈
        if (e?.code === 'ER_DUP_ENTRY') {
          throw createError({ statusCode: 400, statusMessage: '批次 ' + newBatchNo + ' 刚被创建，请重新打开修正窗口后重试' })
        }
        throw e
      }
    }
    // 绑定本行全部"已生成"码（三要素冗余 + status=2）
    const rb = await execute(
      'UPDATE trace_code SET batch_id = ?, produce_date = ?, batch_no = ?, quality_cert_no = ?, status = 2, bound_at = NOW() WHERE upload_batch_id = ? AND status = 1' + (fid ? ' AND enterprise_id = ?' : ''),
      [batchId, newProduceDate, newBatchNo, newQualityCertNo, ubId, ...(fid ? [fid] : [])])
    rebound = Number(rb.affectedRows || 0)
    // 同步上传批次快照（生产批号等随绑定更新）
    if (rebound > 0) {
      await execute(
        'UPDATE upload_batch SET batch_id = ?, batch_no = ?, produce_date = ?, quality_cert_no = ? WHERE id = ?' + (fid ? ' AND enterprise_id = ?' : ''),
        [batchId, newBatchNo, newProduceDate, newQualityCertNo, ubId, ...(fid ? [fid] : [])])
    }
    await logOperation(event, {
      module: '码库管理',
      action: '新建批次绑定',
      content: JSON.stringify({ uploadBatchId: ubId, batchNo: newBatchNo, batchCreated, rebound, productId }),
    })
    return { ok: true, rebound, corrected: 0, batchCreated, batchId }
  }

  // ② 重新绑定批次（仅"已生成"码；生产采集导入的码均为"已绑定"，此分支主要服务于历史/兜底场景）
  if (hasBatchRebind) {
    const batchId = Number(body.batchId)
    const [batch] = await query<any[]>(
      'SELECT * FROM batch WHERE id = ?' + (fid ? ' AND enterprise_id = ?' : ''),
      fid ? [batchId, fid] : [batchId])
    if (!batch) throw createError({ statusCode: 400, statusMessage: '批次不存在' })
    // 一致性：新批次产品须与本上传批次产品一致（同文件码同产品）
    if (Number(batch.product_id) !== productId) {
      throw createError({ statusCode: 400, statusMessage: '所选批次产品与本批次关联产品不一致，请重新选择' })
    }
    const r = await execute(
      'UPDATE trace_code SET batch_id = ?, produce_date = ?, batch_no = ?, quality_cert_no = ?, status = 2, bound_at = NOW() WHERE upload_batch_id = ? AND status = 1' + (fid ? ' AND enterprise_id = ?' : ''),
      [batchId, batch.produce_date, batch.batch_no, batch.quality_cert_no, ubId, ...(fid ? [fid] : [])])
    rebound = Number(r.affectedRows || 0)
    // 同步上传批次快照（生产批号随重绑更新）
    if (rebound > 0) {
      await execute(
        'UPDATE upload_batch SET batch_id = ?, batch_no = ? WHERE id = ?' + (fid ? ' AND enterprise_id = ?' : ''),
        [batchId, batch.batch_no, ubId, ...(fid ? [fid] : [])])
    }
  }

  // ③ 批次字段修正（生产日期/有效期至/质检结果/合格证号）：按码所属生产批次分组更新 batch 表
  if (hasBatchFields) {
    const batchRows = await query<any[]>(
      'SELECT DISTINCT batch_id FROM trace_code WHERE upload_batch_id = ? AND batch_id IS NOT NULL' + (fid ? ' AND enterprise_id = ?' : ''),
      fid ? [ubId, fid] : [ubId])
    for (const b of batchRows) {
      const sets: string[] = []
      const params: any[] = []
      if (body.produceDate) {
        sets.push('produce_date = ?'); params.push(String(body.produceDate))
        sets.push('expire_date = ?'); params.push(String(body.expireDate || body.produceDate))
      } else if (body.expireDate) {
        sets.push('expire_date = ?'); params.push(String(body.expireDate))
      }
      if (body.qcResult !== undefined && body.qcResult !== null && body.qcResult !== '') {
        sets.push('qc_result = ?'); params.push(Number(body.qcResult))
      }
      if (body.qualityCertNo) {
        sets.push('quality_cert_no = ?'); params.push(String(body.qualityCertNo))
      }
      if (sets.length) {
        params.push(b.batch_id)
        await execute('UPDATE batch SET ' + sets.join(', ') + ' WHERE id = ?', params)
      }
    }
    // 同步 trace_code 冗余字段（produce_date / quality_cert_no，码库列表口径）
    const syncSets: string[] = []
    const syncParams: any[] = []
    if (body.produceDate) { syncSets.push('produce_date = ?'); syncParams.push(String(body.produceDate)) }
    if (body.qualityCertNo) { syncSets.push('quality_cert_no = ?'); syncParams.push(String(body.qualityCertNo)) }
    if (syncSets.length) {
      const r2 = await execute(
        'UPDATE trace_code SET ' + syncSets.join(', ') + ' WHERE upload_batch_id = ?' + (fid ? ' AND enterprise_id = ?' : ''),
        [...syncParams, ubId, ...(fid ? [fid] : [])])
      corrected = Number(r2.affectedRows || 0)
    }
  }

  await logOperation(event, {
    module: '码库管理',
    action: '整批修正',
    content: JSON.stringify({
      uploadBatchId: ubId,
      fileName: ub.file_name,
      productId,
      rebound,
      corrected,
      fields: { batchId: hasBatchRebind ? Number(body.batchId) : null, produceDate: body.produceDate || null, expireDate: body.expireDate || null, qcResult: body.qcResult ?? null, qualityCertNo: body.qualityCertNo || null },
    }),
  })
  return { ok: true, rebound, corrected }
})
