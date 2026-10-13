<script setup lang="ts">
import type { ExternalCollectionBatch } from '#shared/types/external-collection'
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '外部码库' })
const { canWrite, user } = useUser()
const { downloading, download } = useExternalCollectionExport()
const route = useRoute()
const toast = useToast()
const filters = reactive({ rawCode: '', keyword: '' })
const query = ref<Record<string, string>>({})
const batchId = ref<string | undefined>(typeof route.query.batchId === 'string' ? route.query.batchId : undefined)
const page = ref(1), pageSize = 20
const { data, pending, error, refresh } = await useFetch<{ rows: ExternalCollectionBatch[]; total: number }>('/api/admin/external-collections', {
  query: computed(() => ({ ...query.value, batchId: batchId.value, page: page.value, pageSize })),
})
const detailOpen = ref(false), selected = ref<string | null>(null)
const editOpen = ref(false), editing = ref<ExternalCollectionBatch | null>(null)
const deleteOpen = ref(false), deleting = ref<ExternalCollectionBatch | null>(null), deletingBusy = ref(false)
const deleteError = ref('')
function search() { page.value = 1; query.value = { rawCode: filters.rawCode.trim(), keyword: filters.keyword.trim() }; void refresh() }
function reset() { Object.assign(filters, { rawCode: '', keyword: '' }); batchId.value = undefined; search() }
function show(id: string) { selected.value = id; detailOpen.value = true }
async function edit(row: ExternalCollectionBatch) {
  editing.value = row
  // 先挂载表单再打开，让首次点击也能按当前批次初始化字段。
  await nextTick()
  editOpen.value = true
}
function confirmDelete(row: ExternalCollectionBatch) { deleting.value = row; deleteError.value = ''; deleteOpen.value = true }
async function changed() {
  await refresh()
  if (page.value > 1 && !data.value?.rows.length) { page.value--; await refresh() }
}
async function remove() {
  if (!deleting.value || deletingBusy.value) return
  deletingBusy.value = true; deleteError.value = ''
  try {
    await $fetch(`/api/admin/external-collections/${deleting.value.id}`, { method: 'DELETE' })
    if (batchId.value === deleting.value.id) batchId.value = undefined
    deleteOpen.value = false
    toast.add({ title: '采集批次已删除', color: 'success' })
    await changed()
  } catch (failure: any) { deleteError.value = failure?.data?.statusMessage || '删除未完成，请重试' }
  finally { deletingBusy.value = false }
}
const timeText = (value: string) => value.replace('T', ' ').slice(0, 19)
let timer: ReturnType<typeof setInterval> | undefined
function refreshVisible() { if (!document.hidden && !detailOpen.value && !editOpen.value && !deleteOpen.value && !downloading.value) void refresh() }
onMounted(() => { timer = setInterval(refreshVisible, 20000); window.addEventListener('focus', refreshVisible) })
onBeforeUnmount(() => { clearInterval(timer); window.removeEventListener('focus', refreshVisible) })
</script>

