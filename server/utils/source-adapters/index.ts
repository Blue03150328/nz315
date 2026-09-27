// 外站适配器注册表：**只登记「通用 HTML 解析搞不定」的宿主**（JS 空壳站）。
//
// 判据一句话（36 号 §10.6）：抓下来剥掉标签后，标签后面还有没有值 ——
//   有值 ⇒ 通用解析已经能吃下（如 ddspp.cn，服务端渲染的完整静态页，线上实测 18 项比对全过），**不要给它加适配器**；
//   没值 ⇒ 才登记到本表。
// 🔴 白名单命中才走适配器；未命中一律走原「抓页面 + 通用解析」，行为与从前完全一致。
import { nyzs315Adapter } from './nyzs315'
import type { SourceDeclaration } from '#shared/types/source-snapshot'

type Adapted = { source: SourceDeclaration; document: string }
type Adapter = (sourceUrl: string, code: string) => Promise<Adapted | null>

/** host（小写）→ 适配器。删掉某一行即整体下线该平台适配器。 */
const ADAPTERS: Record<string, Adapter> = {
  'nyzs315.com': nyzs315Adapter,
  'www.nyzs315.com': nyzs315Adapter,
}

/**
 * 按宿主取适配器执行。**任何失败（含未登记宿主）都返回 null**，
 * 由调用方退回通用抓取 + 解析 —— 适配器永远不得成为「唯一失败点」。
 */
export async function adaptSourceDocument(sourceUrl: string, code: string): Promise<Adapted | null> {
  let host = ''
  try { host = new URL(sourceUrl).hostname.toLowerCase() } catch { return null }
  const adapter = ADAPTERS[host]
  if (!adapter) return null
  try { return await adapter(sourceUrl, code) } catch { return null }
}
