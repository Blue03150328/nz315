<script setup lang="ts">
import type { ImportResult } from '#shared/types/import-report'
import { adminLinks } from '#shared/utils/admin-navigation'
defineProps<{ result: ImportResult }>()
</script>
<template>
  <div class="b-card" role="status">
    <div class="b-card-head"><span class="b-card-title">本次导入结果 · {{ result.fileName }}</span></div>
    <div class="b-card-body space-y-3">
      <p v-if="result.error" class="text-sm text-error">{{ result.error }}</p>
      <p v-else class="text-sm">已处理 {{ result.total }} 条数据，忽略空行或表头 {{ result.ignored }} 行。</p>
      <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div><span class="b-help">成功入库</span><p class="text-xl font-semibold">{{ result.imported }}</p></div>
        <div><span class="b-help">重复跳过</span><p class="text-xl font-semibold">{{ result.skippedDup }}</p></div>
        <div><span class="b-help">校验拒绝</span><p class="text-xl font-semibold">{{ result.skippedInvalid }}</p></div>
        <div><span class="b-help">未写入</span><p class="text-xl font-semibold">{{ result.notWritten }}</p></div>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton :to="'/admin/import-reports/' + result.reportId" variant="outline">查看完整报告和失败明细</UButton>
        <UButton v-if="result.uploadBatchId" :to="adminLinks.uploadBatch(result.uploadBatchId)">查看本次入库批次</UButton>
      </div>
    </div>
  </div>
</template>
