<script setup lang="ts">
import type { ICompareItem } from '#shared/types/compare'

defineProps<{
  items: ICompareItem[]
  passCount?: number
  totalCount?: number
}>()
</script>

<template>
  <div class="rounded-xl border border-border bg-elevated shadow-sm">
    <div class="flex items-center justify-between border-b border-border/60 px-4 py-3">
      <div class="flex items-center gap-2 text-sm font-semibold text-default">
        <UIcon name="i-lucide-badge-check" class="h-4 w-4 text-primary" />
        登记证数据库比对
      </div>
      <UBadge v-if="passCount !== undefined" color="neutral" variant="subtle">
        {{ passCount }}/{{ totalCount }} 项通过
      </UBadge>
    </div>
    <div class="divide-y divide-border/60">
      <div
        v-for="item in items"
        :key="item.key"
        class="flex items-start justify-between gap-3 px-4 py-3 text-sm"
      >
        <div class="min-w-0 flex-1">
          <div class="font-medium text-default">{{ item.label }}</div>
          <div class="mt-0.5 text-xs text-muted">
            {{ item.description }}
          </div>
          <div v-if="item.scannedValue || item.dbValue" class="mt-1 space-y-0.5 text-xs">
            <div v-if="item.scannedValue">
              <span class="text-muted">扫码：</span>{{ item.scannedValue }}
            </div>
            <div v-if="item.dbValue">
              <span class="text-muted">库内：</span>{{ item.dbValue }}
            </div>
          </div>
        </div>
        <span
          class="mt-0.5 flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
          :class="{
            'bg-success/10 text-success': item.result === 'pass',
            'bg-error/10 text-error': item.result === 'fail',
            'bg-warning/10 text-warning': item.result === 'warning',
          }"
        >
          <UIcon
            :name="item.result === 'pass' ? 'i-lucide-check-circle-2' : item.result === 'fail' ? 'i-lucide-x-circle' : 'i-lucide-alert-circle'"
            class="h-3.5 w-3.5"
          />
          {{ item.result === 'pass' ? '一致' : item.result === 'fail' ? '不符' : '存疑' }}
        </span>
      </div>
    </div>
  </div>
</template>
