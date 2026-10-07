// DELETE /api/bill/:id —— 删除一条记账
//
// 🔴 同样必须带 `consumer_id` 归属条件（水平越权防护，见 [id].patch.ts 的说明）。
//    刻意做成**硬删除**而非软删除：这是消费者自己的流水账，用户点删除就该真的删掉
//    （隐私预期）；且账单不含审计价值（不是平台的业务数据）。
import { requireConsumer } from '~~/server/utils/consumer-auth'
import { execute } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  const consumer = await requireConsumer(event)

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: '账单ID不合法' })
  }

  const r = await execute(
    'DELETE FROM farm_bill WHERE id = ? AND consumer_id = ?',
    [id, consumer.id],
  )
  if (!r?.affectedRows) {
    throw createError({ statusCode: 404, statusMessage: '账单不存在或已删除' })
  }

  return { ok: true }
})
