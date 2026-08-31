<script setup lang="ts">
// 数据概览仪表盘（PRD 5.2：统计卡片/状态分布/产品分布/30 天趋势/快捷入口；5.5.8：码库存预警）
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '数据概览' })

const { user, isPlatformAdmin } = useUser()
const { data: stats, error: statsError } = await useFetch<any>('/api/admin/stats', { key: 'admin-stats' })

// 状态分布条
const statusSegments = computed(() => {
  const s = stats.value?.statusDist || {}
  const generated = Number(s[1] || 0)
  const bound = Number(s[2] || 0)
  const total = generated + bound || 1
  return [
    { label: '已生成', count: generated, pct: Math.round(generated / total * 100), cls: 'bg-sky' },
    { label: '已绑定', count: bound, pct: Math.round(bound / total * 100), cls: 'bg-success' },
  ]
})

// 异常标记分布
const flagSegments = computed(() => {
  const f = stats.value?.flagDist || {}
  const normal = Number(f[0] || 0)
  const frozen = Number(f[1] || 0)
  const voided = Number(f[2] || 0)
  return [
    { label: '正常', count: normal, cls: 'text-success' },
    { label: '已冻结', count: frozen, cls: 'text-warning' },
    { label: '已作废', count: voided, cls: 'text-error' },
  ]
})

const cards = computed(() => [
  { label: '累计追溯码', value: stats.value?.totalCodes ?? '--', icon: 'i-lucide-qr-code', color: 'text-primary', bg: 'bg-primary/10' },
  { label: '今日新增', value: stats.value?.todayCodes ?? '--', icon: 'i-lucide-plus-circle', color: 'text-sky', bg: 'bg-sky/10' },
  { label: '累计扫码', value: stats.value?.totalScans ?? '--', icon: 'i-lucide-eye', color: 'text-success', bg: 'bg-success/10' },
  { label: '今日扫码', value: stats.value?.todayScans ?? '--', icon: 'i-lucide-eye-off', color: 'text-info', bg: 'bg-info/10' },
  { label: '待处理异常', value: stats.value?.abnormalCodes ?? '--', icon: 'i-lucide-shield-alert', color: 'text-warning', bg: 'bg-warning/10' },
  { label: '待处理预警', value: stats.value?.pendingAlerts ?? '--', icon: 'i-lucide-bell-ring', color: 'text-error', bg: 'bg-error/10' },
])

// 快捷入口（PRD 5.2 P2）
const quickLinks = [
  { label: '生产采集', to: '/admin/collection', icon: 'i-lucide-upload-cloud', color: 'text-primary' },
  { label: '追溯码生成', to: '/admin/generator', icon: 'i-lucide-qr-code', color: 'text-success' },
  { label: '码库管理', to: '/admin/codes', icon: 'i-lucide-database', color: 'text-sky' },
  { label: '产品管理', to: '/admin/products', icon: 'i-lucide-package', color: 'text-warning' },
  { label: '生产批次', to: '/admin/batches', icon: 'i-lucide-layers', color: 'text-info' },
  { label: '扫码统计', to: '/admin/statistics', icon: 'i-lucide-bar-chart-3', color: 'text-purple' },
  { label: '风险预警', to: '/admin/alerts', icon: 'i-lucide-shield-alert', color: 'text-error' },
  { label: '消息中心', to: '/admin/messages', icon: 'i-lucide-bell', color: 'text-emerald' },
]

// 近 30 天扫码趋势折线图（SVG 自绘：面积渐变 + 折线 + 数据点 + 轴刻度）
const trend = computed(() => stats.value?.scanTrend || [])
const trendMax = computed(() => Math.max(1, ...trend.value.map((t: any) => Number(t.count))))
const CHART_W = 640
const CHART_H = 200
const PAD = { l: 36, r: 12, t: 12, b: 26 }
// 折线点坐标：x 均匀分布，y 按最大值归一化
const trendPoints = computed(() => {
  const n = trend.value.length
  if (!n) return []
  const innerW = CHART_W - PAD.l - PAD.r
  const innerH = CHART_H - PAD.t - PAD.b
  return trend.value.map((t: any, i: number) => {
    const x = PAD.l + (n === 1 ? innerW / 2 : i / (n - 1) * innerW)
    const y = PAD.t + innerH - (Number(t.count) / trendMax.value) * innerH
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }
  })
})
const trendLine = computed(() => trendPoints.value.map(p => p.x + ',' + p.y).join(' '))
const trendArea = computed(() => {
  const pts = trendPoints.value
  if (!pts.length) return ''
  const bottom = CHART_H - PAD.b
  return PAD.l + ',' + bottom + ' ' + trendLine.value + ' ' + pts[pts.length - 1].x + ',' + bottom
})
// x 轴日期刻度：每 5 天显示一个
const trendXTicks = computed(() => trend.value.map((t: any, i: number) => ({
  label: String(t.date).slice(5),
  show: i % 5 === 0 || i === trend.value.length - 1,
  x: trendPoints.value[i]?.x || 0,
})))
// y 轴刻度：0 与最大值
const trendYTicks = computed(() => [{ v: 0, y: CHART_H - PAD.b }, { v: trendMax.value, y: PAD.t }])

