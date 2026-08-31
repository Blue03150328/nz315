<script setup lang="ts">
// 码库管理：码列表查询（PRD 5.5.7：搜索/筛选/分页）
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '码库管理' })

const filters = reactive({ keyword: '', status: '', abnormalFlag: '', dateFrom: '', dateTo: '' })
const page = ref(1)
const pageSize = 20

const { data, pending, refresh, error } = await useFetch<any>('/api/admin/codes', {
  key: 'admin-codes',
  query: computed(() => ({
    keyword: filters.keyword || undefined,
    status: filters.status || undefined,
    abnormalFlag: filters.abnormalFlag || undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    page: page.value,
    pageSize,
  })),
})

const totalPages = computed(() => Math.max(1, Math.ceil((data.value?.total || 0) / pageSize)))

const flagBadge = (f: number) => {
  if (f === 1) return { cls: 'bg-warning/10 text-warning', label: '已冻结' }
  if (f === 2) return { cls: 'bg-error/10 text-error', label: '已作废' }
  return { cls: 'bg-success/10 text-success', label: '正常' }
}
const statusBadge = (s: number) => {
  if (s === 2) return { cls: 'bg-primary/10 text-primary', label: '已绑定' }
  return { cls: 'bg-sky/10 text-sky', label: '已生成' }
}

const doSearch = () => { page.value = 1; refresh() }
const resetSearch = () => {
  filters.keyword = ''; filters.status = ''; filters.abnormalFlag = ''; filters.dateFrom = ''; filters.dateTo = ''
  page.value = 1; refresh()
}
</script>

<template>
  <div class="space-y-5">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold text-default">码库管理</h1>
        <p class="mt-1 text-sm text-muted">追溯码查询、状态与异常标记管理</p>
      </div>
    </div>

    <!-- 筛选区 -->
    <div class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <UInput v-model="filters.keyword" placeholder="追溯码 / 批号 / 产品名" icon="i-lucide-search" @keyup.enter="doSearch" />
        <USelect
          v-model="filters.status"
          :options="[{ value: '', label: '全部状态' }, { value: '1', label: '已生成' }, { value: '2', label: '已绑定' }]"
          placeholder="码状态"
        />
        <USelect
          v-model="filters.abnormalFlag"
          :options="[{ value: '', label: '全部标记' }, { value: '0', label: '正常' }, { value: '1', label: '已冻结' }, { value: '2', label: '已作废' }]"
          placeholder="异常标记"
        />
        <UInput v-model="filters.dateFrom" type="date" placeholder="创建日期起" />
        <UInput v-model="filters.dateTo" type="date" placeholder="创建日期止" />
      </div>
      <div class="mt-3 flex gap-2">
        <UButton color="primary" icon="i-lucide-search" :loading="pending" @click="doSearch">查询</UButton>
        <UButton variant="outline" color="neutral" icon="i-lucide-rotate-ccw" @click="resetSearch">重置</UButton>
      </div>
    </div>

    <!-- 码列表 -->
    <div v-if="error" class="rounded-xl border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">
      码列表加载失败，请刷新重试
    </div>
    <div v-else class="overflow-hidden rounded-xl border border-border bg-elevated shadow-sm">
      <div class="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <span class="text-sm font-semibold text-default">追溯码列表</span>
        <span class="text-xs text-muted">共 {{ data?.total || 0 }} 条</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-border/60 bg-muted/30 text-xs text-muted">
              <th class="px-4 py-3 font-medium">追溯码</th>
              <th class="px-4 py-3 font-medium">产品</th>
              <th class="px-4 py-3 font-medium">码状态</th>
              <th class="px-4 py-3 font-medium">异常标记</th>
              <th class="px-4 py-3 font-medium">生产日期</th>
              <th class="px-4 py-3 font-medium">生产批号</th>
              <th class="px-4 py-3 font-medium">上传时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in data?.rows || []" :key="r.id" class="border-b border-border/40 transition-colors hover:bg-muted/30">
              <td class="px-4 py-3 font-code text-xs">{{ r.code }}</td>
              <td class="px-4 py-3 text-muted">{{ r.product_name || '-' }}</td>
              <td class="px-4 py-3">
                <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="statusBadge(r.status).cls">
                  {{ statusBadge(r.status).label }}
                </span>
              </td>
              <td class="px-4 py-3">
                <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="flagBadge(r.abnormal_flag).cls">
                  {{ flagBadge(r.abnormal_flag).label }}
                </span>
                <div v-if="r.abnormal_reason" class="mt-0.5 max-w-40 truncate text-xs text-muted" :title="r.abnormal_reason">
                  {{ r.abnormal_reason }}
                </div>
              </td>
              <td class="px-4 py-3 text-muted">{{ r.produce_date || '-' }}</td>
              <td class="px-4 py-3 text-muted">{{ r.batch_no || '-' }}</td>
              <td class="px-4 py-3 text-muted">{{ String(r.created_at).slice(0, 16) }}</td>
            </tr>
            <tr v-if="!pending && !data?.rows?.length">
              <td colspan="7" class="px-4 py-10 text-center text-sm text-muted">暂无数据</td>
            </tr>
          </tbody>
        </table>
      </div>
      <!-- 分页 -->
      <div v-if="data?.total" class="flex items-center justify-between border-t border-border/60 px-4 py-3">
        <span class="text-xs text-muted">第 {{ data.page }} / {{ totalPages }} 页</span>
        <div class="flex gap-2">
          <UButton variant="outline" color="neutral" size="sm" :disabled="page <= 1" @click="page--; refresh()">
            上一页
          </UButton>
          <UButton variant="outline" color="neutral" size="sm" :disabled="page >= totalPages" @click="page++; refresh()">
            下一页
          </UButton>
        </div>
      </div>
    </div>
  </div>
</template>
