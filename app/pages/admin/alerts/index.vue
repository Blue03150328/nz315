<script setup lang="ts">
// 风险预警中心（PRD 5.9：8 类异常后台预警的处理与统计）
// Keep-Alive 页面缓存：左侧菜单切换后返回保留页面状态（表单/筛选/页码/预览）；刷新、退出登录自动清空；页内【重置】恢复初始
definePageMeta({ layout: 'admin', middleware: 'backend-guard', keepalive: true })
useHead({ title: '风险预警' })

const toast = useToast()
// 筛选条件：下拉类默认 undefined（Nuxt UI v4 空值自动显示 placeholder，禁止空字符串 value 选项）
const filters = reactive({
  keyword: '',
  alertType: undefined as string | undefined,
  status: undefined as string | undefined,
  dateFrom: '',
  dateTo: '',
})
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

// 处理状态配色映射（纯样式常量，统一使用 B 端语义标签类）
const STATUS_STYLE: Record<string, string> = {
  '0': 'b-tag-warning',
  '1': 'b-tag-success',
  '2': 'b-tag-danger',
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
const resetSearch = () => { filters.keyword = ''; filters.alertType = undefined; filters.status = undefined; filters.dateFrom = ''; filters.dateTo = ''; page.value = 1; refresh() }
</script>

<template>
  <div class="space-y-4">
    <!-- 页面标题区 -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="b-page-title">风险预警中心</h1>
        <p class="b-page-desc">8 类异常的后台预警 · 处理全程记录日志（保留至少 3 年）</p>
      </div>
    </div>

    <!-- 预警指标卡：待处理 / 全部预警 / 已确认违规 -->
    <div class="grid grid-cols-3 gap-3">
      <div class="b-stat">
        <div class="b-stat-label">
          <UIcon name="i-lucide-hourglass" class="h-3.5 w-3.5" />
          <span>待处理</span>
        </div>
        <div class="b-stat-value">{{ data?.pending ?? '--' }}</div>
        <div class="b-stat-foot">尚未核实的预警，需尽快处理</div>
      </div>
      <div class="b-stat">
        <div class="b-stat-label">
          <UIcon name="i-lucide-bell-ring" class="h-3.5 w-3.5" />
          <span>全部预警</span>
        </div>
        <div class="b-stat-value">{{ data?.total ?? '--' }}</div>
        <div class="b-stat-foot">当前筛选条件下的预警总数</div>
      </div>
      <div class="b-stat">
        <div class="b-stat-label">
          <UIcon name="i-lucide-shield-alert" class="h-3.5 w-3.5" />
          <span>已确认违规</span>
        </div>
        <div class="b-stat-value">{{ data?.rows?.filter((r: any) => r.handle_status === 2).length ?? '--' }}</div>
        <div class="b-stat-foot">本页中已判定为违规的预警条数</div>
      </div>
    </div>

    <!-- 筛选查询区 -->
    <div class="b-card">
      <div class="b-card-head">
        <span class="b-card-title">筛选查询</span>
      </div>
      <div class="b-form-grid md:grid-cols-2 xl:grid-cols-5">
        <div>
          <label class="b-label">追溯码 / 产品名</label>
          <UInput v-model="filters.keyword" placeholder="输入追溯码或产品名称" icon="i-lucide-search" @keyup.enter="doSearch" />
        </div>
        <div>
          <label class="b-label">预警类型</label>
          <USelect v-model="filters.alertType" :items="ALERT_OPTIONS.map(o => ({ value: String(o.value), label: o.label }))" placeholder="全部类型" class="w-full" />
        </div>
        <div>
          <label class="b-label">处理状态</label>
          <USelect v-model="filters.status" :items="[{ value: '0', label: '待处理' }, { value: '1', label: '已核实合规' }, { value: '2', label: '已确认违规' }]" placeholder="全部状态" class="w-full" />
        </div>
        <div>
          <label class="b-label">触发日期起</label>
          <UInput v-model="filters.dateFrom" type="date" placeholder="触发起" />
        </div>
        <div>
          <label class="b-label">触发日期止</label>
          <UInput v-model="filters.dateTo" type="date" placeholder="触发止" />
        </div>
      </div>
      <div class="b-card-foot">
        <span class="b-card-extra">共 <span class="font-medium b-strong">{{ data?.total || 0 }}</span> 条预警</span>
        <div class="flex items-center gap-2">
          <UButton color="neutral" variant="solid" :loading="pending" @click="doSearch">查询</UButton>
          <UButton variant="outline" color="neutral" @click="resetSearch">重置</UButton>
        </div>
      </div>
    </div>

    <!-- 预警列表 -->
    <div class="b-card b-card-clip">
      <div class="b-card-head">
        <span class="b-card-title">预警列表</span>
        <span class="b-card-extra">每页 {{ pageSize }} 条 · 共 {{ data?.total || 0 }} 条</span>
      </div>
      <div class="b-scroll-x">
        <table class="b-table">
          <thead>
            <tr>
              <th>类型</th>
              <th>关联追溯码</th>
              <th>产品</th>
              <th>证据摘要</th>
              <th>触发时间</th>
              <th>累计</th>
              <th>处理状态</th>
              <th class="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in data?.rows || []" :key="r.id">
              <td>
                <span class="b-tag b-tag-danger">{{ r.alertTypeLabel }}</span>
              </td>
              <td><span class="font-code text-[13px] b-strong">{{ r.code || '-' }}</span></td>
              <td>{{ r.product_name || '-' }}</td>
              <td class="max-w-56 truncate text-xs text-[var(--b-text-muted)]" :title="JSON.stringify(r.evidence || '')">
                {{ r.evidence ? (r.evidence.queryCount ? '查询 ' + r.evidence.queryCount + ' 次' + (r.evidence.provinces ? '，跨 ' + r.evidence.provinces.join('、') : '') : r.evidence.expireDate ? '过期日 ' + r.evidence.expireDate : JSON.stringify(r.evidence).slice(0, 50)) : '-' }}
              </td>
              <td class="whitespace-nowrap">{{ String(r.trigger_time).slice(0, 19) }}</td>
              <td class="b-strong font-medium">{{ r.repeat_count }}</td>
              <td>
                <span class="b-tag" :class="STATUS_STYLE[String(r.handle_status)] || 'b-tag-default'">
                  {{ r.handleStatusLabel }}
                </span>
              </td>
              <td>
                <div class="b-actions">
                  <UButton v-if="Number(r.handle_status) === 0" variant="link" color="neutral" size="xs" @click="openHandle(r)">
                    处理
                  </UButton>
                  <span v-else class="text-xs text-[var(--b-text-muted)]">{{ r.handler_name || '-' }}</span>
                </div>
              </td>
            </tr>
            <tr v-if="!pending && !data?.rows?.length">
              <td colspan="8" class="b-empty">
                <div class="b-empty-inner">
                  <UIcon name="i-lucide-inbox" class="b-empty-icon h-8 w-8" />
                  <span class="text-sm">暂无符合条件的预警记录，请调整筛选条件后重试</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="data?.total" class="b-pager">
        <span class="b-card-extra">共 {{ data?.total || 0 }} 条 · 第 {{ data.page }} / {{ totalPages }} 页</span>
        <div class="flex items-center gap-2">
          <UButton variant="outline" color="neutral" size="sm" :disabled="page <= 1" @click="page--; refresh()">上一页</UButton>
          <UButton variant="outline" color="neutral" size="sm" :disabled="page >= totalPages" @click="page++; refresh()">下一页</UButton>
        </div>
      </div>
    </div>

    <!-- 处理对话框（Nuxt UI v4：v-model:open 绑定 open 状态，内容必须放 #content 插槽） -->
    <UModal v-model:open="showHandle">
      <template #content>
      <div class="b-modal">
        <!-- 弹窗头部：图标 + 标题 + 当前预警摘要 -->
        <div class="b-modal-head">
          <div class="b-modal-icon">
            <UIcon name="i-lucide-clipboard-check" class="h-4 w-4 text-[var(--b-text-regular)]" />
          </div>
          <div>
            <h3 class="b-modal-title">处理预警</h3>
            <p class="b-modal-sub">
              {{ current?.alertTypeLabel }} · {{ current?.code || '-' }}
            </p>
          </div>
        </div>
        <div class="b-modal-body">
          <!-- 处理结论：自绘单选卡片（Nuxt UI v4 无 URadio，保持自绘） -->
          <div class="space-y-2.5">
            <button type="button" class="flex w-full cursor-pointer items-center gap-2 rounded-sm border p-3 text-left text-sm transition-colors" :class="handleStatus === 1 ? 'border-[var(--b-text-strong)] bg-[var(--b-fill)]' : 'border-[var(--b-border)] hover:bg-[var(--b-fill)]'" @click="handleStatus = 1">
              <span class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border" :class="handleStatus === 1 ? 'border-[var(--b-text-strong)] bg-[var(--b-text-strong)] text-white' : 'border-[var(--b-border)]'">
                <UIcon v-if="handleStatus === 1" name="i-lucide-check" class="h-3 w-3" />
              </span>
              <span class="flex-1">
                <span class="font-medium text-[var(--b-text-strong)]">已核实（合规）</span>
                <span class="block text-xs text-[var(--b-text-muted)]">核实后确认无异常，预警关闭</span>
              </span>
            </button>
            <button type="button" class="flex w-full cursor-pointer items-center gap-2 rounded-sm border p-3 text-left text-sm transition-colors" :class="handleStatus === 2 ? 'border-[var(--b-text-strong)] bg-[var(--b-fill)]' : 'border-[var(--b-border)] hover:bg-[var(--b-fill)]'" @click="handleStatus = 2">
              <span class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border" :class="handleStatus === 2 ? 'border-[var(--b-text-strong)] bg-[var(--b-text-strong)] text-white' : 'border-[var(--b-border)]'">
                <UIcon v-if="handleStatus === 2" name="i-lucide-check" class="h-3 w-3" />
              </span>
              <span class="flex-1">
                <span class="font-medium text-[var(--b-text-strong)]">已确认违规</span>
                <span class="block text-xs text-[var(--b-text-muted)]">确认异常属实，可一键作废关联追溯码</span>
              </span>
            </button>
          </div>
          <!-- 违规时可同时作废关联追溯码（终态操作） -->
          <label v-if="handleStatus === 2" class="b-note items-center text-sm">
            <UCheckbox v-model="voidCode" color="neutral" />
            <span class="b-note-text">同时将关联追溯码标记为「已作废」（终态，不可恢复）</span>
          </label>
        </div>
        <div class="b-modal-foot">
          <UButton variant="outline" color="neutral" @click="showHandle = false">取消</UButton>
          <UButton color="neutral" variant="solid" :loading="handling" @click="submitHandle">确认处理</UButton>
        </div>
      </div>
      </template>
    </UModal>
  </div>
</template>