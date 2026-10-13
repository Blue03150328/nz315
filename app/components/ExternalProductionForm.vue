<script setup lang="ts">
const props = defineProps<{ batch: any }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [] }>()
const toast = useToast()
const saving = ref(false)
const productMode = ref<'select' | 'manual'>('select')
const form = reactive({ productId: undefined as string | undefined, productName: '', batchNo: '', produceDate: '', quantityMode: 'actual', quantity: '' })
const productSearch = ref(''), productRows = ref<any[]>([]), productsLoading = ref(false), productsError = ref('')
const productLabels = reactive(new Map<string, string>())
let productRequest = 0
const productItems = computed(() => {
  const items = productRows.value.map(row => ({ value: String(row.id), label: `${row.name} · ${row.spec_name || '规格未填写'}（${row.registration_no}）` }))
  if (form.productId && !items.some(row => row.value === form.productId)) items.unshift({ value: form.productId, label: productLabels.get(form.productId) || '已选产品' })
  return items
})
async function loadProducts() {
  if (!open.value || productMode.value !== 'select') return
  const request = ++productRequest
  productsLoading.value = true
  productsError.value = ''
  try {
    const result = await $fetch<any>('/api/admin/products', { query: { enterpriseId: props.batch.enterprise_id, keyword: productSearch.value || undefined, status: 1, pageSize: 30 } })
    if (request === productRequest && open.value) {
      productRows.value = result.rows || []
      for (const row of productRows.value) productLabels.set(String(row.id), `${row.name} · ${row.spec_name || '规格未填写'}（${row.registration_no}）`)
    }
  } catch (error: any) {
    if (request === productRequest) productsError.value = error?.data?.statusMessage || '产品加载失败，请重试'
  } finally {
    if (request === productRequest) productsLoading.value = false
  }
}
watch(open, visible => {
  if (!visible) { productRequest++; return }
  const batch = props.batch
  productMode.value = batch.product_id ? 'select' : batch.product_name_snapshot ? 'manual' : 'select'
  Object.assign(form, { productId: batch.product_id ? String(batch.product_id) : undefined, productName: batch.product_name_snapshot || '', batchNo: batch.batch_no || '', produceDate: batch.produce_date ? String(batch.produce_date).slice(0, 10) : '', quantityMode: batch.production_quantity === null || batch.production_quantity === undefined ? 'actual' : 'manual', quantity: String(batch.production_quantity ?? batch.accepted_count) })
  productSearch.value = ''
  productRows.value = []
  productLabels.clear()
  if (form.productId) productLabels.set(form.productId, batch.product_name_snapshot || '已选产品')
  void loadProducts()
})
watch(productMode, () => { void loadProducts() })
watch(productSearch, (_, __, cleanup) => { const timer = setTimeout(() => { void loadProducts() }, 250); cleanup(() => clearTimeout(timer)) })
async function save() {
  if (saving.value) return
  if (productMode.value === 'select' ? !form.productId : !form.productName.trim()) { toast.add({ title: '请选择产品或输入产品名称', color: 'warning' }); return }
  if (!form.batchNo.trim() || !form.produceDate) { toast.add({ title: '请填写生产批号和生产日期', color: 'warning' }); return }
  const quantity = form.quantityMode === 'manual' ? Number(form.quantity) : null
  if (quantity !== null && (!Number.isSafeInteger(quantity) || quantity < 1)) { toast.add({ title: '生产数量须为正整数', color: 'warning' }); return }
  saving.value = true
  try {
    await $fetch(`/api/admin/external-collections/${props.batch.id}`, { method: 'PATCH', body: { productId: productMode.value === 'select' ? Number(form.productId) : null, productName: productMode.value === 'manual' ? form.productName : '', batchNo: form.batchNo, produceDate: form.produceDate, productionQuantity: quantity } })
    toast.add({ title: '外部生产资料已保存', color: 'success' })
    open.value = false
    emit('saved')
  } catch (error: any) {
    toast.add({ title: error?.data?.statusMessage || '保存未完成，请重试', color: 'error' })
  } finally { saving.value = false }
}
</script>

<template>
  <UModal v-model:open="open" title="外部生产资料" :dismissible="!saving" :ui="{ content: 'max-w-xl' }">
    <template #content>
      <form class="b-modal" @submit.prevent="save">
        <div class="b-modal-head"><h2 class="b-modal-title">外部生产资料</h2></div>
        <div class="b-modal-body">
          <p class="b-help">生产线：{{ batch.line_name }} · 工号：{{ batch.worker_no }} · 实际采集 {{ batch.accepted_count }} 条码</p>
          <div>
            <label class="b-label">产品 <span class="b-required">*</span></label>
            <div class="mb-2 flex gap-2">
              <UButton type="button" size="sm" :variant="productMode === 'select' ? 'solid' : 'outline'" :disabled="saving" @click="productMode = 'select'">选择已有产品</UButton>
              <UButton type="button" size="sm" :variant="productMode === 'manual' ? 'solid' : 'outline'" :disabled="saving" @click="productMode = 'manual'">手动输入名称</UButton>
            </div>
            <template v-if="productMode === 'select'">
              <USelectMenu v-model="form.productId" v-model:search-term="productSearch" :search-input="{ placeholder: '搜索产品名称或登记证号' }" :items="productItems" value-key="value" :loading="productsLoading" :ignore-filter="true" :disabled="saving" placeholder="搜索产品名称或登记证号" class="w-full">
                <template #empty>没有找到本企业产品，可切换为手动输入名称</template>
              </USelectMenu>
              <div v-if="productsError" class="mt-1 text-sm text-error">{{ productsError }} <UButton type="button" variant="link" @click="loadProducts">重试</UButton></div>
            </template>
            <UInput v-else v-model="form.productName" :disabled="saving" maxlength="200" aria-label="手动产品名称" placeholder="输入本次生产的产品名称" class="w-full" />
          </div>
          <div><label class="b-label">生产批号 <span class="b-required">*</span></label><UInput v-model="form.batchNo" :disabled="saving" maxlength="100" aria-label="生产批号" placeholder="填写厂家的生产批号" class="w-full" /></div>
          <div><label class="b-label">生产日期 <span class="b-required">*</span></label><ProductionDatePicker v-model="form.produceDate" label="生产日期" :disabled="saving" /></div>
          <div>
            <label class="b-label">生产数量</label>
            <USelect v-model="form.quantityMode" :items="[{ label: `按实际采集码数（${batch.accepted_count}）`, value: 'actual' }, { label: '手动填写生产数量', value: 'manual' }]" :disabled="saving" class="w-full" />
            <UInput v-if="form.quantityMode === 'manual'" v-model="form.quantity" type="number" min="1" step="1" :disabled="saving" aria-label="手填生产数量" class="mt-2 w-full" />
            <p class="b-help">实际采集码数单独保留，文件导出包含本批实际保存的全部溯源码。</p>
          </div>
        </div>
        <div class="b-modal-foot"><UButton type="button" color="neutral" variant="outline" :disabled="saving" @click="open = false">取消</UButton><UButton type="submit" :loading="saving">保存生产资料</UButton></div>
      </form>
    </template>
  </UModal>
</template>
