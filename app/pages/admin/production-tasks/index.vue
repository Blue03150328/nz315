<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '生产任务与剩余码审核' })
const { user, canWrite, canManageUsers } = useUser()
const toast = useToast()
const page = ref(1)
const { data, pending, error, refresh } = await useFetch<any>('/api/admin/production-tasks', { query: { page } })
const productKeyword = ref('')
const { data: products } = await useFetch<any>('/api/admin/products', { query: { page: 1, pageSize: 100, status: 1, keyword: productKeyword } })
const emptyForm = () => ({ requestId: crypto.randomUUID(), name: '', productId: '', batchNo: '', produceDate: '', expireDate: '', qcResult: '', qualityCertNo: '', content: '' })
const form = ref(emptyForm())
const busy = ref(false)
watch(() => [form.value.name, form.value.productId, form.value.batchNo, form.value.produceDate, form.value.expireDate, form.value.qcResult, form.value.qualityCertNo, form.value.content], () => { if (!busy.value) form.value.requestId = crypto.randomUUID() })
const selected = ref<number | null>(null)
const detail = ref<any>(null)
const state = ref('')
const detailPage = ref(1)
const detailBusy = ref(false)
const reason = ref('')
const scanCode = ref('')
const statusLabels: Record<string, string> = { active: '生产中', pending: '剩余码待审核', rejected: '审核退回，继续锁定', approved: '生产已结束，剩余码已放行' }
const stateLabels: Record<string, string> = { reserved: '已领用未生产', used: '已生产', pending: '待审核', released: '已释放，可再次领用' }
const codes = computed(() => [...new Set(form.value.content.split(/\r?\n/).map(c => c.trim()).filter(Boolean))])
const detailTotal = computed(() => (detail.value?.counts || []).filter((c: any) => !state.value || c.state === state.value).reduce((n: number, c: any) => n + Number(c.count), 0))
const message = (e: any) => e?.data?.statusMessage || '操作未确认，请检查网络后重试'
async function loadDetail(id = selected.value) {
  if (!id) return
  detailBusy.value = true
  try { detail.value = await $fetch('/api/admin/production-tasks/' + id, { query: { state: state.value, page: detailPage.value } }); selected.value = id }
  catch (e) { toast.add({ title: message(e), color: 'error' }) }
  finally { detailBusy.value = false }
}
watch(state, () => { detailPage.value = 1; void loadDetail() })
watch(detailPage, () => { void loadDetail() })
async function selectTask(id: number) { state.value = ''; detailPage.value = 1; await loadDetail(id) }
async function createTask() {
  if (busy.value) return
  busy.value = true
  try {
    const result = await $fetch<any>('/api/admin/production-tasks', { method: 'POST', body: { ...form.value, productId: Number(form.value.productId), qcResult: Number(form.value.qcResult), codes: codes.value } })
    toast.add({ title: '领用成功，实际生产扫码后才绑定生产资料', color: 'success' })
    form.value = emptyForm(); await refresh(); await selectTask(result.id)
  } catch (e) { toast.add({ title: message(e), color: 'error' }) }
  finally { busy.value = false }
}
async function readFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) form.value.content = await file.text()
}
async function act(action: 'end' | 'review' | 'scan', body: Record<string, unknown>) {
  if (busy.value || !selected.value) return
  if (action === 'end' && !confirm('结束后禁止继续扫码，未使用码将提交管理员审核。确认结束？')) return
  if (action === 'review' && !confirm('确认本次审核结果？批准只释放未生产码，已生产码保持原资料。')) return
  busy.value = true
  try {
    const r = await $fetch<any>(`/api/admin/production-tasks/${selected.value}/${action}`, { method: 'POST', body })
    toast.add({ title: action === 'scan' ? (r.duplicate ? '该码已成功生产，不重复计数' : '生产扫码已确认') : '操作成功', color: 'success' })
    scanCode.value = ''; await loadDetail(); await refresh()
  } catch (e) { toast.add({ title: message(e), color: 'error' }) }
  finally { busy.value = false }
}
</script>

