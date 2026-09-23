// 首页统计卡片：真实计数
//
// 🔴 原为硬编码演示值 `{ totalQueries: 128630, abnormalClues: 42 }`，**已在公网首页展示**，
//    2026-09-23 修复（缺陷清单 N5）。改口径时务必同步 `app/pages/index.vue` 的注释与 26 号文档。
//
// 口径（务必保持一致）：
//   ① 累计查询 = `scan_log` 全表行数。
//      ⚠️ 只统计**本平台签发**的码 —— 扫到非本平台码会走登记库兜底分支（`external-reg`），
//      该分支是**只读的：刻意不写 `scan_log`、不触发预警**（见 `trace.get.ts` 的只读边界）
//      ⇒ 本数字低于真实扫码总量，属**设计使然**，别当 bug。
//   ② 异常线索 = `risk_alert` **全量**行数（含已处理）。若某天要改成"待处理"，
//      在 SQL 上加 `WHERE handle_status = 0`（口径不同但仍是真数）。
//
// 为什么要缓存：首页是公众高访问路径，不能每次请求都 COUNT 全表。
// 60s 进程内缓存；本项目 PM2 是 fork 单实例，进程内缓存有效（将来若改 cluster，各实例各缓存一份，可接受）。
import { query } from '../utils/db'

let cached: { at: number; data: { totalQueries: number; abnormalClues: number } } | null = null
const TTL_MS = 60 * 1000

export default defineEventHandler(async () => {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data
  try {
    const [q] = await query<any[]>('SELECT COUNT(*) AS c FROM scan_log')
    const [a] = await query<any[]>('SELECT COUNT(*) AS c FROM risk_alert')
    const data = { totalQueries: Number(q?.c || 0), abnormalClues: Number(a?.c || 0) }
    cached = { at: Date.now(), data }
    return data
  } catch {
    // 查询失败宁可回 null（`index.vue` 已有 `stats?.totalQueries || '--'` 兜底会显示 --），
    // 也绝不回一个假数字 —— 这正是本条缺陷的教训。
    return { totalQueries: null, abnormalClues: null }
  }
})
