import { getPool } from './db'
import { productionPatch } from './production-patch'
import { assertBindingAllowed, assertCodesCorrectable } from './binding-guard'
import { effectiveProduction } from '../../shared/utils/production-info'
import { refreshUploadSnapshots } from './upload-snapshot'

type Selection = { ids?: number[]; uploadBatchId?: number; single?: boolean }

/** 三个修正入口同一事务：产品→目标生产批次→码；只写选中码的覆盖字段。 */
export async function correctCodes(user: { role: string; enterprise_id: number | null }, body: Record<string, any>, selection: Selection) {
  let patch: Record<string, string | number>
  try { patch = productionPatch(body) } catch (e) { throw createError({ statusCode: 400, statusMessage: (e as Error).message }) }
  const hasBatch = body.batchId !== undefined && body.batchId !== null && body.batchId !== ''
  const batchId = hasBatch ? Number(body.batchId) : null
  if (hasBatch && (!Number.isInteger(batchId) || batchId! <= 0)) throw createError({ statusCode: 400, statusMessage: '无效的生产批次ID' })
  const newBatchNo = String(body.batchNo ?? '').trim()
  if (newBatchNo.length > 100) throw createError({ statusCode: 400, statusMessage: '生产批号不能超过100字' })
  if (newBatchNo && (hasBatch || !selection.uploadBatchId)) throw createError({ statusCode: 400, statusMessage: '新建批次仅支持上传文件绑定，不能同时选择已有批次' })
  if (!hasBatch && !newBatchNo && !Object.keys(patch).length) throw createError({ statusCode: 400, statusMessage: '请至少选择一个要修改的字段' })
  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  if (user.role !== 'platform_admin' && !fid) throw createError({ statusCode: 403, statusMessage: '账号未关联企业' })
  const ids = [...new Set(selection.ids ?? [])].sort((a, b) => a - b)
  const where = selection.uploadBatchId ? 'upload_batch_id = ?' : 'id IN (' + ids.map(() => '?').join(',') + ')'
  const values = selection.uploadBatchId ? [selection.uploadBatchId] : ids
  const scope = fid ? ' AND enterprise_id = ?' : ''
  const params = [...values, ...(fid ? [fid] : [])]
  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()
    const [seed] = await conn.query<any[]>('SELECT id, product_id, enterprise_id FROM trace_code WHERE ' + where + scope, params)
    if (!seed.length || (!selection.uploadBatchId && seed.length !== ids.length)) throw createError({ statusCode: 404, statusMessage: '部分追溯码不存在或不属于本企业' })
    const [target] = hasBatch ? await conn.query<any[]>('SELECT product_id FROM batch WHERE id = ?', [batchId]) : [[]]
    const productIds = [...new Set([...seed.map(c => Number(c.product_id)), ...target.map(c => Number(c.product_id))])].sort((a, b) => a - b)
    const [products] = await conn.query<any[]>('SELECT id, enterprise_id FROM product WHERE id IN (' + productIds.map(() => '?').join(',') + ') ORDER BY id FOR UPDATE', productIds)
    if (products.length !== productIds.length) throw createError({ statusCode: 400, statusMessage: '关联产品不存在' })
    let batch: any
    let batchCreated = false
    if (hasBatch) {
      const [batches] = await conn.query<any[]>('SELECT * FROM batch WHERE id = ?' + scope + ' FOR UPDATE', [batchId, ...(fid ? [fid] : [])])
      batch = batches[0]
      if (!batch) throw createError({ statusCode: 400, statusMessage: '批次不存在或不属于本企业' })
    } else if (newBatchNo) {
      if (products.length !== 1) throw createError({ statusCode: 400, statusMessage: '同一上传文件只能绑定一个产品' })
      const [batches] = await conn.query<any[]>('SELECT * FROM batch WHERE product_id = ? AND batch_no = ? FOR UPDATE', [products[0].id, newBatchNo])
      batch = batches[0]
    }
    const [codes] = await conn.query<any[]>('SELECT * FROM trace_code WHERE ' + where + scope + ' ORDER BY id FOR UPDATE', params)
    if (codes.length !== seed.length || codes.some(c => !products.some(p => Number(p.id) === Number(c.product_id) && Number(p.enterprise_id) === Number(c.enterprise_id)))) throw createError({ statusCode: 409, statusMessage: '追溯码归属已变化，请刷新后重试' })
    assertCodesCorrectable(codes)
    if (selection.uploadBatchId) {
      const [uploads] = await conn.query<any[]>('SELECT * FROM upload_batch WHERE id = ?' + scope + ' FOR UPDATE', [selection.uploadBatchId, ...(fid ? [fid] : [])])
      if (!uploads[0] || codes.some(c => Number(c.product_id) !== Number(uploads[0].product_id) || Number(c.enterprise_id) !== Number(uploads[0].enterprise_id))) throw createError({ statusCode: 409, statusMessage: '上传文件归属已变化，请刷新后重试' })
    }
    const binding = !!(hasBatch || newBatchNo)
    const eligible = binding ? codes.filter(c => selection.single || Number(c.status) === 1) : []
    if (binding && !eligible.length) throw createError({ statusCode: 400, statusMessage: '所选范围没有可绑定的未绑定码' })
    if (binding && patch.qc_result !== undefined && patch.qc_result !== 1) throw createError({ statusCode: 400, statusMessage: '绑定时质检必须合格，请先在生产批次页处理' })
    if (newBatchNo) {
      if (!patch.produce_date) throw createError({ statusCode: 400, statusMessage: '新建批次需填写生产日期' })
      const cert = patch.quality_cert_no || '见箱内质量合格证'
      if (batch && (String(batch.produce_date).slice(0, 10) !== patch.produce_date || String(batch.quality_cert_no) !== cert)) throw createError({ statusCode: 400, statusMessage: '批次已存在，生产日期或合格证号不一致，请核对后再绑定' })
      if (!batch) {
        const [r]: any = await conn.execute('INSERT INTO batch (enterprise_id, product_id, batch_no, produce_date, quality_cert_no, expire_date, qc_result, qc_report_no, quantity) VALUES (?,?,?,?,?,?,1,?,0)', [products[0].enterprise_id, products[0].id, newBatchNo, patch.produce_date, cert, patch.expire_date ?? null, String(body.qcReportNo ?? '').trim() || null])
        batch = { id: r.insertId, product_id: products[0].id, enterprise_id: products[0].enterprise_id, batch_no: newBatchNo, produce_date: patch.produce_date, quality_cert_no: cert, expire_date: patch.expire_date ?? null, qc_result: 1 }
        batchCreated = true
      }
    }
    if (binding) for (const code of codes) assertBindingAllowed(batch, Number(code.product_id), Number(code.enterprise_id))
    const before = codes.slice(0, 50).map(c => ({ id: c.id, batchId: c.batch_id, produceDate: c.produce_date, expireDate: c.expire_date, qcResult: c.qc_result, qualityCertNo: c.quality_cert_no }))
    // 分块更新以控制大上传文件的SQL参数量；任意块失败整体回滚。
    const update = async (selected: any[], fields: Record<string, any>, bind = false) => {
      for (let i = 0; i < selected.length; i += 1000) {
        const chunk = selected.slice(i, i + 1000)
        const columns = Object.keys(fields)
        await conn.execute('UPDATE trace_code SET ' + columns.map(k => k + ' = ?').join(', ') + (bind ? ', bound_at = NOW()' : '') + ' WHERE id IN (' + chunk.map(() => '?').join(',') + ')', [...Object.values(fields), ...chunk.map(c => c.id)])
      }
    }
    if (binding) await update(eligible, { batch_id: batch.id, batch_no: batch.batch_no, status: 2, produce_date: batch.produce_date, expire_date: batch.expire_date ?? null, qc_result: batch.qc_result, quality_cert_no: batch.quality_cert_no, ...patch }, true)
    if (!newBatchNo && Object.keys(patch).length) await update(codes, patch)
    // 文件聚合信息从实际码计算：混合值置空，不让单码修正伪装成整文件修改。
    const uploadIds = [...new Set(codes.map(c => Number(c.upload_batch_id)).filter(Boolean))].sort((a, b) => a - b)
    await refreshUploadSnapshots(conn, uploadIds)
    const [after] = await conn.query<any[]>('SELECT * FROM trace_code WHERE id IN (' + codes.slice(0, 50).map(() => '?').join(',') + ') ORDER BY id', codes.slice(0, 50).map(c => c.id))
    const result = { ok: true, rebound: eligible.length, corrected: !newBatchNo && Object.keys(patch).length ? codes.length : 0, batchId: binding ? Number(batch.id) : null, batchCreated, fileName: '', audit: { count: codes.length, sampleLimit: 50, fields: patch, before, after: after.map(c => ({ id: c.id, batchId: c.batch_id, ...effectiveProduction(c, {}) })) } }
    await conn.commit()
    return result
  } catch (e) {
    await conn.rollback()
    throw e
  } finally { conn.release() }
}
