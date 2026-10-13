/** 数量一律展示精确整数（千分位 + 「张」），不做「万」位换算；业务计算始终使用精确整数。 */
export function formatCodeQuantity(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isSafeInteger(value) || value < 0) return '待统计'
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '张'
}
