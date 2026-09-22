// 客户端 IP → 省 / 市（供 scan_log.province / city 落库，「重复查询」判据依赖省份）
//
// 为什么有这个模块（2026-09-22，缺陷清单 23 号 P1-1）：
//   `scan_log.province` / `city` 此前全仓库**只有读、没有写** —— `trace.get.ts` 的 INSERT 里就没有这两列，
//   而「重复查询」的判据是 `queryCount >= 3 && COUNT(DISTINCT province) >= 2`
//   ⇒ 该分支在真实扫码链路上**永远触发不了**（线上一直如此），PRD「8 类异常-1」是死分支。
//
// 数据来源：高德 IP 定位 `restapi.amap.com/v3/ip`，复用 runtimeConfig.amapWebKey
//   ⇒ **零新依赖**（与 server/api/stores/nearby.get.ts 同一个 key、同一套调用范式）。
//
// 🔴 三条硬性约束，全部是本机实测出来的，改这个文件前先看：
//   1. **QPS 极小，且限流时 HTTP 仍是 200**：实测连续第 4 次调用即返回
//      `{"status":"0","info":"CUQPS_HAS_EXCEEDED_THE_LIMIT","infocode":"10021"}`，而 **HTTP 状态码是 200**。
//      ⇒ 必须显式判 `status === '1'`，只看 HTTP 码会把限流当成功。
//      ⇒ 公众端是**唯一被陌生人高频打的路径**，因此本模块必须自带缓存 + 全局限速，否则配额很快被打爆。
//   2. **未命中时返回的是空数组，不是空字符串**：内网 IP（127.0.0.1）与境外 IP（8.8.8.8）实测都返回
//      `"province":[], "city":[]` ⇒ 必须按 Array 处理，直接 String() 会把 `[]` 拼进库。
//   3. **内网/保留地址直接跳过，不发请求**：本机 127.0.0.1 实测要白等约 600ms 才回空，纯浪费。
//
// 设计取向：**宁可为空，绝不阻塞**。超时 / 限流 / 网络错误 / 未配置 key，一律返回 null，
// 由调用方按「省份未知」处理 —— 扫码结果永远不受本模块影响（本模块不参与任何判定，只补充字段）。

import { execute } from './db'

/** IP→省市 基本不变，成功结果长期缓存，用缓存把外部调用次数压到最低（QPS 保护的第一道闸） */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000/** 未命中的结果（内网/境外/限流）短缓存，避免同一个 IP 反复问，又不至于把临时故障缓存一整天 */
const NEGATIVE_TTL_MS = 10 * 60 * 1000
/** 缓存条数上限（超限丢弃最早插入的一半，扫码场景不追求严格 LRU） */
const CACHE_MAX = 5000
/** 单次外部调用超时（公众端只允许后台补齐，超时即放弃） */
const TIMEOUT_MS = 800
/** 全局限速：两次外部调用之间的最小间隔 ⇒ 实测该 key 连打 4 次就限流，这里按 ≈3 QPS 以内留余量 */
const MIN_INTERVAL_MS = 350
/** 等待限速槽位的上限（超时即放弃；因为是后台补齐，等一下不影响任何人） */
const GATE_MAX_WAIT_MS = 1500

export interface IpGeo {
  province: string
  city: string
}

const cache = new Map<string, { at: number; value: IpGeo | null }>()
/** 单飞去重：同一个 IP 并发只发一次外部请求 */
const inflight = new Map<string, Promise<IpGeo | null>>()
let nextSlotAt = 0

/** 是否为本机 / 内网 / 保留地址（这类地址查不出省市，直接跳过不打接口） */
function isPrivateIp(ip: string): boolean {
  const v = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  const lower = v.toLowerCase()
  if (lower === '::1' || lower === 'localhost' || lower.startsWith('fc') || lower.startsWith('fd')) return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v)
  if (!m) return false
  const a = Number(m[1]), b = Number(m[2])
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 169 && b === 254) return true
  if (a === 100 && b >= 64 && b <= 127) return true // 运营商 CGNAT 段
  return false
}

/** 高德未命中时返回空数组，统一转成字符串（见文件头约束 2） */
function pickText(v: unknown): string {
  if (Array.isArray(v)) return ''
  return String(v ?? '').trim()
}

