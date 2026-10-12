<script setup lang="ts">
import { isInputDate } from '#shared/utils/input-date'
import { formatCodeQuantity } from '#shared/utils/code-quantity'
// 原码文件保留为总批次；每次移动端完成上传形成独立已用子批次，未使用的码归入剩余子批次。
// 子批次按需分页加载，操作范围由服务端筛选，前端不拼接整批码 ID。
// Keep-Alive 页面缓存：菜单切换保留页面状态；刷新/登出自动清空；【重置】恢复初始。
// 只读账号（viewer）在模板中隐藏全部写操作入口
const { canWrite } = useUser()

definePageMeta({ layout: 'admin', middleware: 'backend-guard', keepalive: true })
useHead({ title: '码库管理' })

const toast = useToast()

// ============ 主列表：上传文件批次聚合 ============
// 筛选：批次文件名 / 关联产品 / 生产批号 / 上传时间范围（下拉默认 undefined 显示 placeholder）
const filters = reactive({
  fileName: '',
  abnormalFlag: undefined as string | undefined,
  uploadBatchId: undefined as number | undefined,
  productId: undefined as number | undefined,
  batchNo: '',
  dateFrom: '',
  dateTo: '',
})
const page = ref(1)
const pageSize = 20
const { applyListQuery, resetListQuery } = useAdminListRoute(filters, page, () => refresh(), ['productId', 'uploadBatchId'])

// 产品下拉（关联产品筛选；pageSize 100 与生产采集/生成页同口径）
const { data: productData } = await useFetch<any>('/api/admin/products', {
  key: 'admin-codes-products',
  query: { page: 1, pageSize: 100, bindable: 1 },
})
const PRODUCT_OPTIONS = computed(() =>
  (productData.value?.rows || []).map((p: any) => ({ value: Number(p.id), label: `${p.name} · ${p.spec_name || '规格未填写'}` })))

const { data, pending, refresh } = await useFetch<any>('/api/admin/codes/upload-batches', {
  key: 'admin-upload-batches',
  watch: false,
  query: computed(() => ({
    fileName: filters.fileName || undefined,
    abnormalFlag: filters.abnormalFlag,
    uploadBatchId: filters.uploadBatchId,
    productId: filters.productId || undefined,
    batchNo: filters.batchNo || undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    page: page.value,
    pageSize,
  })),
})
const totalPages = computed(() => Math.max(1, Math.ceil((data.value?.total || 0) / pageSize)))

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

// 使用数量与可领数量分开：任务占用仍属于剩余，已用数量以后台去重统计为准。
const usedCount = (row: any) => Number(row?.usedCount ?? row?.boundCount ?? 0)
const remainingCount = (row: any) => Number(row?.remainingCount ?? Math.max(0, Number(row?.codeTotal || 0) - usedCount(row)))
const exactQuantity = (value: unknown) => `${Number(value || 0).toLocaleString('zh-CN')}张`
const usageBadge = (row: any) => usedCount(row) === 0
  ? { label: '未使用', cls: 'b-tag-default' }
  : remainingCount(row) === 0
    ? { label: '已用完', cls: 'b-tag-success' }
    : { label: '部分使用', cls: 'b-tag-warning' }

const batchSpec = (row: any) => row?.specName || '原规格资料未记录'
const isUsedChild = (row: any) => row?.kind === 'used'
const isRemainingChild = (row: any) => row?.kind === 'remaining'
const batchRootId = (row: any) => Number(row?.parentUploadBatchId || row?.id || 0)
const batchKey = (row: any) => `${row?.kind || 'root'}:${isUsedChild(row) ? row.id : batchRootId(row)}`
const batchApi = (row: any, action = '') => `/api/admin/codes/${isUsedChild(row) ? 'usage-batches/' + row.id : 'upload-batches/' + batchRootId(row)}${action ? '/' + action : ''}`
const batchScope = (row: any): Record<string, string> => isRemainingChild(row) ? { scope: 'remaining' } : {}
const batchScopeText = (row: any) => isUsedChild(row)
  ? `本次上传子批次，共 ${exactQuantity(row.codeTotal)}`
  : isRemainingChild(row)
    ? `本总批次尚未使用的码，共 ${exactQuantity(row.codeTotal)}`
    : `整个总批次，包含其全部已用及剩余子批次，共 ${exactQuantity(row?.codeTotal)}`

interface ChildPage {
  rows: any[]
  total: number
  page: number
  pageSize: number
  legacyBoundCount: number
  productionRecordsAvailable: boolean
  unavailableReason: string | null
}
interface ChildState {
  page: number
  loading: boolean
  error: string
  result: ChildPage | null
}
const expandedBatches = reactive(new Set<number>())
const childStates = reactive<Record<number, ChildState>>({})
const childPageSize = 20
const childControllers = new Map<number, AbortController>()
const childRequests = new Map<number, number>()
const childState = (id: number) => childStates[id] || (childStates[id] = { page: 1, loading: false, error: '', result: null })
const cancelChildren = (id: number) => {
  childRequests.set(id, (childRequests.get(id) || 0) + 1)
  childControllers.get(id)?.abort()
  childControllers.delete(id)
  if (childStates[id]) childStates[id]!.loading = false
}
const loadChildren = async (id: number) => {
  if (!expandedBatches.has(id)) return
  cancelChildren(id)
  const state = childState(id)
  const requestedPage = state.page
  const request = (childRequests.get(id) || 0) + 1
  childRequests.set(id, request)
  const controller = new AbortController()
  childControllers.set(id, controller)
  state.loading = true
  state.error = ''
  try {
    const result = await $fetch<ChildPage>(`/api/admin/codes/upload-batches/${id}/children`, {
      query: { page: requestedPage, pageSize: childPageSize }, signal: controller.signal,
    })
    if (childRequests.get(id) !== request || !expandedBatches.has(id)) return
    state.result = result
    const lastPage = Math.max(1, Math.ceil(Number(result.total || 0) / childPageSize))
    if (requestedPage > lastPage) { state.page = lastPage; void loadChildren(id) }
  } catch (e: any) {
    if (childRequests.get(id) === request && !controller.signal.aborted) state.error = e?.data?.statusMessage || '子批次加载失败，请重试'
  } finally {
    if (childRequests.get(id) === request) { state.loading = false; childControllers.delete(id) }
  }
}
const toggleChildren = (row: any) => {
  const id = batchRootId(row)
  if (expandedBatches.has(id)) { expandedBatches.delete(id); cancelChildren(id) }
  else { expandedBatches.add(id); void loadChildren(id) }
}
const changeChildPage = (id: number, next: number) => { childState(id).page = next; void loadChildren(id) }
const childTotalPages = (id: number) => Math.max(1, Math.ceil(Number(childStates[id]?.result?.total || 0) / childPageSize))
const childRows = (root: any) => {
  const state = childStates[Number(root.id)]
  if (!state?.result || state.result.page !== state.page) return []
  // 历史已用码只计入父汇总；剩余行按当前未使用范围展示，不补造历史已用子批次。
  return [...state.result.rows].sort((a, b) => Number(a.kind === 'remaining') - Number(b.kind === 'remaining')).map(child => ({
    ...child, parentUploadBatchId: Number(root.id),
    file_name: child.name || (child.kind === 'remaining' ? '剩余子批次' : '已用子批次'),
    product_id: root.product_id, product_name: root.product_name,
    batch_no: child.batchNo, created_at: child.firstReceivedAt || root.created_at,
    boundCount: child.kind === 'used' ? Number(child.count || child.codeTotal || 0) : 0,
  }))
}
const visibleBatchRows = computed(() => (data.value?.rows || []).flatMap((root: any) => [
  { ...root, kind: 'root' },
  ...(expandedBatches.has(Number(root.id)) ? [
    ...childRows(root), { kind: 'children-info', id: `info-${root.id}`, parentUploadBatchId: Number(root.id) },
  ] : []),
]))
watch(data, result => {
  const visibleIds = new Set<number>((result?.rows || []).map((row: any) => Number(row.id)))
  for (const id of childControllers.keys()) if (!visibleIds.has(id)) cancelChildren(id)
  for (const id of expandedBatches) if (visibleIds.has(id)) void loadChildren(id)
})
const refreshAllBatches = () => {
  void refresh()
  if (showUsageModal.value) void loadUsage()
}
const createRemainingTask = (row: any) => {
  if (!canWrite.value || Number(row.availableCount || 0) <= 0) return
  void navigateTo({ path: '/admin/production-tasks', query: { create: '1', productId: String(row.product_id), sourceUploadBatchId: String(batchRootId(row)) } })
}

