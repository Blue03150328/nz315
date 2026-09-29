// GET /api/bill?year=2026&keyword=水稻&from=2026-01-01&to=2026-12-31&crop=水稻&channel=农资店
// —— 账本（档案页）取数：顶部三档统计 + 按月分组 + 年度总计
//
// 设计要点（详见 docs/handover/29 号 §2）：
//   1. **一次给全**：农户一年的账单量级是几十到几百条（私人小数据，不是平台的亿级表），
//      一次返回全部 + 服务端分好组，前端直接渲染，省掉分页与二次请求。
//      仍有 2000 条上限兜底（`truncated` 标记），避免异常数据把响应撑爆。
//   2. 🔴 **统计与列表分开查**：三档金额/覆盖作物用**独立聚合 SQL**算，
//      **绝不能拿被 LIMIT 截断的列表行去累加** —— 否则截断时统计会静默偏小
//      （"看着正常但数字是错的"，这类 bug 最难发现）。
//   3. **年份参数非法时回落当年，不 400**：账本页不该因为一个坏 query 白屏。
//   4. 🔴 **用药 = 总 − 用肥**（而不是各 SUM 一次）：保证「用药 + 用肥 === 总花费」恒成立，
//      否则浮点/口径差异会让三张卡片自己跟自己打架。
import { requireConsumer } from '~~/server/utils/consumer-auth'
import { query } from '~~/server/utils/db'
import { BILL_LIMITS } from '#shared/utils/bill-category'

const round2 = (n: number) => Math.round(n * 100) / 100
const num = (v: any) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export default defineEventHandler(async (event) => {
  const consumer = await requireConsumer(event)
  const q = getQuery(event)
  const thisYear = new Date().getFullYear()

  const yearRaw = Number(q.year)
  const year = Number.isInteger(yearRaw) && yearRaw >= 2000 && yearRaw <= thisYear ? yearRaw : thisYear

  // 筛选值全部走参数绑定；日期格式不合法时忽略，避免坏 query 让账本白屏。
  const keyword = String(q.keyword || '').trim().slice(0, 100)
  const crop = String(q.crop || '').trim().slice(0, 50)
  const channel = String(q.channel || '').trim().slice(0, 50)
  const dateRe = /^\d{4}-\d{2}-\d{2}$/
  const from = String(q.from || '').trim()
  const to = String(q.to || '').trim()
  const validFrom = dateRe.test(from) ? from : ''
  const validTo = dateRe.test(to) ? to : ''

  const filterSql = ['YEAR(bill_date) = ?']
  const filterParams: any[] = [year]
  if (keyword) {
    filterSql.push('product_name LIKE ?')
    filterParams.push('%' + keyword + '%')
  }
  if (validFrom) {
    filterSql.push('bill_date >= ?')
    filterParams.push(validFrom)
  }
  if (validTo) {
    filterSql.push('bill_date <= ?')
    filterParams.push(validTo)
  }
  if (crop) {
    filterSql.push('crop LIKE ?')
    filterParams.push('%' + crop + '%')
  }
  if (channel) {
    filterSql.push('channel LIKE ?')
    filterParams.push('%' + channel + '%')
  }
  const whereSql = 'consumer_id = ? AND ' + filterSql.join(' AND ')

  // 有记账记录的年份（供前端年份切换；量级极小，直接全取）
  const yearRows = await query<any[]>(
    'SELECT DISTINCT YEAR(bill_date) AS y FROM farm_bill WHERE consumer_id = ? ORDER BY y DESC',
    [consumer.id],
  )
  const years = yearRows.map(r => Number(r.y)).filter(y => Number.isInteger(y) && y > 0)
  // 当前查询年必在列表里 —— 否则用户切到一个空年份后无法切回来
  if (!years.includes(year)) years.unshift(year)

  // 列表（日期倒序；LIMIT 兜底）
  const rows = await query<any[]>(
    `SELECT id, bill_date, product_name, dosage, category, crop, quantity, unit, unit_price,
            total_amount, channel, remark, code, source
       FROM farm_bill
       WHERE ${whereSql}
      ORDER BY bill_date DESC, id DESC
      LIMIT ?`,
    [consumer.id, ...filterParams, BILL_LIMITS.yearRowLimit],
  )

  // 统计（独立聚合，不受上面 LIMIT 影响）
  const [agg] = await query<any[]>(
    `SELECT
       COUNT(*) AS cnt,
       COALESCE(SUM(total_amount), 0) AS total_amount,
       COALESCE(SUM(CASE WHEN category = '肥料' THEN total_amount ELSE 0 END), 0) AS fertilizer_amount,
       COUNT(DISTINCT CASE WHEN crop IS NOT NULL AND crop <> '' THEN crop END) AS crop_count
     FROM farm_bill
     WHERE ${whereSql}`,
    [consumer.id, ...filterParams],
  )

  const total = round2(num(agg?.total_amount))
  const fertilizer = round2(num(agg?.fertilizer_amount))
  const pesticide = round2(total - fertilizer)

  // 按月分组：rows 已是日期倒序 ⇒ Map 的插入顺序天然就是年月降序，无需再排序
  const groups: any[] = []
  const index = new Map<string, any>()
  for (const r of rows) {
    const ym = String(r.bill_date).slice(0, 7) // 'YYYY-MM'
    let g = index.get(ym)
    if (!g) {
      g = { ym, label: ym.slice(0, 4) + '年' + Number(ym.slice(5, 7)) + '月', subtotal: 0, count: 0, rows: [] }
      index.set(ym, g)
      groups.push(g)
    }
    g.rows.push({
      id: Number(r.id),
      billDate: r.bill_date,
      productName: r.product_name,
      dosage: r.dosage || null,
      category: r.category || null,
      crop: r.crop || null,
      quantity: r.quantity === null ? null : num(r.quantity),
      unit: r.unit || null,
      unitPrice: r.unit_price === null ? null : num(r.unit_price),
      totalAmount: round2(num(r.total_amount)),
      channel: r.channel || null,
      remark: r.remark || null,
      code: r.code || null,
      source: Number(r.source) === 1 ? 1 : 2,
    })
    g.count++
    g.subtotal = round2(g.subtotal + num(r.total_amount))
  }

  return {
    year,
    years,
    totals: { pesticide, fertilizer, total, cropCount: num(agg?.crop_count) },
    groups,
    grandTotal: total, // 全年总计（= totals.total，单列出来是为了前端语义清晰）
    count: num(agg?.cnt),
    truncated: num(agg?.cnt) > rows.length,
    filters: { keyword, from: validFrom, to: validTo, crop, channel },
  }
})
