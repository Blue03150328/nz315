// 登记资料库（pesticide_reg）兜底比对 —— 公众端「扫到非本平台追溯码」时用
//
// 背景：消费者扫到的绝大多数码不是本平台签发的（别的追溯平台 / 别的企业自建系统）。
// 只回一句「未查询到」等于什么都没告诉他，而 32 位单元识别代码是全国统一结构，
// 前 8 位（类别 + 登记证后六位 + 生产类型）可以直接拿去「国家农药登记资料库」比对：
//   命中 → 把登记资料（名称 / 持有人 / 登记证号 / 剂型 / 毒性 / 有效期 / 原药）摆出来供核对
//
// ⚠️ 边界（必须与前端文案一致，不能越界）：
//   1. 登记资料命中 **不能证明产品是正品** —— 假货完全可以印一个真实存在的登记证号；
//   2. 生产日期 / 生产批次 **登记库里没有**，只能来自包装标签实物或该码所属平台；
//   3. 本模块只读，不写 scan_log、不触发风险预警（不是本平台的码，不该污染本平台统计）。
import { query } from './db'
import { regCategoryOf } from './regdata'
import { parseUnitCode } from '#shared/utils/unit-code'
import type { ExternalCodeParts } from '#shared/types/external-verification'

/** 登记资料库里的原药（母药）来源（1049 六项中的两项：原药登记证号 + 原药生产企业名称） */
export interface RegistryOriginal {
  regNo: string
  productName: string
  company: string
  ingredient: string
}

/** 登记资料库比对到的候选登记证（通常 1 条；后六位撞车时可能多条） */
export interface RegistryCandidate {
  registrationNo: string
  productName: string
  commodityName: string
  trademark: string
  holderName: string
  formulation: string
  toxicity: string
  content: string
  ingredientMain: string
  expireDate: string
  expired: boolean
  originals: RegistryOriginal[]
}

export interface RegistryLookupResult {
  codeParts: ExternalCodeParts
  candidates: RegistryCandidate[]
}

/** 登记资料库裸扫描行（`findRegistryRowsByUnitCode` 的返回，字段即 SELECT 列表） */
export interface RegistryScanRow {
  registration_no: string
  product_name?: string | null
  commodity_name?: string | null
  trademark?: string | null
  content?: string | null
  dosage?: string | null
  toxicity?: string | null
  company?: string | null
  ingredient_main?: string | null
  expire_date?: string | null
}

const MAX_CANDIDATES = 5        // 后端核验页 / 公众端最多展示条数（过滤后截断）
const MAX_ROW_SCAN = 20         // SQL 侧取数上限（⚠️ 加在**类别过滤之前**，管的是「仅按后六位」的桶大小）
const CACHE_MAX = 500           // 进程内缓存条数上限
const CACHE_TTL_MS = 10 * 60 * 1000

const cache = new Map<string, { at: number; value: RegistryLookupResult }>()

/**
 * 按 32 位码前 8 位中的「登记证后六位」取登记资料库候选行，并**按码第 1 位的类别过滤**。
 *
 * 🔴 本函数是「后六位 + 类别过滤」这套口径的**唯一实现**，两个调用方共用：
 *    · 公众端扫码兜底 —— 本文件 `queryRegistry`（/api/trace 未命中本平台码时）
 *    · 后台外部二维码核验 —— external-verification.ts 的 `verifyExternalCode`
 *    2026-09-24 收口：此前两边各写了一遍同样的 SQL 与同样的 `regCategoryOf` 过滤，
 *    只差在「有没有 LIMIT / 有没有缓存 / 映射成什么形状」。同款「一处改、另一处忘」的
 *    教训见 shared/utils/unit-code.ts 与 shared/utils/trace-code.ts 的文件头。
 *
 * 口径要点（改这里就是同时改两端，务必想清楚）：
 *   ① `RIGHT(registration_no, 6)` **不可用索引**（实测 9.7 万行全扫 26–32ms）；
 *   ② 同一后六位在库里会撞车，且**可能跨类别** —— 实测 **4,389** 个后六位同时对应
 *      PD 类与 WP 类的登记证 ⇒ 类别过滤不是可选项，缺了必然误配（拿 WP 的证去比 PD 的码）；
 *   ③ `LIMIT MAX_ROW_SCAN` 加在**类别过滤之前**，故它管的是「仅按后六位」的桶。实测该桶
 *      最大 = **6 条**（后六位 `3-2000`；分布 1条:66776 / 2条:9096 / 3条:3174 / 4条:720 /
 *      5条:19 / 6条:1）⇒ 20 条有 3 倍余量，**当前数据下零截断**。若将来导入的登记库让某个
 *      后六位桶超过 20 条，本函数会在类别过滤前丢行 ⇒ 上下限必须一起上调，否则核验会漏候选。
 *   ④ `ORDER BY registration_no` 让返回**确定**：此前无排序，同桶多行「谁在前」由 MySQL 随机决定
 *      （仅影响展示顺序，不影响 M7 的 `.find` 匹配；桶 ≤6 条时也不影响集合）。
 *
 * @param codeParts `parseUnitCode` 解析结果（只用 `registrationLast6` 与 `categoryCode`）
 * @returns 类别匹配的候选行（**未截断**，截断由调用方按各自展示口径决定）
 */
