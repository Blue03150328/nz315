import type { SourceDeclaration, SourceComparison } from '../../shared/types/source-snapshot'

// 比对保留证号连字符；企业名只做排版归一，不剥公司后缀来推断同一主体。
const norm = (s: unknown) => String(s || '').normalize('NFKC').replace(/\s/g, '').toUpperCase()
export function compareSource(source: SourceDeclaration, product: any, originals: any[]): SourceComparison[] {
  const items: SourceComparison[] = []
  const add = (label: string, sourceValue: unknown, referenceValue: unknown, reason = '与本地导入的登记资料比对') => {
    const a = String(sourceValue || ''), b = String(referenceValue || '')
    items.push({ label, sourceValue: a, referenceValue: b, status: !a || !b ? 'insufficient' : norm(a) === norm(b) ? 'match' : 'mismatch', reason: !a ? '来源页未提供' : !b ? '本地登记资料不足，不能据此认定真伪' : reason })
  }
  add('来源页单元识别码', source.pageCode, source.code, '核对来源页是否对应本次查询')
  add('完整登记证号', source.registrationNo, product?.registration_no)
  if (source.registrationNo && /^\d{32}$/.test(source.code)) {
    const suffix = source.registrationNo.slice(-6)
    const category = /^WP|^WL/i.test(source.registrationNo) ? '2' : '1'
    add('码内登记类别及后六位', source.code.slice(0, 7), category + suffix)
  }
  // 将名称中的百分比单独比对，不把含量差异吞掉。
  const percent = source.productName?.match(/(\d+(?:\.\d+)?)\s*[%％]/)?.[0]
  add('产品名称（不含百分比标注）', source.productName?.replace(/\d+(?:\.\d+)?\s*[%％]/g, ''), product?.product_name)
  add('总有效成分含量', source.content || percent, product?.content)
  add('登记证持有人', source.holderName, product?.company)
  add('剂型', source.formulation, product?.dosage)
  add('毒性', source.toxicity, product?.toxicity)
  add('全部有效成分及含量', source.ingredients, product?.ingredients)
  const ingredients = items[items.length - 1]!
  if (ingredients.status === 'mismatch') {
    // 仅忽略成分间排版分隔，不删除数字或单位；复配每个成分的含量仍须一致。
    const compact = (s: unknown) => norm(s).replace(/[、；;·]/g, '')
    if (compact(source.ingredients) === compact(product?.ingredients)) ingredients.status = 'match'
    else { ingredients.status = 'review'; ingredients.reason = '成分或含量写法存在差异，请逐项核实；未按主成分判定整项一致' }
  }
  if (product?.expire_date) items.push({ label: '登记证当前有效期', status: String(product.expire_date).slice(0, 10) < new Date().toISOString().slice(0, 10) ? 'review' : 'match', sourceValue: '', referenceValue: String(product.expire_date).slice(0, 10), reason: '登记证当前状态；不能单独据此判断历史批次是否合法' })
  items.push({ label: '生产日期及批号', status: 'review', sourceValue: [source.produceDate, source.batchNo, source.productionNote].filter(Boolean).join('；'), referenceValue: '', reason: '登记库不含批次资料，请与包装喷码核对' })
  if (source.manufacturer) items.push({ label: '实际生产企业', status: 'review', sourceValue: source.manufacturer, referenceValue: '', reason: '来源页声明；受托生产企业不与登记持有人直接混比' })
  source.originals.forEach((o, i) => {
    const r = originals.find(r => norm(r.registration_no) === norm(o.regNo))
    add(`原药${i + 1}证号`, o.regNo, r?.registration_no)
    add(`原药${i + 1}企业`, o.company, r?.company)
    add(`原药${i + 1}成分`, o.ingredient, r?.ingredient_main)
    if (r && !/原药|母药/.test(r.dosage || '')) items.push({ label: `原药${i + 1}登记剂型`, status: 'review', sourceValue: '来源页列为原药', referenceValue: r.dosage || '', reason: '该登记记录并非明确的原药/母药剂型，请核实' })
    if (r?.expire_date && String(r.expire_date).slice(0, 10) < new Date().toISOString().slice(0, 10)) items.push({ label: `原药${i + 1}登记有效期`, status: 'review', sourceValue: '', referenceValue: String(r.expire_date).slice(0, 10), reason: '登记证当前已到期，请结合实际生产日期核实' })
  })
  return items
}
