// POST /api/admin/codes/:id/correct —— 单条码修改（2026-09-04 批次码明细单行【修改】）
// 作用域 = 当前这一条追溯码，不影响同批次其他码；表单字段与批量修正一致（复用）：
//   重新绑定批次（batchId，仅当前码换绑，自动带出新批次三要素+质检）/ 生产日期 / 有效期至 / 质检结果 / 质量合格证号
// 规则：
//   ① 作废为终态不可修改（400）；冻结码允许修改（明细中恢复/作废为批量入口）；
//   ② 批次字段修正只写 trace_code 本行冗余覆盖列（produce_date/quality_cert_no/expire_date/qc_result），
//      绝不触碰 batch 表（批次级共享数据，改一条会影响同批其他码）；扫码页 COALESCE 优先码级值，展示生效；
//   ③ 重新绑定批次：校验新批次与本码产品一致，冗余列随新批次带出（可被本次表单字段覆盖）；
//      绑定后码状态自动流转 status=2 已绑定（bound_at 刷新）——与「批次三要素」绑定规则一致；
//   ④ 企业隔离：厂家/码管理员只能操作本企业码。
import { query, execute } from '../../../../utils/db'
import { requireWritableUser } from '../../../../utils/auth'
import { logOperation } from '../../../../utils/audit'
import { assertProductBindable } from '../../../../utils/product-guard'

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: '无效的码ID' })

  const body = await readBody(event) || {}
  const fid = user.role === 'platform_admin' ? null : user.enterprise_id

  // 目标码归属校验
  const [code] = await query<any[]>(
    'SELECT * FROM trace_code WHERE id = ?' + (fid ? ' AND enterprise_id = ?' : ''), fid ? [id, fid] : [id])
  if (!code) throw createError({ statusCode: 404, statusMessage: '追溯码不存在' })

  // ① 终态保护：已作废不可修改（冻结允许，明细单行修改属纠错场景）
  if (Number(code.abnormal_flag) === 2) {
    throw createError({ statusCode: 400, statusMessage: '该码已作废（终态），不可修改' })
  }

  const hasBatchRebind = body.batchId !== undefined && body.batchId !== null && body.batchId !== '' && Number(body.batchId) > 0
  const hasField = body.produceDate || body.expireDate || (body.qcResult !== undefined && body.qcResult !== null && body.qcResult !== '') || body.qualityCertNo
  if (!hasBatchRebind && !hasField) {
    throw createError({ statusCode: 400, statusMessage: '请至少选择一个要修改的字段' })
  }

  let rebound = 0
  let corrected = 0
  const fields: Record<string, unknown> = { batchId: hasBatchRebind ? Number(body.batchId) : null }

  // ② 重新绑定批次：单码换绑（冗余列随新批次带出，允许本次字段覆盖）
  if (hasBatchRebind) {
    const batchId = Number(body.batchId)
    const [batch] = await query<any[]>(
      'SELECT * FROM batch WHERE id = ?' + (fid ? ' AND enterprise_id = ?' : ''),
      fid ? [batchId, fid] : [batchId])
    if (!batch) throw createError({ statusCode: 400, statusMessage: '批次不存在' })
    // 登记证过期守卫（PRD 5.9 异常4：暂停绑定批次；缺陷 N4）
    // 码自身产品优先；码未挂产品时回落到批次所属产品（与下一行一致性校验同口径）
    await assertProductBindable(code.product_id ?? batch.product_id)
    // 产品一致性：码已挂产品时校验新批次产品一致（防跨产品串绑）
    if (code.product_id && Number(batch.product_id) !== Number(code.product_id)) {
      throw createError({ statusCode: 400, statusMessage: '所选批次产品与当前追溯码产品不一致，请重新选择' })
    }
    // 本次表单字段优先，未填则随新批次带出
    const r = await execute(
      'UPDATE trace_code SET batch_id = ?, batch_no = ?, status = 2, bound_at = NOW(), ' +
      'produce_date = ?, expire_date = ?, qc_result = ?, quality_cert_no = ? WHERE id = ?',
      [
        batchId,
        batch.batch_no,
        String(body.produceDate || batch.produce_date || '') || null,
        String(body.expireDate || batch.expire_date || '') || null,
        body.qcResult !== undefined && body.qcResult !== null && body.qcResult !== '' ? Number(body.qcResult) : (batch.qc_result ?? null),
        String(body.qualityCertNo || batch.quality_cert_no || '') || null,
        id,
      ])
    rebound = Number(r.affectedRows || 0)
    fields.produceDate = body.produceDate || null
    fields.expireDate = body.expireDate || null
    fields.qcResult = body.qcResult ?? null
    fields.qualityCertNo = body.qualityCertNo || null
  }

  // ③ 字段修正（未选重绑时）：只写本行冗余覆盖列——不影响 batch 表（同批其他码不受影响）
  if (!hasBatchRebind && hasField) {
    const sets: string[] = []
    const params: any[] = []
    if (body.produceDate) { sets.push('produce_date = ?'); params.push(String(body.produceDate)) }
    if (body.expireDate) { sets.push('expire_date = ?'); params.push(String(body.expireDate)) }
    if (body.qcResult !== undefined && body.qcResult !== null && body.qcResult !== '') {
      sets.push('qc_result = ?'); params.push(Number(body.qcResult))
    }
    if (body.qualityCertNo) { sets.push('quality_cert_no = ?'); params.push(String(body.qualityCertNo)) }
    if (sets.length) {
      const r = await execute('UPDATE trace_code SET ' + sets.join(', ') + ' WHERE id = ?', [...params, id])
      corrected = Number(r.affectedRows || 0)
    }
    fields.produceDate = body.produceDate || null
    fields.expireDate = body.expireDate || null
    fields.qcResult = body.qcResult ?? null
    fields.qualityCertNo = body.qualityCertNo || null
  }

  await logOperation(event, {
    module: '码库管理',
    action: '单条修正',
    content: JSON.stringify({ code: code.code, id, rebound, corrected, fields }),
  })
  return { ok: true, rebound, corrected }
})
