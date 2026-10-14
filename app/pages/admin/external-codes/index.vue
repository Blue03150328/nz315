<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '外部码库管理' })
</script>

<template><ExternalCollectionList mode="codes" /></template>
