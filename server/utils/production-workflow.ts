import { createHash } from 'node:crypto'
import type { PoolConnection } from 'mysql2/promise'
import { getPool } from './db'
import { requireWritableUser, requireBackendUser, requirePlatformAdmin } from './auth'
import { codeOverrides, effectiveProduction, jsonValue, productionFields, publicProduction } from './production-values'

const fail = (message: string, statusCode = 400): never => { throw createError({ statusCode, statusMessage: message }) }
export const positiveId = (value: any) => {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) fail('无效的记录编号')
  return id
}
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const hash = (value: any) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const parse = (value: any) => jsonValue(value) || {}
export function validDate(value: any, label: string, nullable = false): string | null {
  if ((value === null || value === '') && nullable) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1000) fail(label + '格式不正确')
  const date = new Date(value + 'T00:00:00Z')
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail(label + '不是有效日期')
  return value
}
function textField(value: any, label: string, nullable = false) {
  if (nullable && (value == null || value === '')) return null
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 64) fail(label + '须填写且不超过64个字符')
  return value.trim()
}
function validateEffective(value: any) {
  validDate(value.produceDate, '生产日期')
  validDate(value.expireDate, '有效期至', true)
  textField(value.qualityCertNo, '质量合格证号')
  if (![0, 1].includes(Number(value.qcResult)) || value.qcResult == null) fail('请选择质量检验结果')
  if (value.expireDate && value.expireDate < value.produceDate) fail('有效期至不能早于生产日期')
}
export async function transaction<T>(work: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await getPool().getConnection()
  try { await conn.beginTransaction(); const result = await work(conn); await conn.commit(); return result }
  catch (e: any) {
    await conn.rollback()
    if (e.code === 'ER_DUP_ENTRY' || e.code === 'ER_LOCK_DEADLOCK' || e.code === 'ER_LOCK_WAIT_TIMEOUT') fail('数据正在被其他操作修改，请刷新后重试', 409)
    throw e
  } finally { conn.release() }
}
async function rows(conn: PoolConnection, sql: string, args: any[] = []): Promise<any[]> {
  const [result] = await conn.query<any[]>(sql, args)
  return result
}
async function fileState(conn: PoolConnection, user: any, id: number, lock = false) {
  const [file] = await rows(conn, 'SELECT * FROM upload_batch WHERE id = ?' + (lock ? ' FOR UPDATE' : ''), [id])
  if (!file || (user.role !== 'platform_admin' && Number(file.enterprise_id) !== Number(user.enterprise_id))) fail('上传文件不存在', 404)
  const codes = await rows(conn, 'SELECT * FROM trace_code WHERE upload_batch_id = ? ORDER BY id' + (lock ? ' FOR UPDATE' : ''), [id])
  if (codes.some(c => Number(c.enterprise_id) !== Number(file.enterprise_id))) fail('文件归属异常，请联系总部核对')
  const batches: Record<number, any> = {}
  for (const batchId of [...new Set(codes.map(c => Number(c.batch_id)).filter(Boolean))].sort((a, b) => a - b)) {
    const [batch] = await rows(conn, 'SELECT * FROM batch WHERE id = ?' + (lock ? ' FOR UPDATE' : ''), [batchId])
    if (!batch || Number(batch.enterprise_id) !== Number(file.enterprise_id)) fail('生产批次归属异常，请联系总部核对')
    batches[batchId] = batch
  }
  return { file, codes, batches }
}
function scope(state: any, body: any, kind: string) {
  const productId = positiveId(body.productId)
  const groupBatchId = kind === 'correct' ? positiveId(body.groupBatchId) : 0
  const all = state.codes.filter((c: any) => Number(c.product_id) === productId && (kind === 'bind' || Number(c.batch_id) === groupBatchId) && (body.codeId === undefined || Number(c.id) === positiveId(body.codeId)))
  if (!all.length) fail('所选分组没有追溯码')
  if (all.some((c: any) => Number(c.abnormal_flag) !== 0)) fail('所选分组含冻结或作废码，不能执行整批操作；作废码不可恢复')
  const targets = all.filter((c: any) => kind === 'bind' ? Number(c.status) === 1 && !c.batch_id : Number(c.status) === 2)
  if (body.codeId !== undefined) {
    const codeId = positiveId(body.codeId)
    const target = targets.find((c: any) => Number(c.id) === codeId)
    if (!target) fail('目标码不属于可修正范围')
    return [target]
  }
  if (!targets.length) fail(kind === 'bind' ? '所选分组没有未绑定码' : '所选分组没有已绑定码')
  if (targets.length > 10000) fail('单次最多处理一万条目标码，请先分组处理')
  return targets
}
export async function resolveProductionBatch(conn: PoolConnection, product: any, data: any, create: boolean) {
  const batchNo = textField(data.batchNo, '生产批号')
  const produceDate = validDate(data.produceDate, '生产日期')
  const qualityCertNo = textField(data.qualityCertNo, '质量合格证号')
  const expireDate = validDate(data.expireDate ?? null, '有效期至', true)
  const qcReportNo = textField(data.qcReportNo, '质检报告号', true)
  const qcResult = data.qcResult === undefined ? 1 : Number(data.qcResult)
  validateEffective({ produceDate, expireDate, qualityCertNo, qcResult })
  if (qcResult !== 1) fail('质检不合格的批次不能绑定')
  const [existing] = await rows(conn, 'SELECT * FROM batch WHERE product_id = ? AND batch_no = ? FOR UPDATE', [product.id, batchNo])
  if (existing) {
    if (Number(existing.enterprise_id) !== Number(product.enterprise_id)) fail('生产批次归属异常')
    if (Number(existing.qc_result) !== 1) fail('已有批次质检不合格或尚未确认，不能绑定')
    if (existing.produce_date !== produceDate || existing.quality_cert_no !== qualityCertNo ||
      (data.expireDate !== undefined && (existing.expire_date || null) !== expireDate) ||
      (data.qcReportNo !== undefined && (existing.qc_report_no || null) !== qcReportNo)) {
      fail('已有批次资料不一致，请选择已有批次查看并核对，不能覆盖公共资料', 409)
    }
    return { batch: existing, created: false }
  }
  const batch: any = { enterprise_id: product.enterprise_id, product_id: product.id, batch_no: batchNo,
    produce_date: produceDate, quality_cert_no: qualityCertNo, expire_date: expireDate, qc_result: qcResult, qc_report_no: qcReportNo }
  if (create) {
    const [r]: any = await conn.execute('INSERT INTO batch (enterprise_id, product_id, batch_no, produce_date, quality_cert_no, expire_date, qc_result, qc_report_no, quantity) VALUES (?,?,?,?,?,?,?,?,0)',
      [product.enterprise_id, product.id, batchNo, produceDate, qualityCertNo, expireDate, qcResult, qcReportNo])
    batch.id = r.insertId
  }
  return { batch, created: true }
}
async function bindingPlan(conn: PoolConnection, state: any, body: any) {
  const targets = scope(state, body, 'bind')
  const [product] = await rows(conn, 'SELECT *, CURDATE() AS today FROM product WHERE id = ? FOR UPDATE', [positiveId(body.productId)])
  if (!product || Number(product.enterprise_id) !== Number(state.file.enterprise_id) || Number(product.status) !== 1) fail('产品不存在、已停用或归属不匹配')
  if (product.registration_expire && product.registration_expire < product.today) fail('登记证已过期，不能绑定')
  let choice: any
  if (body.mode === 'existing') {
    if (body.newBatch !== undefined) fail('选择已有批次时不能提交新建资料')
    const [batch] = await rows(conn, 'SELECT * FROM batch WHERE id = ? FOR UPDATE', [positiveId(body.batchId)])
    if (!batch || Number(batch.product_id) !== Number(product.id) || Number(batch.enterprise_id) !== Number(product.enterprise_id)) fail('所选批次与产品或企业不匹配')
    validateEffective(publicProduction(batch))
    if (Number(batch.qc_result) !== 1) fail('质检不合格的批次不能绑定')
    choice = { batch, created: false }
  } else if (body.mode === 'new') {
    if (body.batchId !== undefined) fail('新建批次时不能提交已有批次编号')
    choice = await resolveProductionBatch(conn, product, body.newBatch || {}, false)
  } else fail('请选择绑定已有批次或新建批次')
  return { targets, product, ...choice }
}
function correctionPlan(state: any, body: any) {
  const targets = scope(state, body, 'correct')
  if (body.batchId !== undefined || body.batchNo !== undefined || body.newBatch !== undefined || body.mode !== undefined) fail('修正不能新建或更换生产批次')
  if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500) fail('请填写修正原因（不超过500字）')
  if (!body.changes || typeof body.changes !== 'object' || Array.isArray(body.changes)) fail('请选择修正字段')
  const keys = Object.keys(body.changes)
  if (!keys.length || keys.some(k => !(productionFields as readonly string[]).includes(k))) fail('包含不允许修正的字段')
  const changes = targets.map((code: any) => {
    const batch = state.batches[code.batch_id]
    if (!batch || Number(batch.product_id) !== Number(code.product_id)) fail('码与生产批次资料不一致')
    const overrides = { ...codeOverrides(code, batch) }
    for (const field of keys) {
      const command = body.changes[field]
      if (!command || typeof command !== 'object') fail('修正指令无效')
      if (command.action === 'inherit') delete overrides[field]
      else if (command.action === 'clear' && field === 'expireDate') overrides[field] = null
      else if (command.action === 'set') {
        if (field === 'produceDate' || field === 'expireDate') overrides[field] = validDate(command.value, field === 'produceDate' ? '生产日期' : '有效期至')
        else if (field === 'qualityCertNo') overrides[field] = textField(command.value, '质量合格证号')
        else {
          if (![0, 1].includes(command.value)) fail('质量检验结果无效')
          if (command.value === 1 && Number(batch.qc_result) === 0) fail('码级合格不能覆盖生产批次不合格')
          overrides[field] = command.value
        }
      } else fail('修正操作无效，必填字段不能清空')
    }
    const before = effectiveProduction(code, batch)
    const after = effectiveProduction({ ...code, production_override: overrides }, batch)
    validateEffective(after)
    return { code, overrides, before, after }
  })
  return { targets, changes }
}
function fingerprint(state: any, body: any, plan: any) {
  // 扫码日志与查询次数不属于生产资料，不能导致审批无故过期。
  const codes = state.codes.map((c: any) => [c.id, c.product_id, c.batch_id, c.status, c.abnormal_flag, c.produce_date, c.expire_date, c.quality_cert_no, c.qc_result, c.production_override])
  const { previewToken: _token, requestKey: _key, ...command } = body
  return hash({ command, codes, batches: state.batches, file: state.file, targetBatch: plan.batch, product: plan.product })
}
function summary(state: any, plan: any, token: string) {
  const distributions: any = {}
  for (const field of productionFields) {
    const values = new Map<string, number>()
    for (const change of plan.changes || []) {
      const key = JSON.stringify([change.before[field], change.after[field]])
      values.set(key, (values.get(key) || 0) + 1)
    }
    distributions[field] = [...values].map(([key, count]) => ({ before: JSON.parse(key)[0], after: JSON.parse(key)[1], count }))
  }
  return { previewToken: token, total: state.codes.length, targetCount: plan.targets.length,
    excludedCount: state.codes.length - plan.targets.length, batch: plan.batch, batchCreated: plan.created,
    distributions, sampleCodes: plan.targets.slice(0, 10).map((c: any) => c.code) }
}
async function recordChange(conn: PoolConnection, operationId: number, codeId: number | null, before: any, after: any) {
  await conn.execute('INSERT INTO production_change (operation_id, code_id, before_value, after_value) VALUES (?,?,?,?)',
    [operationId, codeId, JSON.stringify(before), JSON.stringify(after)])
}
async function applyPlan(conn: PoolConnection, operationId: number, kind: string, body: any, plan: any) {
  if (kind === 'bind') {
    const choice = body.mode === 'new' ? await resolveProductionBatch(conn, plan.product, body.newBatch || {}, true) : { batch: plan.batch, created: false }
    const b = choice.batch
    for (const code of plan.targets) {
      await conn.execute("UPDATE trace_code SET batch_id=?, batch_no=?, produce_date=?, quality_cert_no=?, expire_date=NULL, qc_result=NULL, production_override=JSON_OBJECT(), status=2, bound_at=NOW() WHERE id=? AND status=1 AND abnormal_flag=0",
        [b.id, b.batch_no, b.produce_date, b.quality_cert_no, code.id])
      await recordChange(conn, operationId, code.id, { batchId: code.batch_id, status: code.status }, { batchId: b.id, status: 2 })
    }
    return { bound: plan.targets.length, batchId: b.id, batchCreated: choice.created }
  }
  for (const change of plan.changes) {
    await conn.execute('UPDATE trace_code SET production_override=? WHERE id=?', [JSON.stringify(change.overrides), change.code.id])
    await recordChange(conn, operationId, change.code.id,
      { effective: change.before, overrides: change.code.production_override == null ? { legacy: true } : parse(change.code.production_override) }, { effective: change.after, overrides: change.overrides })
  }
  return { corrected: plan.targets.length }
}
export async function productionContext(event: any) {
  const user = await requireBackendUser(event)
  return transaction(async conn => {
    const state = await fileState(conn, user, positiveId(getRouterParam(event, 'id')))
    const groups = new Map<string, any>()
    for (const c of state.codes) {
      const key = c.product_id + ':' + (c.batch_id || 0)
      if (!groups.has(key)) groups.set(key, { productId: Number(c.product_id), batchId: Number(c.batch_id || 0), batchNo: state.batches[c.batch_id]?.batch_no || '未绑定', total: 0, bound: 0, abnormal: 0 })
      const group = groups.get(key)
      group.total++; group.bound += Number(c.status) === 2 ? 1 : 0; group.abnormal += Number(c.abnormal_flag) !== 0 ? 1 : 0
    }
    const products = await rows(conn, 'SELECT id, name FROM product WHERE enterprise_id = ? ORDER BY id', [state.file.enterprise_id])
    return { file: state.file, total: state.codes.length, groups: [...groups.values()].map(g => ({ ...g, productName: products.find(p => Number(p.id) === g.productId)?.name || '历史产品未匹配' })) }
  })
}
export async function productionAction(event: any, kind: 'bind' | 'correct', preview = false) {
  const user = await requireWritableUser(event)
  const id = positiveId(getRouterParam(event, 'id'))
  const body = await readBody(event) || {}
  const allowed = kind === 'bind' ? ['productId','mode','batchId','newBatch','previewToken','requestKey'] : ['productId','groupBatchId','codeId','changes','reason','previewToken','requestKey']
  if (Object.keys(body).some(key => !allowed.includes(key))) fail('请求包含不属于当前操作的字段')
  return transaction(async conn => {
    // 上传文件锁串行化同一文件的生产操作，数据库唯一键保护跨文件同批号并发。
    const state = await fileState(conn, user, id, true)
    if (!preview) {
      if (typeof body.requestKey !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(body.requestKey)) fail('请重新预览后提交')
      const [previous] = await rows(conn, 'SELECT * FROM production_operation WHERE actor_id=? AND request_key=? FOR UPDATE', [user.id, body.requestKey])
      if (previous) {
        if (previous.kind !== kind || Number(previous.scope_id) !== id || hash(parse(previous.payload)) !== hash(body)) fail('重复请求内容不一致', 409)
        return { ...parse(previous.result), operationId: previous.id, status: previous.status }
      }
    }
    const plan = kind === 'bind' ? await bindingPlan(conn, state, body) : correctionPlan(state, body)
    const token = fingerprint(state, body, plan)
    if (preview) return summary(state, plan, token)
    if (body.previewToken !== token) fail('目标范围或生产资料已变化，请重新预览', 409)
    const pending = kind === 'correct' && user.role !== 'platform_admin'
    const [insert]: any = await conn.execute('INSERT INTO production_operation (request_key,enterprise_id,actor_id,kind,scope_id,status,payload) VALUES (?,?,?,?,?,?,?)',
      [body.requestKey, state.file.enterprise_id, user.id, kind, id, pending ? 'pending' : 'applied', JSON.stringify(body)])
    const operationId = Number(insert.insertId)
    const result = pending ? summary(state, plan, token) : await applyPlan(conn, operationId, kind, body, plan)
    await conn.execute('UPDATE production_operation SET result=? WHERE id=?', [JSON.stringify(result), operationId])
    return { ...result, operationId, status: pending ? 'pending' : 'applied' }
  })
}
export async function reviewProduction(event: any) {
  const user = await requirePlatformAdmin(event)
  const id = positiveId(getRouterParam(event, 'id'))
  const input = await readBody(event) || {}
  if (!['approve', 'reject'].includes(input.action)) fail('请选择通过或驳回')
  return transaction(async conn => {
    const [operation] = await rows(conn, 'SELECT * FROM production_operation WHERE id=? FOR UPDATE', [id])
    if (!operation) fail('更正申请不存在', 404)
    if (operation.status !== 'pending') return { status: operation.status }
    if (input.action === 'reject') {
      if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500) fail('请填写驳回原因')
      await conn.execute("UPDATE production_operation SET status='rejected', reviewer_id=?, reviewed_at=NOW(), result=? WHERE id=?", [user.id, JSON.stringify({ reason: input.reason }), id])
      return { status: 'rejected' }
    }
    const body = parse(operation.payload)
    if (operation.kind === 'batch') return approveBatch(conn, user, operation, body)
    const state = await fileState(conn, user, Number(operation.scope_id), true)
    // 审批时也检查企业可用性，防止到期或禁用后仍执行旧申请。
    const [enterprise] = await rows(conn, 'SELECT *, CURDATE() AS today FROM enterprise WHERE id=?', [operation.enterprise_id])
    if (!enterprise || Number(enterprise.status) !== 1 || !enterprise.renew_expire || enterprise.renew_expire < enterprise.today) fail('该企业已停用或服务已到期')
    const plan = correctionPlan(state, body)
    if (fingerprint(state, body, plan) !== body.previewToken) fail('申请提交后的生产资料已变化，请驳回后重新申请', 409)
    const result = await applyPlan(conn, id, 'correct', body, plan)
    await conn.execute("UPDATE production_operation SET status='applied', reviewer_id=?, reviewed_at=NOW(), result=? WHERE id=?", [user.id, JSON.stringify(result), id])
    return { ...result, status: 'applied' }
  })
}

