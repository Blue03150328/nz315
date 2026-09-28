// 山东省农药行业数字化服务平台（www.sdakzw.com）来源页适配器。
//
// 为什么需要（2026-09-28 实测，反了原判）：
//   查询页 `/nyzs/<32位码>` **不是**服务端渲染的完整 HTML —— 实抓 HTTP 200 只有 **1661 字节**：
//   一个 Vue3 + Element Plus 空壳（`<div id="app"></div>` + `/frontassets/js/index-*.js`）。
//   浏览器里看到的产品 / 生产 / 原药表格，全是前端拿到 JSON 后渲染的。
//   通用解析剥掉 script 后**一个字段都取不到** ⇒ 必然命中「页面由脚本加载」。
//
// 做法（照抄原页脚本，不自行发明）：
//   ① 接口主机：该站 `/config.js` 里 `window.__env__.VITE_API_URL = "http://api.sdakzw.com"`，
//      axios 实例 `baseURL` 即取该值（`request-kU7VBXyk.js`）。
//   ② 查询路径：结果页 `/frontassets/js/index-DZrM8kwQ.js` 调
//      `GET /api/nongYaoItem/zhuisu/{码}`，判 `type === "success"` 后取 `result`。
//      实测该接口匿名可用，未登记的码返回 HTTP 200 + `{code:400,type:"error",message:"单元识别码不正确…"}`。
//   ③ 字段名全部抄自该站自己的模板绑定（label ↔ 字段一一对应）：
//      nongYao.nongYaoName 农药名称 / nongYao.productName 商品名称 /
//      nongYao.dengJiZhengMaster 登记证持有人 / nongYao.dengJiZhengHao(+dengjiZhengHaoDisplay) 登记证号 /
//      nongYao.jiXingName 剂型 / nongYao.chengFen 有效成分及含量 / nongYao.duXing 毒性及标识 /
//      nongYao.piWenHao 农药生产许可证号（批准文件号）/ nongYao.biaoZhunHao 产品标准号 /
//      nongYao.baoZhiQi 质量保证期 / nongYaoItem.itemCode 单元识别代码 /
//      nongYaoQRCodeBatch.produceBatch 生产批号 / .produceDateTime 生产日期 /
//      .produceTypeName 生产类型 / .producer 生产企业 / .yuanYaoList[] {name,dengJiZhengHao,producer} /
//      nongYaoSpec.specName 产品规格
//      🔴 页面上「检验报告：合格」是模板里**写死的常量**（`g("span",null,"合格")`），
//         不是接口数据 ⇒ 绝不当证据采集。
//
// ⚠️ 本适配器的**验证边界**（务必知情）：
//   · 接口存在性、匿名可访问、响应信封（`{code,type,message,result}`）—— 已用真码实测；
//   · `result` 内部的字段路径 —— 取自该站自己前端源码，但**尚未拿到该站的真码做端到端回放**
//     （本项目手头没有 sdakzw 签发的真实 32 位码）。拿到真码后的第一件事就是回归 §"验收"那一步。
//   · 因此本适配器的失败降级格外重要：任何异常 / 缺字段 ⇒ 返回 null ⇒ 退回通用解析，
//     绝不会因为映射错位而把 A 字段的值贴到 B 标签上（取不到就留空）。
//
// 降级：任何异常 / `type≠"success"` / 核心字段全空 ⇒ 返回 null。
import { fetchSourceDocument } from '../source-fetch'
import type { SourceDeclaration } from '#shared/types/source-snapshot'

/** 该站 `/config.js` 的 `VITE_API_URL`（页面脚本写死的接口主机，照抄） */
const API_HOST = 'http://api.sdakzw.com'

/** 去噪取值：空、纯横线占位一律当「没有」 */
function text(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value).trim()
  return !s || /^[-—]+$/.test(s) ? '' : s
}

/** 该站生产日期可能带时间；只取日期段并校验日历，不合法一律丢弃。 */
function dateOnly(value: unknown): string | undefined {
  const m = text(value).match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (!m) return undefined
  const v = `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`
  const d = new Date(v + 'T00:00:00Z')
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : undefined
}

/**
 * 把该站 `/api/nongYaoItem/zhuisu/{码}` 响应里的 `result` 映射成本平台来源声明（纯函数，便于回归）。
 * @param result 已通过 `type === 'success'` 判定的 result 对象
 */
