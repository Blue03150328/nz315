<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
const page = ref(1)
const codeInput = ref('')
const code = ref('')
const { data, error } = await useFetch<{ total: number; rows: { id: string; code: string; source_url: string; created_at: string; status: string }[] }>('/api/admin/source-snapshots', { query: { page, code } })
const search = () => { page.value = 1; code.value = codeInput.value.trim() }
</script>
<template>
  <div class="space-y-4">
    <h1 class="b-page-title">外页历史快照</h1>
    <p class="text-sm text-muted">保存来源页原始内容、当次登记参考和逐项比对结果。平台管理员可按完整追溯码查找。</p>
    <form class="flex gap-3" @submit.prevent="search"><UInput v-model="codeInput" placeholder="输入32位追溯码" class="w-96" /><UButton type="submit">查询</UButton></form>
    <p v-if="error" class="text-sm text-error">查询失败：请确认平台管理员权限、码值格式和数据库迁移状态。</p>
    <div v-else class="overflow-x-auto"><table class="b-table w-full"><thead><tr><th>获取时间</th><th>追溯码</th><th>来源网址</th><th>采集状态</th><th>操作</th></tr></thead><tbody><tr v-for="row in data?.rows" :key="row.id"><td>{{ row.created_at }}</td><td class="font-mono">{{ row.code || '未识别' }}</td><td class="max-w-sm break-all">{{ row.source_url }}</td><td>{{ row.status === 'ok' ? '已获取' : row.status === 'partial' ? '待核实' : '获取失败' }}</td><td><NuxtLink :to="'/trace-snapshot/' + row.id" target="_blank" class="text-primary underline">查看快照</NuxtLink></td></tr><tr v-if="!data?.rows.length"><td colspan="5">暂无快照</td></tr></tbody></table></div>
    <div class="flex items-center gap-4"><UButton variant="outline" :disabled="page <= 1" @click="page--">上一页</UButton><span class="text-sm">第 {{ page }} 页，共 {{ data?.total || 0 }} 条</span><UButton variant="outline" :disabled="page * 20 >= (data?.total || 0)" @click="page++">下一页</UButton></div>
  </div>
</template>