async function batchPlan(conn: PoolConnection, user: any, id: number, body: any) {
  const [batch] = await rows(conn, 'SELECT * FROM batch WHERE id=? FOR UPDATE', [id])
  if (!batch || (user.role !== 'platform_admin' && Number(batch.enterprise_id) !== Number(user.enterprise_id))) fail('生产批次不存在', 404)
  const codes = await rows(conn, 'SELECT * FROM trace_code WHERE batch_id=? ORDER BY id FOR UPDATE', [id])
  if (codes.some(c => Number(c.enterprise_id) !== Number(batch.enterprise_id) || Number(c.product_id) !== Number(batch.product_id))) fail('批次关联码存在企业或产品归属异常，请先核对历史资料')
  if (codes.some(c => Number(c.abnormal_flag) !== 0)) fail('该生产批次含冻结或作废码，公共资料更正已拦截')
  if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500) fail('请填写更正原因（不超过500字）')
  const next = { ...batch, batch_no: textField(body.batchNo, '生产批号'),
    produce_date: validDate(body.produceDate, '生产日期'), quality_cert_no: textField(body.qualityCertNo, '质量合格证号'),
    expire_date: validDate(body.expireDate ?? null, '有效期至', true), qc_result: body.qcResult,
    qc_report_no: textField(body.qcReportNo, '质检报告号', true), quantity: Number(body.quantity) }
  validateEffective(publicProduction(next))
  if (!Number.isSafeInteger(next.quantity) || next.quantity < 0) fail('生产数量须为非负整数')
  const [duplicate] = await rows(conn, 'SELECT id FROM batch WHERE product_id=? AND batch_no=? AND id<>?', [batch.product_id, next.batch_no, id])
  if (duplicate) fail('该产品下批号已存在', 409)
  for (const code of codes) {
    // 历史值按原批次解析成覆盖后再计算新公共资料，避免公共更新改变历史回退值。
    const effective = effectiveProduction({ ...code, production_override: codeOverrides(code, batch) }, next)
    validateEffective(effective)
  }
  const token = hash({ batch, next, reason: body.reason, codes: codes.map(c => [c.id, c.upload_batch_id, c.abnormal_flag, c.status, c.production_override, c.produce_date, c.expire_date, c.quality_cert_no, c.qc_result]) })
  return { batch, codes, next, token }
}
function batchSummary(plan: any) {
  return { previewToken: plan.token, targetCount: plan.codes.length,
    uploadCount: new Set(plan.codes.map((c: any) => c.upload_batch_id).filter(Boolean)).size,
    legacyCount: plan.codes.filter((c: any) => c.production_override == null).length,
    before: plan.batch, after: plan.next }
}
async function applyBatch(conn: PoolConnection, operationId: number, plan: any) {
  for (const code of plan.codes) {
    const overrides = codeOverrides(code, plan.batch)
    await conn.execute('UPDATE trace_code SET production_override=?, batch_no=? WHERE id=?', [JSON.stringify(overrides), plan.next.batch_no, code.id])
    await recordChange(conn, operationId, code.id, { effective: effectiveProduction(code, plan.batch), batchNo: plan.batch.batch_no },
      { effective: effectiveProduction({ ...code, production_override: overrides }, plan.next), batchNo: plan.next.batch_no })
  }
  const b = plan.next
  await conn.execute('UPDATE batch SET batch_no=?,produce_date=?,quality_cert_no=?,expire_date=?,qc_result=?,qc_report_no=?,quantity=? WHERE id=?',
    [b.batch_no, b.produce_date, b.quality_cert_no, b.expire_date, b.qc_result, b.qc_report_no, b.quantity, b.id])
  await recordChange(conn, operationId, null, plan.batch, plan.next)
  return { updated: true, targetCount: plan.codes.length }
}
export async function batchAction(event: any, preview = false) {
  const user = await requireWritableUser(event)
  const id = positiveId(getRouterParam(event, 'id'))
  const body = await readBody(event) || {}
  return transaction(async conn => {
    if (!preview) {
      if (typeof body.requestKey !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(body.requestKey)) fail('请先预览生产批次更正')
      const [previous] = await rows(conn, 'SELECT * FROM production_operation WHERE actor_id=? AND request_key=? FOR UPDATE', [user.id, body.requestKey])
      if (previous) {
        if (previous.kind !== 'batch' || Number(previous.scope_id) !== id || hash(parse(previous.payload)) !== hash(body)) fail('重复请求内容不一致', 409)
        return { ...parse(previous.result), status: previous.status }
      }
    }
    const plan = await batchPlan(conn, user, id, body)
    if (preview) return batchSummary(plan)
    if (body.previewToken !== plan.token) fail('生产批次资料或影响范围已变化，请重新预览', 409)
    const pending = plan.codes.some(c => Number(c.status) === 2) && user.role !== 'platform_admin'
    const [insert]: any = await conn.execute('INSERT INTO production_operation (request_key,enterprise_id,actor_id,kind,scope_id,status,payload) VALUES (?,?,?,?,?,?,?)',
      [body.requestKey, plan.batch.enterprise_id, user.id, 'batch', id, pending ? 'pending' : 'applied', JSON.stringify(body)])
    const result = pending ? batchSummary(plan) : await applyBatch(conn, insert.insertId, plan)
    await conn.execute('UPDATE production_operation SET result=? WHERE id=?', [JSON.stringify(result), insert.insertId])
    return { ...result, status: pending ? 'pending' : 'applied' }
  })
}
async function approveBatch(conn: PoolConnection, user: any, operation: any, body: any) {
  const [ent] = await rows(conn, 'SELECT *, CURDATE() AS today FROM enterprise WHERE id=?', [operation.enterprise_id])
  if (!ent || Number(ent.status) !== 1 || !ent.renew_expire || ent.renew_expire < ent.today) fail('该企业已停用或服务已到期')
  const plan = await batchPlan(conn, user, Number(operation.scope_id), body)
  if (plan.token !== body.previewToken) fail('公共资料已变化，请驳回后重新申请', 409)
  const result = await applyBatch(conn, operation.id, plan)
  await conn.execute("UPDATE production_operation SET status='applied',reviewer_id=?,reviewed_at=NOW(),result=? WHERE id=?", [user.id, JSON.stringify(result), operation.id])
  return { ...result, status: 'applied' }
}
