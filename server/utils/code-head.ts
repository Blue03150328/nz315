/** 生成与导入使用同一产品头部，不约束厂家自定义尾部。 */
export function productCodeHead(product: Record<string, any>) {
  return {
    regCategory: Number(product.reg_category ?? 1),
    regLast6: String(product.registration_no).slice(-6),
    produceType: Number(product.produce_type ?? 1),
    specCode: String(product.spec_code ?? ''),
  }
}

export function headOf(product: Record<string, any>): string {
  const h = productCodeHead(product)
  return `${h.regCategory}${h.regLast6}${h.produceType}${h.specCode}`
}
