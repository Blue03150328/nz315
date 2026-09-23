// POST /api/bill —— 新建一条农资记账（扫码记账 / 手动记账）
//
// 🔴 服务器"当天"走 **库里的 `CURDATE()`**，不用 JS 的 `toISOString()`：
//    `toISOString()` 是 UTC，北京时间凌晨 00:00–08:00 之间会算成**前一天**，
//    于是「记今天的账」会被日期校验判成未来日期而 400（真实会踩的坑）。
//    走 CURDATE() 还与表里 `created_at DEFAULT CURRENT_TIMESTAMP` 完全同一口径。
import { requireConsumer } from '~~/server/utils/consumer-auth'
import { query, execute } from '~~/server/utils/db'
import { allowRequest } from '~~/server/utils/rate-limit'
import { parseBillBody } from '~~/server/utils/bill-input'

/** 写入限流：60 次/分钟。正常记账远达不到；防的是脚本刷库 */
const WRITE_LIMIT = 60
const WRITE_WINDOW_MS = 60 * 1000

export default defineEventHandler(async (event) => {
  const consumer = await requireConsumer(event)
  const body = (await readBody(event)) || {}

  const [d] = await query<any[]>('SELECT CURDATE() AS today')
  const today = String(d?.today || '').slice(0, 10)

  // 校验在前（失败不消耗限流配额，见下方说明）
  const input = parseBillBody(body, today, false)

  // 🔴 限流刻意放在**入参校验之后**（与 `feedback.post.ts` 同口径）：
  //    校验失败的请求无任何副作用（不落库、无外部调用），不该扣用户的机会；
  //    真需要保护的是下面这条写库路径。
  if (!allowRequest('bill:write:' + consumer.id, WRITE_LIMIT, WRITE_WINDOW_MS)) {
    throw createError({ statusCode: 429, statusMessage: '记账过于频繁，请稍后再试' })
  }

  const r = await execute(
    `INSERT INTO farm_bill
       (consumer_id, bill_date, product_name, category, crop, quantity, unit, unit_price,
        total_amount, channel, remark, code, source)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      consumer.id,
      input.billDate,
      input.productName,
      input.category ?? '其他', // 恒为 6 类之一，库里不存 NULL（见 bill-input.ts 口径 1）
      input.crop ?? null,
      input.quantity ?? null,
      input.unit ?? null,
      input.unitPrice ?? null,
      input.totalAmount ?? 0,
      input.channel ?? null,
      input.remark ?? null,
      input.code ?? null,
      input.source === 1 ? 1 : 2,
    ],
  )

  return { ok: true, id: Number(r.insertId) }
})
