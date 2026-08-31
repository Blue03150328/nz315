<script setup lang="ts">
// 全局标题模板：页面设置 title 时追加品牌名，未设置时显示默认标题
useHead({
  titleTemplate: (t?: string) => (t ? `${t} - 农资315` : '农资315 - 农药追溯查询'),
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>