<script setup lang="ts">
// PC 顶部导航（lg+ 显示；手机端由 BottomNav 承担）
const route = useRoute()

// 当前已实现页面（新增入口前须确认后端已有对应实现）
const MENU = [
  { path: '/', label: '首页' },
  { path: '/profile', label: '个人中心' },
]

const isActive = (path: string) => (path === '/' ? route.path === '/' : route.path.startsWith(path))
</script>

<template>
  <header class="sticky top-0 z-50 hidden border-b border-border bg-elevated/90 backdrop-blur-md lg:block">
    <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-8">
      <!-- Logo -->
      <NuxtLink to="/" class="flex items-center gap-2">
        <span class="relative flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white">
          <UIcon name="i-lucide-leaf" class="h-5 w-5" />
          <span class="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-brown ring-2 ring-default" />
        </span>
        <div class="leading-tight">
          <div class="text-lg font-bold text-default">农资315</div>
        </div>
      </NuxtLink>

      <!-- 菜单 -->
      <nav class="flex items-center gap-1">
        <NuxtLink
          v-for="item in MENU"
          :key="item.path"
          :to="item.path"
          class="relative rounded-lg px-3 py-2 text-sm transition-colors"
          :class="isActive(item.path) ? 'bg-primary/10 font-medium text-primary' : 'text-muted hover:bg-muted hover:text-default'"
        >
          {{ item.label }}
          <span v-if="isActive(item.path)" class="absolute inset-x-3 -bottom-[1px] h-0.5 rounded-full bg-primary" />
        </NuxtLink>
      </nav>

      <!-- 右侧：登录态（登录页待后端需求确认后实现） -->
      <div class="flex items-center gap-3">
        <div class="text-sm text-muted">农药追溯查询平台</div>
      </div>
    </div>
  </header>
</template>