// ============ 批次使用记录（仅查看，按后台收到日期、任务和上传账号汇总） ============
interface UsageRecord {
  taskId: number
  taskName: string
  batchNo: string | null
  lineName: string | null
  usageDate: string
  count: number
  source: 'mobile' | 'online'
  sourceLabel: string
  firstReceivedAt: string | null
  lastReceivedAt: string | null
  firstCapturedAt: string | null
  lastCapturedAt: string | null
  uploaderType: 'user' | 'unknown'
  uploaderId: number | null
  uploaderUsername: string | null
  uploaderName: string | null
  deviceId: number | null
  deviceName: string | null
}
interface UsageResult {
  uploadBatchId: number
  codeTotal: number
  usedCount: number
  remainingCount: number
  taskUsedCount: number
  legacyBoundCount: number
  productionRecordsAvailable: boolean
  unavailableReason: string | null
  rows: UsageRecord[]
  total: number
  page: number
  pageSize: number
}
const showUsageModal = ref(false)
const usageRow = ref<any>(null)
const usageData = ref<UsageResult | null>(null)
const usageLoading = ref(false)
const usageError = ref('')
const usagePage = ref(1)
const usagePageSize = 20
const usageRows = computed(() => usageData.value?.page === usagePage.value ? usageData.value.rows : [])
const usageSummary = computed(() => usageData.value || usageRow.value)
const usageTotalPages = computed(() => Math.max(1, Math.ceil((usageData.value?.total || 0) / usagePageSize)))
let usageRequest = 0
let usageController: AbortController | undefined
const cancelUsageRequest = () => {
  usageRequest++
  usageController?.abort()
  usageController = undefined
  usageLoading.value = false
}
const loadUsage = async () => {
  if (!showUsageModal.value || !usageRow.value) return
  usageController?.abort()
  const controller = new AbortController()
  usageController = controller
  const request = ++usageRequest
  const batchId = Number(usageRow.value.id)
  const requestedPage = usagePage.value
  usageLoading.value = true
  usageError.value = ''
  try {
    const result = await $fetch<UsageResult>(`/api/admin/codes/upload-batches/${batchId}/usage`, {
      query: { page: requestedPage, pageSize: usagePageSize },
      signal: controller.signal,
    })
    if (request !== usageRequest || !showUsageModal.value || Number(usageRow.value?.id) !== batchId) return
    usageData.value = result
    // 删除明细等操作可能减少记录页数，回到仍存在的最后一页。
    const lastPage = Math.max(1, Math.ceil(Number(result.total || 0) / usagePageSize))
    if (requestedPage > lastPage) {
      usagePage.value = lastPage
      void loadUsage()
    }
  } catch (e: any) {
    if (request === usageRequest && !controller.signal.aborted) usageError.value = e?.data?.statusMessage || '使用记录加载失败，请重试'
  } finally {
    if (request === usageRequest) {
      usageLoading.value = false
      usageController = undefined
    }
  }
}
const openUsage = (row: any) => {
  cancelUsageRequest()
  usageRow.value = row
  usageData.value = null
  usagePage.value = 1
  usageError.value = ''
  showUsageModal.value = true
  void loadUsage()
}
watch(data, result => {
  if (!showUsageModal.value || !usageRow.value) return
  const latestRow = result?.rows?.find((row: any) => Number(row.id) === Number(usageRow.value.id))
  if (latestRow) usageRow.value = latestRow
})
const changeUsagePage = (next: number) => {
  usagePage.value = next
  void loadUsage()
}
watch(showUsageModal, open => { if (!open) cancelUsageRequest() })
// 接口统一返回北京时间；保留秒，区分设备采集时间与后台收到时间。
const usageTime = (value: string | null | undefined) => {
  if (!value) return '未记录'
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2}:\d{2})/)
  return match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日 ${match[4]}` : String(value)
}
const uploaderText = (record: Pick<UsageRecord, 'uploaderUsername' | 'uploaderName'>) => {
  // 设备编号和登记管理员都不代表实际上传人，留待账号模块接入。
  const account = record.uploaderUsername && !record.uploaderUsername.startsWith('device:') ? record.uploaderUsername : ''
  const name = record.uploaderName || ''
  if (!account && !name) return '上传账号待接入'
  return account && name && name !== account ? `${account}（${name}）` : account || name
}

// Keep-Alive 切走时停止刷新；恢复页面或窗口焦点后重新获取最新使用量。
let codesRefreshTimer: ReturnType<typeof setInterval> | undefined
let codesPageActive = false
const refreshVisibleCodes = () => {
  if (!codesPageActive || document.visibilityState !== 'visible') return
  if (!pending.value) void refresh()
  if (showUsageModal.value && !usageLoading.value) void loadUsage()
  if (showDetailModal.value && !detailLoading.value) void loadDetail()
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
  cancelUsageRequest()
  for (const id of childControllers.keys()) cancelChildren(id)
  cancelDetailRequest()
  cancelCorrectPreview()
}
onMounted(startCodesRefresh)
onActivated(() => { startCodesRefresh(); refreshVisibleCodes() })
onDeactivated(stopCodesRefresh)
onUnmounted(stopCodesRefresh)

// ============ 父批次及子批次异常标记 ============
const showFreezeModal = ref(false)
const freezing = ref(false)
const freezeTarget = ref<any>(null)
const batchFlagAction = ref<'freeze' | 'void' | 'restore'>('freeze')
const batchFlagReason = ref('')
const batchFlagLabel = computed(() => ({ freeze: '冻结', void: '作废', restore: '恢复正常' })[batchFlagAction.value])
const batchFlagCount = computed(() => Number(batchFlagAction.value === 'freeze' ? freezeTarget.value?.normalCount : batchFlagAction.value === 'restore' ? freezeTarget.value?.frozenCount : Number(freezeTarget.value?.codeTotal || 0) - Number(freezeTarget.value?.voidedCount || 0)))
const openFreeze = (row: any, action: 'freeze' | 'void' | 'restore' = 'freeze') => {
  if (!canWrite.value) return
  freezeTarget.value = row
  batchFlagAction.value = action
  batchFlagReason.value = ''
  if (batchFlagCount.value <= 0) { toast.add({ title: `本批次没有可${batchFlagLabel.value}的追溯码`, color: 'warning' }); return }
  showFreezeModal.value = true
}
const submitFreeze = async () => {
  if (!canWrite.value || !freezeTarget.value) return
  const flag = { freeze: 1, void: 2, restore: 0 }[batchFlagAction.value]
  if (flag === 2 && !batchFlagReason.value.trim()) { toast.add({ title: '作废必须填写原因', color: 'warning' }); return }
  freezing.value = true
  try {
    const res = await $fetch<any>(batchApi(freezeTarget.value, 'flag'), {
      method: 'POST', body: { flag, reason: batchFlagReason.value.trim(), ...batchScope(freezeTarget.value) },
    })
    toast.add({ title: batchFlagLabel.value + '完成：' + res.affected + ' 条', color: 'success' })
    showFreezeModal.value = false
    refreshAllBatches()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || batchFlagLabel.value + '失败', color: 'error' })
  } finally {
    freezing.value = false
  }
}

// ============ 整批修正（表单字段复用批量修正工具：批次重绑/生产日期/有效期/质检/合格证号） ============
const showCorrectModal = ref(false)
const showBindModal = ref(false)
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
  if (!showCorrectModal.value || !isUsedChild(correctTarget.value)) return
  cancelCorrectPreview()
  const targetKey = batchKey(correctTarget.value)
  const request = ++correctPreviewRequest
  const controller = new AbortController()
  correctPreviewController = controller
  correctPreviewLoading.value = true
  correctPreviewError.value = ''
  try {
    const result = await $fetch<CorrectPreview>(batchApi(correctTarget.value, 'correct'), { signal: controller.signal })
    if (request === correctPreviewRequest && showCorrectModal.value && targetKey === batchKey(correctTarget.value)) correctPreview.value = result
  } catch (e: any) {
    if (request === correctPreviewRequest && !controller.signal.aborted) correctPreviewError.value = e?.data?.statusMessage || '关联任务修改范围加载失败，请重试'
  } finally {
    if (request === correctPreviewRequest) { correctPreviewLoading.value = false; correctPreviewController = undefined }
  }
}
watch(showCorrectModal, open => { if (!open) cancelCorrectPreview() })
const correctImpactCount = computed(() => isUsedChild(correctTarget.value) ? Number(correctPreview.value?.totalCodes || 0) : Number(correctTarget.value?.codeTotal || 0))
// batchId=0 与 qcResult='keep' 为「不修改」哨兵值（reka-ui 禁止空字符串 value）
const correctForm = reactive({
  batchId: 0 as number,
  produceDate: '', expireDate: '', qcResult: 'keep', qualityCertNo: '',
  // 新建批次绑定模式（2026-09-04 方案 A）：适用于「生成入库留档」的已生成码——
  // 填三要素自动建档并绑定本批全部已生成码；与「绑定已有批次」互斥
  batchNo: '', qcReportNo: '',
})
const newBatchMode = ref(false)
const { data: batchAll } = await useFetch<any>('/api/admin/batches', {
  key: 'admin-upload-batches-correct',
  query: { page: 1, pageSize: 100 },
})
const openCorrect = (row: any, bind = false) => {
  if (!canWrite.value) return
  if (row.frozenCount + row.voidedCount > 0) {
    toast.add({ title: '本批次含 ' + (row.frozenCount + row.voidedCount) + ' 条已冻结/已作废的码，整批修正前请先在「详细」中处理（单行恢复/作废）', color: 'warning' })
    return
  }
  correctTarget.value = row
  cancelCorrectPreview()
  correctPreview.value = null
  correctPreviewError.value = ''
  correctConfirmed.value = false
  correctRequestId.value = crypto.randomUUID()
  Object.assign(correctForm, { batchId: 0, produceDate: '', expireDate: '', qcResult: 'keep', qualityCertNo: '', batchNo: '', qcReportNo: '' })
  newBatchMode.value = bind
  showBindModal.value = bind
  showCorrectModal.value = !bind
  if (isUsedChild(row)) void loadCorrectPreview()
}
watch(() => JSON.stringify(correctForm), () => { if (!correcting.value) correctRequestId.value = crypto.randomUUID() })
const submitCorrect = async () => {
  if (!canWrite.value || !correctTarget.value) return
  const taskCorrection = isUsedChild(correctTarget.value)
  if (taskCorrection && (correctPreviewLoading.value || !correctPreview.value?.canCorrect || correctPreviewError.value || !correctConfirmed.value)) {
    toast.add({ title: '请先确认关联生产任务的完整修改范围', color: 'warning' }); return
  }
  for (const [label, value] of [['生产日期', correctForm.produceDate], ['有效期至', correctForm.expireDate]]) {
    if (value && !isInputDate(value)) {
      toast.add({ title: label + '请输入有效日期，格式为 YYYY-MM-DD', color: 'warning' }); return
    }
  }
  // 新建批次模式：批号、生产日期必填，合格证号为空使用约定文字（质检默认合格）；与字段修正/已有批次绑定互斥
  if (newBatchMode.value) {
    if (!correctForm.batchNo.trim() || !correctForm.produceDate) {
      toast.add({ title: '新建批次需填写生产批次号与生产日期', color: 'warning' }); return
    }
  } else if (!correctForm.batchId && !correctForm.produceDate && !correctForm.expireDate && correctForm.qcResult === 'keep' && !correctForm.qualityCertNo && !(taskCorrection && correctForm.batchNo.trim())) {
    toast.add({ title: '请至少选择一个要修改的字段', color: 'warning' }); return
  }
  correcting.value = true
  try {
    const res = await $fetch<any>(batchApi(correctTarget.value, 'correct'), {
      method: 'POST',
      body: newBatchMode.value
        ? {
            ...batchScope(correctTarget.value),
            batchNo: correctForm.batchNo.trim(),
            produceDate: correctForm.produceDate,
            qualityCertNo: correctForm.qualityCertNo.trim() || '见箱内质量合格证',
            qcReportNo: correctForm.qcReportNo.trim() || undefined,
            expireDate: correctForm.expireDate || undefined,
          }
        : {
            ...batchScope(correctTarget.value),
            requestId: taskCorrection ? correctRequestId.value : undefined,
            batchNo: taskCorrection ? correctForm.batchNo.trim() || undefined : undefined,
            batchId: taskCorrection ? undefined : correctForm.batchId || undefined,
            produceDate: correctForm.produceDate || undefined,
            expireDate: correctForm.expireDate || undefined,
            qcResult: correctForm.qcResult === 'keep' ? undefined : Number(correctForm.qcResult),
            qualityCertNo: correctForm.qualityCertNo || undefined,
          },
    })
    const parts: string[] = []
    if (newBatchMode.value) {
      parts.push((res.batchCreated ? '已新建批次 ' : '已归并批次 ') + correctForm.batchNo.trim() + '，绑定 ' + res.rebound + ' 条')
    } else {
      if (res.rebound > 0) parts.push('重新绑定批次 ' + res.rebound + ' 条')
      if (res.corrected > 0) parts.push('字段修正 ' + res.corrected + ' 条')
    }
    toast.add({ title: taskCorrection ? `关联生产任务已同步修改，共 ${exactQuantity(res.corrected ?? correctImpactCount.value)}` : (newBatchMode.value ? '绑定完成：' : '整批修正完成：') + (parts.join('，') || '无变更'), color: 'success' })
    showCorrectModal.value = false
    showBindModal.value = false
    refreshAllBatches()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '修正失败', color: 'error' })
  } finally {
    correcting.value = false
  }
}

// ============ 整批删除（上传批次 + 批次下全部追溯码） ============
// 删除约束：批次内存在已绑定码（status=2）时按钮置灰不可删——已绑定码扫码可追溯，
// 删除会破坏 1049 合规可查性；仅全部未绑定批次允许删除（canDelete 由服务端聚合计算）
const showDeleteModal = ref(false)
const deleting = ref(false)
const deleteTarget = ref<any>(null)
const openDelete = (row: any) => {
  if (!row.canDelete) {
    toast.add({ title: '该批次存在已绑定追溯码，无法删除', color: 'warning' })
    return
  }
  deleteTarget.value = row
  showDeleteModal.value = true
}
const submitDelete = async () => {
  if (!canWrite.value || !deleteTarget.value) return
  deleting.value = true
  try {
    const res = await $fetch<any>(batchApi(deleteTarget.value), { method: 'DELETE', query: batchScope(deleteTarget.value) })
    toast.add({ title: '批次已删除（含追溯码 ' + res.deletedCodes + ' 条），数据不可恢复', color: 'success' })
    showDeleteModal.value = false
    refreshAllBatches()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '删除失败', color: 'error' })
  } finally {
    deleting.value = false
  }
}

// ============ 导出留档批次（2026-10-10） ============
// 背景：生成页（generator）生成的码不入库，若未及时下载文件且页面已刷新/关闭，码将无法找回；
// 此前点过「入库留档」的批次可在此重新导出。范围与服务端一致：仅 file_name 以「生成入库」开头的留档批次。
const STOCK_IN_PREFIX = '生成入库'
const isStockedBatch = (row: any) => String(row?.file_name || '').startsWith(STOCK_IN_PREFIX)
const canExportBatch = (row: any) => row?.canExport ?? (row?.kind === 'root' ? isStockedBatch(row) : true)
const showExportModal = ref(false)
const exportTarget = ref<any>(null)
const exporting = ref(false)
const openExport = (row: any) => {
  exportTarget.value = row
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
    const query = new URLSearchParams({ format, ...batchScope(exportTarget.value) })
    const res = await fetch(batchApi(exportTarget.value, 'export') + '?' + query.toString(), { credentials: 'include' })
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
    toast.add({ title: '已导出 ' + (exportTarget.value.codeTotal || 0) + ' 条追溯码', color: 'success' })
    showExportModal.value = false
  } catch (e: any) {
    toast.add({ title: e?.message || '导出失败', color: 'error' })
  } finally {
    exporting.value = false
  }
}

// ============ 批次明细弹窗（查看 + 单行冻结/作废/恢复，无批量操作） ============
const showDetailModal = ref(false)
const detailRow = ref<any>(null)
const detailLoading = ref(false)
const detailError = ref('')
const detailRows = ref<any[]>([])
const detailTotal = ref(0)
const detailPage = ref(1)
const detailPageSize = 20
// 明细筛选（仅本批次内）：码值/批号关键字、码状态、异常标记
const dFilters = reactive({
  keyword: '', status: undefined as string | undefined, abnormalFlag: undefined as string | undefined,
})
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
  const targetKey = batchKey(detailRow.value)
  const requestedPage = detailPage.value
  const controller = new AbortController()
  detailController = controller
  detailLoading.value = true
  detailError.value = ''
  detailRows.value = []
  try {
    const res = await $fetch<any>('/api/admin/codes', {
      query: {
        ...(isUsedChild(detailRow.value) ? { usageBatchId: detailRow.value.id } : { uploadBatchId: batchRootId(detailRow.value) || undefined, ...batchScope(detailRow.value) }),
        keyword: dFilters.keyword || undefined,
        status: dFilters.status || undefined,
        abnormalFlag: dFilters.abnormalFlag || undefined,
        page: requestedPage,
        pageSize: detailPageSize,
      },
      signal: controller.signal,
    })
    if (request !== detailRequest || !showDetailModal.value || targetKey !== batchKey(detailRow.value)) return
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
  Object.assign(dFilters, { keyword: '', status: undefined, abnormalFlag: filters.abnormalFlag })
  showDetailModal.value = true
  loadDetail()
}
watch(showDetailModal, open => { if (!open) cancelDetailRequest() })
// 首页异常指标查看全企业码明细，包括尚未归属上传批次的生成码。
const codesRoute = useRoute()
const openGlobalDetail = () => {
  if (!filters.abnormalFlag) return
  cancelDetailRequest()
  detailRows.value = []
  detailTotal.value = 0
  detailRow.value = { id: undefined, file_name: filters.abnormalFlag === '1' ? '全部冻结码' : '全部作废码' }
  detailPage.value = 1
  Object.assign(dFilters, { keyword: '', status: undefined, abnormalFlag: filters.abnormalFlag })
  showDetailModal.value = true
  loadDetail()
}
onMounted(openGlobalDetail)
onActivated(() => { if (!showDetailModal.value && codesRoute.path === '/admin/codes' && filters.abnormalFlag) openGlobalDetail() })
watch(() => filters.abnormalFlag, () => { if (codesRoute.path === '/admin/codes') { if (filters.abnormalFlag) openGlobalDetail(); else showDetailModal.value = false } })
const onDetailSearch = () => { detailPage.value = 1; loadDetail() }
const detailTotalPages = computed(() => Math.max(1, Math.ceil(detailTotal.value / detailPageSize)))

// 明细单行异常标记操作（PATCH /api/admin/codes/:id，与单条码业务逻辑一致；作废终态需原因）
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
    loadDetail() // 刷新明细（行状态变化）
    refreshAllBatches()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '操作失败', color: 'error' })
  } finally {
    rowFlagging.value = false
  }
}

// ============ 明细单行【修改】（2026-09-04：单条码数据修改，表单复用批量修正字段，仅作用于当前行） ============
const showRowEditModal = ref(false)
const rowEditTarget = ref<any>(null)
const rowEditing = ref(false)
// batchId=0 与 qcResult='keep' 为「不修改」哨兵值（与整批修正表单同构）
const rowEditForm = reactive({
  batchId: 0 as number,
  produceDate: '', expireDate: '', qcResult: 'keep', qualityCertNo: '',
})
const openRowEdit = (row: any) => {
  if (Number(row.abnormal_flag) !== 0) {
    toast.add({ title: '冻结码请先恢复正常；作废码不可修改', color: 'warning' }); return
  }
  if (isUsedChild(detailRow.value)) {
    const target = { ...detailRow.value }
    showDetailModal.value = false
    void nextTick(() => openCorrect(target))
    return
  }
  if (row.usageBatchId) {
    const target = { ...row, kind: 'used', id: Number(row.usageBatchId), parentUploadBatchId: batchRootId(detailRow.value), codeTotal: 1, normalCount: 1, frozenCount: 0, voidedCount: 0, file_name: `追溯码所属上传子批次 · ${row.code}` }
    // 先关闭明细再打开任务编辑，避免两个独立弹窗的遮罩互相覆盖。
    showDetailModal.value = false
    void nextTick(() => openCorrect(target))
    return
  }
  if (row.taskId) { toast.add({ title: `此码由生产任务 ${row.taskId} 管理，请在「生产任务与审核」中同步修改任务`, color: 'warning' }); return }
  rowEditTarget.value = row
  Object.assign(rowEditForm, { batchId: 0, produceDate: '', expireDate: '', qcResult: 'keep', qualityCertNo: '' })
  showRowEditModal.value = true
}
const submitRowEdit = async () => {
  if (!rowEditForm.batchId && !rowEditForm.produceDate && !rowEditForm.expireDate && rowEditForm.qcResult === 'keep' && !rowEditForm.qualityCertNo) {
    toast.add({ title: '请至少选择一个要修改的字段', color: 'warning' }); return
  }
  rowEditing.value = true
  try {
    const res = await $fetch('/api/admin/codes/' + rowEditTarget.value.id + '/correct', {
      method: 'POST',
      body: {
        batchId: rowEditForm.batchId || undefined,
        produceDate: rowEditForm.produceDate || undefined,
        expireDate: rowEditForm.expireDate || undefined,
        qcResult: rowEditForm.qcResult === 'keep' ? undefined : Number(rowEditForm.qcResult),
        qualityCertNo: rowEditForm.qualityCertNo || undefined,
      },
    })
    const parts: string[] = []
    if (res.rebound > 0) parts.push('已重新绑定批次')
    if (res.corrected > 0) parts.push('字段已修正')
    toast.add({ title: '修改成功：' + (parts.join('，') || '无变更'), color: 'success' })
    showRowEditModal.value = false
    loadDetail() // 刷新当前明细（仅本条变化）
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '修改失败', color: 'error' })
  } finally {
    rowEditing.value = false
  }
}

// ============ 明细单行【删除】（仅删除当前这一条码，不影响同批次其他码） ============
// 约束：码状态为已绑定（status=2）时按钮置灰不可删（已绑定码扫码可追溯，删除会破坏合规可查性）；
// 仅未绑定码允许删除（冻结/作废但未绑定的码同样可删，删除为物理清除）
const showRowDeleteModal = ref(false)
const rowDeleting = ref(false)
const rowDeleteTarget = ref<any>(null)
const openRowDelete = (row: any) => {
  if (Number(row.status) === 2) {
    toast.add({ title: '该追溯码已绑定，不允许删除', color: 'warning' })
    return
  }
  rowDeleteTarget.value = row
  showRowDeleteModal.value = true
}
const submitRowDelete = async () => {
  rowDeleting.value = true
  try {
    await $fetch('/api/admin/codes/' + rowDeleteTarget.value.id, { method: 'DELETE' })
    toast.add({ title: '追溯码已删除，数据不可恢复', color: 'success' })
    showRowDeleteModal.value = false
    // 当前页删空且非第一页时回退一页，避免停留在空页
    if (detailRows.value.length === 1 && detailPage.value > 1) detailPage.value--
    loadDetail() // 刷新当前明细表格
    refreshAllBatches()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '删除失败', color: 'error' })
  } finally {
    rowDeleting.value = false
  }
}

// 状态/异常标签（浅底深字）
const statusBadge = (s: number) => {
  if (s === 2) return { cls: 'b-tag-success', label: '已绑定' }
  return { cls: 'b-tag-info', label: '已生成' }
}
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
        <p class="b-page-desc">展开总批次，分别管理每次上传的已用子批次与剩余子批次</p>
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
          <label class="b-label">批次文件名</label>
          <UInput v-model="filters.fileName" placeholder="输入上传文件名称" icon="i-lucide-search" @keyup.enter="doSearch" />
        </div>
        <div>
          <label class="b-label">关联产品</label>
          <USelect v-model="filters.productId" :items="PRODUCT_OPTIONS" placeholder="全部产品" class="w-full" :content="{ class: 'min-w-72' }" :ui="{ value: 'whitespace-normal break-words text-left', itemLabel: 'whitespace-normal break-words' }" />
        </div>
        <div>
          <label class="b-label">生产批号</label>
          <UInput v-model="filters.batchNo" placeholder="输入生产批号" @keyup.enter="doSearch" />
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
        <span class="b-card-extra">共 <span class="font-medium b-strong">{{ data?.total || 0 }}</span> 个上传批次</span>
        <div class="flex items-center gap-2">
          <UButton color="neutral" variant="solid" @click="doSearch">查询</UButton>
          <UButton color="neutral" variant="outline" @click="resetSearch">重置</UButton>
        </div>
      </div>
    </div>

    <div v-if="filters.abnormalFlag || filters.uploadBatchId" class="b-note">
      <UButton v-if="filters.abnormalFlag" size="xs" variant="outline" @click="openGlobalDetail">查看全部匹配码</UButton>
      <span>当前范围：{{ filters.uploadBatchId ? '指定上传批次' : filters.abnormalFlag === '1' ? '包含冻结码的上传批次' : '包含作废码的上传批次' }} · 码总数量为批次全部码数量</span>
      <UButton size="xs" variant="link" @click="resetSearch">查看全部</UButton>
    </div>
    <!-- 批次聚合列表 -->
    <div class="b-card b-card-clip">
      <div class="b-card-head">
        <span class="b-card-title">总批次与子批次</span>
        <span class="b-card-extra">每页 {{ pageSize }} 行 · 共 {{ data?.total || 0 }} 个批次</span>
      </div>

      <div class="b-scroll-x">
        <table class="b-table" aria-label="总批次与子批次">
          <thead>
            <tr>
              <th>批次名称</th>
              <th>关联产品</th>
              <th>包装规格</th>
              <th class="text-right">码数量</th>
              <th>使用情况</th>
              <th>码状态汇总</th>
              <th>生产批号</th>
              <th>上传时间 / 账号</th>
              <th class="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="row in visibleBatchRows" :key="batchKey(row)">
              <tr v-if="row.kind === 'children-info'">
                <td colspan="9" class="!bg-[var(--b-fill-weak)] !py-2 !pl-12">
                  <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--b-text-muted)]">
                    <div class="flex flex-wrap items-center gap-2">
                      <span v-if="childStates[batchRootId(row)]?.loading" role="status" class="flex items-center gap-1"><UIcon name="i-lucide-loader-circle" class="h-3.5 w-3.5 animate-spin" />正在加载子批次</span>
                      <template v-if="childStates[batchRootId(row)]?.error">
                        <span role="alert" class="text-red-600">{{ childStates[batchRootId(row)]?.error }}</span>
                        <UButton variant="link" color="neutral" size="xs" @click="loadChildren(batchRootId(row))">重试</UButton>
                      </template>
                      <span v-if="childStates[batchRootId(row)]?.result?.productionRecordsAvailable === false">{{ childStates[batchRootId(row)]?.result?.unavailableReason || '生产子批次暂不可用' }}</span>
                      <span v-if="childStates[batchRootId(row)]?.result?.legacyBoundCount">历史已用 {{ formatCodeQuantity(childStates[batchRootId(row)]?.result?.legacyBoundCount || 0) }} 仅计入总批次汇总；子批次从新上传流程开始建立。</span>
                      <span v-if="!childStates[batchRootId(row)]?.loading && !childStates[batchRootId(row)]?.error && childStates[batchRootId(row)]?.result?.total === 0 && !childStates[batchRootId(row)]?.result?.legacyBoundCount">尚无已用子批次，移动端完成本次上传后显示。</span>
                    </div>
                    <div v-if="childStates[batchRootId(row)]?.result?.total" class="flex items-center gap-2">
                      <span>已用子批次 {{ childStates[batchRootId(row)]?.result?.total }} 批 · 第 {{ childStates[batchRootId(row)]?.page }} / {{ childTotalPages(batchRootId(row)) }} 页</span>
                      <UButton variant="outline" color="neutral" size="xs" :disabled="childStates[batchRootId(row)]?.loading || (childStates[batchRootId(row)]?.page || 1) <= 1" @click="changeChildPage(batchRootId(row), (childStates[batchRootId(row)]?.page || 1) - 1)">上一页</UButton>
                      <UButton variant="outline" color="neutral" size="xs" :disabled="childStates[batchRootId(row)]?.loading || (childStates[batchRootId(row)]?.page || 1) >= childTotalPages(batchRootId(row))" @click="changeChildPage(batchRootId(row), (childStates[batchRootId(row)]?.page || 1) + 1)">下一页</UButton>
                    </div>
                  </div>
                </td>
              </tr>
              <tr v-else :data-batch-kind="row.kind" :data-batch-key="batchKey(row)" :class="{ '!bg-[var(--b-fill-weak)]': row.kind !== 'root' }">
                <td class="min-w-72">
                  <div class="flex items-start gap-2" :class="{ 'pl-6': row.kind !== 'root' }">
                    <UButton v-if="row.kind === 'root'" variant="link" color="neutral" size="xs" :icon="expandedBatches.has(Number(row.id)) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" :aria-label="(expandedBatches.has(Number(row.id)) ? '收起' : '展开') + '总批次 ' + row.file_name" :aria-expanded="expandedBatches.has(Number(row.id))" @click="toggleChildren(row)" />
                    <UIcon v-else name="i-lucide-chevron-right" class="mt-1 h-4 w-4 shrink-0 text-[var(--b-text-muted)]" />
                    <div>
                      <span v-if="row.kind === 'root'" class="b-tag b-tag-default mb-1">总批次</span>
                      <span v-else class="b-tag mb-1" :class="isRemainingChild(row) ? 'b-tag-info' : 'b-tag-success'">{{ isRemainingChild(row) ? '剩余子批次' : '已用 ' + formatCodeQuantity(row.codeTotal) }}</span>
                      <p class="max-w-72 break-words text-[13px] b-strong" :title="row.file_name">{{ row.file_name }}</p>
                      <p v-if="isUsedChild(row)" class="mt-1 text-xs text-[var(--b-text-muted)]">任务：{{ row.taskName || row.name || '名称未记录' }} · 编号 {{ row.taskId }}</p>
                    </div>
                  </div>
                </td>
                <td class="min-w-32">{{ row.product_name || '-' }}</td>
                <td class="min-w-36"><span class="break-words" :class="{ 'text-[var(--b-text-muted)]': !row.specName }">{{ batchSpec(row) }}</span></td>
                <td class="text-right whitespace-nowrap font-medium b-strong" :title="exactQuantity(row.codeTotal)">{{ formatCodeQuantity(row.codeTotal) }}</td>
                <td class="min-w-52">
                  <template v-if="isUsedChild(row)">
                    <span class="b-tag" :class="row.uploadState === 'completed' ? 'b-tag-success' : 'b-tag-warning'">{{ row.uploadState === 'completed' ? '上传已完成' : row.uploadState === 'closing' ? '正在完成上传' : '上传中' }}</span>
                    <p class="mt-1 text-xs text-[var(--b-text-muted)]">{{ row.sourceLabel || '移动端上传' }}</p>
                    <p v-if="row.uploadState !== 'completed'" class="mt-1 text-xs text-[var(--b-text-muted)]">数量按成功上传更新，完成后固定</p>
                  </template>
                  <template v-else>
                    <div class="flex flex-wrap items-center gap-2">
                      <span v-if="row.kind === 'root'" class="b-tag whitespace-nowrap" :class="usageBadge(row).cls">{{ usageBadge(row).label }}</span>
                      <span class="font-medium b-strong" :title="exactQuantity(remainingCount(row))">剩余 {{ formatCodeQuantity(remainingCount(row)) }}</span>
                    </div>
                    <p v-if="row.kind === 'root'" class="mt-1 text-xs text-[var(--b-text-muted)]" :title="exactQuantity(usedCount(row))">已用 {{ formatCodeQuantity(usedCount(row)) }}</p>
                    <p v-if="row.occupiedCount > 0" class="mt-1 text-xs text-[var(--b-text-muted)]"><span :title="exactQuantity(row.occupiedCount)">任务占用 {{ formatCodeQuantity(row.occupiedCount) }}</span></p>
                    <p v-if="isRemainingChild(row) || row.occupiedCount > 0" class="mt-1 text-xs text-[var(--b-text-muted)]"><span :title="exactQuantity(row.availableCount)">当前可领 {{ formatCodeQuantity(row.availableCount || 0) }}</span></p>
                    <p v-if="isRemainingChild(row) && row.occupiedCount > 0" class="mt-1 max-w-52 text-xs text-[var(--b-text-muted)]">任务结束并审核通过后，未用码才可再次领取</p>
                    <p v-if="row.lastUsedAt" class="mt-1 text-xs text-[var(--b-text-muted)]">最近使用：{{ usageTime(row.lastUsedAt) }}</p>
                    <p v-if="row.productionRecordsAvailable === false" class="mt-1 max-w-64 text-xs text-[var(--b-text-muted)]">{{ row.unavailableReason || '生产使用记录暂不可用' }}</p>
                  </template>
                </td>
                <td>
                  <span class="b-tag" :class="SUMMARY_BADGE[row.summary] || 'b-tag-default'" :title="'正常 ' + row.normalCount + ' · 冻结 ' + row.frozenCount + ' · 作废 ' + row.voidedCount">{{ row.summary }}</span>
                  <p v-if="row.frozenCount + row.voidedCount > 0" class="b-card-extra mt-1 text-xs">正常 {{ row.normalCount }} / 冻结 {{ row.frozenCount }} / 作废 {{ row.voidedCount }}</p>
                </td>
                <td>{{ row.batch_no || '-' }}</td>
                <td class="min-w-44">
                  <template v-if="isUsedChild(row)">
                    <p>{{ usageTime(row.firstReceivedAt) }}</p>
                    <p v-if="row.lastReceivedAt && row.lastReceivedAt !== row.firstReceivedAt" class="mt-1 text-xs text-[var(--b-text-muted)]">至 {{ usageTime(row.lastReceivedAt) }}</p>
                    <p class="mt-1 text-xs">{{ uploaderText(row) }}</p>
                  </template>
                  <span v-else class="whitespace-nowrap">{{ String(row.created_at || '').slice(0, 16) }}</span>
                </td>
                <td>
                  <div class="flex min-w-80 flex-wrap justify-end gap-x-3 gap-y-1">
                    <UButton variant="link" color="neutral" size="xs" icon="i-lucide-eye" @click="openDetail(row)">详细</UButton>
                    <UButton v-if="row.kind === 'root'" variant="link" color="neutral" size="xs" icon="i-lucide-history" @click="openUsage(row)">使用记录</UButton>
                    <UButton v-if="canExportBatch(row)" variant="link" color="neutral" size="xs" icon="i-lucide-download" @click="openExport(row)">导出</UButton>
                    <template v-if="canWrite">
                      <UButton variant="link" color="neutral" size="xs" icon="i-lucide-snowflake" :disabled="row.normalCount <= 0" :title="batchScopeText(row)" @click="openFreeze(row)">冻结</UButton>
                      <UButton variant="link" color="neutral" size="xs" :disabled="row.frozenCount <= 0" @click="openFreeze(row, 'restore')">恢复</UButton>
                      <UButton variant="link" color="error" size="xs" :disabled="row.codeTotal <= row.voidedCount" @click="openFreeze(row, 'void')">作废</UButton>
                      <UButton v-if="!isUsedChild(row)" variant="link" color="neutral" size="xs" :disabled="row.codeTotal <= row.boundCount" @click="openCorrect(row, true)">新建批次并绑定</UButton>
                      <UButton variant="link" color="neutral" size="xs" :disabled="row.canCorrect === false" :title="isUsedChild(row) ? '同步修改整个关联生产任务及其在其他总批次下的码' : batchScopeText(row)" @click="openCorrect(row)">{{ isUsedChild(row) ? '编辑生产信息' : '修正' }}</UButton>
                      <UButton v-if="isRemainingChild(row)" variant="link" color="neutral" size="xs" :disabled="Number(row.availableCount || 0) <= 0" @click="createRemainingTask(row)">新建生产任务</UButton>
                      <span v-if="!row.canDelete" title="该批次存在已绑定追溯码，无法删除"><UButton variant="link" color="error" size="xs" icon="i-lucide-trash-2" disabled>删除</UButton></span>
                      <UButton v-else variant="link" color="error" size="xs" icon="i-lucide-trash-2" @click="openDelete(row)">删除</UButton>
                    </template>
                  </div>
                </td>
              </tr>
            </template>
            <tr v-if="!pending && !data?.rows?.length">
              <td colspan="9" class="b-empty"><div class="b-empty-inner"><UIcon name="i-lucide-inbox" class="b-empty-icon h-8 w-8" /><span class="text-sm">暂无总批次，请先生成入库或上传码文件；也可调整筛选条件后重试</span></div></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 分页区 -->
      <div v-if="data?.total" class="b-pager">
        <span class="b-card-extra">共 {{ data?.total || 0 }} 个批次 · 第 {{ data.page }} / {{ totalPages }} 页</span>
        <div class="flex items-center gap-2">
          <UButton variant="outline" color="neutral" size="sm" :disabled="page <= 1" @click="applyListQuery(page - 1)">上一页</UButton>
          <UButton variant="outline" color="neutral" size="sm" :disabled="page >= totalPages" @click="applyListQuery(page + 1)">下一页</UButton>
        </div>
      </div>
    </div>

    <!-- 使用记录：各角色均可查看；数量来自后台去重统计，格式化仅用于显示。 -->
    <UModal v-model:open="showUsageModal" :ui="{ content: 'sm:max-w-7xl' }">
      <template #content>
        <div class="b-modal">
          <div class="b-modal-head">
            <div class="b-modal-icon">
              <UIcon name="i-lucide-history" class="h-4 w-4 text-[var(--b-text-regular)]" />
            </div>
            <div class="min-w-0 flex-1">
              <h3 class="b-modal-title">批次使用记录</h3>
              <p class="b-modal-sub break-words" :title="usageRow?.file_name">{{ usageRow?.file_name }}</p>
            </div>
            <UButton variant="outline" color="neutral" size="sm" icon="i-lucide-refresh-cw" :loading="usageLoading" @click="loadUsage">刷新</UButton>
          </div>
          <div class="b-modal-body max-h-[70vh] space-y-4 overflow-y-auto">
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div class="b-card p-3">
                <p class="b-card-extra">码总数量</p>
                <p class="mt-1 text-lg font-semibold b-strong" :title="exactQuantity(usageSummary?.codeTotal)">{{ formatCodeQuantity(usageSummary?.codeTotal || 0) }}</p>
              </div>
              <div class="b-card p-3">
                <p class="b-card-extra">累计已用</p>
                <p class="mt-1 text-lg font-semibold b-strong" :title="exactQuantity(usedCount(usageSummary))">{{ formatCodeQuantity(usedCount(usageSummary)) }}</p>
              </div>
              <div class="b-card p-3">
                <p class="b-card-extra">剩余数量</p>
                <p class="mt-1 text-lg font-semibold b-strong" :title="exactQuantity(remainingCount(usageSummary))">{{ formatCodeQuantity(remainingCount(usageSummary)) }}</p>
              </div>
            </div>
            <p v-if="usageRow?.occupiedCount > 0" class="b-help">
              剩余码中任务占用 <span :title="exactQuantity(usageRow.occupiedCount)">{{ formatCodeQuantity(usageRow.occupiedCount) }}</span>，当前可领 <span :title="exactQuantity(usageRow.availableCount)">{{ formatCodeQuantity(usageRow.availableCount) }}</span>。领用尚未生产的码仍计入剩余。
            </p>
            <div v-if="usageData?.productionRecordsAvailable === false || (!usageData && usageRow?.productionRecordsAvailable === false)" class="b-note">
              <UIcon name="i-lucide-info" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--b-text-muted)]" />
              <p class="b-note-text">{{ usageData?.unavailableReason || usageRow?.unavailableReason || '生产使用记录暂不可用' }}</p>
            </div>
            <div v-if="usageData?.legacyBoundCount" class="b-note">
              <UIcon name="i-lucide-info" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--b-text-muted)]" />
              <p class="b-note-text">有 <span :title="exactQuantity(usageData.legacyBoundCount)">{{ formatCodeQuantity(usageData.legacyBoundCount) }}</span> 历史已绑定码，已计入累计已用；对应的生产任务、上传来源和时间未记录。</p>
            </div>
            <p class="b-help">时间均为北京时间。后台收到时间表示上传入库时间，设备采集时间表示移动端扫码时间；重复上传不重复计算使用量。</p>
            <div v-if="usageError" role="alert" class="b-note">
              <UIcon name="i-lucide-circle-alert" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
              <p class="b-note-text flex-1">{{ usageError }}</p>
              <UButton variant="link" color="neutral" size="xs" :loading="usageLoading" @click="loadUsage">重试</UButton>
            </div>
            <div class="b-scroll-x">
              <table class="b-table">
                <thead>
                  <tr>
                    <th>后台收到时间</th>
                    <th>生产任务</th>
                    <th class="text-right">使用量</th>
                    <th>上传来源</th>
                    <th>上传账号</th>
                    <th>采集设备</th>
                    <th>设备采集时间</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(record, index) in usageRows" :key="`${record.taskId}-${record.usageDate}-${record.source}-${record.uploaderType}-${record.uploaderId}-${record.deviceId}-${index}`">
                    <td class="min-w-48">
                      <p>{{ usageTime(record.firstReceivedAt) }}</p>
                      <p v-if="record.lastReceivedAt && record.lastReceivedAt !== record.firstReceivedAt" class="mt-1 text-xs text-[var(--b-text-muted)]">至 {{ usageTime(record.lastReceivedAt) }}</p>
                    </td>
                    <td class="min-w-36">
                      <p class="font-medium b-strong">{{ record.taskName || '任务名称未记录' }}</p>
                      <p class="mt-1 text-xs text-[var(--b-text-muted)]">任务编号：{{ record.taskId }}</p>
                      <p class="mt-1 text-xs text-[var(--b-text-muted)]">生产批号：{{ record.batchNo || '未记录' }}</p>
                      <p class="mt-1 text-xs text-[var(--b-text-muted)]">生产线：{{ record.lineName || '未记录' }}</p>
                    </td>
                    <td class="text-right font-medium b-strong" :title="exactQuantity(record.count)">{{ formatCodeQuantity(record.count) }}</td>
                    <td><span class="b-tag" :class="record.source === 'mobile' ? 'b-tag-success' : 'b-tag-default'">{{ record.source === 'mobile' ? '移动端上传' : record.sourceLabel || '在线扫码（客户端未记录）' }}</span></td>
                    <td class="min-w-32">{{ uploaderText(record) }}</td>
                    <td>{{ record.deviceName || '未记录' }}</td>
                    <td class="min-w-48">
                      <template v-if="record.firstCapturedAt">
                        <p>{{ usageTime(record.firstCapturedAt) }}</p>
                        <p v-if="record.lastCapturedAt && record.lastCapturedAt !== record.firstCapturedAt" class="mt-1 text-xs text-[var(--b-text-muted)]">至 {{ usageTime(record.lastCapturedAt) }}</p>
                      </template>
                      <span v-else class="text-[var(--b-text-muted)]">采集时间未记录</span>
                    </td>
                  </tr>
                  <tr v-if="!usageRows.length">
                    <td colspan="7" class="b-empty">
                      <div class="b-empty-inner">
                        <UIcon :name="usageLoading ? 'i-lucide-loader-circle' : 'i-lucide-inbox'" class="b-empty-icon h-8 w-8" :class="{ 'animate-spin': usageLoading }" />
                        <span class="text-sm">{{ usageLoading ? '正在加载使用记录' : usageError ? '使用记录未加载，请重试' : usageData?.productionRecordsAvailable === false ? '生产使用记录暂不可用' : '本批次暂无生产使用记录' }}</span>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="usageData?.total" class="b-pager">
              <span class="b-card-extra">共 {{ usageData.total }} 条记录 · 第 {{ usagePage }} / {{ usageTotalPages }} 页</span>
              <div class="flex items-center gap-2">
                <UButton variant="outline" color="neutral" size="sm" :disabled="usageLoading || usagePage <= 1" @click="changeUsagePage(usagePage - 1)">上一页</UButton>
                <UButton variant="outline" color="neutral" size="sm" :disabled="usageLoading || usagePage >= usageTotalPages" @click="changeUsagePage(usagePage + 1)">下一页</UButton>
              </div>
            </div>
          </div>
          <div class="b-modal-foot">
            <UButton variant="outline" color="neutral" @click="showUsageModal = false">关闭</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- 异常标记先展示准确范围，父操作包含全部子批次。 -->
    <UModal v-model:open="showFreezeModal">
      <template #content>
        <div class="b-modal">
          <div class="b-modal-head">
            <div class="b-modal-icon">
              <UIcon :name="batchFlagAction === 'void' ? 'i-lucide-ban' : batchFlagAction === 'restore' ? 'i-lucide-rotate-ccw' : 'i-lucide-snowflake'" class="h-4 w-4" :class="batchFlagAction === 'void' ? 'text-red-600' : 'text-amber-600'" />
            </div>
            <div>
              <h3 class="b-modal-title">批次{{ batchFlagLabel }}</h3>
              <p class="b-modal-sub">{{ freezeTarget?.file_name }}</p>
            </div>
          </div>
          <div class="b-modal-body space-y-3">
            <div class="b-note">
              <UIcon name="i-lucide-info" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--b-text-muted)]" />
              <p class="b-note-text">
                操作范围：{{ batchScopeText(freezeTarget) }}。将{{ batchFlagLabel }} <span class="font-medium b-strong">{{ exactQuantity(batchFlagCount) }}</span>。
                {{ batchFlagAction === 'void' ? '作废后不可恢复，请确认所有受影响子批次；扫码将显示已作废提示。' : batchFlagAction === 'freeze' ? '冻结后扫码显示暂不可用，可恢复正常；已作废码不受影响。' : '仅恢复本范围内已冻结的码；已作废码不受影响。' }}
              </p>
            </div>
            <div v-if="batchFlagAction === 'void'"><label class="b-label-lg">作废原因 <span class="b-required">*</span></label><USelect v-model="batchFlagReason" :items="['印刷模糊', '无法识别', '窜货', '召回', '疑似假冒', '其他'].map(r => ({ value: r, label: r }))" placeholder="选择作废原因" class="w-full" /></div>
          </div>
          <div class="b-modal-foot">
            <UButton variant="outline" color="neutral" @click="showFreezeModal = false">取消</UButton>
            <UButton v-if="canWrite" :color="batchFlagAction === 'void' ? 'error' : 'neutral'" variant="solid" :loading="freezing" @click="submitFreeze">确认{{ batchFlagLabel }}</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- 整批修正对话框（表单复用批量修正工具字段，作用域=本批次全部码） -->
    <UModal v-model:open="showCorrectModal" :ui="{ content: 'sm:max-w-2xl' }">
      <template #content>
        <div class="b-modal">
          <div class="b-modal-head">
            <div class="b-modal-icon">
              <UIcon name="i-lucide-wrench" class="h-4 w-4 text-[var(--b-text-regular)]" />
            </div>
            <div>
              <h3 class="b-modal-title">{{ isUsedChild(correctTarget) ? '编辑关联生产任务' : '批次修正' }}</h3>
              <p class="b-modal-sub">{{ isUsedChild(correctTarget) ? '同步整个关联任务，包括其他总批次下的码' : batchScopeText(correctTarget) }}</p>
            </div>
          </div>
          <div class="b-modal-body max-h-[70vh] space-y-3 overflow-y-auto">
            <template v-if="isUsedChild(correctTarget)">
              <p v-if="correctPreviewLoading" role="status" class="b-help">正在确认关联生产任务的完整修改范围…</p>
              <div v-if="correctPreviewError" role="alert" class="b-note"><p class="b-note-text flex-1">{{ correctPreviewError }}</p><UButton variant="link" color="neutral" size="xs" @click="loadCorrectPreview">重试</UButton></div>
              <div v-if="correctPreview" class="b-note">
                <UIcon name="i-lucide-shield-alert" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                <div class="b-note-text">
                  <p>关联任务：{{ correctPreview.task.name }}（编号 {{ correctPreview.task.id }}）。修改影响 {{ correctPreview.rootCount }} 个总批次、共 {{ exactQuantity(correctPreview.totalCodes) }}，其中已用 {{ exactQuantity(correctPreview.usedCodes) }}。</p>
                  <p v-for="root in correctPreview.roots" :key="root.id" class="mt-1 break-words">{{ root.fileName }}：{{ exactQuantity(root.count) }}</p>
                  <p v-if="!correctPreview.canCorrect" class="mt-1 text-red-600">{{ correctPreview.reason || '关联任务当前不可修改' }}</p>
                </div>
              </div>
              <div><label class="b-label-lg">生产批号</label><UInput v-model="correctForm.batchNo" :placeholder="'不修改留空；当前：' + (correctTarget?.batch_no || '未记录')" /></div>
            </template>
            <ProductionChangePreview :form="correctForm" :count="correctImpactCount" />
            <div v-if="!newBatchMode && !isUsedChild(correctTarget)">
              <label class="b-label-lg">重新绑定批次（仅"已生成"码生效，绑定后自动置为"已绑定"）</label>
              <USelect
                v-model="correctForm.batchId"
                :items="[{ value: 0, label: '不修改批次' }, ...(batchAll?.rows || []).filter((b: any) => Number(b.product_id) === Number(correctTarget?.product_id)).map((b: any) => ({ value: Number(b.id), label: b.batch_no + '（' + b.product_name + '）' }))]"
                class="w-full"
                :content="{ class: 'min-w-72' }"
                :ui="{ itemLabel: { class: 'whitespace-normal break-words' } }"
              />
            </div>
            <div v-else-if="newBatchMode" class="space-y-3">
              <div>
                <label class="b-label-lg">生产批次号 <span class="b-required">*</span></label>
                <UInput v-model="correctForm.batchNo" placeholder="与产品标签喷码一致；批号已存在则自动归并" />
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="b-label-lg">质检报告号</label>
                  <UInput v-model="correctForm.qcReportNo" placeholder="选填" />
                </div>
                <div class="flex items-end pb-1">
                  <span class="b-tag b-tag-success">质检默认合格</span>
                </div>
              </div>
              <p class="b-help">生产日期、质量合格证号在下方填写；有效期至选填（可稍后在批次管理页补填）；本批全部「已生成」码将绑定并置为「已绑定」</p>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="b-label-lg">生产日期 <span v-if="newBatchMode" class="b-required">*</span></label>
                <BatchDateInput v-model="correctForm.produceDate" label="生产日期" />
                <p class="b-help">{{ newBatchMode ? '与产品标签喷码日期一致（1049 第五条）' : '修改后扫码页展示的生产日期将变更，请确认与标签喷码一致' }}</p>
              </div>
              <div>
                <label class="b-label-lg">有效期至</label>
                <BatchDateInput v-model="correctForm.expireDate" label="有效期至" />
                <p v-if="newBatchMode" class="b-help">选填；留空可在批次管理页补填</p>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="b-label-lg">质量检验结果</label>
                <USelect
                  v-model="correctForm.qcResult"
                  :disabled="newBatchMode"
                  :items="[{ value: 'keep', label: '不修改' }, { value: '1', label: '合格' }, { value: '0', label: '不合格' }]"
                  class="w-full"
                />
                <p v-if="newBatchMode" class="b-help">新建批次质检默认为合格</p>
              </div>
              <div>
                <label class="b-label-lg">质量合格证号</label>
                <UInput v-model="correctForm.qualityCertNo" :placeholder="newBatchMode ? '留空自动填写：见箱内质量合格证' : '不修改留空'" />
              </div>
            </div>
            <div class="b-note">
              <UIcon name="i-lucide-shield-alert" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--b-text-muted)]" />
              <p class="b-note-text">已绑定码的生产日期/质检字段修改属合规更正，将记录强审计日志；{{ isUsedChild(correctTarget) ? '修改同步整个关联生产任务，包含已分配但尚未使用的码。' : '本批次含已冻结/作废码时需先在明细中处理。' }}</p>
            </div>
            <UCheckbox v-if="isUsedChild(correctTarget)" v-model="correctConfirmed" :disabled="correctPreviewLoading || !correctPreview?.canCorrect || !!correctPreviewError" label="我已确认：同步修改整个关联生产任务及其在其他总批次下的码" />
          </div>
          <div class="b-modal-foot">
            <UButton variant="outline" color="neutral" @click="showCorrectModal = false">取消</UButton>
            <UButton v-if="canWrite" color="neutral" variant="solid" :loading="correcting" :disabled="isUsedChild(correctTarget) && (correctPreviewLoading || !correctPreview?.canCorrect || !!correctPreviewError || !correctConfirmed)" @click="submitCorrect">{{ isUsedChild(correctTarget) ? '确认同步修改' : '确认修正' }}</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="showBindModal">
      <template #content>
        <div class="b-modal">
          <div class="b-modal-head">
            <div class="b-modal-icon">
              <UIcon name="i-lucide-wrench" class="h-4 w-4 text-[var(--b-text-regular)]" />
            </div>
            <div>
              <h3 class="b-modal-title">新建批次并绑定</h3>
              <p class="b-modal-sub">{{ batchScopeText(correctTarget) }}</p>
            </div>
          </div>
          <div class="b-modal-body">
            <ProductionChangePreview :form="correctForm" :count="correctTarget?.codeTotal || 0" />
            <div v-if="!newBatchMode">
              <label class="b-label-lg">重新绑定批次（仅"已生成"码生效，绑定后自动置为"已绑定"）</label>
              <USelect
                v-model="correctForm.batchId"
                :items="[{ value: 0, label: '不修改批次' }, ...(batchAll?.rows || []).filter((b: any) => Number(b.product_id) === Number(correctTarget?.product_id)).map((b: any) => ({ value: Number(b.id), label: b.batch_no + '（' + b.product_name + '）' }))]"
                class="w-full"
                :content="{ class: 'min-w-72' }"
                :ui="{ itemLabel: { class: 'whitespace-normal break-words' } }"
              />
            </div>
            <div v-else class="space-y-3">
              <div>
                <label class="b-label-lg">生产批次号 <span class="b-required">*</span></label>
                <UInput v-model="correctForm.batchNo" placeholder="与产品标签喷码一致；批号已存在则自动归并" />
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="b-label-lg">质检报告号</label>
                  <UInput v-model="correctForm.qcReportNo" placeholder="选填" />
                </div>
                <div class="flex items-end pb-1">
                  <span class="b-tag b-tag-success">质检默认合格</span>
                </div>
              </div>
              <p class="b-help">生产日期、质量合格证号在下方填写；有效期至选填（可稍后在批次管理页补填）；本批全部「已生成」码将绑定并置为「已绑定」</p>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="b-label-lg">生产日期 <span v-if="newBatchMode" class="b-required">*</span></label>
                <BatchDateInput v-model="correctForm.produceDate" label="生产日期" />
                <p class="b-help">{{ newBatchMode ? '与产品标签喷码日期一致（1049 第五条）' : '修改后扫码页展示的生产日期将变更，请确认与标签喷码一致' }}</p>
              </div>
              <div>
                <label class="b-label-lg">有效期至</label>
                <BatchDateInput v-model="correctForm.expireDate" label="有效期至" />
                <p v-if="newBatchMode" class="b-help">选填；留空可在批次管理页补填</p>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="b-label-lg">质量检验结果</label>
                <USelect
                  v-model="correctForm.qcResult"
                  :disabled="newBatchMode"
                  :items="[{ value: 'keep', label: '不修改' }, { value: '1', label: '合格' }, { value: '0', label: '不合格' }]"
                  class="w-full"
                />
                <p v-if="newBatchMode" class="b-help">新建批次质检默认为合格</p>
              </div>
              <div>
                <label class="b-label-lg">质量合格证号</label>
                <UInput v-model="correctForm.qualityCertNo" :placeholder="newBatchMode ? '留空自动填写：见箱内质量合格证' : '不修改留空'" />
              </div>
            </div>
            <div class="b-note">
              <UIcon name="i-lucide-shield-alert" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--b-text-muted)]" />
              <p class="b-note-text">已绑定码的生产日期/质检字段修改属合规更正，将记录强审计日志（不可撤销）；本批次含已冻结/作废码时需先在明细中处理</p>
            </div>
          </div>
          <div class="b-modal-foot">
            <UButton variant="outline" color="neutral" @click="showBindModal = false">取消</UButton>
            <UButton v-if="canWrite" color="neutral" variant="solid" :loading="correcting" @click="submitCorrect">确认绑定</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- 整批删除确认对话框（删除上传批次及其全部追溯码，不可恢复） -->
    <UModal v-model:open="showDeleteModal">
      <template #content>
        <div class="b-modal">
          <div class="b-modal-head">
            <div class="b-modal-icon">
              <UIcon name="i-lucide-trash-2" class="h-4 w-4 text-red-600" />
            </div>
            <div>
              <h3 class="b-modal-title">删除{{ deleteTarget?.kind === 'root' ? '总批次' : '子批次' }}</h3>
              <p class="b-modal-sub max-w-xl truncate" :title="deleteTarget?.file_name">{{ deleteTarget?.file_name }}</p>
            </div>
          </div>
          <div class="b-modal-body">
            <div class="b-note">
              <UIcon name="i-lucide-shield-alert" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
              <p class="b-note-text">
                操作范围：{{ batchScopeText(deleteTarget) }}。确认删除本范围全部追溯码数据？删除后数据不可恢复，请谨慎操作；已绑定码不允许删除。
              </p>
            </div>
          </div>
          <div class="b-modal-foot">
            <UButton variant="outline" color="neutral" @click="showDeleteModal = false">取消</UButton>
            <UButton v-if="canWrite" color="error" variant="solid" :loading="deleting" @click="submitDelete">确认删除</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- 导出留档批次（2026-10-10）：生成页未及时下载文件时的回捞出口，仅「生成入库」批次可见 -->
    <UModal v-model:open="showExportModal">
      <template #content>
        <div class="b-modal">
          <div class="b-modal-head">
            <div class="b-modal-icon">
              <UIcon name="i-lucide-download" class="h-4 w-4 text-[var(--b-text-regular)]" />
            </div>
            <div>
              <h3 class="b-modal-title">导出留档追溯码</h3>
              <p class="b-modal-sub max-w-xl truncate" :title="exportTarget?.file_name">{{ exportTarget?.file_name }}</p>
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

    <!-- 批次码明细弹窗（仅查看 + 单行冻结/作废/恢复，无批量操作） -->
    <UModal v-model:open="showDetailModal" :ui="{ content: 'sm:max-w-6xl' }">
      <template #content>
        <div class="b-modal">
          <div class="b-modal-head">
            <div class="b-modal-icon">
              <UIcon name="i-lucide-eye" class="h-4 w-4 text-[var(--b-text-regular)]" />
            </div>
            <div>
              <h3 class="b-modal-title">{{ batchRootId(detailRow) ? '批次码明细' : '追溯码明细' }}</h3>
              <p class="b-modal-sub max-w-xl truncate" :title="detailRow?.file_name">{{ detailRow?.file_name }}</p>
              <p v-if="batchRootId(detailRow)" class="b-help">{{ batchScopeText(detailRow) }} · 包装规格：{{ batchSpec(detailRow) }}</p>
            </div>
          </div>
          <div class="b-modal-body">
            <p v-if="isUsedChild(detailRow)" class="b-help mb-3">此处修改生产信息将同步整个关联生产任务，确认弹窗会列出完整影响范围。</p>
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
                    <th>上传时间</th>
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
                    <td>{{ String(r.created_at).slice(0, 16) }}</td>
                    <td>
                      <div v-if="canWrite && Number(r.abnormal_flag) === 0" class="b-actions justify-end">
                        <UButton v-if="canWrite" variant="link" color="neutral" size="xs" @click="openRowFlag('freeze', r)">冻结</UButton>
                        <span class="b-sep" />
                        <UButton v-if="canWrite" variant="link" color="error" size="xs" @click="openRowFlag('void', r)">作废</UButton>
                        <span class="b-sep" />
                        <UButton v-if="canWrite" variant="link" color="neutral" size="xs" @click="openRowEdit(r)">修改</UButton>
                        <span class="b-sep" />
                        <!-- 删除：仅未绑定码可删（已绑定置灰，disabled 按钮自身不触发 title，由外层 span 承载 hover 提示） -->
                        <span v-if="canWrite && Number(r.status) === 2" :title="'该追溯码已绑定，不允许删除'">
                          <UButton variant="link" color="error" size="xs" icon="i-lucide-trash-2" disabled>删除</UButton>
                        </span>
                        <UButton v-else-if="canWrite" variant="link" color="error" size="xs" icon="i-lucide-trash-2" @click="openRowDelete(r)">删除</UButton>
                      </div>
                      <div v-else-if="canWrite && Number(r.abnormal_flag) === 1" class="b-actions justify-end">
                        <UButton v-if="canWrite" variant="link" color="neutral" size="xs" @click="openRowFlag('restore', r)">恢复正常</UButton>
                        <span class="b-sep" />
                        <span v-if="canWrite && Number(r.status) === 2" :title="'该追溯码已绑定，不允许删除'">
                          <UButton variant="link" color="error" size="xs" icon="i-lucide-trash-2" disabled>删除</UButton>
                        </span>
                        <UButton v-else-if="canWrite" variant="link" color="error" size="xs" icon="i-lucide-trash-2" @click="openRowDelete(r)">删除</UButton>
                      </div>
                      <div v-else-if="canWrite" class="flex items-center justify-end gap-2">
                        <UButton variant="link" color="neutral" size="xs" disabled title="已作废为终态，不可修改">修改</UButton>
                        <span class="b-card-extra text-xs">已终态</span>
                        <span v-if="Number(r.status) === 2" :title="'该追溯码已绑定，不允许删除'">
                          <UButton variant="link" color="error" size="xs" icon="i-lucide-trash-2" disabled>删除</UButton>
                        </span>
                        <UButton v-else variant="link" color="error" size="xs" icon="i-lucide-trash-2" @click="openRowDelete(r)">删除</UButton>
                      </div>
                    </td>
                  </tr>
                  <tr v-if="!detailRows.length">
                    <td colspan="8" class="b-empty">
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

    <!-- 明细单行异常标记操作对话框 -->
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

    <!-- 明细单行【修改】对话框（2026-09-04：表单复用批量修正字段，仅修改当前这一条追溯码） -->
    <UModal v-model:open="showRowEditModal">
      <template #content>
        <div class="b-modal">
          <div class="b-modal-head">
            <div class="b-modal-icon">
              <UIcon name="i-lucide-pencil-line" class="h-4 w-4 text-[var(--b-text-regular)]" />
            </div>
            <div>
              <h3 class="b-modal-title">修改追溯码</h3>
              <p class="b-modal-sub max-w-lg truncate" :title="rowEditTarget?.code">{{ rowEditTarget?.code }}</p>
            </div>
          </div>
          <div class="b-modal-body">
            <div>
              <ProductionChangePreview :form="rowEditForm" :count="1" :current="rowEditTarget" />
              <label class="b-label-lg">重新绑定批次（仅修改当前这条码的关联，不会影响同批次其他码）</label>
              <USelect
                v-model="rowEditForm.batchId"
                :items="[{ value: 0, label: '不修改批次' }, ...(batchAll?.rows || []).filter((b: any) => Number(b.product_id) === Number(rowEditTarget?.product_id)).map((b: any) => ({ value: Number(b.id), label: b.batch_no + '（' + b.product_name + '）' }))]"
                class="w-full"
                :content="{ class: 'min-w-72' }"
                :ui="{ itemLabel: { class: 'whitespace-normal break-words' } }"
              />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="b-label-lg">生产日期</label>
                <UInput v-model="rowEditForm.produceDate" type="date" />
                <p class="b-help">仅本条码展示生效，不改变批次其他码</p>
              </div>
              <div>
                <label class="b-label-lg">有效期至</label>
                <UInput v-model="rowEditForm.expireDate" type="date" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="b-label-lg">质量检验结果</label>
                <USelect v-model="rowEditForm.qcResult" :items="[{ value: 'keep', label: '不修改' }, { value: '1', label: '合格' }, { value: '0', label: '不合格' }]" class="w-full" />
              </div>
              <div>
                <label class="b-label-lg">质量合格证号</label>
                <UInput v-model="rowEditForm.qualityCertNo" placeholder="不修改留空" />
              </div>
            </div>
            <div class="b-note">
              <UIcon name="i-lucide-shield-alert" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--b-text-muted)]" />
              <p class="b-note-text">修改仅作用于当前追溯码，同批次其他码不受影响；冻结码先恢复正常，作废码不可修改。</p>
            </div>
          </div>
          <div class="b-modal-foot">
            <UButton variant="outline" color="neutral" @click="showRowEditModal = false">取消</UButton>
            <UButton v-if="canWrite" color="neutral" variant="solid" :loading="rowEditing" @click="submitRowEdit">确认修改</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- 明细单行删除确认对话框（仅删除当前这一条追溯码，不可恢复） -->
    <UModal v-model:open="showRowDeleteModal">
      <template #content>
        <div class="b-modal">
          <div class="b-modal-head">
            <div class="b-modal-icon">
              <UIcon name="i-lucide-trash-2" class="h-4 w-4 text-red-600" />
            </div>
            <div>
              <h3 class="b-modal-title">删除追溯码</h3>
              <p class="b-modal-sub max-w-lg truncate font-code text-xs" :title="rowDeleteTarget?.code">{{ rowDeleteTarget?.code }}</p>
            </div>
          </div>
          <div class="b-modal-body">
            <div class="b-note">
              <UIcon name="i-lucide-shield-alert" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
              <p class="b-note-text">确认删除该条追溯码？删除后数据不可恢复，请谨慎操作。（仅删除当前这一条，不影响同批次其他码）</p>
            </div>
          </div>
          <div class="b-modal-foot">
            <UButton variant="outline" color="neutral" @click="showRowDeleteModal = false">取消</UButton>
            <UButton v-if="canWrite" color="error" variant="solid" :loading="rowDeleting" @click="submitRowDelete">确认删除</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
