/** 数量仅在展示时换算成万；业务计算始终使用精确整数。 */
export function formatCodeQuantity(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isSafeInteger(value) || value < 0) return '待统计'
  if (value < 100) return `${value}张`
  const amount = (Math.round(value / 100) / 100).toFixed(2).replace(/\.?0+$/, '')
  return `${value % 100 ? '约' : ''}${amount}万张`
}
