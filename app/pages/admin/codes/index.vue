<script setup lang="ts">
// 码库管理（2026-09-04 聚合改造）：不再逐条展示追溯码，改为按「上传文件批次」聚合展示——
// 每行 = 生产采集上传的一份追溯码文件（upload_batch），展示批次汇总信息与整批操作。
// 行操作：【详细】弹窗查看/单行操作本批次码明细（原单条表格内容，仅查看+单行冻结/作废/恢复）、
//         【冻结】确认后整批冻结、【修正】整批修正（复用批量修正表单字段，作用域=本批次全部码）。
// 原单条追溯码业务逻辑与接口不变（明细弹窗复用 /api/admin/codes 加 uploadBatchId 过滤）。
// Keep-Alive 页面缓存：菜单切换保留页面状态；刷新/登出自动清空；【重置】恢复初始。
definePageMeta({ layout: 'admin', middleware: 'backend-guard', keepalive: true })
useHead({ title: '码库管理' })

const toast = useToast()

// ============ 主列表：上传文件批次聚合 ============
// 筛选：批次文件名 / 关联产品 / 生产批号 / 上传时间范围（下拉默认 undefined 显示 placeholder）
const filters = reactive({
  fileName: '',
  productId: undefined as number | undefined,
  batchNo: '',
  dateFrom: '',
  dateTo: '',
})
const page = ref(1)
const pageSize = 20

// 产品下拉（关联产品筛选；pageSize 100 与生产采集/生成页同口径）
const { data: productData } = await useFetch<any>('/api/admin/products', {
  key: 'admin-codes-products',
  query: { page: 1, pageSize: 100 },
})
const PRODUCT_OPTIONS = computed(() =>
  (productData.value?.rows || []).map((p: any) => ({ value: Number(p.id), label: p.name })))

const { data, pending, refresh } = await useFetch<any>('/api/admin/codes/upload-batches', {
  key: 'admin-upload-batches',
  query: computed(() => ({
    fileName: filters.fileName || undefined,
    productId: filters.productId || undefined,
    batchNo: filters.batchNo || undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    page: page.value,
    pageSize,
  })),
})
const totalPages = computed(() => Math.max(1, Math.ceil((data.value?.total || 0) / pageSize)))

