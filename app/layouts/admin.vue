<script setup lang="ts">
// 后台布局：左侧深色导航（复用 B 端令牌）+ 右侧内容区
// 菜单按角色渲染，只显示已经实现的模块。
// 路由高亮说明：数据概览（/admin 根路径）仅精确匹配当前路由；其余模块按前缀匹配，
// 否则 /admin 前缀会吞掉全部 /admin/* 子路由，导致数据概览永远高亮
const route = useRoute()
const router = useRouter()
const toast = useToast()
const { user, roleLabel, logout, canWrite, clearLocalSession } = useUser()

// 后台停留期间检查会话；接口权限每次请求都校验，此检查负责及时清页面和提示。
let sessionTimer: ReturnType<typeof setInterval> | undefined
let checkingSession = false
let sessionMonitorActive = false
async function checkSession() {
  if (!sessionMonitorActive || checkingSession || document.hidden || !user.value) return
  checkingSession = true
  try {
    const result = await $fetch<{ user: unknown; sessionInvalidated: boolean }>('/api/auth/me')
    if (!sessionMonitorActive || result.user || !route.path.startsWith('/admin')) return
    const redirect = route.fullPath
    clearLocalSession()
    await router.replace({ path: '/login', query: { redirect, reason: result.sessionInvalidated ? 'session-invalidated' : 'session-expired' } })
  } catch {
    // 暂时断网或服务失败不能当作账号被挤下线，恢复连接后继续检查。
  } finally {
    checkingSession = false
  }
}
onMounted(() => {
  sessionMonitorActive = true
  void checkSession()
  sessionTimer = setInterval(checkSession, 15000)
  window.addEventListener('focus', checkSession)
  document.addEventListener('visibilitychange', checkSession)
})
onBeforeUnmount(() => {
  sessionMonitorActive = false
  clearInterval(sessionTimer)
  window.removeEventListener('focus', checkSession)
  document.removeEventListener('visibilitychange', checkSession)
})

// 已实现菜单（可点击）：展示顺序与文案按用户指定，路径/图标/权限不随排序改动
// writeOnly：纯写流程页面（只读账号看进去只剩空白，直接在菜单层隐藏，2026-09-19）
const MENU_READY: { path: string; label: string; icon: string; writeOnly?: boolean; platformOnly?: boolean }[] = [
  { path: '/admin', label: '数据概览', icon: 'i-lucide-layout-dashboard' },
  { path: '/admin/products', label: '产品管理', icon: 'i-lucide-package' },
  { path: '/admin/specs', label: '规格管理', icon: 'i-lucide-ruler' },
  { path: '/admin/generator', label: '追溯码生成', icon: 'i-lucide-wand-2', writeOnly: true },
  { path: '/admin/collection', label: '追溯码上传', icon: 'i-lucide-factory', writeOnly: true },
  { path: '/admin/codes', label: '码库管理', icon: 'i-lucide-qr-code' },
  { path: '/admin/batches', label: '效期预警', icon: 'i-lucide-boxes' },
  { path: '/admin/statistics', label: '扫码统计', icon: 'i-lucide-bar-chart-3' },
  { path: '/admin/alerts', label: '风险预警', icon: 'i-lucide-shield-alert' },
  { path: '/admin/external-verify', label: '外部二维码核验', icon: 'i-lucide-scan-line', writeOnly: true },
  { path: '/admin/source-snapshots', label: '外页历史快照', icon: 'i-lucide-history', platformOnly: true },
  { path: '/admin/messages', label: '消息中心', icon: 'i-lucide-bell' },
  { path: '/admin/settings', label: '系统设置', icon: 'i-lucide-settings' },
]

/** 按角色可见菜单：只读账号隐藏纯写流程条目 */
const visibleMenu = computed(() => MENU_READY.filter(item => (!item.platformOnly || user.value?.role === 'platform_admin') && (canWrite.value || !item.writeOnly)))

const isActive = (path: string) => {
  // 根路径菜单（数据概览）：仅当前路由恰为该路径时高亮
  if (path === '/admin') return route.path === '/admin'
  // 子路径菜单：精确命中或位于其下级路由时高亮
  return route.path === path || route.path.startsWith(path + '/')
}

const onLogout = async () => {
  await logout() // logout() 内已清 Nuxt 数据缓存（clearNuxtData），防切换账号串数据
  toast.add({ title: '已退出登录', color: 'success' })
  // 登录页为 layout: false：admin → 无布局切换会使 NuxtPage 卸载重建，
  // 全部业务页 Keep-Alive 缓存实例随之销毁（内存级缓存，不留任何用户页面数据）
  await router.push('/login')
}
</script>

<template>
  <div class="flex min-h-screen bg-[var(--b-fill)]">
    <!-- 左侧深色导航栏 -->
    <aside class="fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-[var(--b-sider-bg)] text-white">
      <div class="border-b border-white/10 px-6 py-5">
        <div class="text-base font-bold tracking-wide">农资315</div>
        <div class="mt-0.5 truncate text-xs text-white/60">追溯码管理平台</div>
      </div>

      <nav class="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        <div v-for="item in visibleMenu" :key="item.path" class="mb-1">
          <NuxtLink
            :to="item.path"
            class="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors"
            :class="isActive(item.path) ? 'bg-[var(--b-sider-active-bg)] font-medium text-[var(--b-sider-active-text)]' : 'text-white/75 hover:bg-white/10 hover:text-white'"
          >
            <UIcon :name="item.icon" class="h-4.5 w-4.5 shrink-0" />
            {{ item.label }}
          </NuxtLink>
        </div>

      </nav>

      <div class="border-t border-white/10 px-4 py-4">
        <div class="flex items-center gap-2.5">
          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-bold">
            {{ (user?.name || '用').slice(0, 1) }}
          </div>
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium">{{ user?.name || user?.username || '未登录' }}</div>
            <div class="text-xs text-white/60">{{ roleLabel }}</div>
          </div>
        </div>
        <div class="mt-3 flex gap-2">
          <NuxtLink to="/" class="flex-1 rounded-lg bg-white/10 px-3 py-2 text-center text-xs transition-colors hover:bg-white/20">
            门户首页
          </NuxtLink>
          <button class="flex-1 cursor-pointer rounded-lg bg-white/10 px-3 py-2 text-xs transition-colors hover:bg-white/20" @click="onLogout">
            退出登录
          </button>
        </div>
      </div>
    </aside>

    <!-- 右侧内容区 -->
    <div class="ml-60 min-w-0 flex-1">
      <!-- 内容区：放宽容器适配 PC 大屏（企业后台信息密度），批量操作条吸底依赖此处 px-8 -->
      <main class="mx-auto max-w-[1600px] px-8 py-8">
        <!-- 只读账号提示条（2026-09-19）：写入口已按角色全部隐藏，此处统一说明，避免用户以为"功能丢了" -->
        <div v-if="!canWrite" class="mb-4 rounded-lg border border-border bg-warning-soft px-4 py-2.5 text-sm text-default">
          当前为<strong>只读账号</strong>，仅可查看数据，新增/修改/删除等操作入口已隐藏。如需写权限，请联系厂家主账号或平台管理员开通。
        </div>
        <slot />
      </main>
    </div>
  </div>
</template>
