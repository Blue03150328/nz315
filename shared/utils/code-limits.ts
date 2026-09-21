// 追溯码数量上限「集中定义」（2026-09-21 上限由 1 万 → 50 万）
//
// 为什么要有这个文件：上限原先散落在 8 处各写各的数字——
//   生成链路 5 处：引擎守卫（code-generator.ts）+ 生成接口（generate.post.ts）+ 生成页 3 处（提交校验/输入框 max/提示文案）
//   写入通道 3 处：入库留档（stock-in）+ 生产采集导入（import）+ 解析（parse），各写「单次最多 10 万条码」
// 同一口径抄 8 遍，改一处必漏一处（典型症状：前端放开、后端 400，或生成 50 万后无法一次入库留档）。
// 现统一到本文件，服务端与前端均通过 `#shared/utils/code-limits` 引用，改上限只动这里。
//
// 边界依据（2026-09-21 本机实测，1 万 / 10 万 / 50 万三档）：
//   引擎耗时 38ms / 309ms / 1518ms —— 引擎不是瓶颈
//   响应 allCodes 0.33MB / 3.34MB / 16.69MB（JSON）—— 50 万约 16.7MB，弱网需注意 nginx proxy_read_timeout
//   前端导出 urls.txt 约 31MB、CSV 约 80MB、堆内存增量约 +59MB —— 低配机有卡顿风险，故大数量需二次确认
//   服务端内存：一次大数量生成要同时持有「码数组 + 去重 Set（SELECT code FROM trace_code 全表拉库内码）+ 约 17MB JSON 响应」，
//     瞬时数百 MB，且反复跑之后回收不干净 —— 2026-09-21 本机 dev 反复生成后撞 4.1GB 堆上限 OOM 崩溃（exit 134）。
//     线上 PM2 max_memory_restart 仅 800M，**线上验收只跑 5 万条，别跑满 50 万**（详见 19 号执行单 §6.3）
//   MySQL 占位符上限 65535，分块 CHUNK=5000 × 11 列 = 55000 已近顶 —— 分块大小只能减不能加

/** 单次生成追溯码上限（POST /api/admin/codes/generate），50 万条 */
export const MAX_CODES_PER_BATCH = 500000

/** 单次写入 trace_code 的条数上限（入库留档 / 生产采集导入 / 解析页共用口径）。
 *  必须与生成上限同档，否则「生成 50 万」之后无法一次入库留档或导入。 */
export const MAX_CODES_PER_WRITE = 500000

/** 前端「大数量二次确认」阈值：超过此条数时先弹确认框（提示体积与耗时），防误操作、防低配机卡死 */
export const LARGE_BATCH_CONFIRM_THRESHOLD = 200000

/** 上限的中文展示（提示文案统一由此派生，避免各页面手写数字再次漂移） */
export const MAX_CODES_PER_BATCH_TEXT = '50 万'
export const MAX_CODES_PER_WRITE_TEXT = '50 万'

/** 生成数量区间校验错误文案（引擎与接口共用，保证 400 与前端提示一字不差） */
export const GENERATE_QUANTITY_ERROR = `生成数量须为 1-${MAX_CODES_PER_BATCH_TEXT}`

/** 生成页输入框下方提示文案 */
export const GENERATE_QUANTITY_RANGE_TEXT = `1-${MAX_CODES_PER_BATCH_TEXT}条/次`

/** 写入通道（入库留档 / 生产采集导入 / 解析）超限错误文案 */
export const WRITE_QUANTITY_ERROR = `单次最多 ${MAX_CODES_PER_WRITE_TEXT}条码`

/** 粗略估算导出文件体积（MB）：按实测基准折算，txt≈33B/条、urls.txt≈62B/条、CSV≈160B/条。
 *  仅用于大数量二次确认时给用户一个体积预期，非精确值。 */
export function estimateCodesSizeMb(quantity: number, kind: 'txt' | 'urls' | 'csv'): number {
  const bytesPerCode = kind === 'txt' ? 33 : kind === 'urls' ? 62 : 160
  return Math.round(((quantity * bytesPerCode) / 1048576) * 10) / 10
}

/** 粗略估算服务端生成耗时（毫秒）：按实测约 3.2 微秒/条（含库内重码检测）折算。
 *  仅用于大数量二次确认时给用户一个耗时预期，实际取决于库内码量与机器性能。 */
export function estimateGenerateMs(quantity: number): number {
  return Math.round(quantity * 3.2 / 1000)
}
