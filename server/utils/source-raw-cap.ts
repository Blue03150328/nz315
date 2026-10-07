/**
 * 外页原文的落库策略 —— `external_source_snapshot` 存储放大收口（2026-09-28）。
 *
 * 背景：这张表是**公众端匿名可写**的审计表（设计如此，不打算改），但三重放大叠在一起：
 *   ① `raw_document` 是 `MEDIUMTEXT`（上限 16MB），而抓取侧只在 **1MB** 处截断
 *      （`source-fetch.ts`：`size > 1024 * 1024` 即 destroy）⇒ **表本身完全没有兜底**；
 *   ② 抓取或解析**失败时原文照样落库** —— 可失败页恰恰是读不出内容的那一类，留着几乎无用；
 *   ③ 失败行原本**整条排除在缓存之外**（`status <> 'unavailable'`）⇒ 每次重试都要
 *      重新抓一次外站、再落一行，这是放大的主因。
 *   服务器与 cynx 共用磁盘、长期 75% 以上，故必须收口。
 *
 * 本模块只回答两件事：**原文留多少**（`capRawDocument`）、**缓存留多久**
 * （`SUCCESS_CACHE_MINUTES` / `FAILURE_CACHE_MINUTES`）。不碰任何抓取、解析与判定逻辑。
 */

/**
 * 成功快照里原文最多保留的字节数（UTF-8）。
 * 取 64KB：`raw_document` 在应用里是**只写不读**的（唯一读它的是运维 SQL），
 * 截断不影响任何功能；而首页声明所在的头部区域远小于此。
 */
export const RAW_DOCUMENT_MAX_BYTES = 64 * 1024

/** 成功快照的缓存复用时长（分钟）—— 维持线 B 上线时的 10 分钟，未改动。 */
export const SUCCESS_CACHE_MINUTES = 10

/**
 * 失败快照的缓存复用时长（分钟）—— 新增。
 * 刻意取得比成功短得多：既挡住「反复重试 ⇒ 反复抓 + 反复落行」的放大，
 * 又不至于让一个瞬时故障在消费者眼里「卡住 10 分钟」。
 */
export const FAILURE_CACHE_MINUTES = 2

/**
 * 按 UTF-8 字节上限截断原文，且**不把一个多字节字符切成半个** ——
 * 直接 `slice` 会在中文/emoji 中间断开，落库的就是半个乱码字符。
 * 返回空串表示「没有可保留的原文」。
 */
export function capRawDocument(text: string | null | undefined, maxBytes: number = RAW_DOCUMENT_MAX_BYTES): string {
  if (!text) return ''
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= maxBytes) return text
  let end = maxBytes
  // UTF-8 续字节形如 10xxxxxx；向前退到字符起始处
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end--
  return buf.subarray(0, end).toString('utf8')
}
