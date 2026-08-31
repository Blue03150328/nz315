<script setup lang="ts">
// 码库管理：码列表查询 + 异常标记操作（PRD 5.5.5/5.5.7：冻结/作废/解冻，与码状态正交）
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '码库管理' })

const toast = useToast()
const filters = reactive({ keyword: '', status: '', abnormalFlag: '', dateFrom: '', dateTo: '' })
const page = ref(1)
const pageSize = 20
const selected = ref<number[]>([])

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

const toggleAll = () => {
  if (allSelected.value) selected.value = []
  else selected.value = (data.value?.rows || []).map((r: any) => r.id)
}
const toggleOne = (id: number) => {
  const i = selected.value.indexOf(id)
  if (i >= 0) selected.value.splice(i, 1)
  else selected.value.push(id)
}

const flagBadge = (f: number) => {
  if (f === 1) return { cls: 'bg-warning/10 text-warning', label: '已冻结' }
  if (f === 2) return { cls: 'bg-error/10 text-error', label: '已作废' }
  return { cls: 'bg-success/10 text-success', label: '正常' }
}
const statusBadge = (s: number) => {
  if (s === 2) return { cls: 'bg-primary/10 text-primary', label: '已绑定' }
  return { cls: 'bg-sky/10 text-sky', label: '已生成' }
}

