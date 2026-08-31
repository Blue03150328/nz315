<script setup lang="ts">
// 风险预警中心（PRD 5.9：8 类异常后台预警的处理与统计）
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '风险预警' })

const toast = useToast()
const filters = reactive({ keyword: '', alertType: '', status: '', dateFrom: '', dateTo: '' })
const page = ref(1)
const pageSize = 20

const ALERT_OPTIONS = [
  { value: 1, label: '1·重复查询码' }, { value: 2, label: '2·查无此码' }, { value: 3, label: '3·登记证号不存在' },
  { value: 4, label: '4·登记证已过期' }, { value: 5, label: '5·产品名称不符' }, { value: 6, label: '6·生产厂家不符' },
  { value: 7, label: '7·扫码信息与标签不符' }, { value: 8, label: '8·限用农药非定点销售' },
]

const { data, pending, refresh } = await useFetch<any>('/api/admin/alerts', {
  key: 'admin-alerts',
  query: computed(() => ({
    keyword: filters.keyword || undefined,
    alertType: filters.alertType || undefined,
    status: filters.status || undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    page: page.value, pageSize,
  })),
})

const totalPages = computed(() => Math.max(1, Math.ceil((data.value?.total || 0) / pageSize)))

const STATUS_STYLE: Record<string, string> = {
  '0': 'bg-warning/10 text-warning',
  '1': 'bg-success/10 text-success',
  '2': 'bg-error/10 text-error',
}

// 处理对话框
const showHandle = ref(false)
const current = ref<any>(null)
const handleStatus = ref(1)
const voidCode = ref(false)
const handling = ref(false)

const openHandle = (row: any) => {
  current.value = row
  handleStatus.value = 1
  voidCode.value = false
  showHandle.value = true
}

const submitHandle = async () => {
  handling.value = true
  try {
    await $fetch('/api/admin/alerts/' + current.value.id, { method: 'PATCH', body: { status: handleStatus.value, voidCode: voidCode.value } })
    toast.add({ title: handleStatus.value === 1 ? '已标记为核实合规' : '已确认违规' + (voidCode.value ? '，关联码已作废' : ''), color: 'success' })
    showHandle.value = false
    refresh()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '处理失败', color: 'error' })
  } finally {
    handling.value = false
  }
}

const doSearch = () => { page.value = 1; refresh() }
const resetSearch = () => { filters.keyword = ''; filters.alertType = ''; filters.status = ''; filters.dateFrom = ''; filters.dateTo = ''; page.value = 1; refresh() }
</script>

