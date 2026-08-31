<script setup lang="ts">
// 响应式布局：PC（lg+）顶部导航 + 内容限宽；手机保持移动壳 + 底部导航
const route = useRoute()

// 二级页面不显示导航（扫码结果页保持移动优先、无导航干扰）
const hideNav = computed(() => {
  const p = route.path
  return (
    // 扫码结果页/登录为独立场景，隐藏导航
    p.startsWith('/q/') ||
    p.startsWith('/result/') ||
    p.startsWith('/login')
  )
})
</script>

<template>
  <div class="min-h-screen bg-muted/30">
    <!-- PC 顶部导航（lg+ 显示，二级页隐藏） -->
    <AppHeader v-if="!hideNav" />

    <!-- 内容区：手机 480px 壳；PC 全宽限宽居中 -->
    <div
      class="relative mx-auto min-h-screen w-full max-w-[480px] shadow-lg lg:max-w-none lg:shadow-none"
    >
      <main class="pb-20 lg:mx-auto lg:w-full lg:max-w-6xl lg:px-8 lg:pb-10">
        <slot />
      </main>
      <!-- 手机底部导航（仅 <lg 显示） -->
      <BottomNav v-if="!hideNav" />
    </div>
  </div>
</template>
