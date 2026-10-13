import { parseSpecification } from './specification'

/** 只比较能完整解析的包装快照；空值和自定义名称保留未知，不套用当前规格。 */
export function knownCodeSpecKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const spec = parseSpecification(value)
  if (!spec) return null
  // 净含量最多三位小数，先转整数再换单位，避免浮点尾差误判等价规格。
  let amount = Math.round(spec.net * 1000)
  let dimension = spec.unit
  if (spec.unit === '毫升' || spec.unit === '升') {
    dimension = '体积'
    if (spec.unit === '升') amount *= 1000
  } else if (spec.unit === '克' || spec.unit === '千克') {
    dimension = '质量'
    if (spec.unit === '千克') amount *= 1000
  }
  return JSON.stringify([dimension, amount, spec.pack, spec.quantity])
}

/** 无冲突仅表示未发现已知规格矛盾，不能证明未知历史包装与其他码相同。 */
export function assertCodeSpecCompatibility(values: readonly unknown[]): void {
  let known: string | null = null
  for (const value of values) {
    const key = knownCodeSpecKey(value)
    if (key === null) continue
    if (known !== null && known !== key) throw new Error('领用码存在不同的已知包装规格，不能混入同一生产任务')
    known = key
  }
}
