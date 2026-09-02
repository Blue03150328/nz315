<script setup lang="ts">
// 后台布局：左侧深色导航（参考风格 #283850）+ 右侧内容区
// 菜单按角色渲染；已实现模块可点击，规划中模块置灰提示
const route = useRoute()
const router = useRouter()
const toast = useToast()
const { user, roleLabel, logout } = useUser()

// 已实现菜单（可点击）
const MENU_READY = [
  { path: '/admin', label: '数据概览', icon: 'i-lucide-layout-dashboard' },
  { path: '/admin/generator', label: '追溯码生成', icon: 'i-lucide-wand-2' },
  { path: '/admin/codes', label: '码库管理', icon: 'i-lucide-qr-code' },
  { path: '/admin/boxes', label: '外箱码管理', icon: 'i-lucide-box' },
  { path: '/admin/specs', label: '产品规格管理', icon: 'i-lucide-ruler' },
  { path: '/admin/products', label: '产品管理', icon: 'i-lucide-package' },
  { path: '/admin/batches', label: '生产批次', icon: 'i-lucide-boxes' },
  { path: '/admin/collection', label: '生产采集', icon: 'i-lucide-factory' },
  { path: '/admin/statistics', label: '扫码统计', icon: 'i-lucide-bar-chart-3' },
  { path: '/admin/settings', label: '系统设置', icon: 'i-lucide-settings' },
  { path: '/admin/alerts', label: '风险预警', icon: 'i-lucide-shield-alert' },
  { path: '/admin/messages', label: '消息中心', icon: 'i-lucide-bell' },
]

// V1.0 规划菜单（模块建设中）
const MENU_PLANNED: { label: string; icon: string }[] = []

const isActive = (path: string) => route.path === path || route.path.startsWith(path + '/')

const onLogout = async () => {
  await logout()
  toast.add({ title: '已退出登录', color: 'success' })
  await router.push('/login')
}
</script>

<template>
  <div class="flex min-h-screen bg-[#f0f2f5]">
    <!-- 左侧深色导航栏 -->
    <aside class="fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-[#283850] text-white">
      <div class="border-b border-white/10 px-6 py-5">
        <div class="text-base font-bold tracking-wide">农资315</div>
        <div class="mt-0.5 truncate text-xs text-white/60">追溯码管理平台</div>
      </div>

      <nav class="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        <div v-for="item in MENU_READY" :key="item.path" class="mb-1">
          <NuxtLink
            :to="item.path"
            class="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors"
            :class="isActive(item.path) ? 'bg-[#f8f8f8] font-medium text-[#283850]' : 'text-white/75 hover:bg-white/10 hover:text-white'"
          >
            <UIcon :name="item.icon" class="h-4.5 w-4.5 shrink-0" />
            {{ item.label }}
          </NuxtLink>
        </div>

        <!-- 规划中模块：置灰不可点击 -->
        <div class="mb-1 mt-4 border-t border-white/10 pt-3">
          <div class="px-3 pb-1 text-xs text-white/40">规划中模块</div>
        </div>
        <button
          v-for="item in MENU_PLANNED"
          :key="item.label"
          type="button"
          class="flex w-full cursor-not-allowed items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-white/30"
          @click="toast.add({ title: item.label + '模块建设中，敬请期待', color: 'primary' })"
        >
          <UIcon :name="item.icon" class="h-4.5 w-4.5 shrink-0" />
          {{ item.label }}
        </button>
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
        <slot />
      </main>
    </div>
  </div>
</template>