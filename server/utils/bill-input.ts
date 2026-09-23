// 记账入参解析（POST 新建 / PATCH 编辑共用，2026-09-23 新增，见 docs/handover/29 号）
//
// 为什么要抽出来：新建与编辑的字段完全相同，只有"必填 vs 可选"的差别。
// 各写一套必然漂移 —— 典型症状：新建时拦住了未来日期、编辑时放过去了，
// 或者新建时归一化类别、编辑时忘了归一化，导致库里同时存在「杀虫」和「杀虫剂」。
//
// 🔴 三条口径（与 29 号文档一致，改这里必须同步改文档）：
//   1. **category 落库恒为 6 类白名单之一**（空 → `其他`）—— 库里不存 NULL。
//      理由：饼图要固定分区，且「用药 + 用肥 = 总花费」的恒等式要求每行都有明确的类别归属。
//      （用户"类别可空"的诉求由前端「不选」→ 落 `其他` 满足，用户无需感知。）
//   2. **totalAmount 优先采信前端**：用户明确要求可以「调整总金额」⇒ 允许总额 ≠ 数量×单价
//      （抹零、折扣、只记得总价都属正常）。仅在总额缺失时才用「数量×单价」兜底推算。
//   3. **code 非 32 位数字时静默存 null**，不 400 —— 扫码来源只是附注，
//      不该因为一个脏码把整条账单打回（用户白填一次的成本远高于丢掉一个来源标记）。
import { BILL_LIMITS, normalizeBillCategory, isValidBillDate } from '#shared/utils/bill-category'
import { isTraceCode } from '#shared/utils/trace-code'

const bad = (msg: string) => {
  throw createError({ statusCode: 400, statusMessage: msg })
}

/** 金额/数量取数：空值 → null；非数字 → 抛错（不静默当 0，避免"填错了却存成 0"） */
function numOf(v: unknown, label: string, max: number, allowNull = true): number | null {
  if (v === null || v === undefined || v === '') return allowNull ? null : bad(label + '不能为空')
  const n = Number(v)
  if (!Number.isFinite(n)) bad(label + '必须是数字')
  if (n < 0) bad(label + '不能为负数')
  if (n > max) bad(label + '超出上限')
  // 数量按 3 位小数、金额按 2 位小数截断，避免超出 DECIMAL 精度后被 MySQL 静默四舍五入
  return Math.round(n * 1000) / 1000
}

/** 文本取数：trim + 长度校验 + 空串归 null */
function textOf(v: unknown, label: string, max: number): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  if (s.length > max) bad(label + '最长 ' + max + ' 个字符')
  return s
}

export interface BillInput {
  billDate?: string
  productName?: string
  category?: string
  crop?: string | null
  quantity?: number | null
  unit?: string | null
  unitPrice?: number | null
  totalAmount?: number
  channel?: string | null
  remark?: string | null
  code?: string | null
  source?: number
}

/**
 * 解析记账入参。
 * @param partial `true` = PATCH 语义：只处理 body 里**实际出现过**的字段（未出现的不动）；
 *                `false` = POST 语义：`productName` / `billDate` 必填。
 * @param today   当天日期（`YYYY-MM-DD`，由调用方传入，保证同一次请求内口径一致）
 */
export function parseBillBody(body: any, todayRaw: string, partial = false): BillInput {
  // 🔴 兜底：`today` 非法（例如空串）会让**所有**日期校验都判成"未来日期" ⇒ 记账全量 400。
  //    这类故障最难排查（页面只说"日期不合法"，完全看不出根因），故这里统一收口兜底。
  //    正常路径由调用方传库里的 CURDATE()，只有它异常时才退回进程本地日期。
  const today = /^\d{4}-\d{2}-\d{2}$/.test(todayRaw) ? todayRaw : localToday()
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body || {}, k)
  /** 该字段是否需要处理：POST 全处理；PATCH 只处理出现过的 */
  const want = (k: string) => !partial || has(k)
  const out: BillInput = {}

  // ---- 记账日期（分组依据，必填） ----
  if (want('billDate')) {
    const s = String(body.billDate ?? '').trim()
    if (!s) bad('请选择记账日期')
    if (!isValidBillDate(s, today)) bad('记账日期不合法（不支持未来日期）')
    out.billDate = s
  }

  // ---- 产品名称（必填） ----
  if (want('productName')) {
    const s = textOf(body.productName, '产品名称', BILL_LIMITS.productNameMax)
    if (!s) bad('请填写产品名称')
    out.productName = s
  }

  // ---- 类别：一律归一化到 6 类白名单（空 → 其他） ----
  if (want('category')) {
    out.category = normalizeBillCategory(body.category)
  }

  // ---- 作物 / 渠道 / 单位 / 备注：自由输入，可为空 ----
  if (want('crop')) out.crop = textOf(body.crop, '作物', BILL_LIMITS.cropMax)
  if (want('channel')) out.channel = textOf(body.channel, '渠道', BILL_LIMITS.channelMax)
  if (want('unit')) out.unit = textOf(body.unit, '单位', BILL_LIMITS.unitMax)
  if (want('remark')) out.remark = textOf(body.remark, '备注', BILL_LIMITS.remarkMax)

  // ---- 数量 / 单价（可跳过，允许全空） ----
  if (want('quantity')) out.quantity = numOf(body.quantity, '数量', BILL_LIMITS.quantityMax)
  if (want('unitPrice')) out.unitPrice = numOf(body.unitPrice, '单价', BILL_LIMITS.amountMax)

  // ---- 总额：优先采信前端（允许用户手工调整），缺失时才兜底推算 ----
  if (want('totalAmount')) {
    const provided = numOf(body.totalAmount, '总额', BILL_LIMITS.amountMax)
    const q = out.quantity !== undefined ? out.quantity : numOf(body.quantity, '数量', BILL_LIMITS.quantityMax)
    const p = out.unitPrice !== undefined ? out.unitPrice : numOf(body.unitPrice, '单价', BILL_LIMITS.amountMax)
    if (provided !== null) {
      out.totalAmount = Math.round(provided * 100) / 100
    } else if (q !== null && p !== null) {
      out.totalAmount = Math.round(q * p * 100) / 100
    } else {
      out.totalAmount = 0
    }
  }

  // ---- 来源追溯码：非 32 位数字则丢弃（不阻断整条账单） ----
  if (want('code')) {
    const s = String(body.code ?? '').trim()
    out.code = isTraceCode(s) ? s : null
  }

  // ---- 来源：1 扫码 2 手动（白名单；带码时默认扫码） ----
  if (want('source')) {
    const n = Number(body.source)
    out.source = n === 1 ? 1 : n === 2 ? 2 : (out.code ? 1 : 2)
  } else if (!partial && out.code) {
    out.source = 1
  }

  return out
}
