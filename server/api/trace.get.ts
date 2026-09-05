// 扫码查询接口（H5）：/trace?code=xxx —— 真实查询链路（PRD 5.9）
// 流程：格式校验 → 查 trace_code → 写扫码日志(scan_log) → 异常判定（作废/冻结优先）→ 联查产品/批次 → 返回展示数据
import { query, execute } from '../utils/db'
import { triggerAlert } from '../utils/risk-alert'
import { getCurrentConsumer } from '../utils/consumer-auth'
import type { TraceOutcome, TraceResultType } from '#shared/types/trace'

const CODE_RE = /^\d{32}$/

function fmt(code: string) {
  return code.replace(/(\d{8})(?=\d)/g, '$1 ')
}

// 判断扫码设备（PRD 7.8 scan_device：微信/支付宝/浏览器）
function detectDevice(event: any): string {
  const ua = String(getHeader(event, 'user-agent') || '')
  if (ua.includes('MicroMessenger')) return '微信'
  if (ua.includes('AlipayClient')) return '支付宝'
  return '浏览器'
}

// 最近 N 次扫码记录（时间/地域）
async function recentScans(code: string, limit = 5) {
  const rows = await query<any[]>(
    'SELECT scan_time, province, city FROM scan_log WHERE code = ? ORDER BY id DESC LIMIT ?',
    [code, limit])
  return rows.map(r => ({ time: String(r.scan_time).slice(0, 19), province: r.province || '', city: r.city || '' }))
}

