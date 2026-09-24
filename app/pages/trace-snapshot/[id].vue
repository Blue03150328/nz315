<script setup lang="ts">
import type { SourceSnapshot } from '#shared/types/source-snapshot'
const route = useRoute()
const { data, error } = await useFetch<SourceSnapshot>('/api/trace-snapshots/' + encodeURIComponent(String(route.params.id)))
useHead({ title: '历史查询快照 - 农资315', meta: [{ name: 'robots', content: 'noindex' }] })
</script>
<template>
  <div class="mx-auto max-w-2xl pb-8"><PageHeader title="历史查询快照" :show-back="true" /><div class="p-4"><p v-if="error" class="text-sm text-muted">快照不存在或暂时无法读取，请稍后重试。</p><TraceSourceSnapshot v-else-if="data" :snapshot="data" historical /></div></div>
</template>
