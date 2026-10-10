<script setup lang="ts">
import { isInputDate } from '#shared/utils/input-date'
// 码库管理（2026-09-04 聚合改造）：不再逐条展示追溯码，改为按「上传文件批次」聚合展示——
// 每行 = 生产采集上传的一份追溯码文件（upload_batch），展示批次汇总信息与整批操作。
// 行操作：【详细】弹窗查看/单行操作本批次码明细（原单条表格内容，仅查看+单行冻结/作废/恢复）、
//         【冻结】确认后整批冻结、【修正】整批修正（复用批量修正表单字段，作用域=本批次全部码）。
// 原单条追溯码业务逻辑与接口不变（明细弹窗复用 /api/admin/codes 加 uploadBatchId 过滤）。
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
  (productData.value?.rows || []).map((p: any) => ({ value: Number(p.id), label: p.name })))

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

// ============ 整批冻结 ============
const showFreezeModal = ref(false)
const freezing = ref(false)
const freezeTarget = ref<any>(null) // 当前操作的 upload_batch 行
const openFreeze = (row: any) => {
  if (row.normalCount <= 0) {
    toast.add({ title: row.summary === '全部作废' ? '批次码已全部作废（终态），无可冻结的码' : '批次码已全部冻结，无可冻结的码', color: 'warning' })
    return
  }
  freezeTarget.value = row
  showFreezeModal.value = true
}
const submitFreeze = async () => {
  freezing.value = true
  try {
    const res = await $fetch('/api/admin/codes/upload-batches/' + freezeTarget.value.id + '/flag', {
      method: 'POST', body: { flag: 1 },
    })
    toast.add({ title: '整批冻结完成：' + res.affected + ' 条', color: 'success' })
    showFreezeModal.value = false
    refresh()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '冻结失败', color: 'error' })
  } finally {
    freezing.value = false
  }
}

