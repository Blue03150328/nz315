<script setup lang="ts">
const route=useRoute()
const lines=computed(()=>route.path.endsWith('/lines'))
const devices=computed(()=>route.path.endsWith('/devices'))
const {canManageUsers}=useUser()
</script>
<template><div class="flex flex-wrap gap-3" aria-label="生产管理页面">
 <UButton :variant="lines?'solid':'outline'" to="/admin/production-tasks/lines">生产线管理</UButton>
 <UButton :variant="!lines&&!devices?'solid':'outline'" to="/admin/production-tasks/records">生产任务</UButton>
 <UButton v-if="canManageUsers" :variant="devices?'solid':'outline'" to="/admin/production-tasks/devices">扫描仪管理</UButton>
</div></template>
