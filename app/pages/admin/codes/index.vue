<script setup lang="ts">
import { formatCodeQuantity } from '#shared/utils/code-quantity'
// 码库管理（2026-10-12 去子批次改造）：一行 = 扫描仪一次「完成本次上传」。
// 不再有总批次 / 已用子批次 / 剩余子批次 / 使用记录；只记录已完成上传的码。
// 数量一律精确显示（12,352张），不折算「万」。
// Keep-Alive 页面缓存：菜单切换保留页面状态；刷新/登出自动清空；【重置】恢复初始。
// 只读账号（viewer）在模板中隐藏全部写操作入口。
const { canWrite } = useUser()

definePageMeta({ layout: 'admin', middleware: 'backend-guard', keepalive: true })
useHead({ title: '码库管理' })

const toast = useToast()

// ============ 主列表：按「一次完成上传」聚合 ============
// 筛选：关联产品 / 生产批号 / 上传来源 / 上传时间范围
const filters = reactive({
  productId: undefined as number | undefined,
  batchNo: '',
  uploader: '',
  dateFrom: '',
  dateTo: '',
})
const page = ref(1)
const pageSize = 20
const { applyListQuery, resetListQuery } = useAdminListRoute(filters, page, () => refresh(), ['productId'])

// 产品下拉（关联产品筛选；pageSize 100 与生产采集/生成页同口径）
const { data: productData } = await useFetch<any>('/api/admin/products', {
  key: 'admin-codes-products',
  query: { page: 1, pageSize: 100, bindable: 1 },
})
const PRODUCT_OPTIONS = computed(() =>
  (productData.value?.rows || []).map((p: any) => ({ value: Number(p.id), label: `${p.name} · ${p.spec_name || '规格未填写'}` })))

const { data, pending, refresh } = await useFetch<any>('/api/admin/codes/usage-batches', {
  key: 'admin-code-usage-batches',
  watch: false,
  query: computed(() => ({
    productId: filters.productId || undefined,
    batchNo: filters.batchNo || undefined,
    uploader: filters.uploader || undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    page: page.value,
    pageSize,
  })),
})
const totalPages = computed(() => Math.max(1, Math.ceil((data.value?.total || 0) / pageSize)))
const batchRows = computed<any[]>(() => data.value?.rows || [])

const doSearch = () => applyListQuery()
const resetSearch = () => resetListQuery()

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
const batchScopeText = (row: any) => `本次上传的全部码，共 ${formatCodeQuantity(row?.codeTotal)}`
// 上传来源：账号优先，无账号回退设备（服务端已按此口径回填 uploadSource）
const uploadSourceText = (row: any) => row?.uploadSource || '上传账号未记录'
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
  if (!codesPageActive || document.visibilityState !== 'visible' || pending.value || detailLoading.value || showCorrectModal.value || showFlagModal.value || showRowFlagModal.value) return
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
const flagAction = ref<'freeze' | 'void' | 'restore'>('freeze')
const flagReason = ref('')
const flagLabel = computed(() => ({ freeze: '冻结', void: '作废整批', restore: '恢复正常' })[flagAction.value])
const flagTitle = computed(() => ({ freeze: '整批冻结', void: '作废整批', restore: '整批恢复正常' })[flagAction.value])
const flagCount = computed(() => Number(flagAction.value === 'freeze'
  ? flagTarget.value?.normalCount
  : flagAction.value === 'restore'
    ? flagTarget.value?.frozenCount
    : Number(flagTarget.value?.codeTotal || 0) - Number(flagTarget.value?.voidedCount || 0)))
