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
import { regCategoryOf, findOriginalCandidates } from './regdata'
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

const MAX_CANDIDATES = 5        // 后六位多候选时最多返回条数（前端逐条展示）
const MAX_ROW_SCAN = 20         // SQL 侧预取上限（先按类别过滤再截断）
const MAX_ORIGINAL_LOOKUP = 3   // 候选多于这个数就不再逐个查原药信息（避免 N+1 查询）
const CACHE_MAX = 500           // 进程内缓存条数上限
const CACHE_TTL_MS = 10 * 60 * 1000

const cache = new Map<string, { at: number; value: RegistryLookupResult }>()

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
  // 前 8 位结构本身不成立（第 1 位不是 1/2 等）→ 登记库无从比对
  if (!codeParts.validLength || !codeParts.validCategory || !codeParts.registrationLast6) {
    return { codeParts, candidates: [] }
  }
  const rows = await query<any[]>(
    `SELECT registration_no, product_name, commodity_name, trademark, content, dosage, toxicity, company, ingredient_main, expire_date
       FROM pesticide_reg WHERE RIGHT(registration_no, 6) = ? LIMIT ?`,
    [codeParts.registrationLast6, MAX_ROW_SCAN])
  const today = new Date().toISOString().slice(0, 10)
  const candidates: RegistryCandidate[] = rows
    // 登记证类别必须与码第 1 位一致（1=PD 类 / 2=WP 类），否则是别的类别撞了后六位
    .filter(r => regCategoryOf(String(r.registration_no)) === Number(codeParts.categoryCode))
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
  // 原药（母药）信息：制剂按有效成分去登记库找有效期内的原药/母药；命中多条时最多留 3 条
  if (candidates.length && candidates.length <= MAX_ORIGINAL_LOOKUP) {
    for (const c of candidates) c.originals = await lookupOriginals(c.registrationNo)
  }
  return { codeParts, candidates }
}

/** 取某登记证的原药（母药）来源：登记证号 + 生产企业名称 + 有效成分（失败不抛错，原药信息属增强项） */
async function lookupOriginals(registrationNo: string): Promise<RegistryOriginal[]> {
  try {
    const { reg, isOriginal, candidates } = await findOriginalCandidates(registrationNo)
    if (!reg) return []
    // 原药/母药产品自身即原药来源（原药登记证号 = 自身登记证号）
    if (isOriginal) {
      return [{
        regNo: registrationNo,
        productName: String(reg.product_name || ''),
        company: String(reg.company || ''),
        ingredient: String(reg.ingredient_main || ''),
      }]
    }
    const seen = new Set<string>()
    const out: RegistryOriginal[] = []
    for (const c of candidates as any[]) {
      const no = String(c.registration_no)
      if (seen.has(no)) continue
      seen.add(no)
      out.push({
        regNo: no,
        productName: String(c.product_name || ''),
        company: String(c.company || ''),
        ingredient: String(c.ingredient_main || ''),
      })
      if (out.length >= 3) break
    }
    return out
  } catch {
    return []
  }
}
