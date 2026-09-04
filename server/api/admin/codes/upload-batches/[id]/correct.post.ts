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
    'SELECT id, file_name, product_id, batch_no FROM upload_batch WHERE id = ?' + (fid ? ' AND enterprise_id = ?' : ''),
    fid ? [ubId, fid] : [ubId])
  if (!ub) throw createError({ statusCode: 404, statusMessage: '上传批次不存在' })
  const productId = Number(ub.product_id)

  const hasBatchRebind = body.batchId !== undefined && body.batchId !== null && body.batchId !== ''
  const hasBatchFields = body.produceDate || body.expireDate || body.qcResult !== undefined || body.qualityCertNo
  if (!hasBatchRebind && !hasBatchFields) {
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
