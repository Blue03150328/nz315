// 旧外部采集入口统一转到外部码库，保留批次、工号和日期等查询条件。
export default defineNuxtRouteMiddleware(to => {
  if (to.query.view !== 'external-history') return
  const { view, ...query } = to.query
  return navigateTo({ path: '/admin/codes', query: { ...query, source: 'external' } }, { replace: true })
})
