// 绑定生产批次前的**产品合规守卫**
//
// 依据：PRD 5.9 异常类型 4「登记证已过期 ⇒ 暂停绑定批次」（农业农村部公告第1049号）。
// 2026-09-23 新增（缺陷清单 N4）—— 此前 `registration_expire` 全仓库只出现在 4 处
// （`trace.get.ts` 只读判断 + `products.post.ts` / `products/[id].patch.ts` 写入），
// **4 个绑定批次入口全无该字段校验** ⇒ 已过期的登记证照样能绑批次，消费者扫码才看到红字。
//
// 为什么做成公共守卫：三个文件四个入口共用同一套判断，避免四处各写一份随后漂移。
//
// 🔴 五条边界（改这个文件或用这个守卫前先看）：
//   1. **历史数据不回溯**：已绑定的码不回收、不改变 —— 本守卫只拦「新的绑定动作」。
//   2. **只拦「绑定批次」，不拦「生成码」** —— 严格按 PRD 的处置层级（"暂停绑定批次"）；
//      生成码是码池入库、不代表生产行为。
//   3. **不拦「编辑批次」与「字段修正」**（`produceDate` / `expireDate` / `qcResult` 类）——
//      那些是**纠错**场景，拦了会让已过期的历史数据永远修不回来。
//      ⇒ 所以 **不要**把这个守卫加到 `server/api/admin/batches/[id].patch.ts`（它不是绑定入口，
//      只把批次三要素同步到已绑定码的冗余列）。
//   4. **`registration_expire` 为空的产品不拦**（保持既有数据可操作）。代价：没填有效期的产品
//      是个「后门」；要堵得把它变成必填，那是产品决策，本次不做。
//   5. ⚠️ **日期比较刻意沿用项目既有口径 `new Date().toISOString().slice(0, 10)`（UTC 日期）**，
//      与 `trace.get.ts` 的过期判断保持一致。副作用：**东八区凌晨 00:00–08:00 之间，UTC 日期
//      还是前一天** ⇒ 到期当天凌晨会多放行 8 小时。本次刻意保持一致（引入第二套口径 = 两处判断
//      互相打架，更糟）；若某天要统一修，应**连同 `trace.get.ts` 一起**改成按北京时间
//      （那是独立的一条，别混进别的改动里）。
import { query } from './db'

/**
 * 断言某产品「可绑定生产批次」。**登记证已过期时抛 400**（中文提示），其余情况静默通过。
 *
 * @param productId 目标产品 ID；为空（码/批次未挂产品）时直接放行
 */
export async function assertProductBindable(productId: number | null | undefined): Promise<void> {
  if (!productId) return
  const [p] = await query<any[]>(
    'SELECT registration_no, registration_expire FROM product WHERE id = ? LIMIT 1',
    [productId])
  if (!p) return
  const expire = String(p.registration_expire || '').slice(0, 10)
  if (!expire) return // 未填有效期 ⇒ 不拦（见边界 4）
  if (expire < new Date().toISOString().slice(0, 10)) {
    throw createError({
      statusCode: 400,
      statusMessage: '该产品登记证（' + (p.registration_no || '') + '）已于 ' + expire + ' 到期，不可绑定生产批次，请先更新登记证有效期',
    })
  }
}