// 码库存预警（PRD 5.5.8）：可用码低于阈值标红；作废占比超 10% 告警
const stockAlerts = computed(() => stats.value?.stockAlerts || [])
const stockThreshold = computed(() => Number(stats.value?.stockThreshold ?? 10000))
const pct = (n: number) => Math.round(n * 100) + '%'
</script>

<template>
  <div class="space-y-6">
    <div v-if="statsError" class="rounded-xl border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">
      统计数据加载失败，请刷新重试
    </div>
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold text-default">数据概览</h1>
        <p class="mt-1 text-sm text-muted">
          {{ isPlatformAdmin ? '平台全局数据' : '本企业数据' }} · {{ user?.name || user?.username }}
        </p>
      </div>
    </div>

    <!-- 快捷入口（PRD 5.2 P2） -->
    <div class="grid grid-cols-4 gap-3 lg:grid-cols-8">
      <NuxtLink v-for="l in quickLinks" :key="l.to" :to="l.to"
        class="group flex flex-col items-center gap-1.5 rounded-xl border border-border bg-elevated py-3 text-xs text-muted shadow-sm transition hover:border-primary/40 hover:text-default">
        <UIcon :name="l.icon" class="h-5 w-5 transition group-hover:scale-110" :class="l.color" />
        {{ l.label }}
      </NuxtLink>
    </div>

    <!-- 统计卡片 -->
    <div class="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
      <div v-for="c in cards" :key="c.label" class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
        <div class="flex items-center gap-2 text-muted">
          <span class="flex h-8 w-8 items-center justify-center rounded-full" :class="c.bg">
            <UIcon :name="c.icon" class="h-4 w-4" :class="c.color" />
          </span>
          <span class="text-xs">{{ c.label }}</span>
        </div>
        <div class="mt-2 text-2xl font-bold" :class="c.color">{{ c.value }}</div>
      </div>
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      <!-- 码状态分布 -->
      <div class="rounded-xl border border-border bg-elevated p-5 shadow-sm">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-default">码状态分布</h2>
          <span class="text-xs text-muted">已生成 → 已绑定（两状态模型）</span>
        </div>
        <div class="flex h-3 overflow-hidden rounded-full bg-muted">
          <div v-for="s in statusSegments" :key="s.label" class="h-full transition-all" :class="s.cls" :style="{ width: s.pct + '%' }" />
        </div>
        <div class="mt-4 grid grid-cols-2 gap-3">
          <div v-for="s in statusSegments" :key="s.label" class="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm">
            <span class="flex items-center gap-1.5 text-muted">
              <span class="h-2 w-2 rounded-full" :class="s.cls" />
              {{ s.label }}
            </span>
            <span class="font-bold text-default">{{ s.count }}（{{ s.pct }}%）</span>
          </div>
        </div>
      </div>

      <!-- 异常标记分布 -->
      <div class="rounded-xl border border-border bg-elevated p-5 shadow-sm">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-default">异常标记分布</h2>
          <span class="text-xs text-muted">与码状态正交</span>
        </div>
        <div class="grid grid-cols-3 gap-3">
          <div v-for="f in flagSegments" :key="f.label" class="rounded-lg border border-border/60 p-3 text-center">
            <div class="text-xl font-bold" :class="f.cls">{{ f.count }}</div>
            <div class="mt-1 text-xs text-muted">{{ f.label }}</div>
          </div>
        </div>
        <div class="mt-4 rounded-lg bg-muted/40 p-3 text-xs text-muted">
          已冻结/已作废的码不可绑定与修改；作废为终态，扫码页提示"该追溯码已作废，请勿购买"
        </div>
      </div>

      <!-- 产品分布 -->
      <div class="rounded-xl border border-border bg-elevated p-5 shadow-sm">
        <h2 class="mb-4 text-sm font-semibold text-default">产品追溯码分布（Top 10）</h2>
        <div v-if="!stats?.productDist?.length" class="py-8 text-center text-sm text-muted">暂无数据</div>
        <div v-else class="space-y-3">
          <div v-for="p in stats.productDist" :key="p.name" class="flex items-center gap-3 text-sm">
            <span class="w-40 truncate text-muted">{{ p.name }}</span>
            <div class="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div class="h-full rounded-full bg-primary" :style="{ width: Math.round(p.count / stats.productDist[0].count * 100) + '%' }" />
            </div>
            <span class="w-16 text-right font-medium text-default">{{ p.count }}</span>
          </div>
        </div>
      </div>

      <!-- 近 30 天扫码趋势（折线图） -->
      <div class="rounded-xl border border-border bg-elevated p-5 shadow-sm">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-default">近 30 天扫码趋势</h2>
          <span class="text-xs text-muted">按日统计，折线图</span>
        </div>
        <div v-if="!trend.length" class="py-8 text-center text-sm text-muted">暂无扫码数据</div>
        <div v-else>
          <svg :viewBox="`0 0 ${CHART_W} ${CHART_H}`" class="w-full">
            <!-- 网格线（3 等分水平线） -->
            <line v-for="i in 3" :key="i" :x1="PAD.l" :x2="CHART_W - PAD.r"
              :y1="PAD.t + (CHART_H - PAD.t - PAD.b) / 4 * i" :y2="PAD.t + (CHART_H - PAD.t - PAD.b) / 4 * i"
              class="stroke-border" stroke-width="1" stroke-dasharray="4 4" />
            <!-- 面积渐变 -->
            <defs>
              <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="hsl(142 32% 30%)" stop-opacity="0.25" />
                <stop offset="100%" stop-color="hsl(142 32% 30%)" stop-opacity="0.02" />
              </linearGradient>
            </defs>
            <polygon :points="trendArea" fill="url(#trendGrad)" />
            <polyline :points="trendLine" fill="none" class="stroke-primary" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            <!-- 数据点 -->
            <circle v-for="(p, i) in trendPoints" :key="i" :cx="p.x" :cy="p.y" r="2.5" fill="hsl(142 32% 30%)" />
            <!-- y 轴刻度 -->
            <text v-for="t in trendYTicks" :key="t.v" :x="PAD.l - 6" :y="t.y + 3" text-anchor="end" class="fill-muted text-[10px]">{{ t.v }}</text>
            <!-- x 轴日期刻度（每 5 天显示） -->
            <text v-for="t in trendXTicks" v-show="t.show" :key="t.label + t.x" :x="t.x" :y="CHART_H - 8" text-anchor="middle" class="fill-muted text-[10px]">{{ t.label }}</text>
          </svg>
        </div>
      </div>

      <!-- 码库存预警（PRD 5.5.8） -->
      <div class="rounded-xl border border-border bg-elevated p-5 shadow-sm">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-default">码库存预警</h2>
          <span class="text-xs text-muted">可用码阈值 {{ stockThreshold }} · 作废占比 &gt; 10%</span>
        </div>
        <div v-if="!stockAlerts.length" class="py-8 text-center text-sm text-muted">库存正常，暂无预警</div>
        <div v-else class="space-y-2">
          <div v-for="a in stockAlerts" :key="a.name"
            class="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-sm">
            <span class="w-40 truncate text-default">{{ a.name }}</span>
            <span class="text-muted">可用 {{ a.generated }} / 共 {{ a.total }}</span>
            <span class="flex items-center gap-1.5">
              <span v-if="a.lowStock" class="rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">低库存</span>
              <span v-if="a.voidAbnormal" class="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">作废占比 {{ pct(a.voidRatio) }}</span>
            </span>
          </div>
        </div>
        <div class="mt-4 rounded-lg bg-muted/40 p-3 text-xs text-muted">
          可用码（已生成）低于阈值时标红提醒及时补码；作废占比超 10% 时提示排查印刷/采集环节问题
        </div>
      </div>
    </div>
  </div>
</template>
