// 极简进程内限流器（零依赖）
//
// 用途：给公众可写、或能触发外部付费调用的接口做防刷。
// 目前使用方：`/api/feedback`（N2，防刷工单）、`/api/bill`（记账写入，防脚本刷库）。
// 注：原使用方 `/api/stores/nearby` 已随「附近门店」于 2026-09-23 整体下线。
//
// 为什么进程内就够：本项目 PM2 是 **fork 单实例**（部署铁律），进程内计数即全局计数。
// 🔴 若将来改成 cluster 多实例，限流会按实例数成倍放宽 ⇒ 那时必须换成共享存储（Redis/MySQL）。
//
// 取向：**宁可放过、不可误伤**。同一出口 IP 背后可能是公司/校园 NAT 或运营商 CGNAT（`ip-geo.ts`
// 已把 `100.64-127` 识别为 CGNAT）下的大量正常用户，阈值必须给得宽松；只在明显异常时才拒绝。

/** 单个限流桶：窗口内已用次数 + 窗口重置时间 */
interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()
/** 桶数量上限，防止被随机 IP 刷成无界增长（与 `ip-geo.ts` 的 CACHE_MAX 同一取向） */
const MAX_BUCKETS = 10000
/** 距上次清理超过该时长就顺带清一次过期桶（避免只在满的时候才清） */
const SWEEP_INTERVAL_MS = 60 * 1000
let lastSweepAt = 0

/** 清理已过期的桶；桶数触顶时兜底清空（宁可短暂放过，也不让内存无界增长） */
function sweep(now: number): void {
  lastSweepAt = now
  for (const [k, v] of buckets) {
    if (now >= v.resetAt) buckets.delete(k)
  }
  if (buckets.size >= MAX_BUCKETS) buckets.clear()
}

/**
 * 取一个令牌（固定窗口计数）。
 *
 * @param key      限流键，建议带业务前缀，如 `nearby:1.2.3.4` / `feedback:1.2.3.4`
 * @param limit    窗口内允许的最大次数
 * @param windowMs 窗口长度（毫秒）
 * @returns `true` = 放行；`false` = 超限（调用方应返回 429）
 */
export function allowRequest(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  if (now - lastSweepAt >= SWEEP_INTERVAL_MS) sweep(now)

  const b = buckets.get(key)
  if (!b || now >= b.resetAt) {
    if (!b && buckets.size >= MAX_BUCKETS) sweep(now)
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (b.count >= limit) return false
  b.count++
  return true
}
