// POST /api/admin/codes/generate —— 追溯码生成（PRD 5.5.1：离线生成工具 Web 版，不入库，导出后经生产采集导入）
// 生成规则：第 1-11 位取产品/规格主数据（1049 强制结构），第 12 位后自定义段（时间戳/随机/校验位）
import { query } from '../../../utils/db'
import { requireBackendUser } from '../../../utils/auth'
import { logOperation } from '../../../utils/audit'
import { generateBatch, segments, DEFAULT_CONFIG, type GenerateConfig } from '../../../utils/code-generator'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const body = await readBody(event) || {}

  const productId = Number(body.productId)
  const quantity = Number(body.quantity || 100)
  if (!Number.isInteger(productId) || productId <= 0) throw createError({ statusCode: 400, statusMessage: '请选择产品' })
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
    throw createError({ statusCode: 400, statusMessage: '生成数量须为 1-10000' })
  }

  // 产品 + 规格（码头数据源）
  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  const [prod] = await query<any[]>(
    `SELECT p.id, p.reg_category, p.registration_no, p.produce_type, p.spec_id, s.spec_code, s.spec_name
     FROM product p LEFT JOIN product_spec s ON p.spec_id = s.id
     WHERE p.id = ? AND p.status = 1` + (fid ? ' AND p.enterprise_id = ?' : ''),
    fid ? [productId, fid] : [productId])
  if (!prod || !prod.spec_code) throw createError({ statusCode: 400, statusMessage: '产品不存在或未配置规格' })

  // 自定义段配置（PRD 3.2）
  const cfg: GenerateConfig = {
    timestampType: ['none', 'ymd', 'sec', 'ms'].includes(body.timestampType) ? body.timestampType : DEFAULT_CONFIG.timestampType,
    checksum: body.checksum === false ? false : true,
  }

  // 系统内已存在码（重码检测）
  const [existCond, existParams] = fid
    ? [' WHERE enterprise_id = ?', [fid]]
    : ['', []]
  const codeRows = await query<any[]>('SELECT code FROM trace_code' + existCond, existParams)
  const existingSet = new Set(codeRows.map((r: any) => String(r.code)))

  // 批量生成
  const ctx = {
    regCategory: Number(prod.reg_category || 1),
    regLast6: String(prod.registration_no).slice(-6),
    produceType: Number(prod.produce_type || 1),
    specCode: String(prod.spec_code),
    existingSet,
  }
  const result = generateBatch(ctx, quantity, cfg)

  // 审计日志
  await logOperation(event, {
    module: '码库管理',
    action: '追溯码生成',
    content: JSON.stringify({ productId, quantity, generated: result.codes.length, duplicates: result.duplicates, timestampType: cfg.timestampType, checksum: cfg.checksum }),
  })

  return {
    ok: true,
    product: { id: prod.id, name: prod.name, registrationNo: prod.registration_no, specCode: prod.spec_code, specName: prod.spec_name },
    quantity: result.codes.length,
    duplicates: result.duplicates,
    timestampType: cfg.timestampType,
    checksum: cfg.checksum,
    preview: result.codes.slice(0, 10).map(code => ({ code, segments: segments(code) })),
    allCodes: result.codes, // 导出用（数量上限 1 万，JSON 可承载）
  }
})