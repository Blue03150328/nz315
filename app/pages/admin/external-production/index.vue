<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
const route=useRoute()
await navigateTo({path:'/admin/production-tasks',query:{...route.query,view:'external-history'}},{replace:true})
</script>
<template><div /></template>
