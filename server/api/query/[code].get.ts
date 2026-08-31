// 演示版扫码查询接口：按追溯码规则分发 4 种结果页，支撑前端界面开发
// 后端需求确认后将替换为真实查询逻辑（数据库查询 + 判定规则）
import type { QueryOutcome, ICompareItem, ICompareResult } from '#shared/types/compare'

// 32 位数字校验（农业农村部第 1049 号公告单元识别代码）
const CODE_RE = /^\d{32}$/

// 演示产品库（字段对齐参考项目 qrcodes 表：名称/剂型/规格/登记证号/厂家/生产日期等）
const DEMO_PRODUCTS: Record<string, any> = {
  // 正品演示：25% 多·酮可湿性粉剂
  'PD20040767': {
    name: '25%多·酮可湿性粉剂',
    content: '',
    formulation: '可湿性粉剂',
    spec: '100g/袋',
    productionLicenseNo: '农药生许(鲁)0060',
    manufacturer: '山东某生物科技有限公司',
    productionDate: '2026-08-20',
    batchNo: '20260801',
    expiryDate: '2028-08-19',
    registrationNo: 'PD20040767',
  },
  // 过期登记证演示：40% 毒死蜱乳油（登记证已过期）
  'PD20080666': {
    name: '40%毒死蜱乳油',
    content: '',
    formulation: '乳油',
    spec: '500ml/瓶',
    productionLicenseNo: '农药生许(鲁)0123',
    manufacturer: '山东某农化有限公司',
    productionDate: '2025-05-10',
    batchNo: '20250501',
    expiryDate: '2026-05-09',
    registrationNo: 'PD20080666',
  },
  // 异常演示：30% 草甘膦水剂（被重复查询）
  'PD20101234': {
    name: '30%草甘膦水剂',
    content: '',
    formulation: '水剂',
    spec: '1L/瓶',
    productionLicenseNo: '农药生许(冀)0456',
    manufacturer: '河北某化工股份有限公司',
    productionDate: '2026-06-15',
    batchNo: '20260601',
    expiryDate: '2028-06-14',
    registrationNo: 'PD20101234',
  },
}

function formatCode(code: string): string {
  // 每 8 位空格分隔，便于阅读
  return code.replace(/(\d{8})(?=\d)/g, '$1 ')
}

function buildCompare(product: any, fails: string[] = []): ICompareResult {
  const items: ICompareItem[] = [
    { key: 'existence', label: '登记证存在性', result: 'pass', description: '登记证号在农业农村部登记证数据库中是否存在', scannedValue: product.registrationNo, dbValue: product.registrationNo },
    { key: 'validity', label: '登记证有效期', result: fails.includes('validity') ? 'fail' : 'pass', description: '登记证是否在有效期内', scannedValue: '有效期内', dbValue: '有效期内' },
    { key: 'name', label: '产品名称', result: 'pass', description: '扫码产品名称与登记证是否一致', scannedValue: product.name, dbValue: product.name },
    { key: 'formulation', label: '剂型', result: 'pass', description: '剂型是否一致', scannedValue: product.formulation, dbValue: product.formulation },
    { key: 'content', label: '含量', result: 'pass', description: '有效成分含量是否一致', scannedValue: product.name.split('%')[0] + '%', dbValue: product.name.split('%')[0] + '%' },
    { key: 'manufacturer', label: '生产企业', result: 'pass', description: '生产企业是否一致', scannedValue: product.manufacturer, dbValue: product.manufacturer },
    { key: 'category', label: '农药类别', result: 'pass', description: '农药类别是否一致', scannedValue: '杀菌剂', dbValue: '杀菌剂' },
  ]
  const passCount = items.filter(i => i.result === 'pass').length
  return { riskLevel: fails.length ? 'danger' : 'safe', found: true, registration: { validStart: '2021-08-24', validEnd: '2026-08-23' }, items, passCount, totalCount: items.length }
}

export default defineEventHandler((event) => {
  const code = String(getRouterParam(event, 'code') || '')
  const formatValid = CODE_RE.test(code)

  // 非 32 位数字：查无此码（格式不符）
  if (!formatValid) {
    const outcome: QueryOutcome = {
      resultType: 'not-found',
      traceCode: code,
      formattedCode: code,
      formatValid: false,
      found: false,
      queryCount: 0,
      firstQuery: false,
      reasons: ['追溯码格式不符合 32 位阿拉伯数字规则'],
      generatedReport: null,
    }
    return outcome
  }

  // 演示分发规则（真实逻辑待后端需求）：
  // 结尾 0001 → 查无此码；结尾 0002 → 登记证过期；结尾 0003 → 重复查询异常；其余 → 正品
  const suffix = code.slice(-4)

  if (suffix === '0001') {
    const outcome: QueryOutcome = {
      resultType: 'not-found',
      traceCode: code,
      formattedCode: formatCode(code),
      formatValid: true,
      found: false,
      queryCount: 0,
      firstQuery: false,
      reasons: ['该追溯码未在追溯系统中登记'],
      generatedReport: null,
    }
    return outcome
  }

  if (suffix === '0002') {
    const product = DEMO_PRODUCTS['PD20080666']
    const compare = buildCompare(product, ['validity'])
    compare.registration = { validStart: '2016-08-24', validEnd: '2021-08-23' }
    const outcome: QueryOutcome = {
      resultType: 'expired',
      traceCode: code,
      formattedCode: formatCode(code),
      formatValid: true,
      found: true,
      queryCount: 1,
      firstQuery: true,
      product,
      compare,
      expiredText: '过期',
      reasons: ['登记证 PD20080666 已于 2021-08-23 到期'],
      generatedReport: null,
    }
    return outcome
  }

  if (suffix === '0003') {
    const product = DEMO_PRODUCTS['PD20101234']
    const outcome: QueryOutcome = {
      resultType: 'abnormal',
      traceCode: code,
      formattedCode: formatCode(code),
      formatValid: true,
      found: true,
      queryCount: 12,
      firstQuery: false,
      product,
      compare: buildCompare(product),
      provinces: ['山东', '河南'],
      reasons: ['该追溯码累计被查询 12 次，超过 5 次阈值', '3 天内跨 2 个省份查询'],
      generatedReport: null,
    }
    return outcome
  }

  // 正品
  const product = DEMO_PRODUCTS['PD20040767']
  const outcome: QueryOutcome = {
    resultType: 'genuine',
    traceCode: code,
    formattedCode: formatCode(code),
    formatValid: true,
    found: true,
    queryCount: 1,
    firstQuery: true,
    product,
    compare: buildCompare(product),
    reasons: [],
    generatedReport: null,
  }
  return outcome
})
