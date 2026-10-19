<script setup lang="ts">
import { formatCodeQuantity } from '#shared/utils/code-quantity'
// 码库管理（2026-10-12 去子批次改造）：一行 = 扫描仪一次「完成本次上传」。
// 不再有总批次 / 已用子批次 / 剩余子批次 / 使用记录；只记录已完成上传的码。
// 数量一律精确显示（12,352张），不折算「万」。
// Keep-Alive 页面缓存：菜单切换保留页面状态；刷新/登出自动清空；【重置】恢复初始。
// 只读账号（viewer）在模板中隐藏全部写操作入口。
const { canWrite, user } = useUser()
const route = useRoute()
const detailColumns=[{key:'code',label:'追溯码',width:340},{key:'product_name',label:'产品名称',width:260},{key:'status',label:'状态',width:120},{key:'abnormal_flag',label:'异常标记',width:210},{key:'produce_date',label:'生产日期',width:150},{key:'batch_no',label:'生产批号',width:160},{key:'expire_date',label:'有效期至',width:150},{key:'created_at',label:'上传时间',width:200},{key:'actions',label:'操作',width:240}]
const externalSource = computed(() => route.query.source === 'external')
const libraryColumns = [{key:'selection',label:'选择',width:90},{key:'productName',label:'产品名称',width:280},{key:'specName',label:'包装规格',width:180},{key:'batchNo',label:'生产批号',width:160},{key:'produceDate',label:'生产日期',width:150},{key:'codeTotal',label:'码数量',width:140},{key:'summary',label:'码状态',width:190},{key:'uploadAt',label:'上传时间',width:210},{key:'lineName',label:'上传产线',width:180},{key:'deviceName',label:'上传设备',width:180},{key:'actions',label:'操作',width:270}]

definePageMeta({ layout: 'admin', middleware: 'backend-guard', keepalive: true })
useHead({ title: '码库管理' })

const toast = useToast()

// ============ 主列表：按「一次完成上传」聚合 ============
// 筛选：关联产品 / 生产批号 / 上传来源 / 上传时间范围
const filters = reactive({
  productId: undefined as number | undefined,
  batchNo: '',
  lineName: '',
  deviceName: '',
  dateFrom: '',
  dateTo: '',
})
const page = ref(1)
const productPickerKey = ref(0)
const pageSize = 20
const { applyListQuery, resetListQuery } = useAdminListRoute(filters, page, () => refresh(), ['productId'])

const listQuery = computed(() => ({
    productId: filters.productId || undefined,
    batchNo: filters.batchNo || undefined,
    lineName: filters.lineName || undefined,
    deviceName: filters.deviceName || undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    page: page.value,
    pageSize,
  }))
// 页面切换期间可能短暂并存两个实例，独立缓存键避免刷新复用旧实例的筛选闭包。
const { data, pending, refresh } = await useAsyncData<any>('admin-code-usage-batches-' + useId(), () => $fetch('/api/admin/codes/usage-batches', { query: listQuery.value }), { watch: false })
const totalPages = computed(() => Math.max(1, Math.ceil((data.value?.total || 0) / pageSize)))
const batchRows = computed<any[]>(() => data.value?.rows || [])

const doSearch = () => applyListQuery()
const resetSearch = () => { productPickerKey.value++; return resetListQuery() }

// 跨页保留手动选择；全选使用已查询的筛选条件，勾掉单行作为排除项。
const selectionMode = ref(false)
const selectedIds = ref<number[]>([])
const selectAllResults = ref(false)
const excludedIds = ref<number[]>([])
const selectedCount = computed(() => selectAllResults.value ? Math.max(0, Number(data.value?.total || 0) - excludedIds.value.length) : selectedIds.value.length)
const isSelected = (row: any) => selectAllResults.value ? !excludedIds.value.includes(row.id) : selectedIds.value.includes(row.id)
const pageSelected = computed(() => batchRows.value.length > 0 && batchRows.value.every(isSelected))
const clearSelection = () => { selectedIds.value = []; excludedIds.value = []; selectAllResults.value = false }
const toggleSelectionMode = () => { clearSelection(); selectionMode.value = !selectionMode.value }
watch(externalSource, () => { selectionMode.value = false; clearSelection() })
const toggleSelection = (row: any) => {
  const ids = selectAllResults.value ? excludedIds : selectedIds
  ids.value = ids.value.includes(row.id) ? ids.value.filter(id => id !== row.id) : [...ids.value, row.id]
}
const togglePage = () => { const checked = pageSelected.value; for (const row of batchRows.value) if (isSelected(row) === checked) toggleSelection(row) }
const selectAll = () => { clearSelection(); selectAllResults.value = true }
watch(() => JSON.stringify(data.value?.selectionFilters), clearSelection)
const selectionPayload = () => selectAllResults.value ? { all: true, filters: { ...data.value?.selectionFilters }, excludeIds: [...excludedIds.value] } : { ids: [...selectedIds.value] }
const preparingSelection = ref(false)
const previewSelection = async () => {
  preparingSelection.value = true
  try { return await $fetch<any>('/api/admin/codes/usage-batches/preview', { method: 'POST', body: { selection: selectionPayload() } }) }
  catch (error: any) { toast.add({ title: error?.data?.statusMessage || '所选范围加载失败，请重试', color: 'error' }); return null }
  finally { preparingSelection.value = false }
}
const showEditModal = ref(false)
const editingRow = ref<any>(null)
const openEdit = (row: any = null) => { editingRow.value = row; showEditModal.value = true }
const chooseEdit = async (action: 'correct' | 'freeze' | 'restore' | 'void') => {
  if (action === 'correct') { showEditModal.value = false; openCorrect(editingRow.value); return }
  await openFlag(editingRow.value, action)
  showEditModal.value = false
}