<template>
  <div class="space-y-4">
    <div><h1 class="b-page-title">外部码库</h1><p class="b-page-desc">按每次采集批次管理溯源码，查看详情或导出完整码清单交给标签厂家。</p></div>
    <form class="b-card" @submit.prevent="search">
      <div class="b-form-grid sm:grid-cols-2">
        <div><label class="b-label">溯源码</label><UInput v-model="filters.rawCode" placeholder="搜索完整网址或码值，查找所属批次" class="w-full" /></div>
        <div><label class="b-label">采集批次</label><UInput v-model="filters.keyword" placeholder="搜索生产线、工号、产品或生产批号" class="w-full" /></div>
      </div>
      <div class="b-card-foot justify-end"><UButton type="button" color="neutral" variant="outline" @click="reset">重置</UButton><UButton type="submit" :loading="pending">查询</UButton></div>
    </form>
    <div v-if="error" class="b-note"><p class="b-note-text">{{ (error as any).data?.statusMessage || '外部码库加载失败' }}</p><UButton size="sm" variant="outline" @click="refresh()">重试</UButton></div>
    <div v-else class="b-card b-card-clip">
      <div class="b-card-head"><h2 class="b-card-title">采集批次清单</h2><span class="b-card-extra">共 {{ data?.total || 0 }} 批</span></div>
      <div class="b-scroll-x"><table class="b-table"><thead><tr><th v-if="user?.role === 'platform_admin'">企业</th><th>采集批次</th><th>状态</th><th class="text-right">操作</th></tr></thead><tbody>
        <tr v-for="row in data?.rows || []" :key="row.id">
          <td v-if="user?.role === 'platform_admin'" class="max-w-48 break-words">{{ row.enterprise_name }}</td>
          <td class="min-w-64"><p class="b-strong break-words">{{ row.line_name }} · 工号 {{ row.worker_no }} · {{ timeText(row.created_at) }} · {{ row.accepted_count }} 条</p><p v-if="row.product_name_snapshot || row.batch_no" class="b-help mt-1 break-words">{{ row.product_name_snapshot || '待补填产品' }} · 生产批号 {{ row.batch_no || '待补填' }}</p></td>
          <td class="whitespace-nowrap"><span class="b-tag" :class="row.state === 'completed' ? 'b-tag-success' : 'b-tag-info'">{{ row.state === 'completed' ? '采集完成' : '采集中／待补传' }}</span></td>
          <td><div class="flex justify-end gap-1 whitespace-nowrap">
            <UButton size="sm" color="neutral" variant="link" @click="show(row.id)">详情</UButton>
            <UButton v-if="canWrite" size="sm" color="neutral" variant="link" :disabled="row.state !== 'completed'" @click="edit(row)">修改</UButton>
            <UButton v-if="canWrite" size="sm" color="error" variant="link" :disabled="row.state !== 'completed'" @click="confirmDelete(row)">删除</UButton>
            <UButton size="sm" color="neutral" variant="link" :disabled="row.state !== 'completed' || downloading" @click="download(row.id, 'csv')">CSV</UButton>
            <UButton size="sm" color="neutral" variant="link" :disabled="row.state !== 'completed' || downloading" @click="download(row.id, 'txt')">TXT</UButton>
          </div></td>
        </tr>
        <tr v-if="!data?.rows?.length"><td :colspan="user?.role === 'platform_admin' ? 4 : 3"><div class="b-empty">{{ pending ? '正在加载…' : '暂无匹配的采集批次' }}</div></td></tr>
      </tbody></table></div>
      <div class="b-pager"><span class="b-help">每页 {{ pageSize }} 批；采集完成后可修改、删除或导出。</span><ExternalPagination v-model:page="page" :total="data?.total || 0" :items-per-page="pageSize" :disabled="pending" /></div>
    </div>
    <ExternalCollectionDetail v-model:open="detailOpen" :batch-id="selected" @updated="changed" />
    <ExternalProductionForm v-if="editing" v-model:open="editOpen" :batch="editing" @saved="changed" />
    <UModal v-model:open="deleteOpen" title="删除采集批次" :dismissible="!deletingBusy">
      <template #content><div class="b-modal">
        <div class="b-modal-head"><h2 class="b-modal-title">删除采集批次</h2></div>
        <div class="space-y-3 py-4 text-sm"><p v-if="deleting" class="break-words">{{ deleting.line_name }} · 工号 {{ deleting.worker_no }} · {{ timeText(deleting.created_at) }} · {{ deleting.accepted_count }} 条</p><p>删除后，该批将从外部码库和外部生产记录中移除。系统保留原始采集及去重记录，同一码再次采集不会重复入库。</p><p v-if="deleteError" class="text-error">{{ deleteError }}</p></div>
        <div class="b-modal-foot"><UButton color="neutral" variant="outline" :disabled="deletingBusy" @click="deleteOpen = false">取消</UButton><UButton color="error" :loading="deletingBusy" @click="remove">确认删除本批</UButton></div>
      </div></template>
    </UModal>
  </div>
</template>
