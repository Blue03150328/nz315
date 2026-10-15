<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
const route=useRoute()
const {view,...query}=route.query
await navigateTo({path:'/admin/codes',query:{...query,source:'external'}},{replace:true})
</script>
<template><div /></template>
