<script setup lang="ts">
// 数据概览仪表盘（PRD 5.2：统计卡片/状态分布/产品分布/30 天趋势；5.5.8：码库存预警；快捷入口板块已按用户要求下线）
// Keep-Alive 页面缓存：左侧菜单切换后返回保留页面状态（表单/筛选/页码/预览）；刷新、退出登录自动清空；页内【重置】恢复初始
definePageMeta({ layout: 'admin', middleware: 'backend-guard', keepalive: true })
useHead({ title: '数据概览' })

const { user, isPlatformAdmin } = useUser()
const { data: stats, error: statsError, refresh: refreshStats } = await useFetch<any>('/api/admin/stats', { key: 'admin-stats' })

// Keep-Alive 激活刷新：数据概览无表单/筛选类用户状态，从左侧菜单切回时静默拉取最新统计
// （保留的是页面视图本身；首次进入/刷新后由 useFetch 已取数，跳过避免重复请求）
let statsActivatedOnce = false
onActivated(() => {
  if (!statsActivatedOnce) { statsActivatedOnce = true; return }
  refreshStats()
})

// 状态分布条
const statusSegments = computed(() => {
  const s = stats.value?.statusDist || {}
  const generated = Number(s[1] || 0)
  const bound = Number(s[2] || 0)
  const total = generated + bound || 1
  return [
    { label: '已生成', count: generated, pct: Math.round(generated / total * 100), cls: 'bg-[var(--b-text-disabled)]' },
    { label: '已绑定', count: bound, pct: Math.round(bound / total * 100), cls: 'bg-primary' },
  ]
})

// 异常标记分布
const flagSegments = computed(() => {
  const f = stats.value?.flagDist || {}
  const normal = Number(f[0] || 0)
  const frozen = Number(f[1] || 0)
  const voided = Number(f[2] || 0)
  return [
    { label: '正常', count: normal, cls: 'b-tag-success' },
    { label: '已冻结', count: frozen, cls: 'b-tag-warning' },
    { label: '已作废', count: voided, cls: 'b-tag-danger' },
  ]
})

