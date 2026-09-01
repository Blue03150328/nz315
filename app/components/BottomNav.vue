<script setup lang="ts">
const route = useRoute()
const toast = useToast()

// 当前已实现页面（新增入口前须确认后端已有对应实现）
const NAV = [
  { path: '/', label: '首页', icon: 'i-lucide-home', action: 'link' },
  { path: '/q/', label: '扫码查询', icon: 'i-lucide-scan-search', action: 'scan' },
  { path: '/profile', label: '我的', icon: 'i-lucide-user-round', action: 'link' },
]

const isActive = (path: string) => {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}

// 扫码查询入口：手机无相机权限时聚焦首页输入框，引导手动输入（与参考首页交互一致）
const handleScanTap = () => {
  const input = document.getElementById('trace-input')
  if (input) {
    input.focus()
    input.scrollIntoView({ behavior: 'smooth', block: 'center' })
    toast.add({ title: '请扫描瓶身二维码，或手动输入32位追溯码', color: 'primary' })
  } else {
    toast.add({ title: '请在首页输入32位追溯码查询', color: 'primary' })
  }
}
</script>

<template>
  <nav
    class="fixed bottom-0 left-1/2 z-50 w-full max-w-[480px] -translate-x-1/2 border-t border-border bg-elevated/95 backdrop-blur-md lg:hidden"
  >
    <!-- 按 NAV 声明顺序统一渲染，链接与操作按钮混排（扫码为操作而非路由，需保持居中位置） -->
    <div class="grid" :style="{ gridTemplateColumns: 'repeat(' + NAV.length + ', minmax(0, 1fr))' }">
      <template v-for="item in NAV" :key="item.path">
        <NuxtLink
          v-if="item.action === 'link'"
          :to="item.path"
          class="flex flex-col items-center justify-center gap-1 py-2.5 text-xs transition-colors"
          :class="isActive(item.path) ? 'text-primary' : 'text-muted hover:text-default'"
        >
          <UIcon :name="item.icon" class="h-6 w-6" />
          <span class="text-sm font-medium">{{ item.label }}</span>
        </NuxtLink>
        <button
          v-else
          type="button"
          class="flex flex-col items-center justify-center gap-1 py-2.5 text-xs transition-colors"
          :class="route.path.startsWith(item.path) ? 'text-primary' : 'text-muted hover:text-default'"
          @click="handleScanTap"
        >
          <UIcon :name="item.icon" class="h-6 w-6" />
          <span class="text-sm font-medium">{{ item.label }}</span>
        </button>
      </template>
    </div>
    <div class="h-[env(safe-area-inset-bottom)]" />
  </nav>
</template>
