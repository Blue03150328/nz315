// 农资记账「类别」口径集中定义（2026-09-23 新增，见 docs/handover/29 号）
//
// 为什么要有这个文件：
//   类别要同时被三方使用 —— ① 扫码结果页按产品原始类别**自动预填**；② 记账表单下拉选项；
//   ③ 服务端白名单校验。同一份映射逻辑抄三遍，改一处必漏一处
//   （典型症状：前端预填出「杀虫剂」，服务端白名单只认「杀虫」⇒ 存进去的类别五花八门，
//   成本分析的饼图会裂成「杀虫剂 / 杀虫 / 杀虫水剂」三块）。
//   故统一到本文件，服务端与前端均通过 `#shared/utils/bill-category` 引用。
//
// 数据来源差异（这是映射存在的理由）：
//   - `pesticide_reg.category` / `product.category` 存的是**登记资料库原文**：杀虫剂 / 杀菌剂 / 除草剂 / 杀螨剂 / 肥料…
//   - 记账的统计口径只有 6 类：杀虫 / 杀菌 / 除草 / 杀螨 / 肥料 / 其他
//   ⇒ 必须归一化，否则统计维度永远对不齐。

/** 记账类别白名单（统计饼图的固定分区，顺序即展示顺序） */
export const BILL_CATEGORIES = ['杀虫', '杀菌', '除草', '杀螨', '肥料', '其他'] as const

export type BillCategory = (typeof BILL_CATEGORIES)[number]

/** 归一化映射表：正则 → 目标类别（**顺序敏感**，「杀螨」必须排在「杀虫」之前——
 *  两者都以「杀」开头，若先匹配「杀虫」的宽松规则会误吞。
 *  当前用精确词根匹配，顺序无实际影响，但保持此约定以防将来放宽正则） */
const RULES: { re: RegExp; to: BillCategory }[] = [
  { re: /杀螨/, to: '杀螨' },
  { re: /杀虫/, to: '杀虫' },
  { re: /杀菌|杀真菌|抗菌/, to: '杀菌' },
  { re: /除草/, to: '除草' },
  { re: /肥/, to: '肥料' },
]

/** 归一化类别：登记库原文/自由文本 → 6 类白名单之一。
 *  **不匹配时返回 `其他`**（不返回 null）——用户手输的内容不该被拒，
 *  但也不能任其污染统计维度；`其他` 在 `BILL_CATEGORIES` 里是合法分区。 */
export function normalizeBillCategory(raw: unknown): BillCategory {
  const s = String(raw ?? '').trim()
  if (!s) return '其他'
  // 已经是白名单值：原样返回（幂等）
  if ((BILL_CATEGORIES as readonly string[]).includes(s)) return s as BillCategory
  for (const r of RULES) {
    if (r.re.test(s)) return r.to
  }
  return '其他'
}

/** 「用肥花费」的口径（**不用函数表达，直接落在 SQL 里**，见 `server/api/bill.get.ts` 与
 *  `server/api/bill/analysis.get.ts` 的 `SUM(CASE WHEN category = '肥料' …)`）：
 *  仅「肥料」类算用肥，**其余全部算用药**（含「其他」与类别为空）
 *  ⇒ 保证「用药 + 用肥 === 总花费」恒成立（成本统计卡片的硬约束，被 29 号 §1.2 写死）。
 *  ⚠️ 刻意**不提供** `isFertilizer()` 这类 JS 判定函数 —— 它会在服务端聚合口径（SQL）之外
 *  长出第二个真值来源，两边一漂就是统计对不上账。 */

/** 数量单位快捷选项（用户裁定单位可自由输入，这里只提供常用项做「一键填入」，不是白名单） */
export const BILL_UNITS = ['瓶', '袋', '包', '桶', '千克', '升', '亩'] as const

/** 记账业务边界（**集中定义**，服务端校验与前端 maxlength/提示共用，避免两端口径漂移） */
export const BILL_LIMITS = {
  /** 单次金额上限（DECIMAL(12,2) 的安全档，留足余量） */
  amountMax: 999999999.99,
  /** 数量上限（DECIMAL(12,3)） */
  quantityMax: 999999999.999,
  productNameMax: 255,
  cropMax: 50,
  channelMax: 50,
  unitMax: 10,
  remarkMax: 500,
  /** 单年取数上限：账单是私人数据、量级小（农户一年几十到几百条），
   *  2000 条足够覆盖；超出返回 truncated=true 让前端提示，而不是把响应撑爆 */
  yearRowLimit: 2000,
  /** 记账日期下界（早于此值视为误填） */
  dateMin: '2000-01-01',
} as const

/** 记账日期校验：必须 YYYY-MM-DD，且在 [dateMin, 今天] 区间内（**不允许未来日期** —— 记账记的是已发生的支出）。
 *  @param today 由调用方传入当天（服务端用服务器日期，保证同一次请求内口径一致） */
export function isValidBillDate(s: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  // 字符串比较即可（同格式定长日期，字典序 = 时间序），无需 Date 解析避免时区坑
  return s >= BILL_LIMITS.dateMin && s <= today
}

/** 进程本地日期（`YYYY-MM-DD`）。
 *  ⚠️ **只作兜底用**：正常路径一律取库里的 `CURDATE()`（与 `created_at` 的 CURRENT_TIMESTAMP 同口径）。
 *  存在的理由：若 `CURDATE()` 因任何原因返回空串，`isValidBillDate` 会拿 `today=''` 把所有请求判成
 *  「未来日期」⇒ **记账全量 400**，而这类故障最难排查（页面只会说"日期不合法"，看不出根因）。
 *  注意不要改用 `toISOString()`：那是 UTC，北京时间凌晨会算成前一天。 */
export function localToday(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}
