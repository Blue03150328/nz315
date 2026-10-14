<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
const route=useRoute()
await navigateTo({path:'/admin/codes',query:{...route.query,source:'external'}},{replace:true})
</script>
<template><div /></template>
