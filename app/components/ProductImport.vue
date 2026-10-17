<script setup lang="ts">
import { PRODUCT_IMPORT_HEADERS, PRODUCT_IMPORT_MAX_ROWS, type ProductImportError, type ProductImportWarning } from '#shared/utils/product-import'

const emit = defineEmits<{ imported: [] }>()
const { isPlatformAdmin } = useUser()
const toast = useToast()
const open = ref(false)
const importing = ref(false)
const downloading = ref(false)
const file = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const enterpriseId = ref<number | undefined>()
const keyword = ref('')
const factoryRows = ref<any[]>([])
const factoryBusy = ref(false)
const factoryError = ref('')
const pickedFactory = ref<any>(null)
const result = ref<{ success: number; failed: number; errors: ProductImportError[]; warnings: ProductImportWarning[] } | null>(null)
const requestError = ref('')
let factoryRequest = 0
let timer: ReturnType<typeof setTimeout> | undefined
const factoryItems = computed(() => {
  const rows = [...factoryRows.value]
  if (pickedFactory.value && !rows.some(row => Number(row.id) === Number(pickedFactory.value.id))) rows.unshift(pickedFactory.value)
  return rows.map(row => ({ label: row.name, value: Number(row.id) }))
})
async function loadFactories() {
  if (!isPlatformAdmin.value) return
  const request = ++factoryRequest
  factoryBusy.value = true
  factoryError.value = ''
  try {
    const data = await $fetch<any>('/api/admin/factories', { query: { keyword: keyword.value || undefined, pageSize: 100, status: 1 } })
    if (request === factoryRequest) factoryRows.value = data.rows || []
  } catch (e: any) {
    if (request === factoryRequest) factoryError.value = e?.data?.statusMessage || '企业加载失败，请重试'
  } finally { if (request === factoryRequest) factoryBusy.value = false }
}
watch(keyword, () => { clearTimeout(timer); timer = setTimeout(loadFactories, 250) })
watch(enterpriseId, id => {
  pickedFactory.value = factoryRows.value.find(row => Number(row.id) === id) || pickedFactory.value
  result.value = null
  requestError.value = ''
})
function show() {
  open.value = true
  file.value = null
  result.value = null
  requestError.value = ''
  if (fileInput.value) fileInput.value.value = ''
  loadFactories()
}
function selectFile(e: Event) {
  file.value = (e.target as HTMLInputElement).files?.[0] || null
  result.value = null
  requestError.value = ''
}
async function downloadTemplate() {
  if (downloading.value || importing.value) return
  if (isPlatformAdmin.value && !enterpriseId.value) { requestError.value = '请先选择产品归属企业，再下载本企业模板'; return }
  downloading.value = true
  try {
    const blob = await $fetch<Blob>('/api/admin/products/import-template', { query: isPlatformAdmin.value ? { enterpriseId: enterpriseId.value } : {}, responseType: 'blob' })
    saveBlob(blob, '产品导入模板.xlsx')
  } catch (e: any) { toast.add({ title: e?.data?.statusMessage || '模板下载失败，请重试', color: 'error' }) }
  finally { downloading.value = false }
}
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function downloadFailures() {
  if (!result.value?.errors.length || downloading.value) return
  const errors = result.value.errors
  downloading.value = true
  try {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const rows = [PRODUCT_IMPORT_HEADERS, ...errors.map(error => PRODUCT_IMPORT_HEADERS.map(header => error.values[header] || ''))]
    const sheet = XLSX.utils.aoa_to_sheet(rows)
    sheet['!cols'] = [18, 22, 30, 14, 24, 24, 24].map(wch => ({ wch }))
    XLSX.utils.book_append_sheet(wb, sheet, '产品导入')
    const reasons = XLSX.utils.aoa_to_sheet([['失败文件行号', '原文件行号', '登记证号', '失败原因'], ...errors.map((error, i) => [i + 2, error.row, error.value, error.reason])])
    reasons['!cols'] = [16, 16, 24, 90].map(wch => ({ wch }))
    XLSX.utils.book_append_sheet(wb, reasons, '失败原因')
    saveBlob(new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), '产品导入失败行.xlsx')
  } catch { toast.add({ title: '失败行下载失败，请重试', color: 'error' }) }
  finally { downloading.value = false }
}
async function runImport() {
  if (!file.value || importing.value || result.value) return
  if (isPlatformAdmin.value && !enterpriseId.value) { requestError.value = '请选择产品归属企业'; return }
  if (!/\.(xlsx|xls)$/i.test(file.value.name) || file.value.size > 10 * 1024 * 1024) { requestError.value = '请选择10MB以内的.xlsx或.xls文件'; return }
  importing.value = true
  requestError.value = ''
  try {
    const data = new FormData()
    data.append('file', file.value)
    if (isPlatformAdmin.value) data.append('enterpriseId', String(enterpriseId.value))
    result.value = await $fetch('/api/admin/products/import', { method: 'POST', body: data })
    if (result.value.success) {
      emit('imported')
      toast.add({ title: `成功导入${result.value.success}条产品`, color: 'success' })
    }
  } catch (e: any) { requestError.value = e?.data?.statusMessage || '导入失败，请重试' }
  finally { importing.value = false }
}
onDeactivated(() => { open.value = false })
onBeforeUnmount(() => { clearTimeout(timer); ++factoryRequest })
</script>

