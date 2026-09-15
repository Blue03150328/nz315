<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '生产绑定' })
const route = useRoute()
const toast = useToast()
const { user } = useUser()
const base = '/api/admin/codes/upload-batches/' + route.params.id
const { data: context, error, refresh } = await useFetch<any>(base + '/binding-context')
const productId = ref<number>()
const mode = ref('existing')
const batchId = ref<number>()
const keyword = ref('')
const batchPage = ref(1)
const form = reactive({ batchNo: '', produceDate: '', qualityCertNo: '', expireDate: '', qcReportNo: '', qcResult: 1 })
const products = computed(() => [...new Map((context.value?.groups || []).filter((g: any) => g.productId).map((g: any) => [g.productId, { value: g.productId, label: g.productName }])).values()] as { value: number; label: string }[])
watch(products, options => { if (!productId.value && options.length === 1) productId.value = options[0]!.value }, { immediate: true })
const { data: batches } = await useFetch<any>('/api/admin/batches', { query: computed(() => ({ productId: productId.value, keyword: keyword.value, page: batchPage.value, pageSize: 20 })) })
const batchOptions = computed(() => (batches.value?.rows || []).filter((b: any) => Number(b.product_id) === productId.value).map((b: any) => ({ value: Number(b.id), label: b.batch_no })))
const selectedBatch = computed(() => (batches.value?.rows || []).find((b: any) => Number(b.id) === batchId.value))
const preview = ref<any>(null)
const busy = ref(false)
const failure = ref('')
const requestKey = ref('')
const body = computed(() => ({ productId: productId.value, mode: mode.value,
  ...(mode.value === 'existing' ? { batchId: batchId.value } : { newBatch: { ...form, expireDate: form.expireDate || undefined, qcReportNo: form.qcReportNo || undefined } }) }))
watch(body, () => { preview.value = null; requestKey.value = '' }, { deep: true })
watch(productId, () => { batchId.value = undefined; batchPage.value = 1 })
watch(keyword, () => { batchPage.value = 1; batchId.value = undefined })
async function run(confirm = false) {
  busy.value = true
  failure.value = ''
  try {
    if (confirm) {
      const result: any = await $fetch(base + '/bind', { method: 'POST', body: { ...body.value, previewToken: preview.value.previewToken, requestKey: requestKey.value } })
      toast.add({ title: '生产绑定完成，共 ' + result.bound + ' 条', color: 'success' })
      preview.value = null
      await refresh()
      await navigateTo('/admin/codes')
    } else {
      preview.value = await $fetch(base + '/bind/preview', { method: 'POST', body: body.value })
      requestKey.value = crypto.randomUUID()
    }
  } catch (e: any) { failure.value = e?.data?.statusMessage || '操作失败，请重试'; toast.add({ title: e?.data?.statusMessage || '操作失败，请重试', color: 'error' }) }
  finally { busy.value = false }
}
</script>

<template>
  <div class="space-y-4 max-w-5xl">
    <div class="flex items-center justify-between"><h1 class="b-page-title">生产绑定</h1><UButton to="/admin/codes" color="neutral" variant="outline">返回码库</UButton></div>
    <p v-if="error" class="b-tag-danger">{{ error?.data?.statusMessage || '上传文件读取失败，请返回码库重试' }}</p>
    <p v-if="failure" role="alert" class="b-note text-red-700">{{ failure }}</p>
    <template v-if="context">
      <div class="b-card p-5 space-y-2"><p>来源文件：{{ context.file.file_name }}</p><p>文件共 {{ context.total }} 条追溯码，仅对所选产品的未绑定码建立生产关联。</p></div>
      <div class="b-card p-5 space-y-4">
        <div><label class="b-label">关联产品</label><USelect v-model="productId" :items="products" placeholder="选择产品分组" class="w-full" /></div>
        <div><label class="b-label">绑定方式</label><USelect v-model="mode" :items="[{ value: 'existing', label: '绑定已有生产批次' }, { value: 'new', label: '新建生产批次并绑定' }]" class="w-full" /></div>
        <template v-if="mode === 'existing'">
          <UInput v-model="keyword" placeholder="搜索生产批号" class="w-full" />
          <USelect v-model="batchId" :items="batchOptions" placeholder="选择已有生产批次" class="w-full" />
          <div class="flex gap-3 items-center"><UButton :disabled="batchPage === 1" @click="batchPage--">上一页</UButton><span>第 {{ batchPage }} 页</span><UButton :disabled="batchPage * 20 >= (batches?.total || 0)" @click="batchPage++">下一页</UButton></div>
          <div v-if="selectedBatch" class="b-note">生产日期：{{ selectedBatch.produce_date }}；合格证号：{{ selectedBatch.quality_cert_no }}；有效期至：{{ selectedBatch.expire_date || '未填写' }}；质检：{{ selectedBatch.qc_result === 1 ? '合格' : '不合格或未确认' }}</div>
        </template>
        <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label class="b-label">生产批号 *</label><UInput v-model="form.batchNo" maxlength="64" class="w-full" /></div>
          <div><label class="b-label">生产日期 *</label><UInput v-model="form.produceDate" type="date" class="w-full" /></div>
          <div><label class="b-label">质量合格证号 *</label><UInput v-model="form.qualityCertNo" maxlength="64" class="w-full" /></div>
          <div><label class="b-label">有效期至</label><UInput v-model="form.expireDate" type="date" class="w-full" /></div>
          <div><label class="b-label">质检报告号</label><UInput v-model="form.qcReportNo" maxlength="64" class="w-full" /></div>
          <div><label class="b-label">质量检验结果</label><USelect v-model="form.qcResult" :items="[{ value: 1, label: '合格' }, { value: 0, label: '不合格（不可绑定）' }]" class="w-full" /></div>
        </div>
        <UButton :disabled="user?.role === 'viewer'" :loading="busy" @click="run()">预览绑定</UButton>
      </div>
      <div v-if="preview" class="b-card p-5 space-y-3">
        <h2 class="b-page-title">确认绑定范围</h2>
        <p>{{ preview.batchCreated ? '将新建生产批次' : '将使用已有生产批次' }}：{{ preview.batch.batch_no }}</p>
        <p>本次绑定 {{ preview.targetCount }} 条，文件内其他 {{ preview.excludedCount }} 条不参与。</p>
        <p>生产日期：{{ preview.batch.produce_date }}；合格证号：{{ preview.batch.quality_cert_no }}</p>
        <UButton :loading="busy" @click="run(true)">{{ preview.batchCreated ? '确认新建并绑定' : '确认绑定' }}</UButton>
      </div>
    </template>
  </div>
</template>