const openFlag = (row: any, action: 'freeze' | 'void' | 'restore' = 'freeze') => {
  if (!canWrite.value) return
  flagTarget.value = row
  flagAction.value = action
  flagReason.value = ''
  if (flagCount.value <= 0) { toast.add({ title: `本批次没有可${flagLabel.value === '作废整批' ? '作废' : flagLabel.value}的追溯码`, color: 'warning' }); return }
  showFlagModal.value = true
}
const submitFlag = async () => {
  if (!canWrite.value || !flagTarget.value) return
  const flag = { freeze: 1, void: 2, restore: 0 }[flagAction.value]
  if (flag === 2 && !flagReason.value.trim()) { toast.add({ title: '作废必须填写原因', color: 'warning' }); return }
  flagging.value = true
  try {
    const res = await $fetch<any>(batchApi(flagTarget.value, 'flag'), {
      method: 'POST', body: { flag, reason: flagReason.value.trim() },
    })
    toast.add({ title: flagLabel.value + '完成：' + formatCodeQuantity(res.affected), color: 'success' })
    showFlagModal.value = false
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
const exporting = ref(false)
const openExport = (row: any) => { exportTarget.value = row; showExportModal.value = true }
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
    const res = await fetch(batchApi(exportTarget.value, 'export') + '?format=' + format, { credentials: 'include' })
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
    <!-- 页面标题区 -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="b-page-title">码库管理</h1>
        <p class="b-page-desc">一行 = 扫描仪一次「完成本次上传」，只记录已完成上传的追溯码</p>
      </div>
      <UButton variant="outline" color="neutral" icon="i-lucide-rotate-ccw" @click="resetSearch">重置</UButton>
    </div>

    <!-- 筛选查询区 -->
    <div class="b-card">
      <div class="b-card-head">
        <span class="b-card-title">筛选查询</span>
      </div>
      <div class="b-form-grid md:grid-cols-2 xl:grid-cols-5">
        <div>
          <label class="b-label">关联产品</label>
          <USelect v-model="filters.productId" :items="PRODUCT_OPTIONS" placeholder="全部产品" class="w-full" :content="{ class: 'min-w-72' }" :ui="{ value: 'whitespace-normal break-words text-left', itemLabel: 'whitespace-normal break-words' }" />
        </div>
        <div>
          <label class="b-label">生产批号</label>
          <UInput v-model="filters.batchNo" placeholder="输入生产批号" @keyup.enter="doSearch" />
        </div>
        <div>
          <label class="b-label">上传来源</label>
          <UInput v-model="filters.uploader" placeholder="上传账号或设备名称" icon="i-lucide-search" @keyup.enter="doSearch" />
        </div>
        <div>
          <label class="b-label">上传时间起</label>
          <UInput v-model="filters.dateFrom" type="date" />
        </div>
        <div>
          <label class="b-label">上传时间止</label>
          <UInput v-model="filters.dateTo" type="date" />
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

      <div class="b-scroll-x">
        <table class="b-table" aria-label="上传记录">
          <thead>
            <tr>
              <th>产品名称</th>
              <th>包装规格</th>
              <th>生产批号</th>
              <th>生产日期</th>
              <th class="text-right">码数量</th>
              <th>码状态</th>
              <th>上传时间</th>
              <th>上传来源</th>
              <th class="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in batchRows" :key="row.id" :data-batch-id="row.id">
              <td class="min-w-44">
                <p class="break-words text-[13px] b-strong">{{ row.productName || '产品未记录' }}</p>
                <p class="mt-1 text-xs text-[var(--b-text-muted)]">任务：{{ row.taskName || '名称未记录' }} · 编号 {{ row.taskId }}</p>
              </td>
              <td class="min-w-32"><span class="break-words" :class="{ 'text-[var(--b-text-muted)]': !row.specName }">{{ batchSpec(row) }}</span></td>
              <td class="min-w-28">{{ row.batchNo || '-' }}</td>
              <td class="min-w-28 whitespace-nowrap">{{ row.produceDate || '-' }}</td>
              <td class="text-right whitespace-nowrap font-medium b-strong">{{ formatCodeQuantity(row.codeTotal) }}</td>
              <td class="min-w-32">
                <span class="b-tag" :class="SUMMARY_BADGE[row.summary] || 'b-tag-default'">{{ row.summary }}</span>
                <p v-if="row.frozenCount + row.voidedCount > 0" class="b-card-extra mt-1 text-xs">正常 {{ row.normalCount }} / 冻结 {{ row.frozenCount }} / 作废 {{ row.voidedCount }}</p>
              </td>
              <td class="min-w-44 whitespace-nowrap">{{ uploadTime(row.uploadAt) }}</td>
              <td class="min-w-32">
                <p class="break-words">{{ uploadSourceText(row) }}</p>
                <p v-if="row.uploaderUsername && row.deviceName" class="mt-1 text-xs text-[var(--b-text-muted)]">设备：{{ row.deviceName }}</p>
              </td>
              <td>
                <div class="flex min-w-64 flex-wrap justify-end gap-x-3 gap-y-1">
                  <UButton variant="link" color="neutral" size="xs" icon="i-lucide-eye" @click="openDetail(row)">详细</UButton>
                  <UButton v-if="row.canExport" variant="link" color="neutral" size="xs" icon="i-lucide-download" @click="openExport(row)">导出</UButton>
                  <template v-if="canWrite">
                    <UButton variant="link" color="neutral" size="xs" icon="i-lucide-wrench" :title="row.correctionReason || '仅修正本次上传的码'" :disabled="row.canCorrect === false" @click="openCorrect(row)">修正生产信息</UButton>
                    <UButton variant="link" color="neutral" size="xs" icon="i-lucide-snowflake" :disabled="row.normalCount <= 0" @click="openFlag(row, 'freeze')">冻结</UButton>
                    <UButton variant="link" color="neutral" size="xs" icon="i-lucide-rotate-ccw" :disabled="row.frozenCount <= 0" @click="openFlag(row, 'restore')">恢复</UButton>
                    <UButton variant="link" color="error" size="xs" icon="i-lucide-ban" :disabled="row.codeTotal <= row.voidedCount" @click="openFlag(row, 'void')">作废整批</UButton>
                  </template>
                </div>
              </td>
            </tr>
            <tr v-if="!pending && !batchRows.length">
              <td colspan="9" class="b-empty">
                <div class="b-empty-inner">
                  <UIcon name="i-lucide-inbox" class="b-empty-icon h-8 w-8" />
                  <span class="text-sm">暂无上传记录，扫描仪点「完成本次上传」后才会在此记录；也可调整筛选条件后重试</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 分页区 -->
      <div v-if="data?.total" class="b-pager">
        <span class="b-card-extra">共 {{ data?.total || 0 }} 条 · 第 {{ data.page }} / {{ totalPages }} 页</span>
        <div class="flex items-center gap-2">
          <UButton variant="outline" color="neutral" size="sm" :disabled="page <= 1" @click="applyListQuery(page - 1)">上一页</UButton>
          <UButton variant="outline" color="neutral" size="sm" :disabled="page >= totalPages" @click="applyListQuery(page + 1)">下一页</UButton>
        </div>
      </div>
    </div>

    <!-- 整批冻结 / 恢复 / 作废整批 -->
    <UModal v-model:open="showFlagModal">
      <template #content>
        <div class="b-modal">
          <div class="b-modal-head">
            <div class="b-modal-icon">
              <UIcon :name="flagAction === 'void' ? 'i-lucide-ban' : flagAction === 'restore' ? 'i-lucide-rotate-ccw' : 'i-lucide-snowflake'" class="h-4 w-4" :class="flagAction === 'void' ? 'text-red-600' : 'text-amber-600'" />
            </div>
            <div>
              <h3 class="b-modal-title">{{ flagTitle }}</h3>
              <p class="b-modal-sub">{{ flagTarget?.productName }} · {{ flagTarget?.batchNo || '生产批号未记录' }}</p>
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
            <UButton variant="outline" color="neutral" @click="showFlagModal = false">取消</UButton>
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
              <UInput v-model="correctForm.batchNo" :maxlength="64" :placeholder="'不修改留空；当前：' + (correctPreview?.production.batch_no || correctTarget?.batchNo || '未记录或存在多种值')" />
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
                <UInput v-model="correctForm.qualityCertNo" :maxlength="64" placeholder="不修改留空" />
              </div>
            </div>
            <div class="b-note">
              <UIcon name="i-lucide-shield-alert" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--b-text-muted)]" />
              <p class="b-note-text">修改会同步这次上传中各码的扫码展示，并记录操作人、时间、修改前后内容和具体码清单。</p>
            </div>
            <div><label class="b-label-lg">修改备注（选填）</label><UInput v-model="correctForm.reason" :maxlength="500" placeholder="例如：核对喷码后修正生产日期" /></div>
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
              <p class="b-modal-sub">{{ exportTarget?.productName }} · {{ exportTarget?.batchNo || '生产批号未记录' }}</p>
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
                <UInput v-model="dFilters.keyword" placeholder="输入追溯码或生产批号" icon="i-lucide-search" @keyup.enter="onDetailSearch" />
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

            <div class="b-scroll-x">
              <table class="b-table">
                <thead>
                  <tr>
                    <th>追溯码</th>
                    <th>产品</th>
                    <th>码状态</th>
                    <th>异常标记</th>
                    <th>生产日期</th>
                    <th>生产批号</th>
                    <th>有效期至</th>
                    <th>码生成时间</th>
                    <th class="text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in detailRows" :key="r.id">
                    <td><span class="font-code text-[13px] b-strong">{{ r.code }}</span></td>
                    <td>{{ r.product_name || '-' }}</td>
                    <td><span class="b-tag" :class="statusBadge(r.status).cls">{{ statusBadge(r.status).label }}</span></td>
                    <td>
                      <span class="b-tag" :class="flagBadge(r.abnormal_flag).cls">{{ flagBadge(r.abnormal_flag).label }}</span>
                      <div v-if="r.abnormal_reason" class="mt-0.5 max-w-44 truncate text-xs text-[var(--b-text-muted)]" :title="r.abnormal_reason">原因：{{ r.abnormal_reason }}</div>
                    </td>
                    <td>{{ r.produce_date || '-' }}</td>
                    <td>{{ r.batch_no || '-' }}</td>
                    <td>{{ r.expire_date || '-' }}</td>
                    <td>{{ String(r.created_at).slice(0, 16) }}</td>
                    <td>
                      <div v-if="canWrite && Number(r.abnormal_flag) === 0" class="b-actions justify-end">
                        <UButton variant="link" color="neutral" size="xs" @click="openRowFlag('freeze', r)">冻结</UButton>
                        <span class="b-sep" />
                        <UButton variant="link" color="error" size="xs" @click="openRowFlag('void', r)">作废</UButton>
                      </div>
                      <div v-else-if="canWrite && Number(r.abnormal_flag) === 1" class="b-actions justify-end">
                        <UButton variant="link" color="neutral" size="xs" @click="openRowFlag('restore', r)">恢复正常</UButton>
                      </div>
                      <div v-else-if="canWrite" class="flex items-center justify-end gap-2">
                        <span class="b-card-extra text-xs">已终态</span>
                      </div>
                    </td>
                  </tr>
                  <tr v-if="!detailRows.length">
                    <td colspan="9" class="b-empty">
                      <div class="b-empty-inner">
                        <UIcon :name="detailLoading ? 'i-lucide-loader-circle' : 'i-lucide-inbox'" class="b-empty-icon h-8 w-8" :class="{ 'animate-spin': detailLoading }" />
                        <span class="text-sm">{{ detailLoading ? '正在加载追溯码' : detailError ? '追溯码明细未加载，请重试' : '本批次暂无符合筛选条件的追溯码' }}</span>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

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
  </div>
</template>