/** 占一个限速槽位；等待超过上限则返回 false（放弃本次调用，交给降级逻辑） */
async function reserveSlot(): Promise<boolean> {
  const now = Date.now()
  const wait = Math.max(0, nextSlotAt - now)
  if (wait > GATE_MAX_WAIT_MS) return false
  nextSlotAt = Math.max(now, nextSlotAt) + MIN_INTERVAL_MS
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  return true
}

async function callAmap(ip: string): Promise<IpGeo | null> {
  const key = String(useRuntimeConfig().amapWebKey || '')
  if (!key) return null
  const res = await $fetch<any>('https://restapi.amap.com/v3/ip', {
    query: { ip, key },
    timeout: TIMEOUT_MS,
  })
  // 约束 1：限流/配额用尽时 HTTP 仍是 200，必须看业务 status
  if (String(res?.status) !== '1') return null
  const province = pickText(res.province)
  if (!province) return null
  return { province, city: pickText(res.city) }
}

/**
 * 解析客户端 IP 归属省市。任何失败都返回 null（调用方按「未知」处理），**不抛错、不阻塞**。
 * 内网/保留地址与空 IP 直接返回 null，不发请求。
 */
export async function resolveIpGeo(ip: string): Promise<IpGeo | null> {
  const addr = String(ip || '').trim()
  if (!addr || isPrivateIp(addr)) return null

  const hit = cache.get(addr)
  if (hit) {
    const ttl = hit.value ? CACHE_TTL_MS : NEGATIVE_TTL_MS
    if (Date.now() - hit.at < ttl) return hit.value
  }
  const pending = inflight.get(addr)
  if (pending) return pending

  const task = (async (): Promise<IpGeo | null> => {
    try {
      if (!(await reserveSlot())) return null
      const value = await callAmap(addr)
      // 只有「接口正常回了但没数据」才写负缓存；抛错（超时/网络）不缓存，免得把临时故障固化
      cache.set(addr, { at: Date.now(), value })
      if (cache.size >= CACHE_MAX) {
        let removed = 0
        for (const k of cache.keys()) {
          cache.delete(k)
          if (++removed >= Math.floor(CACHE_MAX / 2)) break
        }
      }
      return value
    } catch {
      return null
    } finally {
      inflight.delete(addr)
    }
  })()

  inflight.set(addr, task)
  return task
}

/**
 * 取**已缓存**的省市，不发起任何外部调用（同步、零成本）。
 *
 * 用途：写 scan_log 时先看一眼缓存 —— 命中就当场带上省市（绝大多数扫码都是同城/同运营商 IP，
 * 缓存 24h 命中率很高），于是「重复查询」的判定不必等后台补齐，不存在滞后一次的问题；
 * 只有**首次出现的新 IP** 才走异步补齐。返回值 null 表示「未缓存」或「已缓存为无结果」，
 * 两种情况都由调用方交给 backfillScanGeo 处理（后者命中负缓存时是空操作）。
 */
export function peekIpGeo(ip: string): IpGeo | null {
  const addr = String(ip || '').trim()
  if (!addr) return null
  const hit = cache.get(addr)
  if (!hit) return null
  const ttl = hit.value ? CACHE_TTL_MS : NEGATIVE_TTL_MS
  return Date.now() - hit.at < ttl ? hit.value : null
}

/**
 * 异步补齐某条扫码日志的省市（fire-and-forget）。
 *
 * 为什么异步：公众端是唯一被陌生人高频打的路径，而高德 IP 定位 QPS 极小（约束 1），
 * **绝不能把外部调用压进扫码主链路**。先写日志、立即返回扫码结果，这里在后台补写；
 * 失败就当省份未知 —— 「重复查询」的判据用的是历史统计（≥3 次且 ≥2 省），不依赖本次这几百毫秒。
 *
 * ⚠️ 只在 PM2/Nitro 常驻进程下可靠（本项目就是常驻）。serverless 环境下进程可能被冻结，勿照搬。
 */
export function backfillScanGeo(scanLogId: number | null | undefined, ip: string): void {
  const id = Number(scanLogId)
  if (!id || !ip) return
  void resolveIpGeo(ip)
    .then(async (geo) => {
      if (!geo) return
      await execute('UPDATE scan_log SET province = ?, city = ? WHERE id = ?', [geo.province, geo.city, id])
    })
    .catch(() => { /* 补齐失败不影响任何业务流程，静默 */ })
}
