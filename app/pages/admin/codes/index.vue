<script setup lang="ts">
// 码库管理：码列表查询 + 异常标记操作（PRD 5.5.5/5.5.7：冻结/作废/解冻，与码状态正交）
// 视觉规范：标准中后台（参考 Element Plus / AntD Pro）——小圆角、细分割线、浅底深字标签、中性色按钮、黑深灰浅灰主色调
// Keep-Alive 页面缓存：左侧菜单切换后返回保留页面状态（表单/筛选/页码/预览）；刷新、退出登录自动清空；页内【重置】恢复初始
definePageMeta({ layout: 'admin', middleware: 'backend-guard', keepalive: true })
useHead({ title: '码库管理' })

const toast = useToast()
// 筛选条件：下拉类默认 undefined（Nuxt UI v4 空值自动显示 placeholder，禁止空字符串 value 选项）
const filters = reactive({
  keyword: '',
  status: undefined as string | undefined,
  abnormalFlag: undefined as string | undefined,
  dateFrom: '',
  dateTo: '',
})
const page = ref(1)
const pageSize = 20
const selected = ref<number[]>([])

// 筛选下拉选项（「全部」由 placeholder 承载，reka-ui 禁止空字符串 value）
const STATUS_OPTIONS = [
  { value: '1', label: '已生成' },
  { value: '2', label: '已绑定' },
]
const FLAG_OPTIONS = [
  { value: '0', label: '正常' },
  { value: '1', label: '已冻结' },
  { value: '2', label: '已作废' },
]

const { data, pending, refresh, error } = await useFetch<any>('/api/admin/codes', {
  key: 'admin-codes',
  query: computed(() => ({
    keyword: filters.keyword || undefined,
    status: filters.status || undefined,
    abnormalFlag: filters.abnormalFlag || undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    page: page.value,
    pageSize,
  })),
})

const totalPages = computed(() => Math.max(1, Math.ceil((data.value?.total || 0) / pageSize)))
const allSelected = computed(() => (data.value?.rows?.length || 0) > 0 && selected.value.length === data.value?.rows?.length)
// 当前页已勾选的记录（供底部批量操作条使用）
const selectedRows = computed(() => (data.value?.rows || []).filter((r: any) => selected.value.includes(r.id)))

const toggleAll = () => {
  if (allSelected.value) selected.value = []
  else selected.value = (data.value?.rows || []).map((r: any) => r.id)
}
const toggleOne = (id: number) => {
  const i = selected.value.indexOf(id)
  if (i >= 0) selected.value.splice(i, 1)
  else selected.value.push(id)
}

// 状态标签：「底色浅 + 文字重」简约样式（AntD Tag 风格，仅用颜色提示，不铺大色块）
const statusBadge = (s: number) => {
  if (s === 2) return { cls: 'b-tag-success', label: '已绑定' }
  return { cls: 'b-tag-info', label: '已生成' }
}
// 异常标记标签：浅底深字，异常状态仅靠文字颜色提示
const flagBadge = (f: number) => {
  if (f === 1) return { cls: 'b-tag-warning', label: '已冻结' }
  if (f === 2) return { cls: 'b-tag-danger', label: '已作废' }
  return { cls: 'b-tag-default', label: '正常' }
}

// 异常标记操作（PRD 5.5.5：作废为终态需原因；冻结可解冻）
const showFlagModal = ref(false)
const flagAction = ref<'freeze' | 'void' | 'restore'>('freeze')
const flagReason = ref('')
const flagTargets = ref<any[]>([])
const flagging = ref(false)

// 操作对话框头部图标与语义色（克制：仅图标着色提示）
const FLAG_META = {
  freeze: { icon: 'i-lucide-snowflake', color: 'text-amber-600' },
  void: { icon: 'i-lucide-ban', color: 'text-red-600' },
  restore: { icon: 'i-lucide-rotate-ccw', color: 'text-gray-600' },
} as const

const openFlag = (action: 'freeze' | 'void' | 'restore', rows: any[]) => {
  if (!rows.length) { toast.add({ title: '请选择追溯码', color: 'warning' }); return }
  flagAction.value = action
  flagReason.value = ''
  flagTargets.value = rows
  showFlagModal.value = true
}

const submitFlag = async () => {
  const flagMap = { freeze: 1, void: 2, restore: 0 } as const
  const flag = flagMap[flagAction.value]
  if (flag === 2 && !flagReason.value.trim()) { toast.add({ title: '作废必须填写原因', color: 'warning' }); return }
  flagging.value = true
  try {
    const ids = flagTargets.value.map((r: any) => r.id)
    await $fetch('/api/admin/codes/batch-flag', { method: 'POST', body: { ids, flag, reason: flagReason.value.trim() } })
    toast.add({ title: '已执行：' + ids.length + ' 条', color: 'success' })
    showFlagModal.value = false
    selected.value = []
    refresh()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '操作失败', color: 'error' })
  } finally {
    flagging.value = false
  }
}