const cards = computed(() => [
  { label: '累计追溯码', value: stats.value?.totalCodes ?? '--', icon: 'i-lucide-qr-code', color: 'text-[var(--b-text-regular)]', bg: 'bg-[var(--b-fill)]' },
  { label: '今日新增', value: stats.value?.todayCodes ?? '--', icon: 'i-lucide-plus-circle', color: 'text-[var(--b-text-regular)]', bg: 'bg-[var(--b-fill)]' },
  { label: '累计扫码', value: stats.value?.totalScans ?? '--', icon: 'i-lucide-eye', color: 'text-[var(--b-text-regular)]', bg: 'bg-[var(--b-fill)]' },
  { label: '今日扫码', value: stats.value?.todayScans ?? '--', icon: 'i-lucide-eye-off', color: 'text-[var(--b-text-regular)]', bg: 'bg-[var(--b-fill)]' },
  { label: '待处理异常', value: stats.value?.abnormalCodes ?? '--', icon: 'i-lucide-shield-alert', color: 'text-amber-600', bg: 'bg-[var(--b-fill)]' },
  { label: '待处理预警', value: stats.value?.pendingAlerts ?? '--', icon: 'i-lucide-bell-ring', color: 'text-red-600', bg: 'bg-[var(--b-fill)]' },
])

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
  <div class="space-y-4">
    <!-- 数据加载失败提示 -->
    <div v-if="statsError" class="b-card b-card-body text-sm text-red-600">
      统计数据加载失败，请刷新重试
    </div>

    <!-- 页面标题区 -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="b-page-title">数据概览</h1>
        <p class="b-page-desc">
          {{ isPlatformAdmin ? '平台全局数据' : '本企业数据' }} · {{ user?.name || user?.username }}
        </p>
      </div>
    </div>

    <!-- 核心指标卡（PRD 5.2） -->
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <div v-for="c in cards" :key="c.label" class="b-stat">
        <div class="b-stat-label">
          <span class="flex h-5 w-5 items-center justify-center rounded" :class="c.bg">
            <UIcon :name="c.icon" class="h-3.5 w-3.5" :class="c.color" />
          </span>
          <span>{{ c.label }}</span>
        </div>
        <div class="b-stat-value">{{ c.value }}</div>
      </div>
    </div>

    <!-- 近 30 天扫码趋势（SVG 折线图：绘制逻辑与坐标计算保持不变，仅调整卡片外壳与文字色） -->
    <div class="b-card">
      <div class="b-card-head">
        <span class="b-card-title">近 30 天扫码趋势</span>
        <span class="b-card-extra">按日统计 · 折线图</span>
      </div>
      <div class="b-card-body">
        <div v-if="!trend.length" class="b-empty">
          <div class="b-empty-inner">
            <UIcon name="i-lucide-inbox" class="b-empty-icon h-8 w-8" />
            <span class="text-sm">暂无扫码数据</span>
          </div>
        </div>
        <div v-else>
          <svg :viewBox="`0 0 ${CHART_W} ${CHART_H}`" class="w-full">
            <!-- 网格线（3 等分水平线） -->
            <line v-for="i in 3" :key="i" :x1="PAD.l" :x2="CHART_W - PAD.r"
              :y1="PAD.t + (CHART_H - PAD.t - PAD.b) / 4 * i" :y2="PAD.t + (CHART_H - PAD.t - PAD.b) / 4 * i"
              class="stroke-[var(--b-divider)]" stroke-width="1" stroke-dasharray="4 4" />
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
            <text v-for="t in trendYTicks" :key="t.v" :x="PAD.l - 6" :y="t.y + 3" text-anchor="end" class="fill-[var(--b-text-muted)] text-[10px]">{{ t.v }}</text>
            <!-- x 轴日期刻度（每 5 天显示） -->
            <text v-for="t in trendXTicks" v-show="t.show" :key="t.label + t.x" :x="t.x" :y="CHART_H - 8" text-anchor="middle" class="fill-[var(--b-text-muted)] text-[10px]">{{ t.label }}</text>
          </svg>
        </div>
      </div>
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <!-- 码状态分布 -->
      <div class="b-card">
        <div class="b-card-head">
          <span class="b-card-title">码状态分布</span>
          <span class="b-card-extra">已生成 → 已绑定（两状态模型）</span>
        </div>
        <div class="b-card-body">
          <div class="flex h-2 overflow-hidden rounded bg-[var(--b-fill)]">
            <div v-for="s in statusSegments" :key="s.label" class="h-full transition-all" :class="s.cls" :style="{ width: s.pct + '%' }" />
          </div>
          <div class="mt-4 grid grid-cols-2 gap-3">
            <div v-for="s in statusSegments" :key="s.label" class="flex items-center justify-between rounded border border-[var(--b-border)] px-3 py-2 text-sm">
              <span class="flex items-center gap-1.5 text-[var(--b-text-muted)]">
                <span class="h-2 w-2 rounded-full" :class="s.cls" />
                {{ s.label }}
              </span>
              <span class="font-medium b-strong">{{ s.count }}（{{ s.pct }}%）</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 异常标记分布 -->
      <div class="b-card">
        <div class="b-card-head">
          <span class="b-card-title">异常标记分布</span>
          <span class="b-card-extra">与码状态正交</span>
        </div>
        <div class="b-card-body">
          <div class="grid grid-cols-3 gap-3">
            <div v-for="f in flagSegments" :key="f.label" class="rounded border border-[var(--b-border)] p-3 text-center">
              <div class="text-xl font-semibold text-[var(--b-text-title)]">{{ f.count }}</div>
              <div class="mt-1.5"><span class="b-tag" :class="f.cls">{{ f.label }}</span></div>
            </div>
          </div>
          <div class="b-note mt-3">
            <UIcon name="i-lucide-info" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--b-text-muted)]" />
            <p class="b-note-text">已冻结/已作废的码不可绑定与修改；作废为终态，扫码页提示"该追溯码已作废，请勿购买"</p>
          </div>
        </div>
      </div>

      <!-- 产品分布 -->
      <div class="b-card">
        <div class="b-card-head">
          <span class="b-card-title">产品追溯码分布</span>
          <span class="b-card-extra">Top 10</span>
        </div>
        <div class="b-card-body">
          <div v-if="!stats?.productDist?.length" class="b-empty">
            <div class="b-empty-inner">
              <UIcon name="i-lucide-inbox" class="b-empty-icon h-8 w-8" />
              <span class="text-sm">暂无产品分布数据</span>
            </div>
          </div>
          <div v-else class="space-y-3">
            <div v-for="p in stats.productDist" :key="p.name" class="flex items-center gap-3 text-sm">
              <span class="w-40 truncate text-[var(--b-text-regular)]">{{ p.name }}</span>
              <div class="h-2 flex-1 overflow-hidden rounded bg-[var(--b-fill)]">
                <div class="h-full rounded bg-primary" :style="{ width: Math.round(p.count / stats.productDist[0].count * 100) + '%' }" />
              </div>
              <span class="w-16 text-right font-medium b-strong">{{ p.count }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 码库存预警（PRD 5.5.8） -->
      <div class="b-card b-card-clip">
        <div class="b-card-head">
          <span class="b-card-title">码库存预警</span>
          <span class="b-card-extra">可用码阈值 {{ stockThreshold }} · 作废占比 &gt; 10%</span>
        </div>
        <div v-if="!stockAlerts.length" class="b-empty">
          <div class="b-empty-inner">
            <UIcon name="i-lucide-inbox" class="b-empty-icon h-8 w-8" />
            <span class="text-sm">库存正常，暂无预警</span>
          </div>
        </div>
        <div v-else class="b-scroll-x">
          <table class="b-table">
            <thead>
              <tr>
                <th>产品</th>
                <th>可用码 / 总量</th>
                <th class="text-right">预警项</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in stockAlerts" :key="a.name">
                <td class="b-strong font-medium">{{ a.name }}</td>
                <td>{{ a.generated }} / {{ a.total }}</td>
                <td class="text-right">
                  <span v-if="a.lowStock" class="b-tag b-tag-danger">低库存</span>
                  <span v-if="a.voidAbnormal" class="b-tag b-tag-warning ml-1.5">作废占比 {{ pct(a.voidRatio) }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="b-card-foot">
          <span class="b-card-extra">可用码（已生成）低于阈值时提醒及时补码；作废占比超 10% 时提示排查印刷/采集环节问题</span>
        </div>
      </div>
    </div>
  </div>
</template>
