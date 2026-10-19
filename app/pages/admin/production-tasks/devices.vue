<script setup lang="ts">
definePageMeta({layout:'admin',middleware:'backend-guard',keepalive:true})
useHead({title:'生产管理 · 扫描仪管理'})
const {canManageUsers}=useUser()
</script>
<template><div class="production-device-page"><ProductionManagementTabs /><ProductionDeviceManager v-if="canManageUsers" /><p v-else class="b-card p-5">仅总部管理员和厂家管理员可管理扫描仪。</p></div></template>
<style scoped>.production-device-page{display:flex;flex-direction:column;flex:1;min-height:0;gap:12px;font-size:14px}</style>
