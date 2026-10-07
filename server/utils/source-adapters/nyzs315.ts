// 农资315 网（nyzs315.com）来源页适配器 —— 只服务「通用 HTML 解析读不出内容」的 JS 空壳站。
//
// 为什么需要：
//   该站查询页是 ASP.NET 老站的**空壳**：实抓 HTTP 200 / 约 46 KB，但 72% 是 `<script>`，
//   可见文本里只剩「农药名称：」「登记证持有人：」这类**冒号后全空**的标签，真正的值由
//   JSONP + innerHTML 在浏览器运行时回填。通用解析第一步就剥掉 script ⇒ 一个字段都取不到，
//   命中 source-snapshot.ts 的兜底抛错「页面由脚本加载」。详见 docs/handover/36 号 §2.1。
//
// 做法（照抄原页脚本，不自行发明）：
//   复用该站页面自己调用的私有接口 getCodeResult()：
//     GET {apiNetworkPath}/api/h5/Code/QueryCodeJson
//         ?queryCode=<协议//host/I?m=<m>&c=<码>>&firstAddress=<省>&firstFullAddress=<省,市,区>&lng=&lat=&oldCodeType=0
//     Headers: X-Tenant-ID: <m>   ← 🔴 必需（缺了返回「该码未找到相关信息!」，见 36 号 §10.1）
//
// 🔴 代价（36 号 §5.3.4，必须知情）：
//   每成功调用一次，都会把对方页面上「这是于【地区】第 N 次查询该产品」的计数 +1 ——
//   我们替消费者查一次，就等于在外站留下一次查询记录。**故只在宿主白名单命中时才启用**，
//   且与快照本身共用 10 分钟缓存（同码同址 10 分钟内不重复调用）。
//   ⚠️ 若决定停止污染对方统计，删掉 source-adapters/index.ts 里的一行登记即可整体下线。
//
// 降级：
//   任何异常 / `tag≠1` / 核心字段全空 ⇒ 返回 null ⇒ 调用方自动退回通用抓取 + 解析，
//   再失败仍有「查看原查询页」链接。适配器永远不是唯一失败点。
import { fetchSourceDocument } from '../source-fetch'
import type { SourceDeclaration } from '#shared/types/source-snapshot'

/** 该站页面脚本里写死的接口主机（原页 `var apiNetworkPath = 'http://nyzs315.com'`） */
const API_HOST = 'http://nyzs315.com'

/**
 * 对方接口的必填地址参数。
 * 🔴 实测（36 号 §10.2）：必须「省,市,区」三段；只给两段、或直辖市「省=市」都会返回空；
 *    且地址只承担「过校验 + 被对方记录」，**换任何城市都返回同一份数据**，不参与内容过滤。
 *    服务端没有真实区级地址，故固定一个常规三级地址 —— 代价是对方会把我们发起的查询都记成同一地区。
 */
const ADDRESS = { first: '广西壮族自治区', full: '广西壮族自治区,南宁市,青秀区' }

/** 去噪取值：空、纯横线占位一律当「没有」 */
function text(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value).trim()
  return !s || /^[-—]+$/.test(s) ? '' : s
}

export async function nyzs315Adapter(sourceUrl: string, code: string): Promise<{ source: SourceDeclaration; document: string } | null> {
  const url = new URL(sourceUrl)
  const tenant = text(url.searchParams.get('m'))
  const unit = text(url.searchParams.get('c')) || text(code)
  // 租户号与 32 位码是这条路的必要条件；缺一个就交给通用解析，绝不猜。
  if (!tenant || !/^\d{32}$/.test(unit)) return null
  // queryCode 要传**整条页 URL**：原页脚本把 .aspx 页归一化成 `/I?m=&c=` 查询串形式，照抄其构造。
  const queryCode = `${url.protocol}//${url.host}/I?m=${tenant}&c=${unit}`
  const api = `${API_HOST}/api/h5/Code/QueryCodeJson?` + new URLSearchParams({
    queryCode, firstAddress: ADDRESS.first, firstFullAddress: ADDRESS.full, lng: '', lat: '', oldCodeType: '0',
  }).toString()
  const fetched = await fetchSourceDocument(api, { 'X-Tenant-ID': tenant, 'Content-Type': 'application/json' })
  let payload: any
  try { payload = JSON.parse(fetched.body) } catch { return null }
  if (Number(payload?.tag) !== 1 || !payload?.data || typeof payload.data !== 'object') return null
  const d = payload.data
  // 该接口没有「登记证号 / 含量 / 剂型 / 毒性」字段（只能走本平台登记库比对，见 36 号 §10.3）；
  // `originalMedicineList` 实测恒为 `[]` ⇒ 原药信息如实留空，绝不拿同成分候选顶替（比对口径的红线）。
  const productName = text(d.bookCode)
  const holderName = text(d.departmentName)
  const manufacturer = text(d.tenantName)
  // 三个核心字段全空 ⇒ 视为适配失败：宁可不展示，也不把空数据当「来源页已核对」。
  if (!productName && !holderName && !manufacturer) return null
  const pageCode = /^\d{32}$/.test(text(d.code1)) ? text(d.code1) : undefined
  const fields: { label: string; value: string }[] = []
  const push = (label: string, value: string) => { if (value) fields.push({ label, value }) }
  push('产品名称', productName)
  push('登记证持有人', holderName)
  push('生产企业', manufacturer)
  push('企业地址', text(d.tenantAddress))
  const count = Number(d.queryCount)
  if (Number.isFinite(count) && count > 0) push('该产品被查询次数', count + ' 次（含本次）')
  push('本次查询时间', text(d.queryTime))
  return {
    source: {
      sourceUrl,
      platform: url.hostname,
      // code 保持「本次查询用的码」（与 parseSourceDocument 的口径一致）；
      // 接口自报的码放 pageCode ⇒ 调用方既有的「码是否一致」校验照常生效。
      code,
      pageCode,
      productName: productName || undefined,
      holderName: holderName || undefined,
      manufacturer: manufacturer || undefined,
      productFields: fields,
      originals: [],
    },
    // raw_document 存接口原文（约 1.2 KB），比抓 46 KB 空壳页小得多，也便于日后核对。
    document: fetched.body,
  }
}