const FLAG_TITLE = { freeze: '批量冻结', void: '批量作废', restore: '批量恢复正常' }
const FLAG_NOTE = {
  freeze: '冻结后扫码显示"该追溯码暂不可用，请联系企业（生产厂家）"，可解冻',
  void: '作废为终态不可恢复，扫码显示"该追溯码已作废，请勿购买"（不展示产品与批次信息）',
  restore: '恢复正常后扫码按正常逻辑展示',
}


// 批量修正（PRD 5.8 场景8：关联批次/生产日期/有效期/质检）
const showCorrectModal = ref(false)
const correcting = ref(false)
// 批量修正表单：batchId=0 与 qcResult='keep' 为「不修改」哨兵值（reka-ui 禁止空字符串 value）
const correctForm = reactive({
  batchId: 0 as number,
  produceDate: '', expireDate: '', qcResult: 'keep', qualityCertNo: '',
})
const { data: batchAll } = await useFetch<any>('/api/admin/batches', {
  key: 'admin-batches-correct',
  query: { page: 1, pageSize: 100 },
})

const openCorrect = () => {
  Object.assign(correctForm, { batchId: 0, produceDate: '', expireDate: '', qcResult: 'keep', qualityCertNo: '' })
  showCorrectModal.value = true
}

const submitCorrect = async () => {
  const ids = selected.value
  if (!ids.length) { toast.add({ title: '请选择追溯码', color: 'warning' }); return }
  if (!correctForm.batchId && !correctForm.produceDate && !correctForm.expireDate && correctForm.qcResult === 'keep' && !correctForm.qualityCertNo) {
    toast.add({ title: '请至少选择一个要修改的字段', color: 'warning' }); return
  }
  correcting.value = true
  try {
    const res = await $fetch('/api/admin/codes/batch-correct', {
      method: 'POST',
      body: {
        ids,
        batchId: correctForm.batchId || undefined,
        produceDate: correctForm.produceDate || undefined,
        expireDate: correctForm.expireDate || undefined,
        qcResult: correctForm.qcResult === 'keep' ? undefined : Number(correctForm.qcResult),
        qualityCertNo: correctForm.qualityCertNo || undefined,
      },
    })
    toast.add({ title: '修正完成：绑定批次 ' + res.rebound + ' 条，字段修正 ' + res.corrected + ' 条', color: 'success' })
    showCorrectModal.value = false
    selected.value = []
    refresh()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '修正失败', color: 'error' })
  } finally {
    correcting.value = false
  }
}

const doSearch = () => { page.value = 1; refresh() }
const resetSearch = () => {
  filters.keyword = ''; filters.status = undefined; filters.abnormalFlag = undefined; filters.dateFrom = ''; filters.dateTo = ''
  page.value = 1
  selected.value = [] // 重置即恢复初始状态：清空批量勾选
  refresh()
}
</script>

