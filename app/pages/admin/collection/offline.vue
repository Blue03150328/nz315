<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'backend-guard', keepalive: true })
useHead({ title: '离线生产记录导入' })
const { canWrite } = useUser()
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div><h1 class="b-page-title">离线生产记录导入</h1><p class="b-page-desc">导入扫描仪导出的完整 TXT 生产记录。</p></div>
      <UButton to="/admin/collection" color="neutral" variant="outline" icon="i-lucide-arrow-left">返回追溯码上传</UButton>
    </div>
    <OfflineProductionImport v-if="canWrite" />
    <div v-else class="b-note"><p class="b-note-text">当前账号为只读账号，不能导入生产记录。</p></div>
  </div>
</template>