// ============ 整批修正（表单字段复用批量修正工具：批次重绑/生产日期/有效期/质检/合格证号） ============
const showCorrectModal = ref(false)
const showBindModal = ref(false)
const correcting = ref(false)
const correctTarget = ref<any>(null)
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
  if (row.frozenCount + row.voidedCount > 0) {
    toast.add({ title: '本批次含 ' + (row.frozenCount + row.voidedCount) + ' 条已冻结/已作废的码，整批修正前请先在「详细」中处理（单行恢复/作废）', color: 'warning' })
    return
  }
  correctTarget.value = row
  Object.assign(correctForm, { batchId: 0, produceDate: '', expireDate: '', qcResult: 'keep', qualityCertNo: '', batchNo: '', qcReportNo: '' })
  newBatchMode.value = bind
  showBindModal.value = bind
  showCorrectModal.value = !bind
}
const submitCorrect = async () => {
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
  } else if (!correctForm.batchId && !correctForm.produceDate && !correctForm.expireDate && correctForm.qcResult === 'keep' && !correctForm.qualityCertNo) {
    toast.add({ title: '请至少选择一个要修改的字段', color: 'warning' }); return
  }
  correcting.value = true
  try {
    const res = await $fetch('/api/admin/codes/upload-batches/' + correctTarget.value.id + '/correct', {
      method: 'POST',
      body: newBatchMode.value
        ? {
            batchNo: correctForm.batchNo.trim(),
            produceDate: correctForm.produceDate,
            qualityCertNo: correctForm.qualityCertNo.trim() || '见箱内质量合格证',
            qcReportNo: correctForm.qcReportNo.trim() || undefined,
            expireDate: correctForm.expireDate || undefined,
          }
        : {
            batchId: correctForm.batchId || undefined,
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
    toast.add({ title: (newBatchMode.value ? '绑定完成：' : '整批修正完成：') + (parts.join('，') || '无变更'), color: 'success' })
    showCorrectModal.value = false
    showBindModal.value = false
    refresh()
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
  deleting.value = true
  try {
    const res = await $fetch('/api/admin/codes/upload-batches/' + deleteTarget.value.id, { method: 'DELETE' })
    toast.add({ title: '批次已删除（含追溯码 ' + res.deletedCodes + ' 条），数据不可恢复', color: 'success' })
    showDeleteModal.value = false
    refresh()
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
    const res = await fetch('/api/admin/codes/upload-batches/' + exportTarget.value.id + '/export?format=' + format, { credentials: 'include' })
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

const loadDetail = async () => {
  if (!detailRow.value) return
  detailLoading.value = true
  try {
    const res = await $fetch('/api/admin/codes', {
      query: {
        uploadBatchId: detailRow.value.id,
        keyword: dFilters.keyword || undefined,
        status: dFilters.status || undefined,
        abnormalFlag: dFilters.abnormalFlag || undefined,
        page: detailPage.value,
        pageSize: detailPageSize,
      },
    })
    detailRows.value = res.rows || []
    detailTotal.value = Number(res.total || 0)
  } finally {
    detailLoading.value = false
  }
}
const openDetail = (row: any) => {
  detailRow.value = row
  detailPage.value = 1
  Object.assign(dFilters, { keyword: '', status: undefined, abnormalFlag: filters.abnormalFlag })
  showDetailModal.value = true
  loadDetail()
}
// 首页异常指标查看全企业码明细，包括尚未归属上传批次的生成码。
const codesRoute = useRoute()
const openGlobalDetail = () => {
  if (!filters.abnormalFlag) return
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
    refresh()    // 同步刷新主列表汇总（冻结/作废计数变化）
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
    refresh()    // 同步刷新主列表汇总（码数量变化）
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
        <p class="b-page-desc">按上传文件批次聚合管理：每行 = 生产采集上传的一份追溯码文件 · 冻结/修正整批生效 · 明细可查看单条码</p>
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
          <USelect v-model="filters.productId" :items="PRODUCT_OPTIONS" placeholder="全部产品" class="w-full" :content="{ class: 'min-w-60' }" />
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
        <span class="b-card-title">上传批次列表</span>
        <span class="b-card-extra">每页 {{ pageSize }} 行 · 共 {{ data?.total || 0 }} 个批次</span>
      </div>

      <div class="b-scroll-x">
        <table class="b-table">
          <thead>
            <tr>
              <th>批次名称（上传文件）</th>
              <th>关联产品</th>
              <th class="text-right">码总数量</th>
              <th>码状态汇总</th>
              <th>生产批号</th>
              <th>上传时间</th>
              <th class="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in data?.rows || []" :key="row.id">
              <td>
                <span class="max-w-72 inline-block truncate align-middle text-[13px] b-strong" :title="row.file_name">{{ row.file_name }}</span>
              </td>
              <td>{{ row.product_name || '-' }}</td>
              <td class="text-right font-medium b-strong">{{ row.codeTotal }}</td>
              <td>
                <span
                  class="b-tag"
                  :class="SUMMARY_BADGE[row.summary] || 'b-tag-default'"
                  :title="'正常 ' + row.normalCount + ' · 冻结 ' + row.frozenCount + ' · 作废 ' + row.voidedCount"
                >{{ row.summary }}</span>
                <span v-if="row.frozenCount + row.voidedCount > 0" class="b-card-extra ml-1.5 text-xs">
                  （正常 {{ row.normalCount }} / 冻结 {{ row.frozenCount }} / 作废 {{ row.voidedCount }}）
                </span>
              </td>
              <td>{{ row.batch_no || '-' }}</td>
              <td>{{ String(row.created_at).slice(0, 16) }}</td>
              <td>
                <div class="b-actions justify-end">
                  <UButton variant="link" color="neutral" size="xs" icon="i-lucide-eye" @click="openDetail(row)">详细</UButton>
                  <!-- 导出（2026-10-10）：仅「生成入库」留档批次——生成页未及时下载文件时的回捞出口 -->
                  <template v-if="isStockedBatch(row)">
                    <span class="b-sep" />
                    <!-- 用图标按钮而非文字：操作列原有 5 个文字按钮，再加文字会把「新建批次并绑定」挤成竖排（实测） -->
                    <UButton
                      variant="link"
                      color="neutral"
                      size="xs"
                      icon="i-lucide-download"
                      title="导出本批次追溯码（仅「生成入库」留档批次）"
                      aria-label="导出留档追溯码"
                      @click="openExport(row)"
                    />
                  </template>
                  <span class="b-sep" />
                  <UButton v-if="canWrite"
                    variant="link"
                    color="neutral"
                    size="xs"
                    icon="i-lucide-snowflake"
                    :disabled="row.normalCount <= 0"
                    :title="row.normalCount <= 0 ? (row.summary === '全部作废' ? '批次码已全部作废（终态）' : '批次码已全部冻结') : '整批冻结：本批次 ' + row.normalCount + ' 条正常码将全部冻结'"
                    @click="openFreeze(row)"
                  >冻结</UButton>
                  <span class="b-sep" />
                  <UButton v-if="canWrite" variant="link" color="neutral" size="xs" icon="i-lucide-link" :disabled="row.codeTotal <= row.boundCount" @click="openCorrect(row, true)">新建批次并绑定</UButton>
                  <span class="b-sep" />
                  <UButton v-if="canWrite" variant="link" color="neutral" size="xs" icon="i-lucide-wrench" @click="openCorrect(row)">修正</UButton>
                  <span class="b-sep" />
                  <!-- 删除：批次内存在已绑定码时置灰不可点，hover 提示原因（disabled 按钮自身不触发 title，由外层 span 承载） -->
                  <span v-if="canWrite && !row.canDelete" :title="'该批次存在已绑定追溯码，无法删除（已绑定 ' + row.boundCount + ' 条）'">
                    <UButton variant="link" color="error" size="xs" icon="i-lucide-trash-2" disabled>删除</UButton>
                  </span>
                  <UButton v-else-if="canWrite" variant="link" color="error" size="xs" icon="i-lucide-trash-2" @click="openDelete(row)">删除</UButton>
                </div>
              </td>
            </tr>
            <tr v-if="!pending && !data?.rows?.length">
              <td colspan="7" class="b-empty">
                <div class="b-empty-inner">
                  <UIcon name="i-lucide-inbox" class="b-empty-icon h-8 w-8" />
                  <span class="text-sm">暂无上传批次，请先在「生产采集」上传追溯码文件；或调整筛选条件后重试</span>
                </div>
              </td>
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

    <!-- 整批冻结确认对话框 -->
    <UModal v-model:open="showFreezeModal">
      <template #content>
        <div class="b-modal">
          <div class="b-modal-head">
            <div class="b-modal-icon">
              <UIcon name="i-lucide-snowflake" class="h-4 w-4 text-amber-600" />
            </div>
            <div>
              <h3 class="b-modal-title">整批冻结</h3>
              <p class="b-modal-sub">{{ freezeTarget?.file_name }}</p>
            </div>
          </div>
          <div class="b-modal-body">
            <div class="b-note">
              <UIcon name="i-lucide-info" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--b-text-muted)]" />
              <p class="b-note-text">
                确认后将冻结本批次全部 <span class="font-medium b-strong">{{ freezeTarget?.normalCount }}</span> 条正常追溯码（共 {{ freezeTarget?.codeTotal }} 条）。
                冻结后扫码显示「该追溯码暂不可用，请联系企业（生产厂家）」，可在明细中单行恢复正常；已作废码（{{ freezeTarget?.voidedCount }} 条）为终态不受影响。
              </p>
            </div>
          </div>
          <div class="b-modal-foot">
            <UButton variant="outline" color="neutral" @click="showFreezeModal = false">取消</UButton>
            <UButton v-if="canWrite" color="neutral" variant="solid" :loading="freezing" @click="submitFreeze">确认冻结</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- 整批修正对话框（表单复用批量修正工具字段，作用域=本批次全部码） -->
    <UModal v-model:open="showCorrectModal">
      <template #content>
        <div class="b-modal">
          <div class="b-modal-head">
            <div class="b-modal-icon">
              <UIcon name="i-lucide-wrench" class="h-4 w-4 text-[var(--b-text-regular)]" />
            </div>
            <div>
              <h3 class="b-modal-title">整批修正</h3>
              <p class="b-modal-sub">作用域：本批次全部 {{ correctTarget?.codeTotal || 0 }} 条追溯码</p>
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
            <UButton variant="outline" color="neutral" @click="showCorrectModal = false">取消</UButton>
            <UButton v-if="canWrite" color="neutral" variant="solid" :loading="correcting" @click="submitCorrect">确认修正</UButton>
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
              <p class="b-modal-sub">作用域：本批次全部 {{ correctTarget?.codeTotal || 0 }} 条追溯码</p>
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
              <h3 class="b-modal-title">删除上传批次</h3>
              <p class="b-modal-sub max-w-xl truncate" :title="deleteTarget?.file_name">{{ deleteTarget?.file_name }}</p>
            </div>
          </div>
          <div class="b-modal-body">
            <div class="b-note">
              <UIcon name="i-lucide-shield-alert" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
              <p class="b-note-text">
                确认删除该批次以及批次下全部追溯码数据（{{ deleteTarget?.codeTotal || 0 }} 条）？删除后数据不可恢复，请谨慎操作。
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
            <p class="b-help">本批次共 {{ exportTarget?.codeTotal || 0 }} 条，命名规则与「追溯码生成」页导出一致。选择格式后立即下载。</p>
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
              <h3 class="b-modal-title">{{ detailRow?.id ? '批次码明细' : '追溯码明细' }}</h3>
              <p class="b-modal-sub max-w-xl truncate" :title="detailRow?.file_name">{{ detailRow?.file_name }}</p>
            </div>
          </div>
          <div class="b-modal-body">
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
                  <tr v-if="!detailLoading && !detailRows.length">
                    <td colspan="8" class="b-empty">
                      <div class="b-empty-inner">
                        <UIcon name="i-lucide-inbox" class="b-empty-icon h-8 w-8" />
                        <span class="text-sm">本批次暂无符合筛选条件的追溯码</span>
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
                <UButton variant="outline" color="neutral" size="sm" :disabled="detailPage <= 1" @click="detailPage--; loadDetail()">上一页</UButton>
                <UButton variant="outline" color="neutral" size="sm" :disabled="detailPage >= detailTotalPages" @click="detailPage++; loadDetail()">下一页</UButton>
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