export function mapSdakzw(result: any, sourceUrl: string, code: string): SourceDeclaration | null {
  if (!result || typeof result !== 'object') return null
  const nongYao = result.nongYao || {}
  const item = result.nongYaoItem || {}
  const batch = result.nongYaoQRCodeBatch || {}
  const spec = result.nongYaoSpec || {}
  const productName = text(nongYao.nongYaoName)
  const holderName = text(nongYao.dengJiZhengMaster)
  const registrationNo = text(nongYao.dengjiZhengHaoDisplay) || text(nongYao.dengJiZhengHao)
  // 三个核心字段全空 ⇒ 视为适配失败：宁可不展示，也不把空数据当「来源页已核对」。
  if (!productName && !holderName && !registrationNo) return null
  const pageCode = text(item.itemCode)
  const fields: { label: string; value: string }[] = []
  const push = (label: string, value: string) => { if (value) fields.push({ label, value }) }
  push('产品名称', productName)
  // 该站的「商品名称」正是本平台的 commodityName 语义（只作展示，不参与登记比对）。
  push('商品名称', text(nongYao.productName))
  push('农药登记证号', registrationNo)
  push('登记证持有人', holderName)
  push('生产企业', text(batch.producer))
  push('剂型', text(nongYao.jiXingName))
  push('毒性', text(nongYao.duXing))
  push('有效成分及含量', text(nongYao.chengFen))
  push('规格', text(spec.specName))
  push('执行标准', text(nongYao.biaoZhunHao))
  push('生产许可证', text(nongYao.piWenHao))
  push('生产类型', text(batch.produceTypeName))
  const count = Number(item.viewCount)
  if (Number.isFinite(count) && count > 0) push('该产品被查询次数', count + ' 次（含本次）')
  if (pageCode) push('追溯网址', `http://www.sdakzw.com/nyzs/${pageCode}`)
  return {
    sourceUrl,
    platform: new URL(sourceUrl).hostname,
    // code 保持「本次查询用的码」；接口自报的码放 pageCode ⇒ 调用方既有的「码是否一致」校验照常生效。
    code,
    pageCode: /^\d{32}$/.test(pageCode) ? pageCode : undefined,
    productName: productName || undefined,
    commodityName: text(nongYao.productName) || undefined,
    registrationNo: registrationNo || undefined,
    holderName: holderName || undefined,
    manufacturer: text(batch.producer) || undefined,
    formulation: text(nongYao.jiXingName) || undefined,
    toxicity: text(nongYao.duXing) || undefined,
    ingredients: text(nongYao.chengFen) || undefined,
    spec: text(spec.specName) || undefined,
    produceDate: dateOnly(batch.produceDateTime),
    batchNo: text(batch.produceBatch) || undefined,
    shelfLife: text(nongYao.baoZhiQi) || undefined,
    productFields: fields,
    originals: Array.isArray(batch.yuanYaoList)
      ? batch.yuanYaoList.slice(0, 50).map((o: any) => ({
          ingredient: text(o?.name) || undefined,
          regNo: text(o?.dengJiZhengHao),
          company: text(o?.producer),
        }))
      : [],
  }
}

export async function sdakzwAdapter(sourceUrl: string, code: string): Promise<{ source: SourceDeclaration; document: string } | { notFound: true } | null> {
  const url = new URL(sourceUrl)
  // 码写在路径末段（`/nyzs/<码>`）；取不到就退回调用方给的码。要求标准 32 位，不猜、不截。
  const fromPath = text(url.pathname.split('/').filter(Boolean).pop())
  const unit = /^\d{32}$/.test(fromPath) ? fromPath : text(code)
  if (!/^\d{32}$/.test(unit)) return null
  const api = `${API_HOST}/api/nongYaoItem/zhuisu/${unit}`
  const fetched = await fetchSourceDocument(api, { 'Content-Type': 'application/json' })
  let payload: any
  try { payload = JSON.parse(fetched.body) } catch { return null }
  if (payload?.type !== 'success') {
    // 对方明说「没有这个码」（实测 HTTP 200 + `type:"error"` + 「单元识别码不正确，请联系商家!」）
    // ⇒ 交给调用方出正确文案；其余 error（接口内部故障等）说不清，仍退回通用抓取。
    return /单元识别码不正确|不存在|未找到|查无/.test(text(payload?.message)) ? { notFound: true } : null
  }
  const source = mapSdakzw(payload.result, sourceUrl, unit)
  if (!source) return null
  // raw_document 存接口原文，便于日后核对（也远小于对方前端产物）。
  return { source, document: fetched.body }
}
