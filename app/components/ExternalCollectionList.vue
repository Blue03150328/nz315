<script setup lang="ts">
import type { ExternalCollectionBatch } from '#shared/types/external-collection'
import { formatCodeQuantity } from '#shared/utils/code-quantity'
const props = defineProps<{ mode: 'codes' | 'tasks' }>()
const isCodes = computed(() => props.mode === 'codes')
const title = computed(() => isCodes.value ? '外部码库管理' : '历史外部采集')
const { canWrite, isPlatformAdmin, user } = useUser()
const columns=computed(()=>[...(isCodes.value?[{key:'selection',label:'选择',width:90}]:[]),...(isPlatformAdmin.value?[{key:'enterprise_name',label:'企业',width:240}]:[]),{key:'product_name_snapshot',label:'产品名称',width:280},{key:'linked_spec_name',label:'关联产品规格',width:180},{key:'batch_no',label:'生产批号',width:160},{key:'produce_date',label:'生产日期',width:150},{key:'expire_date',label:'有效期至',width:150},{key:'accepted_count',label:'外部有效码',width:140},{key:'workerLabel',label:'操作员',width:200},{key:'state',label:'状态',width:140},{key:'created_at',label:'开始时间',width:210},{key:'completed_at',label:'上传完成时间',width:210},{key:'line_name',label:'生产线',width:180},{key:'device_name',label:'设备',width:180},{key:'actions',label:'操作',width:370}])
const rows=computed(()=>(data.value?.rows||[]).map(row=>({...row,workerLabel:[row.worker_name_snapshot,row.worker_no?'（'+row.worker_no+'）':''].filter(Boolean).join('')})))
const { downloading, download } = useExternalCollectionExport()
const toast = useToast(), route = useRoute()
const filters = reactive({ keyword: '', batchNo: '', rawCode: '', lineName: '', deviceName: '', workerNo: '', state: '', dateFrom: '', dateTo: '' })
const page = ref(1), pageSize = 20
const { applyListQuery, resetListQuery } = useAdminListRoute(filters, page, () => refresh(), [], ['source', 'view', 'batchId'])
const batchId = computed(() => typeof route.query.batchId === 'string' ? route.query.batchId : undefined)
const { data, pending, error, refresh } = await useAsyncData<{ rows: ExternalCollectionBatch[]; total: number; completedTotal: number; selectionFilters: Record<string, any> }>('external-collection-' + props.mode + '-' + useId(),
  () => $fetch('/api/admin/external-collections', { query: { ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)), batchId: batchId.value, page: page.value, pageSize } }), { watch: false })
