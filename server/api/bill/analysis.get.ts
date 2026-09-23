// GET /api/bill/analysis?range=month|quarter|year&year=2026 —— 成本分析页取数
//
// 四块数据一次给全（详见 docs/handover/29 号 §2.1）：
//   ① 区间总额 + 覆盖作物    ② 12 个月趋势（柱状图，固定 12 项）
//   ③ 类别分布（环形图，**固定按 BILL_CATEGORIES 顺序返回 6 项**，含 0 —— 前端颜色映射才稳定）
//   ④ 作物分布（自由输入的作物按实际值聚合，金额降序）
//
// 区间口径用 **左闭右开 `[from, toEx)`**，且 `toEx` 一律取"结束月的次月 1 日"：
//   不用 `BETWEEN from AND 'YYYY-MM-31'` —— 2 月没有 31 日、9 月没有 31 日，
//   MySQL 拿非法日期串去比 DATE 列会走隐式转换告警，结果不可靠。
// ⚠️ 月份与"当前季度"取自库里的 CURDATE()（与写入侧同口径，避免 UTC 时区把凌晨算成前一天）。
import { requireConsumer } from '~~/server/utils/consumer-auth'
import { query } from '~~/server/utils/db'
import { BILL_CATEGORIES, localToday } from '#shared/utils/bill-category'

const round2 = (n: number) => Math.round(n * 100) / 100
const num = (v: any) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const pad = (n: number) => String(n).padStart(2, '0')

/** 次月（用于把区间右端点转成"次月 1 日"），处理 12 月跨年 */
const nextMonth = (y: number, m: number) => (m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 })

const RANGES = new Set(['month', 'quarter', 'year'])

export default defineEventHandler(async (event) => {
  const consumer = await requireConsumer(event)
  const q = getQuery(event)

  const [dt] = await query<any[]>('SELECT CURDATE() AS today')
  const todayRaw = String(dt?.today || '').slice(0, 10)
  // 兜底：today 一旦非法，curYear/curMonth 会变 NaN ⇒ 年份回落失效、区间算不出来
  //（与 bill-input.ts 的 parseBillBody 同一收口思路）
  const today = /^\d{4}-\d{2}-\d{2}$/.test(todayRaw) ? todayRaw : localToday()
  const curYear = Number(today.slice(0, 4))
  const curMonth = Number(today.slice(5, 7))

  const range = RANGES.has(String(q.range)) ? String(q.range) : 'month'
  const yearRaw = Number(q.year)
  const year = Number.isInteger(yearRaw) && yearRaw >= 2000 && yearRaw <= curYear ? yearRaw : curYear

  // ---- 计算区间 [from, toEx) 与高亮月份 ----
  let from: string
  let toEx: string
  let label: string
  let highlightMonths: number[]

  if (range === 'month') {
    const nx = nextMonth(year, curMonth)
    from = `${year}-${pad(curMonth)}-01`
    toEx = `${nx.y}-${pad(nx.m)}-01`
    label = `${year}年${curMonth}月`
    highlightMonths = [curMonth]
  } else if (range === 'quarter') {
    const quarter = Math.floor((curMonth - 1) / 3) + 1
    const m1 = (quarter - 1) * 3 + 1
    const m2 = quarter * 3
    const nx = nextMonth(year, m2)
    from = `${year}-${pad(m1)}-01`
    toEx = `${nx.y}-${pad(nx.m)}-01`
    label = `${year}年第${quarter}季度（${m1}-${m2}月）`
    highlightMonths = [m1, m1 + 1, m2]
  } else {
    from = `${year}-01-01`
    toEx = `${year + 1}-01-01`
    label = `${year}年全年`
    highlightMonths = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  }

  // ---- ① 区间总额 + 覆盖作物 ----
  const [agg] = await query<any[]>(
    `SELECT COALESCE(SUM(total_amount), 0) AS total,
            COUNT(DISTINCT CASE WHEN crop IS NOT NULL AND crop <> '' THEN crop END) AS crop_count
       FROM farm_bill
      WHERE consumer_id = ? AND bill_date >= ? AND bill_date < ?`,
    [consumer.id, from, toEx],
  )
  const total = round2(num(agg?.total))

  // ---- ② 12 个月趋势（按所选**年份**全年，与区间无关 —— 柱状图要的就是全年走势） ----
  const monthRows = await query<any[]>(
    `SELECT MONTH(bill_date) AS m, COALESCE(SUM(total_amount), 0) AS amount
       FROM farm_bill
      WHERE consumer_id = ? AND YEAR(bill_date) = ?
      GROUP BY MONTH(bill_date)`,
    [consumer.id, year],
  )
  const monthMap = new Map<number, number>(monthRows.map(r => [Number(r.m), round2(num(r.amount))]))
  const monthly = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, amount: monthMap.get(i + 1) || 0 }))

  // ---- ③ 类别分布（区间内；固定 6 项、按白名单顺序，含 0） ----
  const catRows = await query<any[]>(
    `SELECT category, COALESCE(SUM(total_amount), 0) AS amount, COUNT(*) AS cnt
       FROM farm_bill
      WHERE consumer_id = ? AND bill_date >= ? AND bill_date < ?
      GROUP BY category`,
    [consumer.id, from, toEx],
  )
  // 先归并到白名单桶：历史脏数据（非白名单值）一律并入「其他」，杜绝饼图出现第 7 个分区
  const catBucket = new Map<string, { amount: number; count: number }>()
  for (const r of catRows) {
    const key = (BILL_CATEGORIES as readonly string[]).includes(String(r.category))
      ? String(r.category)
      : '其他'
    const cur = catBucket.get(key) || { amount: 0, count: 0 }
    cur.amount = round2(cur.amount + num(r.amount))
    cur.count += num(r.cnt)
    catBucket.set(key, cur)
  }
  const byCategory = BILL_CATEGORIES.map(c => {
    const v = catBucket.get(c) || { amount: 0, count: 0 }
    return {
      category: c,
      amount: v.amount,
      count: v.count,
      percent: total > 0 ? Math.round((v.amount / total) * 1000) / 10 : 0,
    }
  })

  // ---- ④ 作物分布（区间内；自由输入按实际值聚合，金额降序，取前 20） ----
  const cropRows = await query<any[]>(
    `SELECT crop, COALESCE(SUM(total_amount), 0) AS amount
       FROM farm_bill
      WHERE consumer_id = ? AND bill_date >= ? AND bill_date < ?
        AND crop IS NOT NULL AND crop <> ''
      GROUP BY crop
      ORDER BY amount DESC
      LIMIT 20`,
    [consumer.id, from, toEx],
  )
  const byCrop = cropRows.map(r => ({ crop: String(r.crop), amount: round2(num(r.amount)) }))

  return {
    range,
    year,
    label,
    from,
    toEx,
    total,
    cropCount: num(agg?.crop_count),
    monthly,
    highlightMonths,
    byCategory,
    byCrop,
  }
})
