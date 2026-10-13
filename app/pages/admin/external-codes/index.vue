<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '外部码库' })
const { downloading, download } = useExternalCollectionExport()
const route = useRoute()
const keyword = ref(''), searched = ref(''), page = ref(1), pageSize = 50
const batchId = ref<string | undefined>(typeof route.query.batchId === 'string' ? route.query.batchId : undefined)
const batchSearch = ref(''), batchKeyword = ref('')
const { data: batches, error: batchesError, refresh: refreshBatches } = await useFetch<any>('/api/admin/external-collections', { query: computed(() => ({ keyword: batchKeyword.value || undefined, pageSize: 100 })) })
const { data, pending, error, refresh } = await useFetch<any>('/api/admin/external-codes', { query: computed(() => ({ keyword: searched.value || undefined, batchId: batchId.value, page: page.value, pageSize })) })
const batchCache = reactive(new Map<string, any>())
watch(batches, value => { for (const row of value?.rows || []) batchCache.set(row.id, row) }, { immediate: true })
const currentBatch = computed(() => batchId.value ? batchCache.get(batchId.value) : undefined)
const batchItems = computed(() => {
  const items = (batches.value?.rows || []).map((row: any) => ({ value: row.id, label: `${row.line_name} · 工号 ${row.worker_no} · ${String(row.created_at).slice(0, 19)} · ${row.accepted_count} 条` }))
  if (batchId.value && !items.some((item: any) => item.value === batchId.value)) items.unshift({ value: batchId.value, label: currentBatch.value ? `${currentBatch.value.line_name} · 工号 ${currentBatch.value.worker_no}` : '当前采集批次' })
  return items
})
watch(batchSearch, (value, _, cleanup) => { const timer = setTimeout(() => { batchKeyword.value = value.trim() }, 250); cleanup(() => clearTimeout(timer)) })
watch(batchId, () => { page.value = 1 })
const detailOpen = ref(false), selected = ref<string | null>(null)
const toast = useToast()
function search() { page.value = 1; searched.value = keyword.value; void changed() }
function reset() { keyword.value = ''; searched.value = ''; batchId.value = undefined; page.value = 1 }
function show(id: string) { selected.value = id; detailOpen.value = true }
async function copy(value: string) {
  try { await navigator.clipboard.writeText(value); toast.add({ title: '已复制完整溯源码', color: 'success' }) }
  catch { toast.add({ title: '复制未完成，请选中码值复制', color: 'error' }) }
}
async function changed() {
  await Promise.all([refresh(), refreshBatches()])
  const id = batchId.value
  if (id && !batches.value?.rows?.some((row: any) => row.id === id)) {
    try { const result = await $fetch<any>(`/api/admin/external-collections/${id}`, { query: { pageSize: 1 } }); batchCache.set(id, result.batch) }
    catch { /* 当前筛选批次的访问错误由码列表显示，保留已看到的资料。 */ }
  }
}
let timer: ReturnType<typeof setInterval> | undefined
function refreshVisible() { if (!document.hidden && !detailOpen.value && !downloading.value) void changed() }
onMounted(() => { timer = setInterval(refreshVisible, 20000); window.addEventListener('focus', refreshVisible) })
onBeforeUnmount(() => { clearInterval(timer); window.removeEventListener('focus', refreshVisible) })
onMounted(async () => {
  if (batchId.value && !batchCache.has(batchId.value)) {
    try { const result = await $fetch<any>(`/api/admin/external-collections/${batchId.value}`, { query: { pageSize: 1 } }); batchCache.set(batchId.value, result.batch) }
    catch { /* 码列表接口会显示批次不存在或无访问权限。 */ }
  }
})
</script>

<template>
  <div class="space-y-4">
    <div><h1 class="b-page-title">外部码库</h1><p class="b-page-desc">完整保留外部二维码的扫码原文，按采集批次导出交给标签厂家。</p></div>
    <form class="b-card" @submit.prevent="search">
      <div class="b-form-grid sm:grid-cols-2">
        <div><label class="b-label">溯源码</label><UInput v-model="keyword" placeholder="搜索完整网址或码值" class="w-full" /></div>
        <div>
          <label class="b-label">采集批次</label>
          <UInput v-model="batchSearch" placeholder="搜索生产线或工号以查找批次" class="mb-2 w-full" />
          <select v-model="batchId" aria-label="选择采集批次" class="w-full rounded-md border border-[var(--b-border)] bg-white px-2 py-1.5 text-sm">
            <option :value="undefined">全部采集批次</option>
            <option v-for="item in batchItems" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
          <p v-if="batchesError" class="b-help">批次加载失败，请刷新页面重试</p>
        </div>
      </div>
      <div class="b-card-foot"><div class="flex flex-wrap gap-2"><UButton type="button" color="neutral" variant="outline" :disabled="!currentBatch || currentBatch.state !== 'completed' || downloading" @click="download(batchId!, 'csv')">本批导出 CSV</UButton><UButton type="button" color="neutral" variant="outline" :disabled="!currentBatch || currentBatch.state !== 'completed' || downloading" @click="download(batchId!, 'txt')">本批导出 TXT</UButton></div><div class="flex gap-2"><UButton type="button" color="neutral" variant="outline" @click="reset">重置</UButton><UButton type="submit" :loading="pending">查询</UButton></div></div>
    </form>
    <p class="b-help">选择已完成的采集批次后可导出；导出包含该批全部已入库溯源码。</p>
    <div v-if="error" class="b-note"><p class="b-note-text">{{ (error as any).data?.statusMessage || '外部码库加载失败' }}</p><UButton size="sm" variant="outline" @click="refresh()">重试</UButton></div>
    <div v-else class="b-card b-card-clip">
      <div class="b-card-head"><h2 class="b-card-title">溯源码清单</h2><span class="b-card-extra">共 {{ data?.total || 0 }} 条</span></div>
      <div class="b-scroll-x"><table class="b-table"><thead><tr><th>溯源码原文</th><th>所属采集批次</th><th class="text-right">操作</th></tr></thead><tbody>
        <tr v-for="row in data?.rows || []" :key="row.id"><td class="max-w-2xl"><span class="whitespace-pre-wrap break-all font-mono text-xs">{{ row.raw_code }}</span></td><td><UButton size="sm" color="neutral" variant="link" @click="show(row.batch_id)">查看采集批次</UButton></td><td class="text-right"><UButton size="sm" color="neutral" variant="link" @click="copy(row.raw_code)">复制</UButton></td></tr>
        <tr v-if="!data?.rows?.length"><td colspan="3"><div class="b-empty">{{ pending ? '正在加载…' : '暂无匹配的外部溯源码' }}</div></td></tr>
      </tbody></table></div>
      <div class="b-pager"><span class="b-help">每页 {{ pageSize }} 条</span><ExternalPagination v-model:page="page" :total="data?.total || 0" :items-per-page="pageSize" :disabled="pending" /></div>
    </div>
    <ExternalCollectionDetail v-model:open="detailOpen" :batch-id="selected" @updated="changed" />
  </div>
</template>
