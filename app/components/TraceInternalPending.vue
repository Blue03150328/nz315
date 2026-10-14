<script setup lang="ts">
import type { TraceOutcome } from '#shared/types/trace'
defineProps<{ outcome: TraceOutcome }>()
</script>

<template>
  <div class="space-y-4 px-4 pb-6 lg:mx-auto lg:w-full lg:max-w-2xl">
    <PageHeader title="农资315 · 内部码查询" :show-back="true" back-to="/" />
    <section class="rounded-xl border border-border bg-elevated p-5">
      <div class="flex items-center gap-2 text-lg font-semibold text-default">
        <UIcon name="i-lucide-link" class="h-5 w-5 text-primary" />
        系统内部码
      </div>
      <p class="mt-3 text-sm leading-6 text-muted">尚无生产记录</p>
      <p class="mt-2 text-sm leading-6 text-muted">已识别为农资315内部码。生产采集上传后，可查看对应产品与生产资料。</p>
      <p class="mt-2 text-xs leading-5 text-muted">网址归属不代表产品已生产或质检合格。</p>
      <div class="mt-4 border-t border-border pt-4">
        <p class="text-xs text-muted">追溯码</p>
        <p class="mt-1 break-all font-code text-sm text-default">{{ outcome.code }}</p>
      </div>
    </section>
    <TraceBillEntry :code="outcome.code" block />
    <TraceReport :code="outcome.code" block />
    <UButton to="/scan" variant="outline" color="neutral" icon="i-lucide-scan-line">继续扫码</UButton>
  </div>
</template>