<template>
  <div class="space-y-4">
    <!-- 页面标题区 -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="b-page-title">码库管理</h1>
        <p class="b-page-desc">追溯码查询、状态与异常标记管理（异常标记与码状态正交）</p>
      </div>
    </div>

    <!-- 筛选查询区 -->
    <div class="b-card">
      <div class="b-card-head">
        <span class="b-card-title">筛选查询</span>
      </div>
      <div class="b-form-grid md:grid-cols-2 xl:grid-cols-5">
        <div>
          <label class="b-label">追溯码 / 批号 / 产品名</label>
          <UInput v-model="filters.keyword" placeholder="输入追溯码、批号或产品名称" icon="i-lucide-search" @keyup.enter="doSearch" />
        </div>
        <div>
          <label class="b-label">码状态</label>
          <USelect v-model="filters.status" :items="STATUS_OPTIONS" placeholder="全部状态" class="w-full" />
        </div>
        <div>
          <label class="b-label">异常标记</label>
          <USelect v-model="filters.abnormalFlag" :items="FLAG_OPTIONS" placeholder="全部标记" class="w-full" />
        </div>
        <div>
          <label class="b-label">创建日期起</label>
          <UInput v-model="filters.dateFrom" type="date" />
        </div>
        <div>
          <label class="b-label">创建日期止</label>
          <UInput v-model="filters.dateTo" type="date" />
        </div>
      </div>
      <div class="b-card-foot">
        <span class="b-card-extra">共 <span class="font-medium b-strong">{{ data?.total || 0 }}</span> 条追溯码</span>
        <div class="flex items-center gap-2">
          <UButton color="neutral" variant="solid" @click="doSearch">查询</UButton>
          <UButton color="neutral" variant="outline" @click="resetSearch">重置</UButton>
        </div>
      </div>
    </div>

    <!-- 追溯码列表 -->
    <div class="b-card b-card-clip">
      <div class="b-card-head">
        <span class="b-card-title">追溯码列表</span>
        <span class="b-card-extra">每页 {{ pageSize }} 条 · 共 {{ data?.total || 0 }} 条</span>
      </div>

      <div class="b-scroll-x">
        <table class="b-table">
          <thead>
            <tr>
              <th class="w-12">
                <div class="flex items-center gap-1.5">
                  <UCheckbox color="neutral" :model-value="allSelected" @update:model-value="toggleAll" />
                  <span>全选</span>
                </div>
              </th>
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
            <tr v-for="r in data?.rows || []" :key="r.id" :class="{ 'is-selected': selected.includes(r.id) }">
              <td><UCheckbox color="neutral" :model-value="selected.includes(r.id)" @update:model-value="toggleOne(r.id)" /></td>
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
                <div v-if="Number(r.abnormal_flag) === 0" class="b-actions">
                  <UButton variant="link" color="neutral" size="xs" @click="openFlag('freeze', [r])">冻结</UButton>
                  <span class="b-sep" />
                  <UButton variant="link" color="error" size="xs" @click="openFlag('void', [r])">作废</UButton>
                </div>
                <div v-else class="b-actions">
                  <UButton variant="link" color="neutral" size="xs" @click="openFlag('restore', [r])">恢复正常</UButton>
                </div>
              </td>
            </tr>
            <tr v-if="!pending && !data?.rows?.length">
              <td colspan="9" class="b-empty">
                <div class="b-empty-inner">
                  <UIcon name="i-lucide-inbox" class="b-empty-icon h-8 w-8" />
                  <span class="text-sm">暂无符合条件的追溯码，请调整筛选条件后重试</span>
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
          <UButton variant="outline" color="neutral" size="sm" :disabled="page <= 1" @click="page--; refresh()">上一页</UButton>
          <UButton variant="outline" color="neutral" size="sm" :disabled="page >= totalPages" @click="page++; refresh()">下一页</UButton>
        </div>
      </div>
    </div>

    <!-- 底部吸底批量操作条：仅批量作废用警示色，其余中性 -->
    <div v-if="data?.rows?.length" class="b-bulkbar">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2.5">
          <span class="b-count">已选 {{ selected.length }} 条</span>
          <span class="b-card-extra">勾选追溯码后可执行批量冻结、作废、恢复正常或批量修正</span>
        </div>
        <div class="flex items-center gap-2">
          <UButton variant="outline" color="neutral" size="sm" :disabled="!selected.length" @click="openFlag('freeze', selectedRows)">批量冻结</UButton>
          <UButton variant="outline" color="error" size="sm" :disabled="!selected.length" @click="openFlag('void', selectedRows)">批量作废</UButton>
          <UButton variant="outline" color="neutral" size="sm" :disabled="!selected.length" @click="openFlag('restore', selectedRows)">恢复正常</UButton>
          <UButton variant="outline" color="neutral" size="sm" :disabled="!selected.length" @click="openCorrect">批量修正</UButton>
          <UButton v-if="selected.length" variant="ghost" color="neutral" size="sm" @click="selected = []">清空</UButton>
        </div>
      </div>
    </div>

    <!-- 异常标记操作对话框（Nuxt UI v4：v-model:open 绑定 open 状态，内容必须放 #content 插槽） -->
    <UModal v-model:open="showFlagModal">
      <template #content>
        <div class="b-modal">
          <div class="b-modal-head">
            <div class="b-modal-icon">
              <UIcon :name="FLAG_META[flagAction].icon" class="h-4 w-4" :class="FLAG_META[flagAction].color" />
            </div>
            <div>
              <h3 class="b-modal-title">{{ FLAG_TITLE[flagAction] }}</h3>
              <p class="b-modal-sub">已选中 {{ flagTargets.length }} 条追溯码</p>
            </div>
          </div>
          <div class="b-modal-body">
            <div class="b-note">
              <UIcon name="i-lucide-info" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--b-text-muted)]" />
              <p class="b-note-text">{{ FLAG_NOTE[flagAction] }}</p>
            </div>
            <div v-if="flagAction === 'void'">
              <label class="b-label-lg">作废原因 <span class="b-required">*</span></label>
              <USelect v-model="flagReason" :items="['印刷模糊', '无法识别', '窜货', '召回', '疑似假冒', '其他'].map(r => ({ value: r, label: r }))" placeholder="选择原因" class="w-full" />
            </div>
          </div>
          <div class="b-modal-foot">
            <UButton variant="outline" color="neutral" @click="showFlagModal = false">取消</UButton>
            <UButton color="neutral" variant="solid" :loading="flagging" @click="submitFlag">确认执行</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- 批量修正对话框（PRD 5.8；Nuxt UI v4：v-model:open + #content 插槽） -->
    <UModal v-model:open="showCorrectModal">
      <template #content>
        <div class="b-modal">
          <div class="b-modal-head">
            <div class="b-modal-icon">
              <UIcon name="i-lucide-wrench" class="h-4 w-4 text-[var(--b-text-regular)]" />
            </div>
            <div>
              <h3 class="b-modal-title">批量修正</h3>
              <p class="b-modal-sub">已选 {{ selected.length }} 条追溯码 · 已冻结/已作废码自动排除</p>
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
              <p class="b-note-text">已绑定码的生产日期/质检字段修改属合规更正，将记录强审计日志（不可撤销）</p>
            </div>
          </div>
          <div class="b-modal-foot">
            <UButton variant="outline" color="neutral" @click="showCorrectModal = false">取消</UButton>
            <UButton color="neutral" variant="solid" :loading="correcting" @click="submitCorrect">确认修正</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
