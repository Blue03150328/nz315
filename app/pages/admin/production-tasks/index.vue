<script setup lang="ts">
definePageMeta({layout:'admin',middleware:['backend-guard','external-history']})
const route=useRoute()
await navigateTo({path:'/admin/production-tasks/lines',query:route.query},{replace:true})
</script>
<template><div /></template>