<template>
  <div class="space-y-5">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold text-default">风险预警中心</h1>
        <p class="mt-1 text-sm text-muted">8 类异常的后台预警 · 处理全程记录日志（保留至少 3 年）</p>
      </div>
    </div>

    <!-- 统计卡 -->
    <div class="grid grid-cols-3 gap-4">
      <div class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
        <div class="flex items-center gap-2 text-muted">
          <span class="flex h-8 w-8 items-center justify-center rounded-full bg-warning/10 text-warning"><UIcon name="i-lucide-hourglass" class="h-4 w-4" /></span>
          <span class="text-xs">待处理</span>
        </div>
        <div class="mt-2 text-2xl font-bold text-warning">{{ data?.pending ?? '--' }}</div>
      </div>
      <div class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
        <div class="flex items-center gap-2 text-muted">
          <span class="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary"><UIcon name="i-lucide-bell-ring" class="h-4 w-4" /></span>
          <span class="text-xs">全部预警</span>
        </div>
        <div class="mt-2 text-2xl font-bold text-primary">{{ data?.total ?? '--' }}</div>
      </div>
      <div class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
        <div class="flex items-center gap-2 text-muted">
          <span class="flex h-8 w-8 items-center justify-center rounded-full bg-error/10 text-error"><UIcon name="i-lucide-shield-alert" class="h-4 w-4" /></span>
          <span class="text-xs">已确认违规</span>
        </div>
        <div class="mt-2 text-2xl font-bold text-error">{{ data?.rows?.filter((r: any) => r.handle_status === 2).length ?? '--' }}</div>
      </div>
    </div>

    <!-- 筛选 -->
    <div class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
      <div class="grid gap-3 md:grid-cols-5">
        <UInput v-model="filters.keyword" placeholder="追溯码 / 产品名" icon="i-lucide-search" @keyup.enter="doSearch" />
        <USelect v-model="filters.alertType" :options="[{ value: '', label: '全部类型' }, ...ALERT_OPTIONS.map(o => ({ value: String(o.value), label: o.label }))]" />
        <USelect v-model="filters.status" :options="[{ value: '', label: '全部状态' }, { value: '0', label: '待处理' }, { value: '1', label: '已核实合规' }, { value: '2', label: '已确认违规' }]" />
        <UInput v-model="filters.dateFrom" type="date" placeholder="触发起" />
        <UInput v-model="filters.dateTo" type="date" placeholder="触发止" />
      </div>
      <div class="mt-3 flex gap-2">
        <UButton color="primary" icon="i-lucide-search" :loading="pending" @click="doSearch">查询</UButton>
        <UButton variant="outline" color="neutral" icon="i-lucide-rotate-ccw" @click="resetSearch">重置</UButton>
      </div>
    </div>

    <!-- 预警列表 -->
    <div class="overflow-hidden rounded-xl border border-border bg-elevated shadow-sm">
      <div class="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <span class="text-sm font-semibold text-default">预警列表</span>
        <span class="text-xs text-muted">共 {{ data?.total || 0 }} 条</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-border/60 bg-muted/30 text-xs text-muted">
              <th class="px-4 py-3 font-medium">类型</th>
              <th class="px-4 py-3 font-medium">关联追溯码</th>
              <th class="px-4 py-3 font-medium">产品</th>
              <th class="px-4 py-3 font-medium">证据摘要</th>
              <th class="px-4 py-3 font-medium">触发时间</th>
              <th class="px-4 py-3 font-medium">累计</th>
              <th class="px-4 py-3 font-medium">处理状态</th>
              <th class="px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in data?.rows || []" :key="r.id" class="border-b border-border/40 transition-colors hover:bg-muted/30">
              <td class="px-4 py-3">
                <span class="rounded-full bg-error/10 px-2 py-0.5 text-xs font-medium text-error">{{ r.alertTypeLabel }}</span>
              </td>
              <td class="px-4 py-3 font-code text-xs">{{ r.code || '-' }}</td>
              <td class="px-4 py-3 text-muted">{{ r.product_name || '-' }}</td>
              <td class="max-w-56 truncate px-4 py-3 text-xs text-muted" :title="JSON.stringify(r.evidence || '')">
                {{ r.evidence ? (r.evidence.queryCount ? '查询 ' + r.evidence.queryCount + ' 次' + (r.evidence.provinces ? '，跨 ' + r.evidence.provinces.join('、') : '') : r.evidence.expireDate ? '过期日 ' + r.evidence.expireDate : JSON.stringify(r.evidence).slice(0, 50)) : '-' }}
              </td>
              <td class="px-4 py-3 whitespace-nowrap text-muted">{{ String(r.trigger_time).slice(0, 19) }}</td>
              <td class="px-4 py-3 font-medium text-default">{{ r.repeat_count }}</td>
              <td class="px-4 py-3">
                <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="STATUS_STYLE[String(r.handle_status)] || 'bg-muted text-muted'">
                  {{ r.handleStatusLabel }}
                </span>
              </td>
              <td class="px-4 py-3">
                <UButton v-if="Number(r.handle_status) === 0" variant="ghost" color="primary" size="xs" icon="i-lucide-check-check" @click="openHandle(r)">
                  处理
                </UButton>
                <span v-else class="text-xs text-muted">{{ r.handler_name || '-' }}</span>
              </td>
            </tr>
            <tr v-if="!pending && !data?.rows?.length">
              <td colspan="8" class="px-4 py-10 text-center text-sm text-muted">暂无预警</td>
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

    <!-- 处理对话框 -->
    <UModal v-model="showHandle">
      <div class="p-5">
        <h3 class="text-base font-semibold text-default">处理预警</h3>
        <p class="mt-1 text-xs text-muted">
          {{ current?.alertTypeLabel }} · {{ current?.code || '-' }}
        </p>
        <div class="mt-4 space-y-3">
          <label class="flex cursor-pointer items-center gap-2 rounded-lg border border-border/60 p-3 text-sm" :class="handleStatus === 1 ? 'border-success/40 bg-success/5' : ''">
            <URadio v-model="handleStatus" :value="1" />
            <span class="flex-1">
              <span class="font-medium text-success">已核实（合规）</span>
              <span class="block text-xs text-muted">核实后确认无异常，预警关闭</span>
            </span>
          </label>
          <label class="flex cursor-pointer items-center gap-2 rounded-lg border border-border/60 p-3 text-sm" :class="handleStatus === 2 ? 'border-error/40 bg-error/5' : ''">
            <URadio v-model="handleStatus" :value="2" />
            <span class="flex-1">
              <span class="font-medium text-error">已确认违规</span>
              <span class="block text-xs text-muted">确认异常属实，可一键作废关联追溯码</span>
            </span>
          </label>
          <label v-if="handleStatus === 2" class="flex items-center gap-2 rounded-lg bg-error/5 p-3 text-sm">
            <UCheckbox v-model="voidCode" />
            <span class="text-error">同时将关联追溯码标记为「已作废」（终态，不可恢复）</span>
          </label>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <UButton variant="outline" color="neutral" @click="showHandle = false">取消</UButton>
          <UButton color="primary" :loading="handling" @click="submitHandle">确认处理</UButton>
        </div>
      </div>
    </UModal>
  </div>
</template>
