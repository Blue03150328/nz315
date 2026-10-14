<script setup lang="ts">
const props = defineProps<{ batchId: string | null }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ updated: [] }>()
const { canWrite, user } = useUser()
const columns=[{key:'sequence_no',label:'序号',width:100},{key:'raw_code',label:'溯源码原文',width:600},{key:'actions',label:'操作',width:130}]
const { downloading, download } = useExternalCollectionExport()
const toast = useToast()
const detail = ref<any>(null), loading = ref(false), error = ref(''), page = ref(1), editing = ref(false)
const pageSize = 50
let request = 0
let controller: AbortController | undefined
async function load() {
  if (!open.value || !props.batchId) return
  const current = ++request
  controller?.abort()
  controller = new AbortController()
  loading.value = true
  error.value = ''
  try {
    const result = await $fetch(`/api/admin/external-collections/${props.batchId}`, { query: { page: page.value, pageSize }, signal: controller.signal })
    if (current === request && open.value) detail.value = result
  } catch (failure: any) {
    if (current === request && open.value && failure?.name !== 'AbortError') error.value = failure?.data?.statusMessage || '采集批次加载失败，请重试'
  } finally { if (current === request) loading.value = false }
}
watch(() => props.batchId, () => { detail.value = null; page.value = 1; editing.value = false; void load() })
watch(open, visible => {
  if (visible) { detail.value = null; page.value = 1; void load() }
  else { request++; controller?.abort(); editing.value = false; loading.value = false }
})
watch(page, () => { void load() })
onBeforeUnmount(() => { request++; controller?.abort() })
async function saved() { await load(); emit('updated') }
async function copy(value: string) {
  try { await navigator.clipboard.writeText(value); toast.add({ title: '已复制完整溯源码', color: 'success' }) }
  catch { toast.add({ title: '复制未完成，请选中码值复制', color: 'error' }) }
}
const dateText = (value: unknown) => value ? String(value).slice(0, 10) : '待补填'
</script>

<template>
  <UModal v-model:open="open" title="外部采集批次" :ui="{ content: 'max-w-5xl' }">
    <template #content>
      <div class="b-modal">
        <div class="b-modal-head justify-between"><h2 class="b-modal-title">外部采集批次</h2><UButton color="neutral" variant="ghost" icon="i-lucide-x" aria-label="关闭批次详情" @click="open = false" /></div>
        <div v-if="error" class="b-note mt-4"><p class="b-note-text">{{ error }}</p><UButton size="sm" variant="outline" @click="load">重试</UButton></div>
        <div v-else-if="loading && !detail" class="b-empty">正在加载采集批次…</div>
        <template v-if="detail && !error">
          <div class="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><span class="b-help">上传产线</span><p class="b-strong break-all">{{ detail.batch.line_name }}</p></div>
            <div><span class="b-help">上传设备</span><p class="b-strong break-all">{{ detail.batch.device_name }}</p></div>
            <div><span class="b-help">关联产品当前规格</span><p class="b-strong break-all">{{ detail.batch.linked_spec_name || '规格未记录' }}</p></div>
            <div><span class="b-help">工号</span><p class="b-strong break-all">{{ detail.batch.worker_name_snapshot }} {{ detail.batch.worker_no }}</p></div>
            <div><span class="b-help">采集码数</span><p class="b-strong">{{ detail.batch.accepted_count }}</p></div>
            <div><span class="b-help">生产数量</span><p class="b-strong">{{ detail.batch.effective_production_quantity }} <span class="b-help">{{ detail.batch.production_quantity == null ? '按码数' : '手填' }}</span></p></div>
            <div><span class="b-help">产品</span><p class="b-strong break-all">{{ detail.batch.product_name_snapshot || '待补填' }}</p></div>
            <div><span class="b-help">生产批号</span><p class="b-strong break-all">{{ detail.batch.batch_no || '待补填' }}</p></div>
            <div><span class="b-help">生产日期</span><p class="b-strong">{{ dateText(detail.batch.produce_date) }}</p></div>
<div v-if="detail.batch.expire_date"><span class="b-help">有效期至</span><p class="b-strong">{{ dateText(detail.batch.expire_date) }}</p></div>
            <div><span class="b-help">采集状态</span><p>{{ detail.batch.state === 'completed' ? '采集完成' : '正在采集／待补传' }}</p></div>
          </div>
          <div class="mt-4 flex flex-wrap items-center gap-2">
            <UButton v-if="canWrite && detail.batch.state === 'completed'" icon="i-lucide-pencil" @click="editing = true">{{ detail.batch.product_name_snapshot ? '修改生产资料' : '补全生产资料' }}</UButton>
            <UButton color="neutral" variant="outline" :disabled="detail.batch.state !== 'completed' || downloading" @click="download(detail.batch.id, 'csv')">导出 CSV</UButton>
            <UButton color="neutral" variant="outline" :disabled="detail.batch.state !== 'completed' || downloading" @click="download(detail.batch.id, 'txt')">导出 TXT</UButton>
            <UButton color="neutral" variant="ghost" :loading="loading" @click="load">刷新</UButton>
          </div>
          <p class="b-help mt-2">{{ detail.batch.state === 'completed' ? '按本次采集导出全部已入库溯源码，生产资料可在后台补填。' : '在采集器完成本次采集并补传全部记录后，可补填生产资料和导出文件。' }}</p>
          <p class="b-help mt-1">重复 {{ detail.batch.duplicate_count }} 条 · 异常 {{ detail.batch.rejected_count }} 条 · 设备：{{ detail.batch.device_name }}</p>
          <div class="b-card b-card-clip mt-4">
            <div class="b-card-head"><h3 class="b-card-title">本批溯源码</h3><span class="b-card-extra">共 {{ detail.total }} 条</span></div>
            <ProductionGrid :columns="columns" :rows="detail.rows||[]" row-key="id" :storage-key="'external-detail-columns:v1:'+user?.id"><template #cell-raw_code="{row}"><span :title="row.raw_code" class="font-mono">{{ row.raw_code }}</span></template><template #cell-actions="{row}"><UButton size="xs" variant="link" @click="copy(row.raw_code)">复制</UButton></template></ProductionGrid>
            <div class="b-pager"><span class="b-help">第 {{ page }} 页</span><ExternalPagination v-model:page="page" :total="detail.total" :items-per-page="pageSize" :disabled="loading" /></div>
          </div>
          <div class="b-modal-foot"><UButton color="neutral" variant="outline" @click="open = false">关闭</UButton></div>
          <ExternalProductionForm v-model:open="editing" :batch="detail.batch" @saved="saved" />
        </template>
      </div>
    </template>
  </UModal>
</template>
