<script setup lang="ts">
// 成本分析页（公众端 /bill/analysis）—— 2026-09-23 新增，见 docs/handover/29 号
//
// 三块内容：
//   ① 时间维度切换（本月 / 本季 / 本年）→ 决定区间总额、类别分布、作物分布的口径
//   ② 12 个月柱状图 → **始终展示所选年份的全年走势**，并把当前区间覆盖的月份高亮
//      （不随维度切换而变形状，否则用户每次切换都失去"全年对比"这个参照系）
//   ③ 类别分布（环形图）+ 作物维度（横向条形）
//
// ⚠️ 环形图的输入必须是**后端返回的全部 6 个类别（含金额为 0 的项）**：
//    BillPieChart 按原始索引取色，若前端先过滤掉 0 会让颜色整体错位（见该组件头部注释）。
const range = ref<'month' | 'quarter' | 'year'>('month')

const TABS: { value: 'month' | 'quarter' | 'year'; label: string }[] = [
  { value: 'month', label: '本月' },
  { value: 'quarter', label: '本季' },
  { value: 'year', label: '本年' },
]

const { data: meData } = await useFetch<any>('/api/consumer/me', { key: 'consumer-me' })
const loggedIn = computed(() => !!meData.value?.loggedIn)

// ⚠️ `refresh` 必须取自本页这个 useFetch：解构错对象会让「登录后自动加载」静默失效
//    （拿到的会是刷新 me 的那个 refresh，分析数据永远不加载，且不报任何错）
const { data, pending, refresh } = await useFetch<any>('/api/bill/analysis', {
  key: 'bill-analysis',
  query: computed(() => ({ range: range.value })),
  immediate: loggedIn.value,
})
watch(loggedIn, (v) => { if (v) refresh() })

const fmtMoney = (n: any) => (Number(n) || 0).toFixed(2)

/** 类别图数据：全量 6 项（含 0），保证颜色索引稳定 */
const pieData = computed(() =>
  (data.value?.byCategory || []).map((c: any) => ({ label: c.category, amount: c.amount })),
)

/** 作物条形的最大值（用于算百分比宽度） */
const cropMax = computed(() => {
  const list = data.value?.byCrop || []
  return list.length ? Math.max(...list.map((c: any) => Number(c.amount) || 0)) : 0
})
const cropPct = (amount: any) => {
  if (!cropMax.value) return 0
  // 最小值给 3%，避免金额极小的作物条形完全看不见
  return Math.max(3, Math.round(((Number(amount) || 0) / cropMax.value) * 100))
}

useHead({ title: '成本分析 - 农资315' })
</script>

<template>
  <div class="pb-6">
    <PageHeader title="成本分析" :show-back="true" />

    <div class="space-y-4 px-4 pt-4 lg:mx-auto lg:w-full lg:max-w-2xl lg:pt-6">
      <!-- 未登录 -->
      <div v-if="!loggedIn" class="rounded-2xl border border-border bg-elevated p-6 text-center shadow-sm">
        <UIcon name="i-lucide-lock" class="mx-auto h-10 w-10 text-muted/50" />
        <p class="mt-2 text-sm text-muted">需要登录后才能查看成本分析</p>
        <UButton class="mt-4" to="/bill">去登录 / 查看账本</UButton>
      </div>

      <template v-else>
        <!-- 时间维度切换 -->
        <div class="flex gap-1 rounded-xl border border-border bg-elevated p-1">
          <button
            v-for="t in TABS"
            :key="t.value"
            type="button"
            class="flex-1 rounded-lg py-2 text-sm transition-colors"
            :class="range === t.value ? 'bg-primary font-medium text-white' : 'text-muted hover:text-default'"
            @click="range = t.value"
          >
            {{ t.label }}
          </button>
        </div>

        <!-- 区间摘要 -->
        <div class="rounded-2xl border border-border bg-elevated p-4 shadow-sm">
          <div class="flex items-center justify-between">
            <span class="text-sm text-muted">{{ data?.label || '—' }}</span>
            <span class="text-xs text-muted">覆盖作物 {{ data?.cropCount || 0 }} 种</span>
          </div>
          <div class="mt-1 text-3xl font-bold text-default">¥{{ fmtMoney(data?.total) }}</div>
          <div class="mt-0.5 text-xs text-muted">共 {{ (data?.byCategory || []).reduce((s: number, c: any) => s + (c.count || 0), 0) }} 笔花费</div>
        </div>

        <!-- 12 个月柱状图 -->
        <div class="rounded-2xl border border-border bg-elevated p-4 shadow-sm">
          <div class="mb-2 flex items-center gap-2 text-sm font-semibold text-default">
            <UIcon name="i-lucide-chart-column" class="h-4 w-4 text-primary" />
            {{ data?.year || '' }} 年各月花费
          </div>
          <BillBarChart :data="data?.monthly || []" :highlight="data?.highlightMonths || []" :height="180" />
        </div>

        <!-- 类别分布 -->
        <div class="rounded-2xl border border-border bg-elevated p-4 shadow-sm">
          <div class="mb-3 flex items-center gap-2 text-sm font-semibold text-default">
            <UIcon name="i-lucide-pie-chart" class="h-4 w-4 text-primary" />
            类别分布
          </div>
          <BillPieChart :data="pieData" :height="140" />
        </div>

        <!-- 作物维度 -->
        <div class="rounded-2xl border border-border bg-elevated p-4 shadow-sm">
          <div class="mb-3 flex items-center gap-2 text-sm font-semibold text-default">
            <UIcon name="i-lucide-sprout" class="h-4 w-4 text-primary" />
            作物维度
          </div>
          <div v-if="data?.byCrop?.length" class="space-y-3">
            <div v-for="c in data.byCrop" :key="c.crop" class="space-y-1">
              <div class="flex items-center justify-between text-sm">
                <span class="truncate text-default">{{ c.crop }}</span>
                <span class="shrink-0 font-medium text-default">¥{{ fmtMoney(c.amount) }}</span>
              </div>
              <div class="h-2 overflow-hidden rounded-full bg-muted">
                <div class="h-full rounded-full bg-primary" :style="{ width: cropPct(c.amount) + '%' }" />
              </div>
            </div>
          </div>
          <p v-else-if="!pending" class="text-xs text-muted">
            还没有记录作物的花费。记账时填上「作物」，这里就会按作物汇总。
          </p>
        </div>
      </template>
    </div>
  </div>
</template>
