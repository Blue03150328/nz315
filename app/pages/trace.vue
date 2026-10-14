<script setup lang="ts">
import type { TraceOutcome } from '#shared/types/trace'

const route = useRoute()
const code = String(route.query.code || '')
// 直接打开瓶身扫码网址时按配置的网站入口识别；扫码及手输入口显式保留原文。
const source = String(route.query.source || (String(useRuntimeConfig().public.traceBaseUrl) + encodeURIComponent(code)))

// SSR 阶段即完成查询，首屏直接呈现结果（扫码场景秒开）
const traceQuery = new URLSearchParams({ code })
if (source) traceQuery.set('source', source)
const { data, error } = await useFetch<TraceOutcome>(`/api/trace?${traceQuery.toString()}`, {
  key: 'trace-' + code + '-' + source,
})

useHead({
  title: code ? `追溯查询 - ${code.slice(0, 8)}...` : '农药追溯查询',
})
</script>

<template>
  <div v-if="error" class="p-6">
    <PageHeader title="查询失败" :show-back="true" back-to="/" />
    <div class="mt-10 text-center text-sm text-muted">
      查询服务暂时不可用，请稍后重试
    </div>
  </div>
  <div v-else-if="data">
    <TraceResult v-if="data.resultType === 'genuine'" :outcome="data" />
    <TraceExternal v-else-if="data.resultType === 'external-reg'" :outcome="data" />
    <TraceInternalPending v-else-if="data.resultType === 'internal-pending'" :outcome="data" />
    <TraceNotFound v-else-if="data.resultType === 'not-found'" :outcome="data" />
    <TraceAlert v-else :outcome="data" />
  </div>
  <div v-else class="flex min-h-[50vh] items-center justify-center">
    <UIcon name="i-lucide-loader-circle" class="h-8 w-8 animate-spin text-primary" />
  </div>
</template>
