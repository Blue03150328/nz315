<script setup lang="ts">
// 全宽布局：用于「附近农资店」等需要整屏沉浸式体验的页面
// 与 default 的区别：不做 480px 移动壳、不做 PC 居中限宽、不渲染 PC 顶部导航与手机底部导航，
// 页面自身负责顶栏与全屏区块（该布局只贡献最外层背景与内容插槽）
</script>

<template>
  <div class="min-h-dvh">
    <slot />
  </div>
</template>