<template>
  <div class="space-y-5">
    <div><h1 class="b-page-title">生产任务与剩余码审核</h1><p class="b-page-desc">先领用具体码清单，生产逐码确认；结束后自动统计剩余码，由管理员审核放行。</p></div>
    <form v-if="canWrite" class="b-card p-5 space-y-3" @submit.prevent="createTask">
      <h2 class="font-semibold">开始生产并领用</h2>
      <fieldset :disabled="busy" class="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label class="space-y-1"><span>任务名称</span><input v-model="form.name" required maxlength="100" class="w-full rounded border p-2" placeholder="例如：一号线上午生产" /></label>
        <label class="space-y-1"><span>搜索产品</span><input v-model="productKeyword" class="w-full rounded border p-2" placeholder="输入产品名或登记证号" /></label>
        <label class="space-y-1"><span>产品</span><select v-model="form.productId" required class="w-full rounded border p-2"><option value="">请选择产品</option><option v-for="p in products?.rows || []" :key="p.id" :value="p.id">{{ p.name }} · {{ p.registration_no }}</option></select></label>
        <label class="space-y-1"><span>生产批号</span><input v-model="form.batchNo" required maxlength="64" class="w-full rounded border p-2" /></label>
        <label class="space-y-1"><span>生产日期</span><input v-model="form.produceDate" required type="date" class="w-full rounded border p-2" /></label>
        <label class="space-y-1"><span>有效期至</span><input v-model="form.expireDate" required type="date" class="w-full rounded border p-2" /></label>
        <label class="space-y-1"><span>质检结果</span><select v-model="form.qcResult" required class="w-full rounded border p-2"><option value="">请选择</option><option value="1">合格</option></select></label>
        <label class="space-y-1"><span>质量合格证号</span><input v-model="form.qualityCertNo" required maxlength="100" class="w-full rounded border p-2" /></label>
        <label class="space-y-1"><span>导入领用码清单</span><input type="file" accept=".txt,.csv" @change="readFile" /></label>
        <label class="md:col-span-3 space-y-1"><span>具体码清单（每行一个32位码，最多10000个）</span><textarea v-model="form.content" required rows="5" class="w-full rounded border p-2 font-mono text-sm" placeholder="仅填写数量不能领用；请先将生成码入库留档" /></label>
      </fieldset>
      <p class="text-sm text-muted">已填写 {{ codes.length }} 个不同码。领用不写入生产日期；历史已绑定码不能直接回收。</p>
      <UButton type="submit" :loading="busy">确认领用并创建任务</UButton>
    </form>
    <div class="b-card p-5 space-y-3">
      <div class="flex justify-between"><h2 class="font-semibold">任务使用情况</h2><UButton variant="outline" @click="refresh()">刷新</UButton></div>
      <p v-if="error" class="text-error">任务查询失败，请检查网络后重试。</p>
      <p v-else-if="pending">正在加载…</p>
      <p v-else-if="!data?.rows?.length">暂无生产任务。</p>
      <div v-else class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="text-left"><th>任务 / 产品 / 批号</th><th>领用</th><th>已用</th><th>未用</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="t in data.rows" :key="t.id" class="border-t"><td class="py-3">{{ t.name }}<br />{{ t.product_name }} · {{ t.batch_no }}</td><td>{{ t.total }}</td><td>{{ t.used_count }}</td><td>{{ Number(t.total) - Number(t.used_count) }}</td><td>{{ statusLabels[t.status] }}</td><td><UButton size="sm" variant="outline" @click="selectTask(t.id)">查看与审核</UButton></td></tr></tbody></table></div>
      <div class="flex items-center gap-3"><UButton :disabled="page <= 1" variant="outline" @click="page--">上一页</UButton><span>第 {{ page }} 页</span><UButton :disabled="page * 30 >= (data?.total || 0)" variant="outline" @click="page++">下一页</UButton></div>
    </div>
    <div v-if="detail && selected" class="b-card p-5 space-y-4">
      <h2 class="font-semibold">{{ detail.task.name }} · {{ statusLabels[detail.task.status] }}</h2>
      <p>{{ detail.task.product_name }} / 批号 {{ detail.task.batch_no }} / 生产日期 {{ String(detail.task.produce_date).slice(0, 10) }} / 有效期 {{ String(detail.task.expire_date).slice(0, 10) }} / 合格证 {{ detail.task.quality_cert_no }}</p>
      <p><span v-for="c in detail.counts" :key="c.state" class="mr-4">{{ stateLabels[c.state] }}：{{ c.count }}</span></p>
      <div v-if="canWrite && detail.task.status === 'active'" class="flex flex-wrap gap-3">
        <input v-model="scanCode" class="rounded border p-2" placeholder="输入或扫描本任务二维码" @keydown.enter.prevent="act('scan', { code: scanCode, device: '后台生产采集' })" />
        <UButton :disabled="busy || !scanCode" @click="act('scan', { code: scanCode, device: '后台生产采集' })">确认生产扫码</UButton>
        <UButton v-if="canManageUsers || Number(detail.task.created_by) === Number(user?.id)" color="warning" :disabled="busy" @click="act('end', {})">结束生产并提交剩余码</UButton>
      </div>
      <div v-if="canManageUsers && ['pending', 'rejected'].includes(detail.task.status)" class="space-y-3">
        <textarea v-model="reason" maxlength="500" class="w-full rounded border p-2" placeholder="填写审核原因，确认未使用包装可再次领用" />
        <UButton :disabled="busy || !reason.trim()" @click="act('review', { decision: 'approve', reason })">批准剩余码再次领用</UButton>
        <UButton class="ml-3" color="warning" :disabled="busy || !reason.trim()" @click="act('review', { decision: 'reject', reason })">退回，继续锁定</UButton>
      </div>
      <label>码明细筛选 <select v-model="state" class="rounded border p-2"><option value="">全部</option><option v-for="(label, value) in stateLabels" :key="value" :value="value">{{ label }}</option></select></label>
      <p v-if="detailBusy">正在加载…</p>
      <div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="text-left"><th>追溯码</th><th>状态</th><th>使用时间 / 设备</th></tr></thead><tbody><tr v-for="c in detail.rows" :key="c.code_id" class="border-t"><td class="py-2 font-mono">{{ c.code }}</td><td>{{ stateLabels[c.state] }}</td><td>{{ c.used_at || '-' }} / {{ c.device || '-' }}</td></tr></tbody></table></div>
      <div class="flex gap-3"><UButton :disabled="detailPage <= 1 || detailBusy" variant="outline" @click="detailPage--">上一页</UButton><span>第 {{ detailPage }} 页，共 {{ detailTotal }} 个码</span><UButton :disabled="detailPage * 100 >= detailTotal || detailBusy" variant="outline" @click="detailPage++">下一页</UButton></div>
      <div v-if="detail.reviews.length"><h3 class="font-semibold">审核记录</h3><p v-for="r in detail.reviews" :key="r.id">{{ r.created_at }} · {{ r.reviewer_name || r.reviewer_id }} · {{ r.decision === 'approve' ? '批准' : '退回' }} {{ r.remaining_count }}个 · {{ r.reason }}</p></div>
    </div>
  </div>
</template>