export async function findRegistryRowsByUnitCode(codeParts: ExternalCodeParts): Promise<RegistryScanRow[]> {
  // 与 M7 收口前的守卫完全一致（那边是 `registrationLast6 && validCategory`）；
  // ⚠️ 刻意**不**在此要求 `validLength` —— 公众端在调用前已自行判过（见 queryRegistry），
  //    两处都不加会让「≥32 位」这条约束失效。
  if (!codeParts.validCategory || !codeParts.registrationLast6) return []
  const rows = await query<RegistryScanRow[]>(
    `SELECT registration_no, product_name, commodity_name, trademark, content, dosage, toxicity, company, ingredient_main, expire_date
       FROM pesticide_reg WHERE RIGHT(registration_no, 6) = ?
      ORDER BY registration_no LIMIT ?`,
    [codeParts.registrationLast6, MAX_ROW_SCAN])
  // 登记证类别必须与码第 1 位一致（1=PD 类 / 2=WP 类），否则是别的类别撞了后六位
  return rows.filter(r => regCategoryOf(String(r.registration_no)) === Number(codeParts.categoryCode))
}

/**
 * 登记资料库兜底比对（带进程内小缓存）。
 * 为什么要缓存：`RIGHT(registration_no, 6) = ?` 不可用索引（实测本机 26-32ms / 次，覆盖索引全扫），
 * 同一个码被反复扫（或有人拿随机 32 位码刷接口）时不该每次全扫一遍 —— 结果对该码是确定值。
 */
export async function lookupRegistryByCode(code: string): Promise<RegistryLookupResult> {
  const hit = cache.get(code)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value
  const value = await queryRegistry(code)
  // 超出上限时丢弃最早插入的一半（扫码场景不追求严格 LRU 命中率，避免引入额外依赖）
  if (cache.size >= CACHE_MAX) {
    let removed = 0
    for (const key of cache.keys()) {
      cache.delete(key)
      if (++removed >= Math.floor(CACHE_MAX / 2)) break
    }
  }
  cache.set(code, { at: Date.now(), value })
  return value
}

async function queryRegistry(code: string): Promise<RegistryLookupResult> {
  const codeParts = parseUnitCode(code)
  // 前 8 位结构本身不成立（第 1 位不是 1/2、或不足 32 位）→ 登记库无从比对
  if (!codeParts.validLength || !codeParts.validCategory || !codeParts.registrationLast6) {
    return { codeParts, candidates: [] }
  }
  // 取数与「后六位 + 类别」过滤统一走共用原语（与后台外部核验 external-verification.ts 同一实现）
  const rows = await findRegistryRowsByUnitCode(codeParts)
  const today = new Date().toISOString().slice(0, 10)
  const candidates: RegistryCandidate[] = rows
    .slice(0, MAX_CANDIDATES)
    .map(r => ({
      registrationNo: String(r.registration_no),
      productName: String(r.product_name || ''),
      commodityName: String(r.commodity_name || ''),
      trademark: String(r.trademark || ''),
      holderName: String(r.company || ''),
      formulation: String(r.dosage || ''),
      toxicity: String(r.toxicity || ''),
      content: String(r.content || ''),
      ingredientMain: String(r.ingredient_main || ''),
      expireDate: r.expire_date ? String(r.expire_date).slice(0, 10) : '',
      expired: Boolean(r.expire_date) && String(r.expire_date).slice(0, 10) < today,
      originals: [] as RegistryOriginal[],
    }))
  // 原药实际来源只能来自厂家声明，禁止用同成分候选推导。
  return { codeParts, candidates }
}