// 码状态汇总标签（作废为终态最需关注，红系；冻结黄系；正常绿）
const SUMMARY_BADGE: Record<string, string> = {
  正常: 'b-tag-success',
  部分冻结: 'b-tag-warning',
  全部冻结: 'b-tag-warning',
  部分作废: 'b-tag-danger',
  全部作废: 'b-tag-danger',
}

const batchSpec = (row: any) => row?.specName || '原规格资料未记录'
const batchApi = (row: any, action = '') => `/api/admin/codes/usage-batches/${row.id}${action ? '/' + action : ''}`
const batchScopeText = (row: any) => `${row?.batchCount ? '所选 ' + row.batchCount + ' 批上传' : '本次上传'}的全部码，共 ${formatCodeQuantity(row?.codeTotal)}`
// 接口统一返回北京时间；保留秒。
const uploadTime = (value: string | null | undefined) => {
  if (!value) return '未记录'
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2}:\d{2})/)
  return match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日 ${match[4]}` : String(value)
}

// Keep-Alive 切走时停止刷新；恢复页面或窗口焦点后重新获取最新数据。
let codesRefreshTimer: ReturnType<typeof setInterval> | undefined
let codesPageActive = false
const refreshVisibleCodes = async () => {
  if (!codesPageActive || document.visibilityState !== 'visible' || pending.value || detailLoading.value || showCorrectModal.value || showFlagModal.value || showRowFlagModal.value || showEditModal.value || showExportModal.value) return
  await refresh()
  if (!codesPageActive) return
  if (showDetailModal.value) {
    const latest = batchRows.value.find(row => Number(row.id) === Number(detailRow.value?.id))
    if (latest) detailRow.value = latest
    await loadDetail()
  }
}
const startCodesRefresh = () => {
  codesPageActive = true
  if (codesRefreshTimer) return
  codesRefreshTimer = setInterval(refreshVisibleCodes, 20000)
  window.addEventListener('focus', refreshVisibleCodes)
}
const stopCodesRefresh = () => {
  codesPageActive = false
  clearInterval(codesRefreshTimer)
  codesRefreshTimer = undefined
  window.removeEventListener('focus', refreshVisibleCodes)
  cancelDetailRequest()
  cancelCorrectPreview()
}
onMounted(startCodesRefresh)
onActivated(() => { startCodesRefresh(); refreshVisibleCodes() })
onDeactivated(stopCodesRefresh)
onUnmounted(stopCodesRefresh)

// ============ 整批异常标记：冻结 / 恢复正常 / 作废整批 ============
// 「作废整批」= 整批标记作废（不物理删除，保留 1049 可追溯性）；明细内仍可单独作废某一条码。
const showFlagModal = ref(false)
const flagging = ref(false)
const flagTarget = ref<any>(null)
const flagPreview = ref<any>(null)
const flagAction = ref<'freeze' | 'void' | 'restore'>('freeze')
const flagReason = ref('')
const flagLabel = computed(() => ({ freeze: '冻结', void: '作废整批', restore: '恢复正常' })[flagAction.value])
const flagTitle = computed(() => ({ freeze: '整批冻结', void: '作废整批', restore: '整批恢复正常' })[flagAction.value])
const flagCount = computed(() => Number(flagAction.value === 'freeze'
  ? flagTarget.value?.normalCount
  : flagAction.value === 'restore'
    ? flagTarget.value?.frozenCount
    : Number(flagTarget.value?.codeTotal || 0) - Number(flagTarget.value?.voidedCount || 0)))
const openFlag = async (row: any, action: 'freeze' | 'void' | 'restore' = 'freeze') => {
  if (!canWrite.value) return
  flagPreview.value = row ? null : await previewSelection()
  if (!row && !flagPreview.value) return
  flagTarget.value = row || flagPreview.value
  flagAction.value = action
  flagReason.value = ''
  if (flagCount.value <= 0) { toast.add({ title: `本批次没有可${flagLabel.value === '作废整批' ? '作废' : flagLabel.value}的追溯码`, color: 'warning' }); return }
  showFlagModal.value = true
}
const submitFlag = async () => {
  if (!canWrite.value || !flagTarget.value || flagging.value) return
  const flag = { freeze: 1, void: 2, restore: 0 }[flagAction.value]
  if (flag === 2 && !flagReason.value.trim()) { toast.add({ title: '作废必须填写原因', color: 'warning' }); return }
  flagging.value = true
  try {
    const res = await $fetch<any>(flagPreview.value ? '/api/admin/codes/usage-batches/flag' : batchApi(flagTarget.value, 'flag'), {
      method: 'POST', body: { flag, reason: flagReason.value.trim(), ...(flagPreview.value ? { selection: flagPreview.value.selection, previewHash: flagPreview.value.previewHash } : {}) },
    })
    toast.add({ title: flagLabel.value + '完成：' + formatCodeQuantity(res.affected), color: 'success' })
    showFlagModal.value = false
    clearSelection()
    void refresh()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || flagLabel.value + '失败', color: 'error' })
  } finally {
    flagging.value = false
  }
}

// ============ 修正生产信息（仅本次上传的固定码清单） ============
const showCorrectModal = ref(false)
const correcting = ref(false)
const correctTarget = ref<any>(null)
interface CorrectPreview {
  task: { id: number, name: string, batchNo?: string }
  totalCodes: number
  usedCodes: number
  rootCount: number
  roots: { id: number, fileName: string, count: number, usedCount: number }[]
  canCorrect: boolean
  reason: string | null
  previewHash: string
  production: Record<string, any>
}
const correctPreview = ref<CorrectPreview | null>(null)
const correctPreviewLoading = ref(false)
const correctPreviewError = ref('')
const correctConfirmed = ref(false)
const correctRequestId = ref('')
let correctPreviewRequest = 0
let correctPreviewController: AbortController | undefined
const cancelCorrectPreview = () => {
  correctPreviewRequest++
  correctPreviewController?.abort()
  correctPreviewController = undefined
  correctPreviewLoading.value = false
}
const loadCorrectPreview = async () => {
  if (!showCorrectModal.value || !correctTarget.value) return
  cancelCorrectPreview()
  const targetId = Number(correctTarget.value.id)
  const request = ++correctPreviewRequest
  const controller = new AbortController()
  correctPreviewController = controller
  correctPreviewLoading.value = true
  correctPreviewError.value = ''
  try {
    const result = await $fetch<CorrectPreview>(batchApi(correctTarget.value, 'correct'), { signal: controller.signal })
    if (request === correctPreviewRequest && showCorrectModal.value && targetId === Number(correctTarget.value?.id)) correctPreview.value = result
  } catch (e: any) {
    if (request === correctPreviewRequest && !controller.signal.aborted) correctPreviewError.value = e?.data?.statusMessage || '本次上传修改范围加载失败，请重试'
  } finally {
    if (request === correctPreviewRequest) { correctPreviewLoading.value = false; correctPreviewController = undefined }
  }
}
watch(showCorrectModal, open => { if (!open) cancelCorrectPreview() })
const correctImpactCount = computed(() => Number(correctPreview.value?.totalCodes || correctTarget.value?.codeTotal || 0))
// qcResult='keep' 为「不修改」哨兵值（reka-ui 禁止空字符串 value）
const correctForm = reactive({ produceDate: '', expireDate: '', qcResult: 'keep', qualityCertNo: '', batchNo: '', reason: '' })
const openCorrect = (row: any) => {
  if (!canWrite.value) return
  if (Number(row.frozenCount || 0) + Number(row.voidedCount || 0) > 0) {
    toast.add({ title: '本批次含 ' + (Number(row.frozenCount || 0) + Number(row.voidedCount || 0)) + ' 条已冻结/已作废的码，修正前请先在「详细」中处理（单行恢复/作废）', color: 'warning' })
    return
  }
  correctTarget.value = row
  correctPreview.value = null
  correctPreviewError.value = ''
  correctConfirmed.value = false
  correctRequestId.value = crypto.randomUUID()
  Object.assign(correctForm, { produceDate: '', expireDate: '', qcResult: 'keep', qualityCertNo: '', batchNo: '', reason: '' })
  showCorrectModal.value = true
  void loadCorrectPreview()
}
watch(() => JSON.stringify(correctForm), () => { if (!correcting.value) correctRequestId.value = crypto.randomUUID() })
const submitCorrect = async () => {
  if (!canWrite.value || !correctTarget.value) return
  if (correctPreviewLoading.value || !correctPreview.value?.canCorrect || correctPreviewError.value || !correctConfirmed.value) {
    toast.add({ title: '请先确认本次上传的修改范围', color: 'warning' }); return
  }
  for (const [label, value] of [['生产日期', correctForm.produceDate], ['有效期至', correctForm.expireDate]]) {
    if (value && !isInputDate(value)) {
      toast.add({ title: label + '请输入有效日期，格式为 YYYY-MM-DD', color: 'warning' }); return
    }
  }
  if (!correctForm.batchNo.trim() && !correctForm.produceDate && !correctForm.expireDate && correctForm.qcResult === 'keep' && !correctForm.qualityCertNo) {
    toast.add({ title: '请至少选择一个要修改的字段', color: 'warning' }); return
  }
  correcting.value = true
  try {
    await $fetch<any>(batchApi(correctTarget.value, 'correct'), {
      method: 'POST',
      body: {
        requestId: correctRequestId.value,
        batchNo: correctForm.batchNo.trim() || undefined,
        produceDate: correctForm.produceDate || undefined,
        expireDate: correctForm.expireDate || undefined,
        qcResult: correctForm.qcResult === 'keep' ? undefined : Number(correctForm.qcResult),
        qualityCertNo: correctForm.qualityCertNo || undefined,
        reason: correctForm.reason.trim(),
        previewHash: correctPreview.value.previewHash,
      },
    })
    toast.add({ title: `本次上传已修正，共 ${formatCodeQuantity(correctImpactCount.value)}`, color: 'success' })
    showCorrectModal.value = false
    void refresh()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '修正失败', color: 'error' })
  } finally {
    correcting.value = false
  }
}

// ============ 导出本次上传的码 ============
const showExportModal = ref(false)
const exportTarget = ref<any>(null)
const exportPreview = ref<any>(null)
const exporting = ref(false)
const openExport = async (row: any = null) => {
  exportPreview.value = row ? null : await previewSelection()
  if (!row && !exportPreview.value) return
  exportTarget.value = row || exportPreview.value
  showExportModal.value = true
}
// 从 Content-Disposition 的 filename*=UTF-8'' 取原始中文文件名（服务端已按 RFC 5987 编码）
const fileNameFromResponse = (res: Response): string => {
  const cd = res.headers.get('content-disposition') || ''
  const m = cd.match(/filename\*=UTF-8''([^;]+)/i)
  if (m && m[1]) { try { return decodeURIComponent(m[1]) } catch { return '' } }
  return ''
}
// SPA 下直链会被客户端路由拦截（同生成页「下载离线工具」的踩坑）⇒ fetch → Blob → 临时 a 标签
const doExport = async (format: 'txt' | 'urls' | 'csv') => {
  if (!exportTarget.value || exporting.value) return
  exporting.value = true
  try {
    const res = exportPreview.value
      ? await fetch('/api/admin/codes/usage-batches/export', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selection: exportPreview.value.selection, previewHash: exportPreview.value.previewHash, format }) })
      : await fetch(batchApi(exportTarget.value, 'export') + '?format=' + format, { credentials: 'include' })
    if (!res.ok) {
      let msg = '导出失败'
      try { msg = (await res.json())?.statusMessage || msg } catch { /* 非 JSON 错误体 */ }
      throw new Error(msg)
    }
    const blob = await res.blob()
    const name = fileNameFromResponse(res) || 'codes.' + (format === 'csv' ? 'csv' : 'txt')
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
    toast.add({ title: '已导出 ' + formatCodeQuantity(exportTarget.value.codeTotal), color: 'success' })
    showExportModal.value = false
  } catch (e: any) {
    toast.add({ title: e?.message || '导出失败', color: 'error' })
  } finally {
    exporting.value = false
  }
}

// ============ 明细弹窗（本次上传的码；单行冻结/作废/恢复） ============
const showDetailModal = ref(false)
const detailRow = ref<any>(null)
const detailLoading = ref(false)
const detailError = ref('')
const detailRows = ref<any[]>([])
const detailTotal = ref(0)
const detailPage = ref(1)
const detailPageSize = 20
// 明细筛选（仅本批次内）：码值/批号关键字、码状态、异常标记
const dFilters = reactive({ keyword: '', status: undefined as string | undefined, abnormalFlag: undefined as string | undefined })
const STATUS_OPTIONS = [
  { value: '1', label: '已生成' },
  { value: '2', label: '已绑定' },
]
const FLAG_OPTIONS = [
  { value: '0', label: '正常' },
  { value: '1', label: '已冻结' },
  { value: '2', label: '已作废' },
]
let detailRequest = 0
let detailController: AbortController | undefined
const cancelDetailRequest = () => {
  detailRequest++
  detailController?.abort()
  detailController = undefined
  detailLoading.value = false
}
const loadDetail = async () => {
  if (!detailRow.value || !showDetailModal.value) return
  cancelDetailRequest()
  const request = ++detailRequest
  const targetId = Number(detailRow.value.id)
  const requestedPage = detailPage.value
  const controller = new AbortController()
  detailController = controller
  detailLoading.value = true
  detailError.value = ''
  detailRows.value = []
  try {
    const res = await $fetch<any>('/api/admin/codes', {
      query: {
        usageBatchId: targetId,
        keyword: dFilters.keyword || undefined,
        status: dFilters.status || undefined,
        abnormalFlag: dFilters.abnormalFlag || undefined,
        page: requestedPage,
        pageSize: detailPageSize,
      },
      signal: controller.signal,
    })
    if (request !== detailRequest || !showDetailModal.value || targetId !== Number(detailRow.value?.id)) return
    detailRows.value = res.rows || []
    detailTotal.value = Number(res.total || 0)
    const lastPage = Math.max(1, Math.ceil(detailTotal.value / detailPageSize))
    if (requestedPage > lastPage) { detailPage.value = lastPage; void loadDetail() }
  } catch (e: any) {
    if (request === detailRequest && !controller.signal.aborted) detailError.value = e?.data?.statusMessage || '追溯码明细加载失败，请重试'
  } finally {
    if (request === detailRequest) { detailLoading.value = false; detailController = undefined }
  }
}
const openDetail = (row: any) => {
  cancelDetailRequest()
  detailRow.value = row
  detailRows.value = []
  detailTotal.value = 0
  detailPage.value = 1
  Object.assign(dFilters, { keyword: '', status: undefined, abnormalFlag: undefined })
  showDetailModal.value = true
  void loadDetail()
}
watch(showDetailModal, open => { if (!open) cancelDetailRequest() })
const onDetailSearch = () => { detailPage.value = 1; void loadDetail() }
const detailTotalPages = computed(() => Math.max(1, Math.ceil(detailTotal.value / detailPageSize)))

// 明细单行异常标记（PATCH /api/admin/codes/:id；作废为终态需原因）
const showRowFlagModal = ref(false)
const rowFlagAction = ref<'freeze' | 'void' | 'restore'>('freeze')
const rowFlagTarget = ref<any>(null)
const rowFlagReason = ref('')
const rowFlagging = ref(false)
const ROW_FLAG_TITLE = { freeze: '冻结追溯码', void: '作废追溯码', restore: '恢复正常' }
const ROW_FLAG_META = {
  freeze: { icon: 'i-lucide-snowflake', color: 'text-amber-600' },
  void: { icon: 'i-lucide-ban', color: 'text-red-600' },
  restore: { icon: 'i-lucide-rotate-ccw', color: 'text-gray-600' },
} as const
const openRowFlag = (action: 'freeze' | 'void' | 'restore', row: any) => {
  rowFlagAction.value = action
  rowFlagTarget.value = row
  rowFlagReason.value = ''
  showRowFlagModal.value = true
}
const submitRowFlag = async () => {
  const flagMap = { freeze: 1, void: 2, restore: 0 } as const
  const flag = flagMap[rowFlagAction.value]
  if (flag === 2 && !rowFlagReason.value.trim()) {
    toast.add({ title: '作废必须填写原因', color: 'warning' }); return
  }
  rowFlagging.value = true
  try {
    await $fetch('/api/admin/codes/' + rowFlagTarget.value.id, {
      method: 'PATCH',
      body: { flag, reason: rowFlagReason.value.trim() },
    })
    toast.add({ title: '已执行：' + ROW_FLAG_TITLE[rowFlagAction.value] + '成功', color: 'success' })
    showRowFlagModal.value = false
    void loadDetail()
    void refresh()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '操作失败', color: 'error' })
  } finally {
    rowFlagging.value = false
  }
}

// 状态/异常标签（浅底深字）
const statusBadge = (s: number) => s === 2 ? { cls: 'b-tag-success', label: '已绑定' } : { cls: 'b-tag-info', label: '已生成' }
const flagBadge = (f: number) => {
  if (f === 1) return { cls: 'b-tag-warning', label: '已冻结' }
  if (f === 2) return { cls: 'b-tag-danger', label: '已作废' }
  return { cls: 'b-tag-default', label: '正常' }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex gap-3"><UButton :variant="externalSource?'outline':'solid'" to="/admin/codes">内部码</UButton><UButton :variant="externalSource?'solid':'outline'" to="/admin/codes?source=external">外部码</UButton></div>
    <ExternalCollectionList v-if="externalSource" mode="codes" />
    <template v-else>
    <!-- 页面标题区 -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="b-page-title">码库管理</h1>
      </div>
      <UButton variant="outline" color="neutral" icon="i-lucide-rotate-ccw" @click="resetSearch">重置</UButton>
    </div>

    <!-- 筛选查询区 -->
    <div class="b-card">
      <div class="b-card-head">
        <span class="b-card-title">筛选查询</span>
      </div>
      <div class="b-form-grid md:grid-cols-2 xl:grid-cols-6">
        <div>
          <label class="b-label">关联产品</label>
          <ProductPicker :key="productPickerKey" :model-value="filters.productId ?? null" all-statuses allow-all aria-label="关联产品" @update:model-value="filters.productId = $event ?? undefined" />
        </div>
        <div>
          <label class="b-label">生产批号</label>
          <UInput v-model="filters.batchNo" placeholder="输入生产批号" @keyup.enter="doSearch"  class="w-full" />
        </div>
        <div>
          <label class="b-label">上传产线</label>
          <UInput v-model="filters.lineName" placeholder="输入生产线" @keyup.enter="doSearch"  class="w-full" />
        </div>
        <div>
          <label class="b-label">上传设备</label>
          <UInput v-model="filters.deviceName" placeholder="输入设备名称" @keyup.enter="doSearch"  class="w-full" />
        </div>
        <div>
          <label class="b-label">上传时间起</label>
          <UInput v-model="filters.dateFrom" type="date"  class="w-full" />
        </div>
        <div>
          <label class="b-label">上传时间止</label>
          <UInput v-model="filters.dateTo" type="date"  class="w-full" />
        </div>
      </div>
      <div class="b-card-foot">
        <span class="b-card-extra">共 <span class="font-medium b-strong">{{ data?.total || 0 }}</span> 条上传记录</span>
        <div class="flex items-center gap-2">
          <UButton color="neutral" variant="solid" @click="doSearch">查询</UButton>
          <UButton color="neutral" variant="outline" @click="resetSearch">重置</UButton>
        </div>
      </div>
    </div>

    <!-- 上传记录列表 -->
    <div class="b-card b-card-clip">
      <div class="b-card-head">
        <span class="b-card-title">上传记录</span>
        <span class="b-card-extra">每页 {{ pageSize }} 行 · 共 {{ data?.total || 0 }} 条</span>
      </div>

      <div class="flex flex-wrap items-center gap-3 border-b border-[var(--b-border)] px-4 py-3">
        <UButton size="sm" variant="outline" :aria-pressed="selectionMode" @click="toggleSelectionMode">{{ selectionMode ? '退出多选' : '多选' }}</UButton>
        <template v-if="selectionMode">
        <UCheckbox :model-value="pageSelected" :disabled="pending || !batchRows.length" label="全选本页" @update:model-value="togglePage" />
        <UButton size="sm" variant="link" :disabled="pending || !data?.total" @click="selectAll">全选当前查询结果（{{ data?.total || 0 }}批）</UButton>
        <span class="b-help">已选 {{ selectedCount }} 批</span>
        <UButton v-if="selectedCount" size="sm" variant="link" @click="clearSelection">取消选择</UButton>
        <UButton size="sm" variant="outline" icon="i-lucide-download" :disabled="!selectedCount || pending" :loading="preparingSelection" @click="openExport()">导出所选</UButton>
        <UButton v-if="canWrite" size="sm" variant="outline" icon="i-lucide-pencil" :disabled="!selectedCount || pending" @click="openEdit()">批量编辑</UButton>
        </template>
      </div>

      <div class="p-4"><ProductionGrid :selection-mode="selectionMode" :columns="libraryColumns" :rows="batchRows" row-key="id" :storage-key="'internal-library-columns:v1:'+user?.id">
        <template #cell-selection="{row}"><UCheckbox :model-value="isSelected(row)" :aria-label="'选择上传批次'+row.id" @update:model-value="toggleSelection(row)" /></template>
        <template #cell-specName="{row}">{{ batchSpec(row) }}</template>
        <template #cell-codeTotal="{row}">{{ formatCodeQuantity(row.codeTotal) }}</template>
        <template #cell-summary="{row}"><span class="b-tag" :class="SUMMARY_BADGE[row.summary]||'b-tag-default'">{{ row.summary }}</span><p v-if="row.frozenCount+row.voidedCount>0" class="text-xs">正常 {{ row.normalCount }} / 冻结 {{ row.frozenCount }} / 作废 {{ row.voidedCount }}</p></template>
        <template #cell-uploadAt="{row}">{{ uploadTime(row.uploadAt) }}</template>
        <template #cell-actions="{row}"><div class="flex gap-2"><UButton size="xs" variant="link" @click="openDetail(row)">详细</UButton><UButton v-if="row.canExport" size="xs" variant="link" @click="openExport(row)">导出</UButton><UButton v-if="canWrite" size="xs" variant="link" @click="openEdit(row)">编辑</UButton></div></template>
      </ProductionGrid></div>

      <!-- 分页区 -->
      <div v-if="data?.total" class="b-pager">
        <span class="b-card-extra">共 {{ data?.total || 0 }} 条 · 第 {{ data.page }} / {{ totalPages }} 页</span>
        <div class="flex items-center gap-2">
          <UButton variant="outline" color="neutral" size="sm" :disabled="page <= 1" @click="applyListQuery(page - 1)">上一页</UButton>
          <UButton variant="outline" color="neutral" size="sm" :disabled="page >= totalPages" @click="applyListQuery(page + 1)">下一页</UButton>
        </div>
      </div>
    </div>

    <UModal v-model:open="showEditModal" :dismissible="!preparingSelection" title="编辑码库">
      <template #content><div class="b-modal">
        <div class="b-modal-head"><h3 class="b-modal-title">{{ editingRow ? '编辑本次上传' : '批量编辑所选上传' }}</h3></div>
        <div class="b-modal-body space-y-3">
          <p class="b-help">{{ editingRow ? batchScopeText(editingRow) : '已选 ' + selectedCount + ' 批，请选择操作' }}</p>
          <div class="grid gap-3 sm:grid-cols-2">
            <UButton v-if="editingRow && canWrite" variant="outline" :disabled="editingRow.canCorrect === false" @click="chooseEdit('correct')">修正生产信息</UButton>
            <UButton v-if="canWrite" variant="outline" :disabled="preparingSelection || (editingRow && editingRow.normalCount <= 0)" @click="chooseEdit('freeze')">冻结</UButton>
            <UButton v-if="canWrite" variant="outline" :disabled="preparingSelection || (editingRow && editingRow.frozenCount <= 0)" @click="chooseEdit('restore')">恢复</UButton>
            <UButton v-if="canWrite" color="error" variant="outline" :disabled="preparingSelection || (editingRow && editingRow.codeTotal <= editingRow.voidedCount)" @click="chooseEdit('void')">整批作废</UButton>
          </div>
        </div><div class="b-modal-foot"><UButton variant="outline" :disabled="preparingSelection" @click="showEditModal = false">取消</UButton></div>
      </div></template>
    </UModal>
    <!-- 整批冻结 / 恢复 / 作废整批 -->
    <UModal v-model:open="showFlagModal" :dismissible="!flagging">
      <template #content>
        <div class="b-modal">
          <div class="b-modal-head">
            <div class="b-modal-icon">
              <UIcon :name="flagAction === 'void' ? 'i-lucide-ban' : flagAction === 'restore' ? 'i-lucide-rotate-ccw' : 'i-lucide-snowflake'" class="h-4 w-4" :class="flagAction === 'void' ? 'text-red-600' : 'text-amber-600'" />
            </div>
            <div>
              <h3 class="b-modal-title">{{ flagTitle }}</h3>
              <p class="b-modal-sub">{{ flagPreview ? '所选 ' + flagPreview.batchCount + ' 批上传' : (flagTarget?.productName || '产品未记录') + ' · ' + (flagTarget?.batchNo || '生产批号未记录') }}</p>
            </div>
          </div>
          <div class="b-modal-body space-y-3">
            <div class="b-note">
              <UIcon name="i-lucide-info" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--b-text-muted)]" />
              <p class="b-note-text">
                操作范围：{{ batchScopeText(flagTarget) }}。将{{ flagLabel }} <span class="font-medium b-strong">{{ formatCodeQuantity(flagCount) }}</span>。
                {{ flagAction === 'void' ? '作废为终态不可恢复，扫码将显示「该追溯码已作废，请勿购买」；此操作不删除数据，仅标记作废。' : flagAction === 'freeze' ? '冻结后扫码显示暂不可用，可恢复正常；已作废码不受影响。' : '仅恢复本批次已冻结的码；已作废码不受影响。' }}
              </p>
            </div>
            <div v-if="flagAction === 'void'">
              <label class="b-label-lg">作废原因 <span class="b-required">*</span></label>
              <USelect v-model="flagReason" :items="['印刷模糊', '无法识别', '窜货', '召回', '疑似假冒', '其他'].map(r => ({ value: r, label: r }))" placeholder="选择作废原因" class="w-full" />
            </div>
          </div>
          <div class="b-modal-foot">
            <UButton variant="outline" color="neutral" :disabled="flagging" @click="showFlagModal = false">取消</UButton>
            <UButton v-if="canWrite" :color="flagAction === 'void' ? 'error' : 'neutral'" variant="solid" :loading="flagging" @click="submitFlag">确认{{ flagLabel }}</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- 修正生产信息（仅当前上传记录） -->
    <UModal v-model:open="showCorrectModal" :ui="{ content: 'sm:max-w-2xl' }">
      <template #content>
        <div class="b-modal">
          <div class="b-modal-head">
            <div class="b-modal-icon">
              <UIcon name="i-lucide-wrench" class="h-4 w-4 text-[var(--b-text-regular)]" />
            </div>
            <div>
              <h3 class="b-modal-title">修正本次上传的生产信息</h3>
              <p class="b-modal-sub">只修正当前这条上传记录，其他上传记录保持原资料</p>
            </div>
          </div>
          <div class="b-modal-body max-h-[70vh] space-y-3 overflow-y-auto">
            <p v-if="correctPreviewLoading" role="status" class="b-help">正在确认本次上传的码清单…</p>
            <div v-if="correctPreviewError" role="alert" class="b-note"><p class="b-note-text flex-1">{{ correctPreviewError }}</p><UButton variant="link" color="neutral" size="xs" @click="loadCorrectPreview">重试</UButton></div>
            <div v-if="correctPreview" class="b-note">
              <UIcon name="i-lucide-shield-alert" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <div class="b-note-text">
                <p class="font-semibold">只修改这次上传的 {{ formatCodeQuantity(correctPreview.totalCodes) }} 码。</p>
                <p>关联任务：{{ correctPreview.task.name }}（编号 {{ correctPreview.task.id }}）；其他上传记录保持原资料。</p>
                <p v-if="!correctPreview.canCorrect" class="mt-1 text-red-600">{{ correctPreview.reason || '本次上传当前不可修改' }}</p>
              </div>
            </div>
            <div>
              <label class="b-label-lg">生产批号</label>
              <UInput v-model="correctForm.batchNo" :maxlength="64" :placeholder="'不修改留空；当前：' + (correctPreview?.production.batch_no || correctTarget?.batchNo || '未记录或存在多种值')"  class="w-full" />
            </div>
            <ProductionChangePreview :form="correctForm" :count="correctImpactCount" :current="correctPreview?.production" scope-only />
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="b-label-lg">生产日期</label>
                <BatchDateInput v-model="correctForm.produceDate" label="生产日期" />
                <p class="b-help">修改后扫码页展示的生产日期将变更，请确认与标签喷码一致</p>
              </div>
              <div>
                <label class="b-label-lg">有效期至</label>
                <BatchDateInput v-model="correctForm.expireDate" label="有效期至" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="b-label-lg">质量检验结果</label>
                <USelect v-model="correctForm.qcResult" :items="[{ value: 'keep', label: '不修改' }, { value: '1', label: '合格' }, { value: '0', label: '不合格' }]" class="w-full" />
              </div>
              <div>
                <label class="b-label-lg">质量合格证号</label>
                <UInput v-model="correctForm.qualityCertNo" :maxlength="64" placeholder="不修改留空"  class="w-full" />
              </div>
            </div>
            <div class="b-note">
              <UIcon name="i-lucide-shield-alert" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--b-text-muted)]" />
              <p class="b-note-text">修改会同步这次上传中各码的扫码展示，并记录操作人、时间、修改前后内容和具体码清单。</p>
            </div>
            <div><label class="b-label-lg">修改备注（选填）</label><UInput v-model="correctForm.reason" :maxlength="500" placeholder="例如：核对喷码后修正生产日期"  class="w-full" /></div>
            <UCheckbox v-model="correctConfirmed" :disabled="correctPreviewLoading || !correctPreview?.canCorrect || !!correctPreviewError" label="我已确认修改这次上传的码" />
          </div>
          <div class="b-modal-foot">
            <UButton variant="outline" color="neutral" @click="showCorrectModal = false">取消</UButton>
            <UButton v-if="canWrite" color="neutral" variant="solid" :loading="correcting" :disabled="correctPreviewLoading || !correctPreview?.canCorrect || !!correctPreviewError || !correctConfirmed" @click="submitCorrect">确认修改</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- 导出本次上传的码 -->
    <UModal v-model:open="showExportModal">
      <template #content>
        <div class="b-modal">
          <div class="b-modal-head">
            <div class="b-modal-icon">
              <UIcon name="i-lucide-download" class="h-4 w-4 text-[var(--b-text-regular)]" />
            </div>
            <div>
              <h3 class="b-modal-title">导出本次上传的追溯码</h3>
              <p class="b-modal-sub">{{ exportPreview ? '所选 ' + exportPreview.batchCount + ' 批上传' : (exportTarget?.productName || '产品未记录') + ' · ' + (exportTarget?.batchNo || '生产批号未记录') }}</p>
            </div>
          </div>
          <div class="b-modal-body space-y-3">
            <p class="b-help">导出范围：{{ batchScopeText(exportTarget) }}。选择格式后立即下载。</p>
            <div class="flex flex-col gap-2">
              <UButton color="neutral" variant="outline" icon="i-lucide-file-text" :loading="exporting" @click="doExport('txt')">
                码文件 TXT（每行一个 32 位追溯码）
              </UButton>
              <UButton color="neutral" variant="outline" icon="i-lucide-link" :loading="exporting" @click="doExport('urls')">
                扫码地址 urls.txt（离线生图工具输入）
              </UButton>
              <UButton color="neutral" variant="outline" icon="i-lucide-table" :loading="exporting" @click="doExport('csv')">
                sn 清单 CSV（含分段与绑定状态）
              </UButton>
            </div>
          </div>
          <div class="b-modal-foot">
            <UButton variant="outline" color="neutral" @click="showExportModal = false">关闭</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- 明细弹窗（本次上传的码 + 单行冻结/作废/恢复） -->
    <UModal v-model:open="showDetailModal" :ui="{ content: 'sm:max-w-6xl' }">
      <template #content>
        <div class="b-modal">
          <div class="b-modal-head">
            <div class="b-modal-icon">
              <UIcon name="i-lucide-eye" class="h-4 w-4 text-[var(--b-text-regular)]" />
            </div>
            <div>
              <h3 class="b-modal-title">本次上传码明细</h3>
              <p class="b-modal-sub">{{ detailRow?.productName }} · {{ detailRow?.batchNo || '生产批号未记录' }} · 上传 {{ uploadTime(detailRow?.uploadAt) }}</p>
              <p class="b-help">{{ batchScopeText(detailRow) }} · 包装规格：{{ batchSpec(detailRow) }}</p>
            </div>
          </div>
          <div class="b-modal-body">
            <div v-if="detailError" role="alert" class="b-note mb-3"><p class="b-note-text flex-1">{{ detailError }}</p><UButton variant="link" color="neutral" size="xs" :loading="detailLoading" @click="loadDetail">重试</UButton></div>
            <!-- 明细筛选 -->
            <div class="mb-3 flex flex-wrap items-end gap-2">
              <div class="w-64">
                <label class="b-label">追溯码 / 批号</label>
                <UInput v-model="dFilters.keyword" placeholder="输入追溯码或生产批号" icon="i-lucide-search" @keyup.enter="onDetailSearch"  class="w-full" />
              </div>
              <div class="w-36">
                <label class="b-label">码状态</label>
                <USelect v-model="dFilters.status" :items="STATUS_OPTIONS" placeholder="全部状态" class="w-full" />
              </div>
              <div class="w-36">
                <label class="b-label">异常标记</label>
                <USelect v-model="dFilters.abnormalFlag" :items="FLAG_OPTIONS" placeholder="全部标记" class="w-full" />
              </div>
              <UButton color="neutral" variant="solid" size="sm" @click="onDetailSearch">查询</UButton>
              <UButton color="neutral" variant="outline" size="sm" @click="Object.assign(dFilters, { keyword: '', status: undefined, abnormalFlag: undefined }); onDetailSearch()">重置</UButton>
            </div>

            <ProductionGrid :columns="detailColumns" :rows="detailRows" row-key="id" :storage-key="'internal-detail-columns:v1:'+user?.id">
              <template #cell-status="{row}"><span class="b-tag" :class="statusBadge(row.status).cls">{{ statusBadge(row.status).label }}</span></template>
              <template #cell-abnormal_flag="{row}"><span class="b-tag" :class="flagBadge(row.abnormal_flag).cls">{{ flagBadge(row.abnormal_flag).label }}</span><p v-if="row.abnormal_reason" :title="row.abnormal_reason" class="truncate text-xs">{{ row.abnormal_reason }}</p></template>
              <template #cell-created_at="{row}">{{ String(row.created_at).slice(0,16) }}</template>
              <template #cell-actions="{row}"><div v-if="canWrite" class="flex gap-2"><UButton v-if="Number(row.abnormal_flag)===0" size="xs" variant="link" @click="openRowFlag('freeze',row)">冻结</UButton><UButton v-if="Number(row.abnormal_flag)===0" size="xs" variant="link" color="error" @click="openRowFlag('void',row)">作废</UButton><UButton v-if="Number(row.abnormal_flag)===1" size="xs" variant="link" @click="openRowFlag('restore',row)">恢复正常</UButton><span v-if="Number(row.abnormal_flag)===2">已终态</span></div></template>
            </ProductionGrid>

            <!-- 明细分页 -->
            <div v-if="detailTotal" class="b-pager">
              <span class="b-card-extra">共 {{ detailTotal }} 条 · 第 {{ detailPage }} / {{ detailTotalPages }} 页</span>
              <div class="flex items-center gap-2">
                <UButton variant="outline" color="neutral" size="sm" :disabled="detailLoading || detailPage <= 1" @click="detailPage--; loadDetail()">上一页</UButton>
                <UButton variant="outline" color="neutral" size="sm" :disabled="detailLoading || detailPage >= detailTotalPages" @click="detailPage++; loadDetail()">下一页</UButton>
              </div>
            </div>
          </div>
        </div>
      </template>
    </UModal>

    <!-- 明细单行异常标记 -->
    <UModal v-model:open="showRowFlagModal">
      <template #content>
        <div class="b-modal">
          <div class="b-modal-head">
            <div class="b-modal-icon">
              <UIcon :name="ROW_FLAG_META[rowFlagAction].icon" class="h-4 w-4" :class="ROW_FLAG_META[rowFlagAction].color" />
            </div>
            <div>
              <h3 class="b-modal-title">{{ ROW_FLAG_TITLE[rowFlagAction] }}</h3>
              <p class="b-modal-sub max-w-lg truncate" :title="rowFlagTarget?.code">{{ rowFlagTarget?.code }}</p>
            </div>
          </div>
          <div class="b-modal-body">
            <div class="b-note">
              <UIcon name="i-lucide-info" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--b-text-muted)]" />
              <p class="b-note-text">
                {{ rowFlagAction === 'void' ? '作废为终态不可恢复，扫码显示「该追溯码已作废，请勿购买」（不展示产品与批次信息）' : rowFlagAction === 'freeze' ? '冻结后扫码显示「该追溯码暂不可用，请联系企业（生产厂家）」，可恢复正常' : '恢复正常后扫码按正常逻辑展示' }}
              </p>
            </div>
            <div v-if="rowFlagAction === 'void'">
              <label class="b-label-lg">作废原因 <span class="b-required">*</span></label>
              <USelect v-model="rowFlagReason" :items="['印刷模糊', '无法识别', '窜货', '召回', '疑似假冒', '其他'].map(r => ({ value: r, label: r }))" placeholder="选择原因" class="w-full" />
            </div>
          </div>
          <div class="b-modal-foot">
            <UButton variant="outline" color="neutral" @click="showRowFlagModal = false">取消</UButton>
            <UButton v-if="canWrite" color="neutral" variant="solid" :loading="rowFlagging" @click="submitRowFlag">确认执行</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </template>
  </div>
</template>
