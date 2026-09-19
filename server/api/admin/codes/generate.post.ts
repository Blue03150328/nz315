// POST /api/admin/codes/generate —— 追溯码生成（PRD 5.5.1：离线生成工具 Web 版，不入库，导出后经生产采集导入）
// 生成规则：第 1-11 位取产品/规格主数据（1049 强制结构），第 12 位后自定义段（PRD 3.2：时间戳段/随机段/校验位段）
import { query } from '../../../utils/db'
import { requireWritableUser } from '../../../utils/auth'
import { logOperation } from '../../../utils/audit'
import { generateBatch, segments, type GenerateConfig } from '../../../utils/code-generator'

// 自定义段固定配置（PRD 3.2）：时间戳段=毫秒级、随机数字段=6位随机+2位校验、校验位段=MD5取后2位
// 平台标准锁定：生成接口不接受客户端传入配置，防止客户乱配置导致追溯码结构错乱（引擎逻辑不变）
const FIXED_CONFIG: GenerateConfig = { timestampType: 'ms', randomType: 'rand6c2', checksumType: 'md5' }

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const body = await readBody(event) || {}

  const productId = Number(body.productId)
  // 数量默认 100；显式传 0/负数/非数字一律进入下方区间校验并 400——
  // 原写法 `Number(body.quantity || 100)` 会把 0 当 falsy 吞成 100，传 0 反而生成 100 个码（2026-09-19 修复）
  const quantity = body.quantity === undefined || body.quantity === null || body.quantity === ''
    ? 100
    : Number(body.quantity)
  if (!Number.isInteger(productId) || productId <= 0) throw createError({ statusCode: 400, statusMessage: '请选择产品' })
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
    throw createError({ statusCode: 400, statusMessage: '生成数量须为 1-10000' })
  }

  // 产品 + 规格（码头数据源）
  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  const [prod] = await query<any[]>(
    `SELECT p.id, p.enterprise_id, p.reg_category, p.registration_no, p.produce_type, p.name, p.spec_id, s.spec_code, s.spec_name
     FROM product p LEFT JOIN product_spec s ON p.spec_id = s.id
     WHERE p.id = ? AND p.status = 1` + (fid ? ' AND p.enterprise_id = ?' : ''),
    fid ? [productId, fid] : [productId])
  if (!prod || !prod.spec_code) throw createError({ statusCode: 400, statusMessage: '产品不存在或未配置规格' })

  // 自定义段配置：固定参数（毫秒时间戳 + 6位随机+2位校验 + MD5校验位），仅展示不可改
  const cfg: GenerateConfig = FIXED_CONFIG

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
    content: JSON.stringify({ productId, quantity, generated: result.codes.length, duplicates: result.duplicates, cfg }),
  })

  return {
    ok: true,
    product: {
      id: prod.id,
      enterpriseId: prod.enterprise_id,
      name: prod.name,
      registrationNo: prod.registration_no,
      specCode: prod.spec_code,
      specName: prod.spec_name,
    },
    quantity: result.codes.length,
    duplicates: result.duplicates,
    elapsedMs: result.elapsedMs,
    cfg,
    preview: result.codes.slice(0, 10).map(code => ({ code, segments: segments(code) })),
    allCodes: result.codes, // 导出用（数量上限 1 万，JSON 可承载）
  }
})