export default defineEventHandler(async (event) => {
  const code = String(getQuery(event).code || '')
  const formatValid = CODE_RE.test(code)

  // 基础响应
  const baseOutcome = { code, formattedCode: fmt(code), formatValid }

  // 1) 格式校验：非 32 位数字 → 查无此码
  if (!formatValid) {
    const out: TraceOutcome = {
      ...baseOutcome, resultType: 'not-found', status: null, abnormalFlag: 0,
      queryCount: 0, firstQuery: false, recentScans: [],
      reasons: ['追溯码格式不符合 32 位阿拉伯数字规则'], generatedReport: null,
    }
    return out
  }

  // 2) 查码
  const [tc] = await query<any[]>('SELECT * FROM trace_code WHERE code = ? LIMIT 1', [code])
  if (!tc) {
    const out: TraceOutcome = {
      ...baseOutcome, resultType: 'not-found', status: null, abnormalFlag: 0,
      queryCount: 0, firstQuery: false, recentScans: [],
      reasons: ['该追溯码未在追溯系统中登记'], generatedReport: null,
    }
    return out
  }

  // 3) 写扫码日志（扫码不改变码状态，仅记录；PRD 5.9 H5 业务规则2）
  // 已登录消费者的扫码归属到本人，支撑个人中心「我的查询记录」；未登录时 consumer_id 为空，不影响任何原有逻辑
  const ip = (String(getHeader(event, 'x-forwarded-for') || getHeader(event, 'x-real-ip') || '').split(',')[0] || '').trim()
  const consumer = await getCurrentConsumer(event).catch(() => null)
  await execute(
    'INSERT INTO scan_log (enterprise_id, code, product_id, scan_time, scan_device, scan_subject, ip_location, consumer_id) VALUES (?,?,?,NOW(),?,1,?,?)',
    [tc.enterprise_id, code, tc.product_id, detectDevice(event), ip || null, consumer?.id ?? null])

  // 4) 查询统计（含本次；重复查询判定 PRD 8类异常-1：≥3次且≥2归属地）
  const [statRow] = await query<any[]>(
    `SELECT COUNT(*) AS c, COUNT(DISTINCT province) AS p, COUNT(DISTINCT city) AS cities
     FROM scan_log WHERE code = ?`, [code])
  const queryCount = Number(statRow?.c || 0)
  const provinceRows = await query<any[]>('SELECT DISTINCT province FROM scan_log WHERE code = ? AND province <> \'\'', [code])
  const provinces = provinceRows.map((r: any) => r.province)
  const firstQuery = queryCount <= 1

  const scans = await recentScans(code)

  // 5) 异常标记优先（PRD 5.5.5：作废不展示产品与批次；冻结展示基础信息）
  if (Number(tc.abnormal_flag) === 2) {
    const out: TraceOutcome = {
      ...baseOutcome, resultType: 'voided', status: Number(tc.status) === 2 ? 'bound' : 'generated',
      abnormalFlag: 2, queryCount, firstQuery, recentScans: scans,
      reasons: [tc.abnormal_reason || '该追溯码已作废，请勿购买'], generatedReport: null,
    }
    return out
  }
  if (Number(tc.abnormal_flag) === 1) {
    const out: TraceOutcome = {
      ...baseOutcome, resultType: 'frozen', status: Number(tc.status) === 2 ? 'bound' : 'generated',
      abnormalFlag: 1, queryCount, firstQuery, recentScans: scans,
      reasons: [tc.abnormal_reason || '该追溯码暂不可用，请联系企业（生产厂家）'], generatedReport: null,
    }
    return out
  }

  // 6) 联查产品（含规格）与批次
  const [prod] = tc.product_id ? await query<any[]>(
    `SELECT p.*, s.spec_name, s.net_content, s.content_unit, s.pack_unit
     FROM product p LEFT JOIN product_spec s ON p.spec_id = s.id WHERE p.id = ? LIMIT 1`, [tc.product_id]) : []
  const [batch] = tc.batch_id ? await query<any[]>('SELECT * FROM batch WHERE id = ? LIMIT 1', [tc.batch_id]) : []
  // 原药（母药）信息多行（product_original 表，复配产品可多条；1049 制剂展示用）
  const originals = tc.product_id ? await query<any[]>(
    'SELECT reg_no, company FROM product_original WHERE product_id = ? ORDER BY id ASC', [tc.product_id]) : []

  // 产品展示字段（PRD 5.9 展示结构）
  const product = prod ? {
    trademark: prod.trademark || '',
    name: prod.name,
    registrationNo: prod.registration_no,
    holderName: prod.holder_name || '',
    formulation: prod.dosage || '',
    toxicity: prod.toxicity || '',
    spec: prod.spec_name || '',
    netContent: prod.net_content !== null && prod.net_content !== undefined ? String(Number(prod.net_content)) + (prod.content_unit || '') + '/' + (prod.pack_unit || '') : '',
    content: prod.content || '',
    category: prod.category || '',
    originals: originals.map((o: any) => ({ regNo: o.reg_no, company: o.company })),
    labelImage: prod.label_image || '',
    manualImage: prod.manual_image || '',
  } : undefined

  // 批次信息展示：单码字段修正只写 trace_code 覆盖列（produce_date/quality_cert_no/expire_date/qc_result），
  // 扫码展示 COALESCE 优先码级值（批次码明细单行修改功能，2026-09-04），未覆盖时回退批次级数据
  const batchInfo = batch ? {
    batchNo: batch.batch_no,
    produceDate: String(tc.produce_date || batch.produce_date || '').slice(0, 10),
    expireDate: String(tc.expire_date || batch.expire_date || '').slice(0, 10),
    qcResult: Number(tc.qc_result ?? batch.qc_result) === 1 ? '合格' : '不合格',
    qualityCertNo: tc.quality_cert_no || batch.quality_cert_no || '',
    qcReportNo: batch.qc_report_no || '',
  } : undefined

  const status: 'bound' | 'generated' = Number(tc.status) === 2 ? 'bound' : 'generated'

  // 7) 登记证已过期（8类异常-4：登记证有效期至 < 今天）
  const today = new Date().toISOString().slice(0, 10)
  if (prod?.registration_expire && String(prod.registration_expire).slice(0, 10) < today) {
    // 触发风险预警（同码同类未处理合并累计）
    await triggerAlert(event, {
      alertType: 4, enterpriseId: tc.enterprise_id, code, codeId: tc.id, productId: tc.product_id,
      evidence: { code, registrationNo: prod.registration_no, expireDate: String(prod.registration_expire).slice(0, 10), scanTime: new Date().toISOString() },
    })
    const out: TraceOutcome = {
      ...baseOutcome, resultType: 'reg-expired', status, abnormalFlag: 0,
      queryCount, firstQuery, product, batch: batchInfo, recentScans: scans,
      reasons: ['登记证 ' + prod.registration_no + ' 已于 ' + String(prod.registration_expire).slice(0, 10) + ' 到期，请勿购买使用'],
      generatedReport: null,
    }
    return out
  }

  // 8) 产品已过有效期（批次有效期至 < 今天）
  if (batch?.expire_date && String(batch.expire_date).slice(0, 10) < today) {
    const out: TraceOutcome = {
      ...baseOutcome, resultType: 'expired', status, abnormalFlag: 0,
      queryCount, firstQuery, product, batch: batchInfo, recentScans: scans,
      reasons: ['该产品已过有效期（' + String(batch.expire_date).slice(0, 10) + '），请勿使用'],
      generatedReport: null,
    }
    return out
  }

  // 9) 重复查询（≥3 次且 ≥2 个省份）
  if (queryCount >= 3 && provinces.length >= 2) {
    // 触发风险预警（8类异常-1）
    await triggerAlert(event, {
      alertType: 1, enterpriseId: tc.enterprise_id, code, codeId: tc.id, productId: tc.product_id,
      evidence: { code, queryCount, provinces, scanTime: new Date().toISOString() },
    })
    const out: TraceOutcome = {
      ...baseOutcome, resultType: 'repeat', status, abnormalFlag: 0,
      queryCount, firstQuery, product, batch: batchInfo, recentScans: scans,
      reasons: ['该追溯码已被查询 ' + queryCount + ' 次，超过 3 次阈值', '查询地域跨 ' + provinces.length + ' 个省份（' + provinces.join('、') + '）'],
      generatedReport: null,
    }
    return out
  }

  // 10) 正常结果（已绑定完整展示 / 已生成提示未绑定）
  const out: TraceOutcome = {
    ...baseOutcome, resultType: 'genuine', status, abnormalFlag: 0,
    queryCount, firstQuery, product, batch: status === 'bound' ? batchInfo : null, recentScans: scans,
    reasons: [], generatedReport: null,
  }
  return out
})