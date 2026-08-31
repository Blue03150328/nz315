// 后台访问守卫：未登录跳转登录页（带 redirect 回跳）
export default defineNuxtRouteMiddleware(async (to) => {
  const { user, isPending, refresh } = useUser()
  // 等待登录态加载完成（首屏 useFetch 未返回时 user 为 null）
  if (!user.value && isPending.value) {
    try { await refresh() } catch { /* 未登录 */ }
  }
  if (!user.value) {
    const redirect = encodeURIComponent(to.fullPath)
    return navigateTo('/login?redirect=' + redirect)
  }
})