// 异常标记操作（PRD 5.5.5：作废为终态需原因；冻结可解冻）
const showFlagModal = ref(false)
const flagAction = ref<'freeze' | 'void' | 'restore'>('freeze')
const flagReason = ref('')
const flagTargets = ref<any[]>([])
const flagging = ref(false)

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
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold text-default">码库管理</h1>
        <p class="mt-1 text-sm text-muted">追溯码查询、状态与异常标记管理（异常标记与码状态正交）</p>
      </div>
    </div>

    <!-- 筛选区 -->
    <div class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <UInput v-model="filters.keyword" placeholder="追溯码 / 批号 / 产品名" icon="i-lucide-search" @keyup.enter="doSearch" />
        <USelect v-model="filters.status" :options="[{ value: '', label: '全部状态' }, { value: '1', label: '已生成' }, { value: '2', label: '已绑定' }]" />
        <USelect v-model="filters.abnormalFlag" :options="[{ value: '', label: '全部标记' }, { value: '0', label: '正常' }, { value: '1', label: '已冻结' }, { value: '2', label: '已作废' }]" />
        <UInput v-model="filters.dateFrom" type="date" placeholder="创建日期起" />
        <UInput v-model="filters.dateTo" type="date" placeholder="创建日期止" />
      </div>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <UButton color="primary" icon="i-lucide-search" :loading="pending" @click="doSearch">查询</UButton>
        <UButton variant="outline" color="neutral" icon="i-lucide-rotate-ccw" @click="resetSearch">重置</UButton>
        <div v-if="selected.length" class="ml-2 flex items-center gap-2 border-l border-border/60 pl-3">
          <span class="text-xs text-muted">已选 {{ selected.length }} 条</span>
          <UButton variant="outline" color="warning" size="sm" icon="i-lucide-snowflake" @click="openFlag('freeze', data.rows.filter((r: any) => selected.includes(r.id)))">批量冻结</UButton>
          <UButton variant="outline" color="error" size="sm" icon="i-lucide-ban" @click="openFlag('void', data.rows.filter((r: any) => selected.includes(r.id)))">批量作废</UButton>
          <UButton variant="outline" color="neutral" size="sm" icon="i-lucide-rotate-ccw" @click="openFlag('restore', data.rows.filter((r: any) => selected.includes(r.id)))">恢复正常</UButton>
          <UButton variant="outline" color="primary" size="sm" icon="i-lucide-wrench" @click="openCorrect">批量修正</UButton>
        </div>
      </div>
    </div>

    <!-- 码列表 -->
    <div class="overflow-hidden rounded-xl border border-border bg-elevated shadow-sm">
      <div class="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <span class="text-sm font-semibold text-default">追溯码列表</span>
        <span class="text-xs text-muted">共 {{ data?.total || 0 }} 条</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-border/60 bg-muted/30 text-xs text-muted">
              <th class="w-10 px-4 py-3"><UCheckbox :model-value="allSelected" @update:model-value="toggleAll" /></th>
              <th class="px-4 py-3 font-medium">追溯码</th>
              <th class="px-4 py-3 font-medium">产品</th>
              <th class="px-4 py-3 font-medium">码状态</th>
              <th class="px-4 py-3 font-medium">异常标记</th>
              <th class="px-4 py-3 font-medium">生产日期</th>
              <th class="px-4 py-3 font-medium">生产批号</th>
              <th class="px-4 py-3 font-medium">上传时间</th>
              <th class="px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in data?.rows || []" :key="r.id" class="border-b border-border/40 transition-colors hover:bg-muted/30">
              <td class="px-4 py-3"><UCheckbox :model-value="selected.includes(r.id)" @update:model-value="toggleOne(r.id)" /></td>
              <td class="px-4 py-3 font-code text-xs">{{ r.code }}</td>
              <td class="px-4 py-3 text-muted">{{ r.product_name || '-' }}</td>
              <td class="px-4 py-3">
                <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="statusBadge(r.status).cls">{{ statusBadge(r.status).label }}</span>
              </td>
              <td class="px-4 py-3">
                <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="flagBadge(r.abnormal_flag).cls">{{ flagBadge(r.abnormal_flag).label }}</span>
                <div v-if="r.abnormal_reason" class="mt-0.5 max-w-40 truncate text-xs text-muted" :title="r.abnormal_reason">{{ r.abnormal_reason }}</div>
              </td>
              <td class="px-4 py-3 text-muted">{{ r.produce_date || '-' }}</td>
              <td class="px-4 py-3 text-muted">{{ r.batch_no || '-' }}</td>
              <td class="px-4 py-3 text-muted">{{ String(r.created_at).slice(0, 16) }}</td>
              <td class="px-4 py-3">
                <div v-if="Number(r.abnormal_flag) === 0" class="flex gap-1">
                  <UButton variant="ghost" color="warning" size="xs" icon="i-lucide-snowflake" @click="openFlag('freeze', [r])">冻结</UButton>
                  <UButton variant="ghost" color="error" size="xs" icon="i-lucide-ban" @click="openFlag('void', [r])">作废</UButton>
                </div>
                <UButton v-else variant="ghost" color="neutral" size="xs" icon="i-lucide-rotate-ccw" @click="openFlag('restore', [r])">恢复正常</UButton>
              </td>
            </tr>
            <tr v-if="!pending && !data?.rows?.length">
              <td colspan="9" class="px-4 py-10 text-center text-sm text-muted">暂无数据</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="data?.total" class="flex items-center justify-between border-t border-border/60 px-4 py-3">
        <span class="text-xs text-muted">第 {{ data.page }} / {{ totalPages }} 页</span>
        <div class="flex gap-2">
          <UButton variant="outline" color="neutral" size="sm" :disabled="page <= 1" @click="page--; refresh()">上一页</UButton>
          <UButton variant="outline" color="neutral" size="sm" :disabled="page >= totalPages" @click="page++; refresh()">下一页</UButton>
        </div>
      </div>
    </div>

    <!-- 异常标记操作对话框 -->
    <UModal v-model="showFlagModal">
      <div class="p-5">
        <h3 class="text-base font-semibold text-default">{{ FLAG_TITLE[flagAction] }}</h3>
        <p class="mt-1 text-xs text-muted">选中 {{ flagTargets.length }} 条追溯码</p>
        <p class="mt-2 rounded-lg bg-muted/40 p-3 text-xs text-muted">{{ FLAG_NOTE[flagAction] }}</p>
        <div v-if="flagAction === 'void'" class="mt-3 space-y-1.5">
          <label class="block text-sm font-medium text-default">作废原因 <span class="text-error">*</span></label>
          <USelect v-model="flagReason" :options="['印刷模糊', '无法识别', '窜货', '召回', '疑似假冒', '其他'].map(r => ({ value: r, label: r }))" placeholder="选择原因" />
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <UButton variant="outline" color="neutral" @click="showFlagModal = false">取消</UButton>
          <UButton color="primary" :loading="flagging" @click="submitFlag">确认执行</UButton>
        </div>
      </div>
    
    <!-- 批量修正对话框（PRD 5.8） -->
    <UModal v-model="showCorrectModal">
      <div class="p-5">
        <h3 class="text-base font-semibold text-default">批量修正</h3>
        <p class="mt-1 text-xs text-muted">已选 {{ selected.length }} 条追溯码 · 已冻结/已作废码自动排除</p>
        <div class="mt-4 space-y-4">
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
          <p class="rounded-lg bg-muted/40 p-3 text-xs text-muted">已绑定码的生产日期/质检字段修改属合规更正，将记录强审计日志（不可撤销）</p>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <UButton variant="outline" color="neutral" @click="showCorrectModal = false">取消</UButton>
          <UButton color="primary" :loading="correcting" @click="submitCorrect">确认修正</UButton>
        </div>
      </div>
    </UModal>
</UModal>
  </div>
</template>
