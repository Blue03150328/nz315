// PATCH /api/bill/:id —— 编辑一条记账（只改请求里实际出现的字段）
//
// 🔴 归属校验是本接口的**唯一安全要点**：SQL 必须是 `WHERE id = ? AND consumer_id = ?`。
//    只按 id 更新就是**水平越权** —— 任何人拿到别人的账单 id 就能改别人的数据，
//    而账单 id 是自增的，猜起来毫无难度。（本项目有 P0 提权前科，提交 1db9535，别重蹈。）
//    命中不到行时统一返回 404（不区分"不存在"与"不是你的"，避免泄露 id 是否存在）。
import { requireConsumer } from '~~/server/utils/consumer-auth'
import { query, execute } from '~~/server/utils/db'
import { parseBillBody } from '~~/server/utils/bill-input'

/** 入参字段 → 表列名（**顺序即 SQL 拼接顺序**，保证可复核） */
const FIELD_MAP: Record<string, string> = {
  billDate: 'bill_date',
  productName: 'product_name',
  dosage: 'dosage',
  category: 'category',
  crop: 'crop',
  quantity: 'quantity',
  unit: 'unit',
  unitPrice: 'unit_price',
  totalAmount: 'total_amount',
  channel: 'channel',
  remark: 'remark',
  code: 'code',
  source: 'source',
}

export default defineEventHandler(async (event) => {
  const consumer = await requireConsumer(event)

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: '账单ID不合法' })
  }

  const body = (await readBody(event)) || {}
  const [d] = await query<any[]>('SELECT CURDATE() AS today')
  const today = String(d?.today || '').slice(0, 10)

  // partial=true：只处理 body 里出现过的字段
  const input = parseBillBody(body, today, true) as Record<string, any>

  const sets: string[] = []
  const params: any[] = []
  for (const [field, col] of Object.entries(FIELD_MAP)) {
    if (field in input) {
      sets.push(col + ' = ?')
      params.push(input[field] ?? null)
    }
  }
  if (sets.length === 0) {
    throw createError({ statusCode: 400, statusMessage: '没有需要更新的字段' })
  }

  params.push(id, consumer.id)
  const r = await execute(
    'UPDATE farm_bill SET ' + sets.join(', ') + ' WHERE id = ? AND consumer_id = ?',
    params,
  )
  if (!r?.affectedRows) {
    throw createError({ statusCode: 404, statusMessage: '账单不存在或无权修改' })
  }

  return { ok: true }
})
