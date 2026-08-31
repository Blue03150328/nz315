// POST /api/admin/codes/batch-correct —— 批量修正工具（PRD 5.8 场景8：勾选码→选择字段→填写正确值→预览→确认）
// 字段修改范围限制（PRD 5.8 表）：
// - 关联批次：仅"已生成"码（绑定后三要素齐全自动置"已绑定"）
// - 生产日期/有效期至/质检结果/合格证号：按码所属批次更新（同批码同步生效）；已绑定码修改属合规更正（记强日志）
import { query, execute } from '../../../utils/db'
import { requireBackendUser } from '../../../utils/auth'
import { logOperation } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const body = await readBody(event) || {}
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(n => Number.isInteger(n) && n > 0) : []
  if (ids.length === 0) throw createError({ statusCode: 400, statusMessage: '请选择追溯码' })
  if (ids.length > 5000) throw createError({ statusCode: 400, statusMessage: '单次最多 5000 条' })

  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  const idList = ids.join(',')

  // 1) 异常标记优先：已作废/已冻结的码不参与批量修改（PRD 5.8 批量修正通用规则9）
  const [badRow] = await query<any[]>(
    'SELECT COUNT(*) AS c FROM trace_code WHERE id IN (' + idList + ') AND abnormal_flag > 0' + (fid ? ' AND enterprise_id = ?' : ''),
    fid ? [fid] : [])
  if (Number(badRow?.c || 0) > 0) {
    throw createError({ statusCode: 400, statusMessage: '所选码中包含已冻结/已作废的码，不可批量修改' })
  }

  const hasBatchRebind = body.batchId !== undefined && body.batchId !== null && body.batchId !== ''
  const hasBatchFields = body.produceDate || body.expireDate || body.qcResult !== undefined || body.qualityCertNo
  if (!hasBatchRebind && !hasBatchFields) {
    throw createError({ statusCode: 400, statusMessage: '请至少选择一个要修改的字段' })
  }

  let rebound = 0
  let corrected = 0

  // 2) 重新绑定批次（仅已生成码；PRD 场景1：已绑定码不可替换产品/批次）
  if (hasBatchRebind) {
    const batchId = Number(body.batchId)
    const [batch] = await query<any[]>(
      'SELECT * FROM batch WHERE id = ?' + (fid ? ' AND enterprise_id = ?' : ''),
      fid ? [batchId, fid] : [batchId])
    if (!batch) throw createError({ statusCode: 400, statusMessage: '批次不存在' })

    // 关联产品一致性：批次的产品须与码的产品一致
    const [mismatch] = await query<any[]>(
      'SELECT COUNT(*) AS c FROM trace_code WHERE id IN (' + idList + ') AND product_id <> ?' + (fid ? ' AND enterprise_id = ?' : ''),
      fid ? [batch.product_id, fid] : [batch.product_id])
    if (Number(mismatch?.c || 0) > 0) {
      throw createError({ statusCode: 400, statusMessage: '所选码中存在产品与批次不匹配的码，请先调整产品归属' })
    }

    const result = await execute(
      'UPDATE trace_code SET batch_id = ?, produce_date = ?, batch_no = ?, quality_cert_no = ?, status = 2, bound_at = NOW() WHERE id IN (' + idList + ')' + (fid ? ' AND enterprise_id = ?' : '') + ' AND status = 1',
      [batchId, batch.produce_date, batch.batch_no, batch.quality_cert_no, ...(fid ? [fid] : [])])
    rebound = result.affectedRows
  }

  // 3) 批次字段修正（生产日期/有效期至/质检结果/合格证号）：按码所属批次分组更新
  if (hasBatchFields) {
    // 取所选码涉及的批次
    const batchRows = await query<any[]>(
      'SELECT DISTINCT batch_id FROM trace_code WHERE id IN (' + idList + ') AND batch_id IS NOT NULL' + (fid ? ' AND enterprise_id = ?' : ''),
      fid ? [fid] : [])
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
    // 同步 trace_code 冗余字段（produce_date / quality_cert_no）
    const syncSets: string[] = []
    const syncParams: any[] = []
    if (body.produceDate) { syncSets.push('produce_date = ?'); syncParams.push(String(body.produceDate)) }
    if (body.qualityCertNo) { syncSets.push('quality_cert_no = ?'); syncParams.push(String(body.qualityCertNo)) }
    if (syncSets.length) {
      const r2 = await execute(
        'UPDATE trace_code SET ' + syncSets.join(', ') + ' WHERE id IN (' + idList + ')' + (fid ? ' AND enterprise_id = ?' : ''),
        [...syncParams, ...(fid ? [fid] : [])])
      corrected = r2.affectedRows
    }
  }

  await logOperation(event, {
    module: '码库管理',
    action: '批量修正',
    content: JSON.stringify({
      ids: ids.slice(0, 50),
      rebound,
      corrected,
      fields: { batchId: hasBatchRebind ? Number(body.batchId) : null, produceDate: body.produceDate || null, expireDate: body.expireDate || null, qcResult: body.qcResult ?? null, qualityCertNo: body.qualityCertNo || null },
    }),
  })
  return { ok: true, rebound, corrected }
})