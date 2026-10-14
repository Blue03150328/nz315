<script setup lang="ts">
definePageMeta({layout:'admin',middleware:'backend-guard'})
const route=useRoute()
await navigateTo({path:route.query.view==='external-history'?'/admin/production-tasks/records':'/admin/production-tasks/lines',query:route.query},{replace:true})
</script>
<template><div /></template>