const doSearch = () => { page.value = 1; refresh() }
const resetSearch = () => {
  Object.assign(filters, { fileName: '', productId: undefined, batchNo: '', dateFrom: '', dateTo: '' })
  page.value = 1
  refresh()
}

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
const correcting = ref(false)
const correctTarget = ref<any>(null)
// batchId=0 与 qcResult='keep' 为「不修改」哨兵值（reka-ui 禁止空字符串 value）
const correctForm = reactive({
  batchId: 0 as number,
  produceDate: '', expireDate: '', qcResult: 'keep', qualityCertNo: '',
})
const { data: batchAll } = await useFetch<any>('/api/admin/batches', {
  key: 'admin-upload-batches-correct',
  query: { page: 1, pageSize: 100 },
})
const openCorrect = (row: any) => {
  if (row.frozenCount + row.voidedCount > 0) {
    toast.add({ title: '本批次含 ' + (row.frozenCount + row.voidedCount) + ' 条已冻结/已作废的码，整批修正前请先在「详细」中处理（单行恢复/作废）', color: 'warning' })
    return
  }
  correctTarget.value = row
  Object.assign(correctForm, { batchId: 0, produceDate: '', expireDate: '', qcResult: 'keep', qualityCertNo: '' })
  showCorrectModal.value = true
}
const submitCorrect = async () => {
  if (!correctForm.batchId && !correctForm.produceDate && !correctForm.expireDate && correctForm.qcResult === 'keep' && !correctForm.qualityCertNo) {
    toast.add({ title: '请至少选择一个要修改的字段', color: 'warning' }); return
  }
  correcting.value = true
  try {
    const res = await $fetch('/api/admin/codes/upload-batches/' + correctTarget.value.id + '/correct', {
      method: 'POST',
      body: {
        batchId: correctForm.batchId || undefined,
        produceDate: correctForm.produceDate || undefined,
        expireDate: correctForm.expireDate || undefined,
        qcResult: correctForm.qcResult === 'keep' ? undefined : Number(correctForm.qcResult),
        qualityCertNo: correctForm.qualityCertNo || undefined,
      },
    })
    const parts: string[] = []
    if (res.rebound > 0) parts.push('重新绑定批次 ' + res.rebound + ' 条')
    if (res.corrected > 0) parts.push('字段修正 ' + res.corrected + ' 条')
    toast.add({ title: '整批修正完成：' + (parts.join('，') || '无变更'), color: 'success' })
    showCorrectModal.value = false
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
  Object.assign(dFilters, { keyword: '', status: undefined, abnormalFlag: undefined })
  showDetailModal.value = true
  loadDetail()
}
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
                  <span class="b-sep" />
                  <UButton
                    variant="link"
                    color="neutral"
                    size="xs"
                    icon="i-lucide-snowflake"
                    :disabled="row.normalCount <= 0"
                    :title="row.normalCount <= 0 ? (row.summary === '全部作废' ? '批次码已全部作废（终态）' : '批次码已全部冻结') : '整批冻结：本批次 ' + row.normalCount + ' 条正常码将全部冻结'"
                    @click="openFreeze(row)"
                  >冻结</UButton>
                  <span class="b-sep" />
                  <UButton variant="link" color="neutral" size="xs" icon="i-lucide-wrench" @click="openCorrect(row)">修正</UButton>
                  <span class="b-sep" />
                  <!-- 删除：批次内存在已绑定码时置灰不可点，hover 提示原因（disabled 按钮自身不触发 title，由外层 span 承载） -->
                  <span v-if="!row.canDelete" :title="'该批次存在已绑定追溯码，无法删除（已绑定 ' + row.boundCount + ' 条）'">
                    <UButton variant="link" color="error" size="xs" icon="i-lucide-trash-2" disabled>删除</UButton>
                  </span>
                  <UButton v-else variant="link" color="error" size="xs" icon="i-lucide-trash-2" @click="openDelete(row)">删除</UButton>
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
          <UButton variant="outline" color="neutral" size="sm" :disabled="page <= 1" @click="page--; refresh()">上一页</UButton>
          <UButton variant="outline" color="neutral" size="sm" :disabled="page >= totalPages" @click="page++; refresh()">下一页</UButton>
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
            <UButton color="neutral" variant="solid" :loading="freezing" @click="submitFreeze">确认冻结</UButton>
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
            <div>
              <label class="b-label-lg">重新绑定批次（仅"已生成"码生效，绑定后自动置为"已绑定"）</label>
              <USelect
                v-model="correctForm.batchId"
                :items="[{ value: 0, label: '不修改批次' }, ...(batchAll?.rows || []).map((b: any) => ({ value: Number(b.id), label: b.batch_no + '（' + b.product_name + '）' }))]"
                class="w-full"
                :content="{ class: 'min-w-72' }"
                :ui="{ itemLabel: { class: 'whitespace-normal break-words' } }"
              />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="b-label-lg">生产日期</label>
                <UInput v-model="correctForm.produceDate" type="date" />
                <p class="b-help">修改后扫码页展示的生产日期将变更，请确认与标签喷码一致</p>
              </div>
              <div>
                <label class="b-label-lg">有效期至</label>
                <UInput v-model="correctForm.expireDate" type="date" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="b-label-lg">质量检验结果</label>
                <USelect v-model="correctForm.qcResult" :items="[{ value: 'keep', label: '不修改' }, { value: '1', label: '合格' }, { value: '0', label: '不合格' }]" class="w-full" />
              </div>
              <div>
                <label class="b-label-lg">质量合格证号</label>
                <UInput v-model="correctForm.qualityCertNo" placeholder="不修改留空" />
              </div>
            </div>
            <div class="b-note">
              <UIcon name="i-lucide-shield-alert" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--b-text-muted)]" />
              <p class="b-note-text">已绑定码的生产日期/质检字段修改属合规更正，将记录强审计日志（不可撤销）；本批次含已冻结/作废码时需先在明细中处理</p>
            </div>
          </div>
          <div class="b-modal-foot">
            <UButton variant="outline" color="neutral" @click="showCorrectModal = false">取消</UButton>
            <UButton color="neutral" variant="solid" :loading="correcting" @click="submitCorrect">确认修正</UButton>
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
            <UButton color="error" variant="solid" :loading="deleting" @click="submitDelete">确认删除</UButton>
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
              <h3 class="b-modal-title">批次码明细</h3>
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
                      <div v-if="Number(r.abnormal_flag) === 0" class="b-actions justify-end">
                        <UButton variant="link" color="neutral" size="xs" @click="openRowFlag('freeze', r)">冻结</UButton>
                        <span class="b-sep" />
                        <UButton variant="link" color="error" size="xs" @click="openRowFlag('void', r)">作废</UButton>
                        <span class="b-sep" />
                        <UButton variant="link" color="neutral" size="xs" @click="openRowEdit(r)">修改</UButton>
                      </div>
                      <div v-else-if="Number(r.abnormal_flag) === 1" class="b-actions justify-end">
                        <UButton variant="link" color="neutral" size="xs" @click="openRowFlag('restore', r)">恢复正常</UButton>
                        <span class="b-sep" />
                        <UButton variant="link" color="neutral" size="xs" @click="openRowEdit(r)">修改</UButton>
                      </div>
                      <div v-else class="flex items-center justify-end gap-2">
                        <UButton variant="link" color="neutral" size="xs" disabled title="已作废为终态，不可修改">修改</UButton>
                        <span class="b-card-extra text-xs">已终态</span>
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
            <UButton color="neutral" variant="solid" :loading="rowFlagging" @click="submitRowFlag">确认执行</UButton>
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
              <label class="b-label-lg">重新绑定批次（仅修改当前这条码的关联，不会影响同批次其他码）</label>
              <USelect
                v-model="rowEditForm.batchId"
                :items="[{ value: 0, label: '不修改批次' }, ...(batchAll?.rows || []).map((b: any) => ({ value: Number(b.id), label: b.batch_no + '（' + b.product_name + '）' }))]"
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
              <p class="b-note-text">修改仅作用于当前追溯码（不触碰批次共享数据，同批次其他码不受影响）；扫码页展示以本条为准；已作废码为终态不可修改（冻结码可正常修改）</p>
            </div>
          </div>
          <div class="b-modal-foot">
            <UButton variant="outline" color="neutral" @click="showRowEditModal = false">取消</UButton>
            <UButton color="neutral" variant="solid" :loading="rowEditing" @click="submitRowEdit">确认修改</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
