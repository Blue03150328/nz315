// 用户登录态 composable（全项目唯一入口）
// 角色：platform_admin（总部管理员）/ enterprise_admin（厂家主账号）/ code_admin（码管理员）/ viewer（只读）
export function useUser() {
  const user = useState<any>('nz315-user', () => null)

  const { pending, refresh, clear } = useFetch<any>('/api/auth/me', {
    key: 'nz315-user-me',
    immediate: true,
    transform: (res) => {
      user.value = res?.user ?? null
      return res
    },
  })

  const isLoggedIn = computed(() => !!user.value)
  const isBackendUser = computed(() => !!user.value && ['platform_admin', 'enterprise_admin', 'code_admin', 'viewer'].includes(user.value.role))
  const isPlatformAdmin = computed(() => user.value?.role === 'platform_admin')
  const isEnterpriseAdmin = computed(() => user.value?.role === 'enterprise_admin')
  // 写权限（2026-09-19 与后端 requireWritableUser 对齐）：只读账号（viewer）前端隐藏全部写入口，
  // 避免"看得到按钮、点了吃 403"的割裂体验
  const canWrite = computed(() => !!user.value && user.value.role !== 'viewer')
  // 用户管理 / 企业信息编辑（与后端 users 三件套的角色白名单对齐）：仅总部管理员与厂家主账号
  const canManageUsers = computed(() => !!user.value && ['platform_admin', 'enterprise_admin'].includes(user.value.role))
  const isPending = computed(() => pending.value)

  /** 角色中文名 */
  const roleLabel = computed(() => {
    const map: Record<string, string> = {
      platform_admin: '总部管理员',
      enterprise_admin: '厂家主账号',
      code_admin: '码管理员',
      viewer: '只读账号',
    }
    return map[user.value?.role || ''] || ''
  })

  /** 账号密码登录：成功返回 true；失败抛 Error（中文提示） */
  async function loginWithPassword(username: string, password: string): Promise<true> {
    let loginUser: any = null
    try {
      const res = await $fetch<any>('/api/auth/login', { method: 'POST', body: { username, password } })
      loginUser = res?.user ?? null
    } catch (e: any) {
      throw new Error(e?.data?.statusMessage || '登录失败，请稍后重试')
    }
    try {
      await refresh()
    } catch (e: any) {
      // 刷新失败时回填登录响应中的用户信息，避免"登录成功却被弹回登录页"
      console.warn('[auth] 登录成功但用户态刷新失败，回填登录响应：', e?.message || e)
      user.value = loginUser
    }
    return true
  }

  /** 退出登录：无论接口成败，finally 中强制清本地态 */
  async function logout(): Promise<void> {
    try {
      await $fetch('/api/auth/logout', { method: 'POST' })
    } catch (e: any) {
      console.warn('[auth] 退出接口调用失败，已强制清理本地登录态：', e?.message || e)
    } finally {
      user.value = null
      clear()
      // 清空全部 useFetch/useAsyncData 内存缓存（含各业务页面接口数据）：
      // 页面 Keep-Alive 实例随布局切换销毁，但 Nuxt 数据缓存不随之清除——
      // 不清会导致切换账号后，旧账号的页面数据被同 key 的 useFetch 直接复用（数据串号）
      clearNuxtData()
    }
  }

  return { user, isLoggedIn, isBackendUser, isPlatformAdmin, isEnterpriseAdmin, canWrite, canManageUsers, isPending, roleLabel, loginWithPassword, logout, refresh }
}
