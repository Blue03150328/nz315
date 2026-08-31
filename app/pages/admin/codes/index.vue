<script setup lang="ts">
// 码库管理：码列表查询 + 异常标记操作（PRD 5.5.5/5.5.7：冻结/作废/解冻，与码状态正交）
// 界面为 PC 后台企业级 B 端风格：筛选卡片化、强表头表格、底部批量操作条
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '码库管理' })

const toast = useToast()
const filters = reactive({ keyword: '', status: '', abnormalFlag: '', dateFrom: '', dateTo: '' })
const page = ref(1)
const pageSize = 20
const selected = ref<number[]>([])

// 筛选下拉选项
const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: '1', label: '已生成' },
  { value: '2', label: '已绑定' },
]
const FLAG_OPTIONS = [
  { value: '', label: '全部标记' },
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

// 状态标签：边框 + 圆点 + 语义色（已生成=蓝 / 已绑定=绿），提升视觉权重
const statusBadge = (s: number) => {
  if (s === 2) return { cls: 'border-success/40 bg-success/10 text-success', dot: 'bg-success', label: '已绑定' }
  return { cls: 'border-sky/40 bg-sky/10 text-sky', dot: 'bg-sky', label: '已生成' }
}
// 异常标记标签：作废/冻结为实心高权重样式，正常为中性灰
const flagBadge = (f: number) => {
  if (f === 1) return { cls: 'border-warning bg-warning text-white', dot: 'bg-white', label: '已冻结' }
  if (f === 2) return { cls: 'border-error bg-error text-white', dot: 'bg-white', label: '已作废' }
  return { cls: 'border-border bg-muted/50 text-muted-foreground', dot: 'bg-muted-foreground', label: '正常' }
}

// 异常标记操作（PRD 5.5.5：作废为终态需原因；冻结可解冻）
const showFlagModal = ref(false)
const flagAction = ref<'freeze' | 'void' | 'restore'>('freeze')
const flagReason = ref('')
const flagTargets = ref<any[]>([])
const flagging = ref(false)

// 操作对话框头部图标与语义色
const FLAG_META = {
  freeze: { icon: 'i-lucide-snowflake', color: 'text-warning' },
  void: { icon: 'i-lucide-ban', color: 'text-error' },
  restore: { icon: 'i-lucide-rotate-ccw', color: 'text-primary' },
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
const correctForm = reactive({
  batchId: null as number | null,
  produceDate: '', expireDate: '', qcResult: '', qualityCertNo: '',
})
const { data: batchAll } = await useFetch<any>('/api/admin/batches', {
  key: 'admin-batches-correct',
  query: { page: 1, pageSize: 100 },
})

const openCorrect = () => {
  Object.assign(correctForm, { batchId: null, produceDate: '', expireDate: '', qcResult: '', qualityCertNo: '' })
  showCorrectModal.value = true
}

const submitCorrect = async () => {
  const ids = selected.value
  if (!ids.length) { toast.add({ title: '请选择追溯码', color: 'warning' }); return }
  if (!correctForm.batchId && !correctForm.produceDate && !correctForm.expireDate && !correctForm.qcResult && !correctForm.qualityCertNo) {
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
        qcResult: correctForm.qcResult === '' ? undefined : Number(correctForm.qcResult),
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
  filters.keyword = ''; filters.status = ''; filters.abnormalFlag = ''; filters.dateFrom = ''; filters.dateTo = ''
  page.value = 1; refresh()
}
</script>

<template>
  <div class="space-y-5">
    <!-- 页面标题区 -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold tracking-tight text-default">码库管理</h1>
        <p class="mt-1 text-sm text-muted">追溯码查询、状态与异常标记管理（异常标记与码状态正交）</p>
      </div>
    </div>

    <!-- 筛选查询区：独立卡片，标题条 + 带标签表单 + 底部操作条，与列表容器明确分隔 -->
    <div class="overflow-hidden rounded-lg border border-border bg-white shadow-sm">
      <div class="flex items-center justify-between border-b border-border px-5 py-3">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-filter" class="h-4 w-4 text-primary" />
          <span class="text-sm font-semibold text-default">筛选查询</span>
        </div>
        <span class="text-xs text-muted">支持追溯码 / 批号 / 产品名模糊匹配</span>
      </div>

      <div class="grid gap-x-4 gap-y-4 px-5 py-5 md:grid-cols-2 xl:grid-cols-5">
        <div class="space-y-1.5">
          <label class="block text-xs font-medium text-toned">追溯码 / 批号 / 产品名</label>
          <UInput v-model="filters.keyword" placeholder="输入追溯码、批号或产品名称" icon="i-lucide-search" @keyup.enter="doSearch" />
        </div>
        <div class="space-y-1.5">
          <label class="block text-xs font-medium text-toned">码状态</label>
          <USelect v-model="filters.status" :options="STATUS_OPTIONS" />
        </div>
        <div class="space-y-1.5">
          <label class="block text-xs font-medium text-toned">异常标记</label>
          <USelect v-model="filters.abnormalFlag" :options="FLAG_OPTIONS" />
        </div>
        <div class="space-y-1.5">
          <label class="block text-xs font-medium text-toned">创建日期起</label>
          <UInput v-model="filters.dateFrom" type="date" />
        </div>
        <div class="space-y-1.5">
          <label class="block text-xs font-medium text-toned">创建日期止</label>
          <UInput v-model="filters.dateTo" type="date" />
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/30 px-5 py-3">
        <div class="flex items-center gap-1.5 text-xs text-muted">
          <UIcon name="i-lucide-database" class="h-3.5 w-3.5" />
          <span>共 <span class="font-semibold text-default">{{ data?.total || 0 }}</span> 条追溯码</span>
        </div>
        <div class="flex items-center gap-2">
          <UButton color="primary" icon="i-lucide-search" :loading="pending" @click="doSearch">查询</UButton>
          <UButton variant="outline" color="neutral" icon="i-lucide-rotate-ccw" @click="resetSearch">重置</UButton>
        </div>
      </div>
    </div>

    <!-- 追溯码列表：白底卡片，强表头 + 行区分 + 语义状态标签 -->
    <div class="overflow-hidden rounded-lg border border-border bg-white shadow-sm">
      <div class="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-table-2" class="h-4 w-4 text-primary" />
          <span class="text-sm font-semibold text-default">追溯码列表</span>
        </div>
        <span class="text-xs text-muted">每页 {{ pageSize }} 条 · 共 {{ data?.total || 0 }} 条</span>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-border bg-[#f5f7fa] text-xs text-muted">
              <th class="w-16 px-5 py-3.5">
                <div class="flex items-center gap-1.5">
                  <UCheckbox :model-value="allSelected" @update:model-value="toggleAll" />
                  <span class="font-medium">全选</span>
                </div>
              </th>
              <th class="px-4 py-3.5 font-medium">追溯码</th>
              <th class="px-4 py-3.5 font-medium">产品</th>
              <th class="px-4 py-3.5 font-medium">码状态</th>
              <th class="px-4 py-3.5 font-medium">异常标记</th>
              <th class="px-4 py-3.5 font-medium">生产日期</th>
              <th class="px-4 py-3.5 font-medium">生产批号</th>
              <th class="px-4 py-3.5 font-medium">上传时间</th>
              <th class="px-4 py-3.5 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in data?.rows || []" :key="r.id"
              class="border-b border-border/60 transition-colors hover:bg-[#f8fafc]"
              :class="selected.includes(r.id) ? 'bg-primary/5' : ''"
            >
              <td class="px-5 py-3.5"><UCheckbox :model-value="selected.includes(r.id)" @update:model-value="toggleOne(r.id)" /></td>
              <td class="px-4 py-3.5"><span class="font-code text-[13px] font-medium text-default">{{ r.code }}</span></td>
              <td class="px-4 py-3.5 text-muted">{{ r.product_name || '-' }}</td>
              <td class="px-4 py-3.5">
                <span class="inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-semibold" :class="statusBadge(r.status).cls">
                  <span class="h-1.5 w-1.5 rounded-full" :class="statusBadge(r.status).dot" />
                  {{ statusBadge(r.status).label }}
                </span>
              </td>
              <td class="px-4 py-3.5">
                <span class="inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-semibold" :class="flagBadge(r.abnormal_flag).cls">
                  <span class="h-1.5 w-1.5 rounded-full" :class="flagBadge(r.abnormal_flag).dot" />
                  {{ flagBadge(r.abnormal_flag).label }}
                </span>
                <div v-if="r.abnormal_reason" class="mt-1 max-w-44 truncate text-xs text-muted" :title="r.abnormal_reason">原因：{{ r.abnormal_reason }}</div>
              </td>
              <td class="px-4 py-3.5 text-muted">{{ r.produce_date || '-' }}</td>
              <td class="px-4 py-3.5 text-muted">{{ r.batch_no || '-' }}</td>
              <td class="px-4 py-3.5 text-muted">{{ String(r.created_at).slice(0, 16) }}</td>
              <td class="px-4 py-3.5">
                <div v-if="Number(r.abnormal_flag) === 0" class="flex items-center justify-end gap-1">
                  <UButton variant="ghost" color="warning" size="xs" icon="i-lucide-snowflake" @click="openFlag('freeze', [r])">冻结</UButton>
                  <span class="mx-0.5 h-3.5 w-px bg-border" />
                  <UButton variant="ghost" color="error" size="xs" icon="i-lucide-ban" @click="openFlag('void', [r])">作废</UButton>
                </div>
                <div v-else class="flex items-center justify-end">
                  <UButton variant="ghost" color="neutral" size="xs" icon="i-lucide-rotate-ccw" @click="openFlag('restore', [r])">恢复正常</UButton>
                </div>
              </td>
            </tr>
            <tr v-if="!pending && !data?.rows?.length">
              <td colspan="9" class="px-5 py-16 text-center">
                <div class="flex flex-col items-center gap-2 text-muted">
                  <UIcon name="i-lucide-inbox" class="h-10 w-10 text-border" />
                  <span class="text-sm">暂无符合条件的追溯码，请调整筛选条件后重试</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 分页区 -->
      <div v-if="data?.total" class="flex items-center justify-between border-t border-border bg-muted/20 px-5 py-3">
        <span class="text-xs text-muted">共 {{ data?.total || 0 }} 条 · 第 {{ data.page }} / {{ totalPages }} 页</span>
        <div class="flex items-center gap-2">
          <UButton variant="outline" color="neutral" size="sm" icon="i-lucide-chevron-left" :disabled="page <= 1" @click="page--; refresh()">上一页</UButton>
          <UButton variant="outline" color="neutral" size="sm" icon="i-lucide-chevron-right" :disabled="page >= totalPages" @click="page++; refresh()">下一页</UButton>
        </div>
      </div>
    </div>

    <!-- 底部批量操作条：吸底 + 顶部粗分隔线，与列表视觉强分隔 -->
    <div v-if="data?.rows?.length" class="sticky bottom-0 z-20 -mx-8 border-t-2 border-border/80 bg-white/95 px-8 py-3.5 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <span class="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-white">
            <UIcon name="i-lucide-check-square" class="h-3.5 w-3.5" />
            已选 {{ selected.length }} 条
          </span>
          <span class="text-xs text-muted">勾选追溯码后可执行批量冻结、作废、恢复正常或批量修正</span>
        </div>
        <div class="flex items-center gap-2">
          <UButton variant="outline" color="warning" size="sm" icon="i-lucide-snowflake" :disabled="!selected.length" @click="openFlag('freeze', selectedRows)">批量冻结</UButton>
          <UButton variant="outline" color="error" size="sm" icon="i-lucide-ban" :disabled="!selected.length" @click="openFlag('void', selectedRows)">批量作废</UButton>
          <UButton variant="outline" color="neutral" size="sm" icon="i-lucide-rotate-ccw" :disabled="!selected.length" @click="openFlag('restore', selectedRows)">恢复正常</UButton>
          <UButton variant="outline" color="primary" size="sm" icon="i-lucide-wrench" :disabled="!selected.length" @click="openCorrect">批量修正</UButton>
          <UButton v-if="selected.length" variant="ghost" color="neutral" size="sm" icon="i-lucide-x" @click="selected = []">清空</UButton>
        </div>
      </div>
    </div>

    <!-- 异常标记操作对话框 -->
    <UModal v-model="showFlagModal">
      <div class="p-5">
        <div class="flex items-center gap-2.5 border-b border-border pb-4">
          <div class="flex h-9 w-9 items-center justify-center rounded-md bg-muted/60">
            <UIcon :name="FLAG_META[flagAction].icon" class="h-4.5 w-4.5" :class="FLAG_META[flagAction].color" />
          </div>
          <div>
            <h3 class="text-base font-semibold text-default">{{ FLAG_TITLE[flagAction] }}</h3>
            <p class="text-xs text-muted">已选中 {{ flagTargets.length }} 条追溯码</p>
          </div>
        </div>
        <div class="mt-4 flex gap-2 rounded-md border border-border bg-muted/40 p-3">
          <UIcon name="i-lucide-info" class="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p class="text-xs leading-relaxed text-muted">{{ FLAG_NOTE[flagAction] }}</p>
        </div>
        <div v-if="flagAction === 'void'" class="mt-4 space-y-1.5">
          <label class="block text-sm font-medium text-default">作废原因 <span class="text-error">*</span></label>
          <USelect v-model="flagReason" :options="['印刷模糊', '无法识别', '窜货', '召回', '疑似假冒', '其他'].map(r => ({ value: r, label: r }))" placeholder="选择原因" />
        </div>
        <div class="mt-6 flex justify-end gap-2 border-t border-border pt-4">
          <UButton variant="outline" color="neutral" @click="showFlagModal = false">取消</UButton>
          <UButton color="primary" :loading="flagging" @click="submitFlag">确认执行</UButton>
        </div>
      </div>
    </UModal>

    <!-- 批量修正对话框（PRD 5.8） -->
    <UModal v-model="showCorrectModal">
      <div class="p-5">
        <div class="flex items-center gap-2.5 border-b border-border pb-4">
          <div class="flex h-9 w-9 items-center justify-center rounded-md bg-muted/60">
            <UIcon name="i-lucide-wrench" class="h-4.5 w-4.5 text-primary" />
          </div>
          <div>
            <h3 class="text-base font-semibold text-default">批量修正</h3>
            <p class="text-xs text-muted">已选 {{ selected.length }} 条追溯码 · 已冻结/已作废码自动排除</p>
          </div>
        </div>
        <div class="mt-4 max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <div class="space-y-1.5">
            <label class="block text-sm font-medium text-default">重新绑定批次（仅"已生成"码生效，绑定后自动置为"已绑定"）</label>
            <USelect
              v-model="correctForm.batchId"
              :options="[{ value: '', label: '不修改批次' }, ...(batchAll?.rows || []).map((b: any) => ({ value: Number(b.id), label: b.batch_no + '（' + b.product_name + '）' }))]"
            />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <label class="block text-sm font-medium text-default">生产日期</label>
              <UInput v-model="correctForm.produceDate" type="date" />
              <p class="text-xs text-warning">修改后扫码页展示的生产日期将变更，请确认与标签喷码一致</p>
            </div>
            <div class="space-y-1.5">
              <label class="block text-sm font-medium text-default">有效期至</label>
              <UInput v-model="correctForm.expireDate" type="date" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <label class="block text-sm font-medium text-default">质量检验结果</label>
              <USelect v-model="correctForm.qcResult" :options="[{ value: '', label: '不修改' }, { value: '1', label: '合格' }, { value: '0', label: '不合格' }]" />
            </div>
            <div class="space-y-1.5">
              <label class="block text-sm font-medium text-default">质量合格证号</label>
              <UInput v-model="correctForm.qualityCertNo" placeholder="不修改留空" />
            </div>
          </div>
          <div class="flex gap-2 rounded-md border border-border bg-muted/40 p-3">
            <UIcon name="i-lucide-shield-alert" class="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p class="text-xs leading-relaxed text-muted">已绑定码的生产日期/质检字段修改属合规更正，将记录强审计日志（不可撤销）</p>
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-2 border-t border-border pt-4">
          <UButton variant="outline" color="neutral" @click="showCorrectModal = false">取消</UButton>
          <UButton color="primary" :loading="correcting" @click="submitCorrect">确认修正</UButton>
        </div>
      </div>
    </UModal>
  </div>
</template>
