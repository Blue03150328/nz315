// 登记数据源（pesticide_reg 字典表）共享逻辑：产品表单自动回填支撑
// 表由 scripts/import-regdata.mjs 从「2026农药登记证大全2.xlsx」导入，登记证号全局唯一主键
import { query } from './db'

/**
 * 企业名称归一化：去空格与通用后缀（用于「本厂产品」判定）
 * 规则必须与 SQL 侧（regdata.get.ts 的 REPLACE 链）保持一致：
 * 依次去除 股份有限公司/有限责任公司/有限公司 后缀、半角/全角空格
 * 例：'山东绿丰生物科技有限公司' → '山东绿丰生物科技'
 */
export function normalizeOrgName(name: string): string {
  return String(name || '')
    .replace(/股份有限公司/g, '')
    .replace(/有限责任公司/g, '')
    .replace(/有限公司/g, '')
    .replace(/集团/g, '')
    .replace(/[ 　]/g, '')
    .trim()
}

/** 登记类别代码推导（32位码第1位）：数据源登记证号前缀映射 —— PD/PDN/LS/EX→1(PD类)，WP/WPN/WL→2(WP类) */
export function regCategoryOf(registrationNo: string): 1 | 2 {
  const no = String(registrationNo || '').toUpperCase()
  if (/^WP|^WL/.test(no)) return 2
  return 1
}

/**
 * 查询登记数据源中某登记证的原药候选（制剂 → 匹配剂型=原药/母药 且有效成分名一致的有效期内记录）
 * 返回：reg=数据源行（无则 null）、isOriginal=该行本身是否原药/母药剂型、candidates=有效期内原药候选
 * 原药/母药产品自身即原药（原药登记证号=自身登记证号），无候选列表
 */
export async function findOriginalCandidates(registrationNo: string) {
  const regNo = String(registrationNo || '').trim().toUpperCase()
  const [reg] = await query<any[]>(
    'SELECT registration_no, product_name, dosage, ingredient_main, company, expire_date FROM pesticide_reg WHERE registration_no = ? LIMIT 1',
    [regNo]
  )
  if (!reg) return { reg: null, isOriginal: false, candidates: [] }
  const isOriginal = /原药|母药/.test(String(reg.dosage || ''))
  if (isOriginal) return { reg, isOriginal: true, candidates: [] }
  const main = String(reg.ingredient_main || '').trim()
  if (!main) return { reg, isOriginal: false, candidates: [] }
  // 候选仅取登记证仍在有效期内的原药/母药（过期登记证不作为原药来源）
  const candidates = await query<any[]>(
    `SELECT registration_no, product_name, dosage, ingredient_main, company, expire_date
       FROM pesticide_reg
      WHERE dosage IN ('原药','母药') AND ingredient_main = ?
        AND (expire_date IS NULL OR expire_date >= CURDATE())
      ORDER BY expire_date DESC
      LIMIT 50`,
    [main]
  )
  return { reg, isOriginal, candidates }
}

/**
 * 按登记证取「全有效成分」原药候选池（原药多行 UI 用，2026-09-04）：
 * 复配制剂存在多个有效成分（ingredient_all），每个成分匹配到的有效期内原药/母药记录合并去重成池，
 * 供原药行下拉候选与双向联动；剂型=原药/母药 的产品其自身必在池内（自身成分匹配）。
 * 返回：reg=数据源行（无则 null）、isOriginal、ingredients=全部成分名、pool=合并候选池（登记证号去重）
 */
export async function findOriginalPool(registrationNo: string) {
  const regNo = String(registrationNo || '').trim().toUpperCase()
  const [reg] = await query<any[]>(
    'SELECT registration_no, product_name, dosage, ingredient_main, ingredient_all, company, expire_date FROM pesticide_reg WHERE registration_no = ? LIMIT 1',
    [regNo]
  )
  if (!reg) return { reg: null, isOriginal: false, ingredients: [] as string[], pool: [] as any[] }
  const isOriginal = /原药|母药/.test(String(reg.dosage || ''))
  // 成分清单：数据源 ingredient_all（JSON 数组）兜底主成分
  const all = Array.isArray(reg.ingredient_all) ? reg.ingredient_all : []
  const ingredients = (all.length ? all : [String(reg.ingredient_main || '').trim()]).filter(Boolean) as string[]
  if (!ingredients.length) return { reg, isOriginal, ingredients: [], pool: [] }
  const pool = await query<any[]>(
    `SELECT registration_no, product_name, dosage, ingredient_main, company, expire_date
       FROM pesticide_reg
      WHERE dosage IN ('原药','母药') AND ingredient_main IN (?)
        AND (expire_date IS NULL OR expire_date >= CURDATE())
      ORDER BY expire_date DESC
      LIMIT 200`,
    [ingredients]
  )
  // 按登记证号去重（同证只保留一条）
  const seen = new Set<string>()
  const unique = (pool as any[]).filter((r: any) => {
    if (seen.has(r.registration_no)) return false
    seen.add(r.registration_no)
    return true
  })
  return { reg, isOriginal, ingredients, pool: unique }
}

/**
 * 登记证号是否存在于国家农药登记资料库（`pesticide_reg`）。
 *
 * 用途：产品建档 / 编辑时阻断「登记证号不存在」（PRD 5.9 异常清单第 3 条「建档时阻断」）。
 * 2026-09-23 新增（缺陷清单 N1）—— 此前 `products.post.ts` 只校验**非空**与**本系统内重复**，
 * 从不查登记库 ⇒ 任意填一个格式合法但不存在的证号即可建档出码，消费者扫到「登记证号 PDxxx」
 * 而该证并不存在，且不产生任何预警（防伪主防线敞开）。
 *
 * 为什么用完整证号精确匹配（而非后六位）：
 *   ① `pesticide_reg.registration_no` 有 UNIQUE 索引 `uq_registration_no` ⇒ 单点查询，9.7 万行走索引；
 *   ② 后六位在库里会撞车（同一个后六位对应多条登记证），按后六位匹配必然误放行；
 *   ③ 实测 8,914 条老证号（`LS01317-F02-0126` 形态）是**后六位含非数字**，
 *      按完整证号匹配不受影响。
 *   ⚠️ 与 `registry-lookup.ts`（公众端外码兜底）的口径**刻意不同**：那里只能拿到后六位，
 *      故必须放宽；建档是**写库**动作，必须严格。
 */
export async function registrationExistsInRegistry(registrationNo: string): Promise<boolean> {
  const no = String(registrationNo || '').trim().toUpperCase()
  if (!no) return false
  const [row] = await query<any[]>(
    'SELECT 1 AS ok FROM pesticide_reg WHERE registration_no = ? LIMIT 1',
    [no]
  )
  return Boolean(row)
}