<template>
  <UButton color="neutral" variant="outline" icon="i-lucide-upload" @click="show">导入产品</UButton>
  <UModal v-model:open="open" :dismissible="!importing" :ui="{ content: 'max-w-3xl' }">
    <template #content>
      <div class="b-modal">
        <div class="b-modal-head"><h3 class="b-modal-title">导入产品</h3></div>
        <div class="b-modal-body space-y-4 max-h-[70vh] overflow-y-auto">
          <p class="b-hint">每行一个产品，只需填写七列，最多{{ PRODUCT_IMPORT_MAX_ROWS }}行，文件不超过10MB。仅导入第一个工作表。</p>
          <div v-if="isPlatformAdmin" class="space-y-2">
            <label class="b-label">产品归属企业 <span class="b-required">*</span></label>
            <UInput v-model="keyword" :disabled="importing || downloading" placeholder="输入企业关键词搜索" class="w-full" />
            <USelect v-model="enterpriseId" :items="factoryItems" :disabled="importing || downloading" :loading="factoryBusy" placeholder="选择本次全部产品的归属企业" class="w-full" />
            <div v-if="factoryError" role="alert" class="text-sm text-red-600">{{ factoryError }} <button type="button" @click="loadFactories">重试</button></div>
          </div>
          <UButton color="neutral" variant="outline" icon="i-lucide-download" :loading="downloading" :disabled="importing || (isPlatformAdmin && !enterpriseId)" @click="downloadTemplate">下载 Excel 模板</UButton>
          <p class="b-hint">模板包含生产类型下拉、填写说明及本企业启用规格的代码对照表；请先建立规格，再填写代码。</p>
          <ul class="list-disc pl-5 space-y-1 text-sm text-[var(--b-text-secondary)]">
            <li>七列：生产类型、登记证号、产标名、规格代码、原药登记证号1、2、3。产标名指产品商标，无商标可留空。</li>
            <li>生产类型、登记证号、规格代码及原药登记证号1必填；原药2、3按实际填写，不用时留空。</li>
            <li>产品资料、原药企业及成分按完整登记证号补齐；未收录、过期、原药成分不匹配时该行失败。</li>
            <li>规格只匹配本企业已有启用规格，不自动新增。001可填写1；持有人生产须使用本企业登记证。</li>
            <li>同厂家、登记证号、规格及商标重复时不再新增；成功行会导入，失败行保留行号和原因。</li>
          </ul>
          <input ref="fileInput" type="file" accept=".xlsx,.xls" :disabled="importing" aria-label="选择产品导入Excel文件" @change="selectFile">
          <p v-if="file" class="b-hint">已选择：{{ file.name }}</p>
          <p v-if="requestError" role="alert" class="text-sm text-red-600">{{ requestError }}</p>
          <p v-if="importing" role="status" class="b-hint">正在校验并导入，请稍候…</p>
          <div v-if="result" role="status" class="space-y-2">
            <p>成功{{ result.success }}条产品，失败{{ result.failed }}条。</p>
            <p class="b-hint">可下载失败行，按第二张表的原因修正后重新选择文件。已成功产品再次提交会提示重复。</p>
            <UButton v-if="result.errors.length" color="neutral" variant="outline" icon="i-lucide-download" :disabled="downloading" @click="downloadFailures">下载失败行</UButton>
            <div v-if="result.errors.length" class="max-h-64 overflow-auto">
              <table class="b-table w-full"><thead><tr><th>Excel行号</th><th>登记证号</th><th>未导入原因</th></tr></thead>
                <tbody><tr v-for="error in result.errors" :key="error.row"><td>{{ error.row }}</td><td>{{ error.value }}</td><td>{{ error.reason }}</td></tr></tbody>
              </table>
            </div>
            <div v-if="result.warnings.length" class="space-y-1 text-sm text-amber-700" role="status">
              <p>以下产品已导入，请核对资料：</p>
              <ul class="list-disc pl-5"><li v-for="(warning, i) in result.warnings" :key="i">第{{ warning.row }}行：{{ warning.reason }}</li></ul>
            </div>
          </div>
        </div>
        <div class="b-modal-foot">
          <UButton color="neutral" variant="outline" :disabled="importing" @click="open = false">关闭</UButton>
          <UButton color="neutral" variant="solid" :loading="importing" :disabled="!file || !!result || (isPlatformAdmin && !enterpriseId)" @click="runImport">开始导入</UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
