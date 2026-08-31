<script setup lang="ts">
// 旧路径兼容：/q/:code → /trace?code=（PRD 3.3 追溯 URL 官方格式）
const route = useRoute()
const code = String(route.params.code || '')
await navigateTo('/trace?code=' + encodeURIComponent(code), { redirectCode: 302 })
</script>

<template>
  <div class="flex min-h-[50vh] items-center justify-center">
    <UIcon name="i-lucide-loader-circle" class="h-8 w-8 animate-spin text-primary" />
  </div>
</template>
