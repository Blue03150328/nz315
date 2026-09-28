// 外站适配器注册表：**只登记「通用 HTML 解析搞不定」的宿主**（JS 空壳站）。
//
// 判据一句话（36 号 §10.6）：抓下来剥掉标签后，标签后面还有没有值 ——
//   有值 ⇒ 通用解析已经能吃下（如 ddspp.cn，服务端渲染的完整静态页，线上实测 18 项比对全过），**不要给它加适配器**；
//   没值 ⇒ 才登记到本表。
// 🔴 白名单命中才走适配器；未命中一律走原「抓页面 + 通用解析」，行为与从前完全一致。
import { nyzs315Adapter } from './nyzs315'
import { hyny168Adapter } from './hyny168'
import { sdakzwAdapter } from './sdakzw'
import type { SourceDeclaration } from '#shared/types/source-snapshot'

type Adapted = { source: SourceDeclaration; document: string }
/**
 * 适配器结论（2026-09-28 新增第三态）：
 * · 拿到声明 ⇒ 正常返回；
 * · `{ notFound: true }` ⇒ **对方平台明确答复「查无此码」**（不是我们没读懂）——
 *   调用方据此给出「该码在来源平台查不到」的文案。没有这一态时，这类码会退到通用抓取、
 *   撞上空壳页，消费者看到的是「页面要靠浏览器才能显示内容」，等于把对方的答复说错了；
 * · null ⇒ 说不清（未登记宿主 / 接口异常 / 缺字段），一律退回通用抓取 + 解析。
 */
type AdapterOutcome = Adapted | { notFound: true } | null
type Adapter = (sourceUrl: string, code: string) => Promise<AdapterOutcome>

/** host（小写）→ 适配器。删掉某一行即整体下线该平台适配器。 */
const ADAPTERS: Record<string, Adapter> = {
  'nyzs315.com': nyzs315Adapter,
  'www.nyzs315.com': nyzs315Adapter,
  // 2026-09-28 新增：两站均为**纯前端空壳**（实抓 12 KB / 1.6 KB Vue 壳，字段全靠运行时 XHR 回填），
  // 通用解析必然读不出 ⇒ 按各自页面自己调用的 JSON 接口接入。详见 hyny168.ts / sdakzw.ts 顶部说明。
  'zp.hyny168.cn': hyny168Adapter,
  'www.hyny168.cn': hyny168Adapter,
  'www.sdakzw.com': sdakzwAdapter,
}

/**
 * 按宿主取适配器执行。**任何失败（含未登记宿主）都返回 null**，
 * 由调用方退回通用抓取 + 解析 —— 适配器永远不得成为「唯一失败点」。
 */
export async function adaptSourceDocument(sourceUrl: string, code: string): Promise<AdapterOutcome> {
  let host = ''
  try { host = new URL(sourceUrl).hostname.toLowerCase() } catch { return null }
  const adapter = ADAPTERS[host]
  if (!adapter) return null
  try { return await adapter(sourceUrl, code) } catch { return null }
}
