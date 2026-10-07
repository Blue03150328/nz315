// 列表地址保存已应用条件；输入中的草稿只在查询时写入地址。
export function useAdminListRoute(filters: Record<string, any>, page: Ref<number>, refresh: () => unknown, numericKeys: string[] = []) {
  const route = useRoute()
  const router = useRouter()
  const path = route.path
  const defaults = { ...filters }
  const readRoute = () => {
    if (route.path !== path) return
    for (const key of Object.keys(defaults)) {
      const raw = route.query[key]
      const value = Array.isArray(raw) ? raw[0] : raw
      filters[key] = value == null || value === '' ? defaults[key] : numericKeys.includes(key) ? Number(value) : String(value)
    }
    page.value = Math.max(1, Number(route.query.page) || 1)
  }
  readRoute()
  watch(() => route.fullPath, () => { if (route.path === path) { readRoute(); refresh() } })
  const apply = async (nextPage = 1) => {
    page.value = nextPage
    const query: Record<string, string> = {}
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') query[key] = String(value)
    }
    if (page.value > 1) query.page = String(page.value)
    const previous = route.fullPath
    await router.push({ path, query })
    if (previous === route.fullPath) await refresh()
  }
  const reset = () => { Object.assign(filters, defaults); return apply() }
  return { applyListQuery: apply, resetListQuery: reset }
}