const selectionMode = ref(false)
const selectedIds = ref<string[]>([]), allSelected = ref(false), excludedIds = ref<string[]>([])
const exportOpen = ref(false), exportPreview = ref<any>(null), exportBusy = ref(false), previewBusy = ref(false)
const selectedCount = computed(() => allSelected.value ? Math.max(0, Number(data.value?.completedTotal || 0) - excludedIds.value.length) : selectedIds.value.length)
const isSelected = (row: ExternalCollectionBatch) => row.state === 'completed' && (allSelected.value ? !excludedIds.value.includes(row.id) : selectedIds.value.includes(row.id))
const completedRows = computed(() => (data.value?.rows || []).filter(row => row.state === 'completed'))
const pageSelected = computed(() => completedRows.value.length > 0 && completedRows.value.every(isSelected))
const clearSelection = () => { selectedIds.value = []; excludedIds.value = []; allSelected.value = false }
const toggleSelectionMode = () => { clearSelection(); selectionMode.value = !selectionMode.value }
const toggleSelection = (row: ExternalCollectionBatch) => { if (row.state !== 'completed') return; const ids = allSelected.value ? excludedIds : selectedIds; ids.value = ids.value.includes(row.id) ? ids.value.filter(id => id !== row.id) : [...ids.value, row.id] }
const togglePage = () => { const checked = pageSelected.value; for (const row of completedRows.value) if (isSelected(row) === checked) toggleSelection(row) }
watch(() => JSON.stringify(data.value?.selectionFilters), clearSelection)
async function openExport() {
  if (previewBusy.value || !selectedCount.value) return
  previewBusy.value = true
  try {
    exportPreview.value = await $fetch('/api/admin/external-collections/preview', { method: 'POST', body: { selection: allSelected.value ? { all: true, filters: { ...data.value?.selectionFilters }, excludeIds: [...excludedIds.value] } : { ids: [...selectedIds.value] } } })
    exportOpen.value = true
  } catch (failure: any) { toast.add({ title: failure?.data?.statusMessage || '导出范围加载失败，请重试', color: 'error' }) }
  finally { previewBusy.value = false }
}
async function exportSelected(format: 'csv' | 'txt') {
  if (exportBusy.value || !exportPreview.value) return
  exportBusy.value = true
  try {
    const response = await fetch('/api/admin/external-collections/export', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...exportPreview.value, format }) })
    if (!response.ok) throw new Error((await response.json()).statusMessage || '导出失败')
    const blob = await response.blob(), url = URL.createObjectURL(blob), link = document.createElement('a')
    const filename = response.headers.get('content-disposition')?.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
    link.href = url; link.download = filename ? decodeURIComponent(filename) : '外部溯源码.' + format; link.click(); URL.revokeObjectURL(url)
    exportOpen.value = false; toast.add({ title: '已导出 ' + formatCodeQuantity(exportPreview.value.codeTotal), color: 'success' })
  } catch (failure: any) { toast.add({ title: failure?.message || '导出失败，请重试', color: 'error' }) }
  finally { exportBusy.value = false }
}
const detailOpen = ref(false), selected = ref<string | null>(null)
const editOpen = ref(false), editing = ref<ExternalCollectionBatch | null>(null)
const deleteOpen = ref(false), deleting = ref<ExternalCollectionBatch | null>(null), deletingBusy = ref(false), deleteError = ref('')
function show(id: string) { selected.value = id; detailOpen.value = true }
async function edit(row: ExternalCollectionBatch) { editing.value = row; await nextTick(); editOpen.value = true }
function confirmDelete(row: ExternalCollectionBatch) { deleting.value = row; deleteError.value = ''; deleteOpen.value = true }
async function changed() { await refresh(); if (page.value > 1 && !data.value?.rows.length) await applyListQuery(page.value - 1) }
async function remove() {
  if (!deleting.value || deletingBusy.value || !canWrite.value) return
  deletingBusy.value = true; deleteError.value = ''
  try {
    await $fetch(`/api/admin/external-collections/${deleting.value.id}`, { method: 'DELETE' })
    deleteOpen.value = false
    if (batchId.value === deleting.value.id) await applyListQuery(page.value)
    toast.add({ title: '采集批次已删除', color: 'success' }); await changed()
  } catch (failure: any) { deleteError.value = failure?.data?.statusMessage || '删除未完成，请重试' }
  finally { deletingBusy.value = false }
}
const dateText = (value: unknown) => value ? String(value).slice(0, 10) : '待补填'
const timeText = (value: unknown) => value ? String(value).replace('T', ' ').slice(0, 19) : '未记录'
let timer: ReturnType<typeof setInterval> | undefined
function refreshVisible() { if (!document.hidden && !pending.value && !detailOpen.value && !editOpen.value && !deleteOpen.value && !exportOpen.value && !downloading.value) void refresh() }
onMounted(() => { timer = setInterval(refreshVisible, 20000); window.addEventListener('focus', refreshVisible) })
onBeforeUnmount(() => { clearInterval(timer); window.removeEventListener('focus', refreshVisible) })
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3"><div><h1 class="b-page-title">{{ title }}</h1></div><UButton color="neutral" variant="outline" icon="i-lucide-refresh-cw" :loading="pending" @click="refresh()">刷新</UButton></div>
    <form class="b-card" @submit.prevent="applyListQuery()">
      <div class="b-card-head"><h2 class="b-card-title">筛选查询</h2></div>
      <div class="b-form-grid sm:grid-cols-2 xl:grid-cols-4">
        <div><label class="b-label">产品名称</label><UInput v-model="filters.keyword" placeholder="搜索产品名称" class="w-full" /></div>
        <div><label class="b-label">生产批号</label><UInput v-model="filters.batchNo" placeholder="输入生产批号" class="w-full" /></div>
        <div><label class="b-label">{{ isCodes ? '上传产线' : '生产线' }}</label><UInput v-model="filters.lineName" placeholder="搜索生产线" class="w-full" /></div>
        <div><label class="b-label">{{ isCodes ? '上传设备' : '采集设备' }}</label><UInput v-model="filters.deviceName" placeholder="搜索设备名称" class="w-full" /></div>
        <div v-if="isCodes"><label class="b-label">溯源码</label><UInput v-model="filters.rawCode" placeholder="搜索完整网址或码值，查找所属批次" class="w-full" /></div>
        <div><label class="b-label">操作工号</label><UInput v-model="filters.workerNo" placeholder="搜索采集工号" class="w-full" /></div>
        <div><label class="b-label">状态</label><USelect v-model="filters.state" :items="[{ label: '进行中', value: 'active' }, { label: '已完成', value: 'completed' }]" placeholder="全部状态" class="w-full" /></div>
        <div><label class="b-label">{{ isCodes ? '采集日期起' : '开始日期起' }}</label><UInput v-model="filters.dateFrom" type="date" class="w-full" /></div>
        <div><label class="b-label">{{ isCodes ? '采集日期止' : '开始日期止' }}</label><UInput v-model="filters.dateTo" type="date" class="w-full" /></div>
      </div>
      <div class="b-card-foot"><span class="b-card-extra">共 {{ data?.total || 0 }} {{ isCodes ? '批上传' : '次采集任务' }}</span><div class="flex gap-2"><UButton type="submit" :loading="pending">查询</UButton><UButton type="button" color="neutral" variant="outline" @click="resetListQuery()">重置</UButton></div></div>
    </form>
    <div v-if="error" class="b-note"><p class="b-note-text">{{ (error as any).data?.statusMessage || title + '加载失败' }}</p><UButton size="sm" variant="outline" @click="refresh()">重试</UButton></div>
    <div v-else class="b-card b-card-clip">
      <div class="b-card-head"><h2 class="b-card-title">{{ isCodes ? '上传记录' : '采集任务' }}</h2><span class="b-card-extra">每页 {{ pageSize }} 行 · 共 {{ data?.total || 0 }} 条</span></div>
      <div v-if="isCodes" class="flex flex-wrap items-center gap-3 border-b border-[var(--b-border)] px-4 py-3">
        <UButton size="sm" variant="outline" :aria-pressed="selectionMode" @click="toggleSelectionMode">{{ selectionMode ? '退出多选' : '多选' }}</UButton>
        <template v-if="selectionMode">
        <UCheckbox :model-value="pageSelected" :disabled="pending || !completedRows.length" label="全选本页" @update:model-value="togglePage" />
        <UButton size="sm" variant="link" :disabled="pending || !data?.completedTotal" @click="clearSelection(); allSelected = true">全选查询中的已完成批次（{{ data?.completedTotal || 0 }}批）</UButton>
        <span class="b-help">已选 {{ selectedCount }} 批</span><UButton v-if="selectedCount" size="sm" variant="link" @click="clearSelection">取消选择</UButton>
        <UButton size="sm" variant="outline" icon="i-lucide-download" :disabled="!selectedCount || pending" :loading="previewBusy" @click="openExport">导出所选</UButton>
        </template>
      </div>
      <div class="p-4"><ProductionGrid :selection-mode="isCodes ? selectionMode : undefined" :columns="columns" :rows="rows" row-key="id" :storage-key="'external-library-columns:v1:'+props.mode+':'+user?.id">
        <template #cell-selection="{row}"><UCheckbox :model-value="isSelected(row)" :disabled="row.state!=='completed'" :aria-label="'选择采集批次'+row.id" @update:model-value="toggleSelection(row)" /></template>
        <template #cell-produce_date="{row}">{{ dateText(row.produce_date) }}</template>
        <template #cell-accepted_count="{row}">{{ formatCodeQuantity(row.accepted_count) }}</template>
        <template #cell-state="{row}"><span class="b-tag" :class="row.state==='completed'?'b-tag-success':'b-tag-info'">{{ row.state==='completed'?'已完成':'进行中' }}</span></template>
        <template #cell-created_at="{row}">{{ timeText(row.created_at) }}</template>
        <template #cell-completed_at="{row}">{{ row.completed_at?timeText(row.completed_at):'尚未完成上传' }}</template>
        <template #cell-actions="{row}"><div class="flex gap-2"><UButton size="xs" variant="link" @click="show(row.id)">详细</UButton><UButton v-if="canWrite" size="xs" variant="link" :disabled="row.state!=='completed'" @click="edit(row)">编辑</UButton><UButton v-if="canWrite" size="xs" color="error" variant="link" :disabled="row.state!=='completed'" @click="confirmDelete(row)">删除</UButton><UButton size="xs" variant="link" :disabled="row.state!=='completed'||downloading" @click="download(row.id,'csv')">CSV</UButton><UButton size="xs" variant="link" :disabled="row.state!=='completed'||downloading" @click="download(row.id,'txt')">TXT</UButton></div></template>
      </ProductionGrid></div>
      <div class="b-pager"><span class="b-help">{{ isCodes ? '去重入库数量' : '历史采集记录' }}</span><ExternalPagination :page="page" :total="data?.total || 0" :items-per-page="pageSize" :disabled="pending" @update:page="applyListQuery($event)" /></div>
    </div>
    <ExternalCollectionDetail v-model:open="detailOpen" :batch-id="selected" @updated="changed" />
    <ExternalProductionForm v-if="editing" v-model:open="editOpen" :batch="editing" @saved="changed" />
    <UModal v-model:open="exportOpen" title="导出所选外部码" :dismissible="!exportBusy"><template #content><div class="b-modal">
      <div class="b-modal-head"><h2 class="b-modal-title">导出所选外部码</h2></div>
      <div class="b-modal-body space-y-3"><p>导出范围：所选 {{ exportPreview?.batchCount }} 批，共 {{ formatCodeQuantity(exportPreview?.codeTotal) }}，保留完整溯源码原文。</p><div class="flex gap-3"><UButton :loading="exportBusy" @click="exportSelected('csv')">导出 CSV</UButton><UButton :loading="exportBusy" variant="outline" @click="exportSelected('txt')">导出 TXT</UButton></div></div>
      <div class="b-modal-foot"><UButton color="neutral" variant="outline" :disabled="exportBusy" @click="exportOpen = false">关闭</UButton></div>
    </div></template></UModal>
    <UModal v-model:open="deleteOpen" title="删除采集批次" :dismissible="!deletingBusy"><template #content><div class="b-modal">
      <div class="b-modal-head"><h2 class="b-modal-title">删除采集批次</h2></div>
      <div class="b-modal-body space-y-3 text-sm"><p v-if="deleting">{{ deleting.product_name_snapshot || '待补填产品' }} · {{ deleting.line_name }} · 工号 {{ deleting.worker_no }} · {{ formatCodeQuantity(deleting.accepted_count) }}</p><p>该批将从外部码库管理移除，原始采集和去重记录保留，同一码再次采集不会重复入库。</p><p v-if="deleteError" class="text-error">{{ deleteError }}</p></div>
      <div class="b-modal-foot"><UButton color="neutral" variant="outline" :disabled="deletingBusy" @click="deleteOpen = false">取消</UButton><UButton v-if="canWrite" color="error" :loading="deletingBusy" @click="remove">确认删除本批</UButton></div>
    </div></template></UModal>
  </div>
</template>
