<script setup lang="ts">
// 数据概览仪表盘（PRD 5.2）
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

// 近 7 天扫码趋势（简单条形图）
const trendMax = computed(() => Math.max(1, ...(stats.value?.scanTrend || []).map((t: any) => Number(t.count))))
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

      <!-- 扫码趋势 -->
      <div class="rounded-xl border border-border bg-elevated p-5 shadow-sm">
        <h2 class="mb-4 text-sm font-semibold text-default">近 7 天扫码趋势</h2>
        <div v-if="!stats?.scanTrend?.length" class="py-8 text-center text-sm text-muted">暂无扫码数据</div>
        <div v-else class="flex h-40 items-end gap-2">
          <div v-for="t in stats.scanTrend" :key="t.date" class="flex flex-1 flex-col items-center gap-1">
            <span class="text-xs font-medium text-default">{{ t.count }}</span>
            <div class="w-full rounded-t-md bg-primary/80" :style="{ height: Math.max(4, Math.round(t.count / trendMax * 120)) + 'px' }" />
            <span class="text-[10px] text-muted">{{ t.date.slice(5) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
