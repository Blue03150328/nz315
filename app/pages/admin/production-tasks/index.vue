<script setup lang="ts">
import ProductionDatePicker from '~/components/ProductionDatePicker.vue'
import ProductionAllocationPicker from '~/components/ProductionAllocationPicker.vue'
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '生产任务与剩余码审核' })
const { user, canWrite, canManageUsers } = useUser()
const toast = useToast()
const page = ref(1)
const { data, pending, error, refresh } = await useFetch<any>('/api/admin/production-tasks', { query: { page } })
const productKeyword = ref(''), productSearch = ref('')
const { data: products, pending: productLoading, error: productError } = await useFetch<any>('/api/admin/products', { query: { page: 1, pageSize: 100, status: 1, keyword: productKeyword } })
const emptyForm = () => ({ name: '', lineName: '', productId: null as string | null, batchNo: '', produceDate: '', expireDate: '', qcResult: '', qualityCertNo: '' })
const emptyAllocation = () => ({ kind: 'upload', sourceId: '', quantity: 0, content: '' })
const form = ref(emptyForm()), allocation = ref(emptyAllocation())
const sourceProductId = computed(() => Number(form.value.productId || 0))
const { data: sources, pending: sourceLoading, error: sourceError, refresh: refreshSources } = await useFetch<any>('/api/admin/production-tasks/sources', { query: { productId: sourceProductId } })
const requestId = ref(crypto.randomUUID()), busy = ref(false), showForm = ref(false)
const mode = ref<'create' | 'edit' | 'transfer'>('create')
const editingTask = ref<any>(null), sourceTask = ref<any>(null), appendCodes = ref(false)
const destination = ref('new'), destinationId = ref('')
const productionEditable = computed(() => mode.value !== 'edit' || (editingTask.value?.status === 'active' && Number(editingTask.value?.used_count) === 0))
const existingDestination = computed(() => mode.value === 'transfer' && destination.value === 'existing')
const canEdit = (t: any) => canWrite.value && (canManageUsers.value || Number(t.created_by) === Number(user.value?.id))
// 远程搜索保留已选产品的名称。
const productCache = new Map<string, string>()
watch(products, result => { for (const row of result?.rows || []) productCache.set(String(row.id), `${row.name} · ${row.registration_no}`) }, { immediate: true })
const productItems = computed(() => (products.value?.rows || []).map((r: any) => ({ value: String(r.id), label: `${r.name} · ${r.registration_no}` })))
const selectedProductLabel = computed(() => productCache.get(form.value.productId || ''))
watch(productSearch, (value, _, onCleanup) => { const timer = setTimeout(() => { productKeyword.value = value.trim() }, 250); onCleanup(() => clearTimeout(timer)) })
watch(() => form.value.produceDate, date => { if (date && form.value.expireDate && form.value.expireDate < date) form.value.expireDate = '' })
watch(() => form.value.productId, () => { if (mode.value === 'create') allocation.value = emptyAllocation() })
// 超时重试保持提交标识，改变资料后使用新的标识。
watch(() => JSON.stringify([form.value, allocation.value, appendCodes.value, destination.value, destinationId.value]), () => { if (!busy.value) requestId.value = crypto.randomUUID() })
const selected = ref<number | null>(null), detail = ref<any>(null), state = ref(''), detailPage = ref(1), detailBusy = ref(false)
const reason = ref(''), scanCode = ref(''), history = ref<any>(null), showHistory = ref(false)
const statusLabels: Record<string, string> = { active: '生产中', pending: '剩余码待审核', rejected: '审核退回，继续锁定', approved: '已结束，剩余码已放行' }
const stateLabels: Record<string, string> = { reserved: '本任务待生产', used: '本任务已生产', pending: '待审核', released: '已审核放行记录', available: '当前可再次领用', transferred: '已转领其他任务' }
const detailTotal = computed(() => detail.value?.filteredTotal || 0)
const message = (e: any) => e?.data?.statusMessage || '操作未确认，请检查网络后重试'
const dateText = (v: any) => v ? String(v).slice(0, 10) : '-'
const codeState = (c: any) => c.state !== 'released' ? stateLabels[c.state] : c.available_now ? '可再次领用' : c.current_task_id ? (c.current_state === 'used' ? '其他任务已生产' : c.current_state === 'pending' ? '其他任务待审核' : '其他任务待生产') : '暂不可领用，请核对码状态'
let detailRequest = 0
let refreshTimer: ReturnType<typeof setInterval> | undefined
function refreshVisible() {
  if (document.visibilityState === 'visible' && !busy.value && !showForm.value && !showHistory.value) { void refresh(); void loadDetail() }
}
onMounted(() => { refreshTimer = setInterval(refreshVisible, 20000); window.addEventListener('focus', refreshVisible) })
onBeforeUnmount(() => { clearInterval(refreshTimer); window.removeEventListener('focus', refreshVisible) })
function resetForm() {
  form.value = emptyForm(); allocation.value = emptyAllocation(); productSearch.value = ''
  editingTask.value = null; sourceTask.value = null; appendCodes.value = false; destination.value = 'new'; destinationId.value = ''
  requestId.value = crypto.randomUUID()
}
function openCreate() { mode.value = 'create'; resetForm(); showForm.value = true }
async function openTaskForm(t: any, kind: 'edit' | 'transfer') {
  mode.value = kind; resetForm(); editingTask.value = t
  productCache.set(String(t.product_id), t.product_name)
  form.value = { name: t.name, lineName: t.line_name || t.name, productId: String(t.product_id), batchNo: t.batch_no, produceDate: dateText(t.produce_date), expireDate: dateText(t.expire_date), qcResult: String(t.qc_result), qualityCertNo: t.quality_cert_no }
  if (kind === 'transfer') {
    sourceTask.value = t; allocation.value = { kind: 'task', sourceId: String(t.id), quantity: Math.min(Number(t.available_count), 10000), content: '' }
    form.value.name = t.name + '续产'; form.value.lineName = ''; form.value.batchNo = ''; form.value.qualityCertNo = ''
    form.value.produceDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date())
    if (form.value.expireDate < form.value.produceDate) form.value.expireDate = ''
  }
  showForm.value = true; await refreshSources()
}
async function loadDetail(id = selected.value) {
  if (!id) return
  const request = ++detailRequest
  detailBusy.value = true
  try {
    const result = await $fetch('/api/admin/production-tasks/' + id, { query: { state: state.value, page: detailPage.value } })
    if (request === detailRequest) { detail.value = result; selected.value = id }
  } catch (e) { if (request === detailRequest) toast.add({ title: message(e), color: 'error' }) }
  finally { if (request === detailRequest) detailBusy.value = false }
}
watch(state, () => { detailPage.value = 1; void loadDetail() })
watch(detailPage, () => { void loadDetail() })
async function selectTask(id: number) { selected.value = id; state.value = ''; detailPage.value = 1; await loadDetail(id) }
function allocationBody() {
  return allocation.value.kind === 'manual' ? { content: allocation.value.content } : { [allocation.value.kind === 'task' ? 'sourceTaskId' : 'sourceUploadBatchId']: Number(allocation.value.sourceId), quantity: Number(allocation.value.quantity) }
}
async function saveTask() {
  if (busy.value) return
  if (!existingDestination.value && (!form.value.produceDate || !form.value.expireDate)) { toast.add({ title: '请选择生产日期和有效期至', color: 'warning' }); return }
  busy.value = true
  try {
    const metadata = { ...form.value, productId: Number(form.value.productId), qcResult: Number(form.value.qcResult), requestId: requestId.value }
    let result: any
    if (existingDestination.value) result = await $fetch(`/api/admin/production-tasks/${destinationId.value}/append`, { method: 'POST', body: { ...allocationBody(), requestId: requestId.value } })
    else if (mode.value === 'edit') result = await $fetch(`/api/admin/production-tasks/${editingTask.value.id}`, { method: 'PATCH', body: { ...metadata, ...(appendCodes.value ? { allocation: allocationBody() } : {}) } })
    else result = await $fetch('/api/admin/production-tasks', { method: 'POST', body: { ...metadata, ...allocationBody() } })
    toast.add({ title: mode.value === 'edit' ? '任务已保存' : '领用成功，扫码后绑定生产资料', color: 'success' })
    showForm.value = false; await refresh(); await selectTask(result.id)
  } catch (e) { toast.add({ title: message(e), color: 'error' }) } finally { busy.value = false }
}
async function act(action: 'end' | 'review' | 'scan', body: Record<string, unknown>) {
  if (busy.value || !selected.value) return
  if (action === 'end' && !confirm('结束后禁止继续扫码，未使用码将提交管理员审核。确认结束？')) return
  busy.value = true
  try {
    const r = await $fetch<any>(`/api/admin/production-tasks/${selected.value}/${action}`, { method: 'POST', body })
    toast.add({ title: action === 'scan' ? (r.duplicate ? '该码已成功生产，不重复计数' : '生产扫码已确认') : '操作成功', color: 'success' })
    scanCode.value = ''; await loadDetail(); await refresh()
  } catch (e) { toast.add({ title: message(e), color: 'error' }) } finally { busy.value = false }
}
async function loadHistory(c: any) {
  try { history.value = await $fetch(`/api/admin/production-tasks/${selected.value}/code-history`, { query: { codeId: c.code_id } }); showHistory.value = true }
  catch (e) { toast.add({ title: message(e), color: 'error' }) }
}
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-3"><div><h1 class="b-page-title">生产任务与剩余码审核</h1><p class="b-page-desc">选择码文件或已审核任务，按数量领用；生产扫码后才绑定批次资料。</p></div><UButton v-if="canWrite" @click="openCreate">新建任务</UButton></div>
    <div class="b-card p-5 space-y-3">
      <div class="flex justify-between"><h2 class="font-semibold">任务使用情况</h2><UButton variant="outline" @click="refresh(); loadDetail()">刷新</UButton></div>
      <p class="text-sm text-muted">本任务已生产保留历史；可再次领用和已转领反映当前去向。</p>
      <p v-if="error" class="text-error">任务查询失败，请检查网络后重试。</p><p v-else-if="pending">正在加载…</p><p v-else-if="!data?.rows?.length">暂无生产任务。</p>
      <div v-else class="overflow-x-auto"><table class="b-table"><thead><tr class="text-left"><th>任务 / 生产线 / 批号</th><th>累计领用</th><th>本任务已生产</th><th>待生产</th><th>待审核</th><th>可再次领用</th><th>已转领</th><th>状态与操作</th></tr></thead><tbody><tr v-for="t in data.rows" :key="t.id" class="border-t">
        <td class="py-3 min-w-48"><strong>{{ t.name }}</strong><br />{{ t.line_name || t.name }} · {{ t.batch_no }}<br /><span class="text-muted">{{ t.product_name }}</span></td><td>{{ t.total }}</td><td>{{ t.used_count }}</td><td>{{ t.reserved_count }}</td><td>{{ t.pending_count }}</td><td>{{ t.available_count }}</td><td>{{ t.transferred_count }}<span v-if="t.transferred_used_count" class="block text-xs text-muted">其中已生产 {{ t.transferred_used_count }}</span></td>
        <td class="py-3"><p class="mb-2">{{ statusLabels[t.status] }}</p><div class="flex flex-wrap gap-2"><UButton size="sm" variant="outline" @click="selectTask(t.id)">查看</UButton><UButton v-if="canEdit(t)" size="sm" variant="outline" @click="openTaskForm(t, 'edit')">编辑</UButton><UButton v-if="canWrite && t.available_count > 0" size="sm" @click="openTaskForm(t, 'transfer')">领取剩余码</UButton></div></td>
      </tr></tbody></table></div>
      <div class="flex items-center gap-3"><UButton :disabled="page <= 1" variant="outline" @click="page--">上一页</UButton><span>第 {{ page }} 页</span><UButton :disabled="page * 30 >= (data?.total || 0)" variant="outline" @click="page++">下一页</UButton></div>
    </div>
    <div v-if="detail && selected" class="b-card p-5 space-y-4">
      <div class="flex flex-wrap justify-between gap-2"><h2 class="font-semibold">{{ detail.task.name }} · {{ statusLabels[detail.task.status] }}</h2><div class="flex gap-2"><UButton v-if="canEdit(detail.task)" variant="outline" @click="openTaskForm(detail.task, 'edit')">编辑任务</UButton><UButton v-if="canWrite && detail.task.available_count > 0" @click="openTaskForm(detail.task, 'transfer')">领取剩余码</UButton></div></div>
      <p>{{ detail.task.product_name }} / {{ detail.task.line_name || detail.task.name }} / 批号 {{ detail.task.batch_no }} / 生产日期 {{ dateText(detail.task.produce_date) }} / 有效期 {{ dateText(detail.task.expire_date) }} / 合格证 {{ detail.task.quality_cert_no }}</p>
      <div class="flex flex-wrap gap-4 rounded bg-elevated p-3 text-sm"><span>累计领用 {{ detail.task.total }}</span><span>本任务已生产 {{ detail.task.used_count }}</span><span>待生产 {{ detail.task.reserved_count }}</span><span>待审核 {{ detail.task.pending_count }}</span><span>可再次领用 {{ detail.task.available_count }}</span><span>已转领 {{ detail.task.transferred_count }}（其中已生产 {{ detail.task.transferred_used_count }}）</span></div>
      <div v-if="canWrite && detail.task.status === 'active'" class="flex flex-wrap gap-3"><input v-model="scanCode" class="rounded border p-2" placeholder="输入或扫描本任务二维码" @keydown.enter.prevent="act('scan', { code: scanCode, device: '后台生产采集' })" /><UButton :disabled="busy || !scanCode" @click="act('scan', { code: scanCode, device: '后台生产采集' })">确认生产扫码</UButton><UButton v-if="canEdit(detail.task)" color="warning" :disabled="busy" @click="act('end', {})">结束生产</UButton></div>
      <div v-if="canManageUsers && ['pending', 'rejected'].includes(detail.task.status)" class="space-y-3"><textarea v-model="reason" maxlength="500" class="w-full rounded border p-2" placeholder="填写审核原因，确认未使用包装可再次领用" /><UButton :disabled="busy || !reason.trim()" @click="act('review', { decision: 'approve', reason })">批准剩余码再次领用</UButton><UButton class="ml-3" color="warning" :disabled="busy || !reason.trim()" @click="act('review', { decision: 'reject', reason })">退回，继续锁定</UButton></div>
      <label>码明细筛选 <select v-model="state" class="rounded border p-2"><option value="">全部</option><option v-for="(label, value) in stateLabels" :key="value" :value="value">{{ label }}</option></select></label><p v-if="detailBusy">正在加载…</p>
      <div class="overflow-x-auto"><table class="b-table"><thead><tr class="text-left"><th>追溯码</th><th>当前情况</th><th>当前任务 / 实际生产线 / 批号</th><th>生产时间 / 设备</th><th>流转</th></tr></thead><tbody><tr v-for="c in detail.rows" :key="c.code_id" class="border-t"><td class="py-2 font-mono">{{ c.code }}</td><td>{{ codeState(c) }}</td><td><button v-if="c.current_task_id" class="text-primary underline" @click="selectTask(c.current_task_id)">{{ c.current_task_name }}</button><span v-else>-</span><br />{{ c.actual_line_name || '-' }} / {{ c.current_batch_no || '-' }}</td><td>{{ c.current_used_at || '-' }} / {{ c.current_device || '-' }}</td><td><UButton size="sm" variant="ghost" @click="loadHistory(c)">流转记录</UButton></td></tr></tbody></table></div>
      <div class="flex gap-3"><UButton :disabled="detailPage <= 1 || detailBusy" variant="outline" @click="detailPage--">上一页</UButton><span>第 {{ detailPage }} 页，共 {{ detailTotal }} 个码</span><UButton :disabled="detailPage * 100 >= detailTotal || detailBusy" variant="outline" @click="detailPage++">下一页</UButton></div>
      <div v-if="detail.reviews.length"><h3 class="font-semibold">审核记录</h3><p v-for="r in detail.reviews" :key="r.id">{{ r.created_at }} · {{ r.reviewer_name || r.reviewer_id }} · {{ r.decision === 'approve' ? '批准' : '退回' }} {{ r.remaining_count }}个 · {{ r.reason }}</p></div>
      <details v-if="detail.changes?.length"><summary class="cursor-pointer font-semibold">任务修改与领用记录</summary><p v-for="r in detail.changes" :key="r.id" class="mt-2 text-sm">{{ r.created_at }} · {{ r.actor_name }} · {{ r.action === 'create' ? '创建并领用' : r.action === 'append' ? '追加领用' : '编辑任务' }}<span v-if="r.detail?.before">：{{ r.detail.before.name }} / {{ r.detail.before.lineName }} → {{ r.detail.after.name }} / {{ r.detail.after.lineName }}</span><span v-if="r.detail?.count || r.detail?.result?.added"> · 领用 {{ r.detail.count || r.detail.result.added }} 个</span></p></details>
    </div>
    <UModal v-model:open="showForm" :dismissible="!busy" :close="{ 'aria-label': '关闭' }" :ui="{ content: 'max-w-3xl' }" :title="mode === 'edit' ? '编辑生产任务' : mode === 'transfer' ? '领取剩余码' : '新建生产任务'">
      <template #body><form id="production-task-form" class="space-y-4" @submit.prevent="saveTask"><fieldset :disabled="busy" class="space-y-4">
        <label v-if="mode === 'transfer'" class="block space-y-1"><span>领用到</span><select v-model="destination" class="w-full rounded border p-2"><option value="new">新建下一批任务</option><option value="existing">现有生产中的任务</option></select></label>
        <label v-if="existingDestination" class="block space-y-1"><span>目标任务</span><select v-model="destinationId" required class="w-full rounded border p-2"><option value="">请选择目标任务</option><option v-for="t in sources?.activeTasks || []" :key="t.id" :value="String(t.id)">{{ t.name }} · {{ t.line_name || t.name }}</option></select><span class="text-sm text-muted">追加到目标任务，使用该任务的生产资料。</span></label>
        <div v-else class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label class="space-y-1"><span>任务名称</span><input v-model="form.name" required maxlength="100" class="w-full rounded border p-2" placeholder="例如：10月9日上午生产" /></label><label class="space-y-1"><span>生产线</span><input v-model="form.lineName" required maxlength="100" class="w-full rounded border p-2" placeholder="例如：一号线" /></label>
          <div class="space-y-1 md:col-span-2"><label for="production-product">产品</label><USelectMenu id="production-product" v-model="form.productId" v-model:search-term="productSearch" :items="productItems" value-key="value" :loading="productLoading" :disabled="busy || mode !== 'create'" required ignore-filter aria-label="产品" :clear="{ 'aria-label': '清除产品选择' }" :search-input="{ placeholder: '输入产品名或登记证号搜索' }" placeholder="搜索并选择产品" class="w-full"><template #default><span class="truncate" :class="{ 'text-muted': !form.productId }">{{ selectedProductLabel || '搜索并选择产品' }}</span></template><template #empty>{{ productError ? '产品加载失败，请重新搜索' : productLoading ? '正在搜索…' : '没有匹配的产品' }}</template></USelectMenu></div>
          <p v-if="!productionEditable" class="md:col-span-2 text-sm text-muted">已有生产记录或任务已结束，生产资料保持原值。更改生产线只影响后续扫码，已生产码保留当时的生产线。</p>
          <label class="space-y-1"><span>生产批号</span><input v-model="form.batchNo" :disabled="!productionEditable" required maxlength="64" class="w-full rounded border p-2" /></label><label class="space-y-1"><span>质量合格证号</span><input v-model="form.qualityCertNo" :disabled="!productionEditable" required maxlength="100" class="w-full rounded border p-2" /></label>
          <div class="space-y-1"><span>生产日期</span><ProductionDatePicker v-model="form.produceDate" label="生产日期" :disabled="busy || !productionEditable" /></div><div class="space-y-1"><span>有效期至</span><ProductionDatePicker v-model="form.expireDate" label="有效期至" :min="form.produceDate" :disabled="busy || !productionEditable" /></div><label class="space-y-1"><span>质检结果</span><select v-model="form.qcResult" :disabled="!productionEditable" required class="w-full rounded border p-2"><option value="">请选择</option><option value="1">合格</option></select></label>
        </div>
        <label v-if="mode === 'edit' && editingTask?.status === 'active'" class="flex items-center gap-2"><input v-model="appendCodes" type="checkbox" />同时追加领用</label>
        <ProductionAllocationPicker v-if="mode !== 'edit' || appendCodes" v-model="allocation" :sources="sources" :fixed-source="sourceTask" :loading="sourceLoading" :disabled="busy" /><p v-if="sourceError && (mode !== 'edit' || appendCodes)" class="text-error">码来源加载失败，请关闭弹窗后重试。</p>
      </fieldset></form></template>
      <template #footer><UButton type="submit" form="production-task-form" :loading="busy">{{ mode === 'edit' ? '保存任务' : '确认领用' }}</UButton><UButton variant="outline" :disabled="busy" @click="showForm = false">取消</UButton></template>
    </UModal>
    <UModal v-model:open="showHistory" title="追溯码流转记录" :close="{ 'aria-label': '关闭' }" :ui="{ content: 'max-w-3xl' }"><template #body><p class="mb-3 font-mono text-sm">{{ history?.code }}</p><div class="overflow-x-auto"><table class="b-table"><thead><tr class="text-left"><th>任务 / 批号</th><th>生产线</th><th>领用 / 生产 / 放行时间</th><th>记录</th></tr></thead><tbody><tr v-for="r in history?.rows || []" :key="r.task_id" class="border-t"><td class="py-3">{{ r.name }}<br />{{ r.batch_no }}</td><td>{{ r.state === 'used' ? (r.used_line || '历史未记录') : (r.line_name || r.name) }}</td><td>{{ r.allocated_at }}<br />{{ r.used_at || '-' }}<br />{{ r.released_at || '-' }}</td><td>{{ stateLabels[r.state] }}<br />{{ r.operator_name || '-' }} / {{ r.device || '-' }}</td></tr></tbody></table></div></template></UModal>
  </div>
</template>

<style scoped>
.b-table th, .b-table td { padding: 0.625rem 0.5rem; }
.b-table tbody tr { border-top-color: var(--b-divider); }
.b-table td:first-child { max-width: 18rem; overflow-wrap: anywhere; }
.b-table td.font-mono { white-space: nowrap; }
</style>
