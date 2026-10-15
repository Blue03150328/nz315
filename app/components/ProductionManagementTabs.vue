<script setup lang="ts">
const route=useRoute()
const lines=computed(()=>route.path.endsWith('/lines'))
</script>
<template><div class="flex flex-wrap gap-3" aria-label="生产管理页面">
 <UButton :variant="lines?'solid':'outline'" to="/admin/production-tasks/lines">生产线管理</UButton>
 <UButton :variant="!lines?'solid':'outline'" to="/admin/production-tasks/records">生产任务</UButton>
</div></template>
