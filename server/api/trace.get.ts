// 扫码查询接口（H5）：/trace?code=xxx
// 当前为演示数据（模拟 8 种场景），后端需求落地后替换为数据库查询
import type { TraceOutcome } from '#shared/types/trace'

const CODE_RE = /^\d{32}$/

// 演示产品（字段对齐 PRD 7.3 product 表）
const DEMO_PRODUCT = {
  trademark: '绿丰',
  name: '25%多·酮可湿性粉剂',
  registrationNo: 'PD20040767',
  holderName: '山东绿丰生物科技有限公司',
  formulation: '可湿性粉剂',
  toxicity: '低毒',
  spec: '200ml/瓶',
  netContent: '200ml',
  content: '25%',
  category: '杀菌剂',
  originalRegNo: 'PD20080708',
  originalCompany: '江苏原药化工有限公司',
  labelImage: '',
  manualImage: '',
}

// 演示批次（PRD 7.4 batch 表字段）
const DEMO_BATCH = {
  batchNo: '2026080101',
  produceDate: '2026-08-20',
  expireDate: '2028-08-19',
  qcResult: '合格',
  qualityCertNo: '质检(鲁)2026-081001',
  qcReportNo: 'BG-2026-081001',
}

function fmt(code: string) {
  return code.replace(/(\d{8})(?=\d)/g, '$1 ')
}

export default defineEventHandler((event) => {
  const code = String(getQuery(event).code || '')
  const formatValid = CODE_RE.test(code)

  if (!formatValid) {
    const out: TraceOutcome = {
      resultType: 'not-found', code, formattedCode: code, formatValid: false,
      status: null, abnormalFlag: 0, queryCount: 0, firstQuery: false,
      recentScans: [], reasons: ['追溯码格式不符合 32 位阿拉伯数字规则'], generatedReport: null,
    }
    return out
  }

  const suffix = code.slice(-4)
  const baseOutcome = { code, formattedCode: fmt(code), formatValid: true, product: DEMO_PRODUCT }

  // 0001 查无此码
  if (suffix === '0001') {
    return { ...baseOutcome, resultType: 'not-found', status: null, abnormalFlag: 0, queryCount: 0, firstQuery: false, recentScans: [], reasons: ['该追溯码未在追溯系统中登记'], generatedReport: null }
  }
  // 0002 登记证已过期（8类异常第4类）
  if (suffix === '0002') {
    return { ...baseOutcome, resultType: 'reg-expired', status: 'bound', abnormalFlag: 0, queryCount: 1, firstQuery: true, batch: { ...DEMO_BATCH, produceDate: '2026-05-01' }, recentScans: [{ time: '2026-08-28 10:23:41', province: '山东', city: '济南' }], reasons: ['登记证 PD20040767 已于 2026-08-23 到期'], generatedReport: null }
  }
  // 0003 重复查询（≥3次且≥2归属地）
  if (suffix === '0003') {
    return { ...baseOutcome, resultType: 'repeat', status: 'bound', abnormalFlag: 0, queryCount: 7, firstQuery: false, batch: DEMO_BATCH, recentScans: [
      { time: '2026-08-29 09:12:05', province: '山东', city: '济南' },
      { time: '2026-08-28 21:47:33', province: '河南', city: '郑州' },
      { time: '2026-08-27 08:30:12', province: '山东', city: '临沂' },
      { time: '2026-08-26 19:15:48', province: '河北', city: '石家庄' },
      { time: '2026-08-25 11:02:27', province: '山东', city: '济南' },
    ], reasons: ['该追溯码已被查询 7 次，超过 3 次阈值', '查询地域跨 3 个省份'], generatedReport: null }
  }
  // 0004 已冻结（异常标记）
  if (suffix === '0004') {
    return { ...baseOutcome, resultType: 'frozen', status: 'bound', abnormalFlag: 1, queryCount: 1, firstQuery: true, batch: DEMO_BATCH, recentScans: [{ time: '2026-08-20 10:00:00', province: '山东', city: '潍坊' }], reasons: ['该码已被企业冻结，暂不可用'], generatedReport: null }
  }
  // 0005 已作废（异常标记）
  if (suffix === '0005') {
    return { ...baseOutcome, resultType: 'voided', status: 'generated', abnormalFlag: 2, queryCount: 2, firstQuery: false, recentScans: [], reasons: ['该追溯码已作废，请勿购买'], generatedReport: null }
  }
  // 0006 产品已过有效期
  if (suffix === '0006') {
    return { ...baseOutcome, resultType: 'expired', status: 'bound', abnormalFlag: 0, queryCount: 1, firstQuery: true, batch: { ...DEMO_BATCH, produceDate: '2023-06-15', expireDate: '2025-06-14' }, recentScans: [{ time: '2026-07-18 14:20:09', province: '山东', city: '青岛' }], reasons: ['该产品已过有效期，请勿使用'], generatedReport: null }
  }
  // 0007 扫码信息与标签不符（信息反馈入口）
  if (suffix === '0007') {
    return { ...baseOutcome, resultType: 'mismatch', status: 'bound', abnormalFlag: 0, queryCount: 1, firstQuery: true, batch: DEMO_BATCH, recentScans: [{ time: '2026-08-27 16:44:30', province: '山东', city: '烟台' }], reasons: ['扫码信息与包装标签标注可能存在不一致，可提交反馈'], generatedReport: null }
  }
  // 1001 正品·已绑定（完整展示）
  if (suffix === '1001') {
    return { ...baseOutcome, resultType: 'genuine', status: 'bound', abnormalFlag: 0, queryCount: 1, firstQuery: true, batch: DEMO_BATCH, recentScans: [{ time: '2026-08-29 08:02:15', province: '山东', city: '济南' }], reasons: [], generatedReport: null }
  }
  // 1002 正品·已生成（未绑定批次，展示缺项提示）
  return { ...baseOutcome, resultType: 'genuine', status: 'generated', abnormalFlag: 0, queryCount: 2, firstQuery: false, batch: null, recentScans: [{ time: '2026-08-29 07:55:00', province: '山东', city: '济南' }, { time: '2026-08-28 18:30:22', province: '山东', city: '济南' }], reasons: [], generatedReport: null }
})
