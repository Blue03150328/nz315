<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '外部生产记录' })
const { canWrite, user } = useUser()
const { downloading, download } = useExternalCollectionExport()
const filters = reactive({ keyword: '', lineName: '', workerNo: '', state: 'all' })
const query = ref<Record<string, string>>({})
const page = ref(1), pageSize = 20
const { data, pending, error, refresh } = await useFetch<any>('/api/admin/external-collections', { query: computed(() => ({ ...query.value, page: page.value, pageSize })) })
const selected = ref<string | null>(null), detailOpen = ref(false)
function search() { page.value = 1; query.value = { keyword: filters.keyword.trim(), lineName: filters.lineName.trim(), workerNo: filters.workerNo.trim(), ...(filters.state !== 'all' ? { state: filters.state } : {}) }; void refresh() }
function reset() { Object.assign(filters, { keyword: '', lineName: '', workerNo: '', state: 'all' }); search() }
function show(id: string) { selected.value = id; detailOpen.value = true }
const dateText = (value: unknown) => value ? String(value).slice(0, 10) : '待补填'
const timeText = (value: unknown) => value ? String(value).replace('T', ' ').slice(0, 19) : '—'
let timer: ReturnType<typeof setInterval> | undefined
function refreshVisible() { if (!document.hidden && !detailOpen.value && !downloading.value) void refresh() }
onMounted(() => { timer = setInterval(refreshVisible, 20000); window.addEventListener('focus', refreshVisible) })
onBeforeUnmount(() => { clearInterval(timer); window.removeEventListener('focus', refreshVisible) })
</script>

<template>
  <div class="space-y-4">
    <div><h1 class="b-page-title">外部生产记录</h1><p class="b-page-desc">每次采集单独留档，以生产线和工号区分；采集完成后补填产品、生产批号和生产日期。</p></div>
    <form class="b-card" @submit.prevent="search">
      <div class="b-form-grid sm:grid-cols-2 lg:grid-cols-4">
        <div><label class="b-label">产品／生产批号</label><UInput v-model="filters.keyword" placeholder="搜索产品名称或生产批号" class="w-full" /></div>
        <div><label class="b-label">生产线</label><UInput v-model="filters.lineName" placeholder="搜索生产线" class="w-full" /></div>
        <div><label class="b-label">工号</label><UInput v-model="filters.workerNo" placeholder="搜索采集工号" class="w-full" /></div>
        <div><label class="b-label">采集状态</label><USelect v-model="filters.state" :items="[{ label: '全部', value: 'all' }, { label: '采集中／待补传', value: 'active' }, { label: '采集完成', value: 'completed' }]" class="w-full" /></div>
      </div>
      <div class="b-card-foot justify-end"><UButton type="button" color="neutral" variant="outline" @click="reset">重置</UButton><UButton type="submit" :loading="pending">查询</UButton></div>
    </form>
    <div v-if="error" class="b-note"><p class="b-note-text">{{ (error as any).data?.statusMessage || '外部生产记录加载失败' }}</p><UButton size="sm" variant="outline" @click="refresh()">重试</UButton></div>
    <div v-else class="b-card b-card-clip">
      <div class="b-card-head"><h2 class="b-card-title">采集生产记录</h2><span class="b-card-extra">共 {{ data?.total || 0 }} 次采集</span></div>
      <div class="b-scroll-x"><table class="b-table"><thead><tr><th v-if="user?.role === 'platform_admin'">企业</th><th>产品</th><th>生产批号</th><th>采集码数</th><th>生产数量</th><th>生产日期</th><th>生产线／工号</th><th>采集时间</th><th>状态</th><th class="text-right">操作</th></tr></thead><tbody>
        <tr v-for="row in data?.rows || []" :key="row.id">
          <td v-if="user?.role === 'platform_admin'">{{ row.enterprise_name }}</td>
          <td class="max-w-64 break-words b-strong">{{ row.product_name_snapshot || '待补填产品' }}</td><td class="max-w-48 break-all">{{ row.batch_no || '待补填' }}</td><td>{{ row.accepted_count }}</td><td>{{ row.effective_production_quantity }}<span v-if="row.production_quantity != null" class="ml-1 b-tag b-tag-default">手填</span></td><td class="whitespace-nowrap">{{ dateText(row.produce_date) }}</td>
          <td><p class="break-all">{{ row.line_name }}</p><p class="b-help">工号 {{ row.worker_no }}</p></td><td class="whitespace-nowrap text-xs">{{ timeText(row.created_at) }}</td>
          <td><span class="b-tag" :class="row.state === 'completed' ? 'b-tag-success' : 'b-tag-info'">{{ row.state === 'completed' ? (row.product_name_snapshot ? '资料已填写' : '待补生产资料') : '采集中／待补传' }}</span></td>
          <td><div class="flex justify-end gap-1 whitespace-nowrap"><UButton size="sm" color="neutral" variant="link" @click="show(row.id)">{{ canWrite && row.state === 'completed' ? '查看／补填' : '查看' }}</UButton><UButton size="sm" color="neutral" variant="link" :disabled="row.state !== 'completed' || downloading" @click="download(row.id, 'csv')">CSV</UButton><UButton size="sm" color="neutral" variant="link" :disabled="row.state !== 'completed' || downloading" @click="download(row.id, 'txt')">TXT</UButton></div></td>
        </tr>
        <tr v-if="!data?.rows?.length"><td :colspan="user?.role === 'platform_admin' ? 10 : 9"><div class="b-empty"><p>{{ pending ? '正在加载…' : '暂无外部生产记录' }}</p><p class="b-help mt-2">在采集器进入外部码采集，扫码上传后会在这里生成记录。</p></div></td></tr>
      </tbody></table></div>
      <div class="b-pager"><span class="b-help">采集码数为实际去重入库数量</span><ExternalPagination v-model:page="page" :total="data?.total || 0" :items-per-page="pageSize" :disabled="pending" /></div>
    </div>
    <ExternalCollectionDetail v-model:open="detailOpen" :batch-id="selected" @updated="refresh()" />
  </div>
</template>
