<script setup lang="ts">
const route = useRoute()

// 当前已实现页面（新增入口前须确认后端已有对应实现）
const NAV = [
  { path: '/', label: '首页', icon: 'i-lucide-home', action: 'link' },
  { path: '/scan', label: '扫码查询', icon: 'i-lucide-scan-search', action: 'scan' },
  { path: '/nearby-stores', label: '附近门店', icon: 'i-lucide-store', action: 'link' },
  { path: '/profile', label: '我的', icon: 'i-lucide-user-round', action: 'link' },
]

const isActive = (path: string) => {
  if (path === '/') return route.path === '/'
  // 扫码页 /scan 与查询结果页 /trace（扫码后跳转）都视为「扫码查询」高亮
  if (path === '/scan') return route.path === '/scan' || route.path.startsWith('/trace')
  return route.path.startsWith(path)
}

// 扫码查询入口：跳转 /scan 扫码页（相机实时识别 + 相册选图 + 手动输入三通道）
const handleScanTap = () => {
  navigateTo('/scan')
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
