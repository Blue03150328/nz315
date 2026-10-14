<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '外部生产任务' })
</script>

<template><ExternalCollectionList mode="tasks" /></template>
