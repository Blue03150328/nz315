<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '导入报告' })
const page = ref(1)
const { data, error, pending, refresh } = await useFetch<any>('/api/admin/import-reports', { query: computed(() => ({ page: page.value })) })
const states: Record<string, string> = { pending: '等待处理或重试', completed: '已完成', failed: '未完成入库' }
</script>
<template>
  <div class="space-y-4">
    <h1 class="b-page-title">导入报告</h1>
    <p class="b-page-desc">保存每次导入结果，失败明细保留原始文件行号；旧导入没有报告。</p>
    <div v-if="error" class="b-card b-card-body">报告加载失败。<UButton @click="refresh()">重试</UButton></div>
    <div v-else class="b-card b-scroll-x">
      <table class="b-table"><thead><tr><th>文件</th><th>企业</th><th>状态</th><th>时间</th><th>操作</th></tr></thead>
        <tbody><tr v-for="row in data?.rows" :key="row.id"><td>{{ row.file_name }}</td><td>{{ row.enterprise_name }}</td><td>{{ states[row.state] || '待核实' }}</td><td>{{ String(row.created_at).slice(0, 19) }}</td><td><NuxtLink :to="'/admin/import-reports/' + row.id" class="text-primary underline">查看报告</NuxtLink></td></tr>
          <tr v-if="!pending && !data?.rows?.length"><td colspan="5" class="b-empty">暂无导入报告，上传完成后会自动保存。</td></tr></tbody>
      </table>
      <div class="b-pager"><span>共 {{ data?.total || 0 }} 份</span><div class="flex gap-2"><UButton :disabled="page <= 1" @click="page--">上一页</UButton><UButton :disabled="page * 20 >= (data?.total || 0)" @click="page++">下一页</UButton></div></div>
    </div>
  </div>
</template>
