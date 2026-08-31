<script setup lang="ts">
// 扫码统计（PRD 5.10）
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '扫码统计' })

const filters = reactive({ keyword: '', province: '', dateFrom: '', dateTo: '' })
const page = ref(1)
const pageSize = 20

const { data, pending, refresh } = await useFetch<any>('/api/admin/statistics', {
  key: 'admin-statistics',
  query: computed(() => ({
    keyword: filters.keyword || undefined,
    province: filters.province || undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    page: page.value, pageSize,
  })),
})

const totalPages = computed(() => Math.max(1, Math.ceil((data.value?.detail?.total || 0) / pageSize)))

// 趋势图（近 30 天，条形）
const trendMax = computed(() => Math.max(1, ...(data.value?.trend || []).map((t: any) => Number(t.count))))
// 24 小时分布
const hourMax = computed(() => Math.max(1, ...(data.value?.hourDist || []).map((t: any) => Number(t.count))))
const hourLabels = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00')

const doSearch = () => { page.value = 1; refresh() }
const resetSearch = () => { filters.keyword = ''; filters.province = ''; filters.dateFrom = ''; filters.dateTo = ''; page.value = 1; refresh() }
</script>

<template>
  <div class="space-y-5">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold text-default">扫码统计</h1>
        <p class="mt-1 text-sm text-muted">消费者扫码查询数据分析（扫码不改变码状态，仅记录日志）</p>
      </div>
    </div>

    <!-- 统计卡 -->
    <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <div class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
        <div class="flex items-center gap-2 text-muted">
          <span class="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary"><UIcon name="i-lucide-eye" class="h-4 w-4" /></span>
          <span class="text-xs">累计扫码</span>
        </div>
        <div class="mt-2 text-2xl font-bold text-primary">{{ data?.totalScans ?? '--' }}</div>
      </div>
      <div class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
        <div class="flex items-center gap-2 text-muted">
          <span class="flex h-8 w-8 items-center justify-center rounded-full bg-sky/10 text-sky"><UIcon name="i-lucide-calendar-check" class="h-4 w-4" /></span>
          <span class="text-xs">今日扫码</span>
        </div>
        <div class="mt-2 text-2xl font-bold text-sky">{{ data?.todayScans ?? '--' }}</div>
      </div>
      <div class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
        <div class="flex items-center gap-2 text-muted">
          <span class="flex h-8 w-8 items-center justify-center rounded-full bg-success/10 text-success"><UIcon name="i-lucide-boxes" class="h-4 w-4" /></span>
          <span class="text-xs">涉及产品</span>
        </div>
        <div class="mt-2 text-2xl font-bold text-success">{{ data?.productDist?.length ?? '--' }}</div>
      </div>
      <div class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
        <div class="flex items-center gap-2 text-muted">
          <span class="flex h-8 w-8 items-center justify-center rounded-full bg-warning/10 text-warning"><UIcon name="i-lucide-map-pin" class="h-4 w-4" /></span>
          <span class="text-xs">涉及地区</span>
        </div>
        <div class="mt-2 text-2xl font-bold text-warning">{{ data?.regionDist?.length ?? '--' }}</div>
      </div>
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      <!-- 近 30 天趋势 -->
      <div class="rounded-xl border border-border bg-elevated p-5 shadow-sm">
        <h2 class="mb-4 text-sm font-semibold text-default">近 30 天扫码趋势</h2>
        <div v-if="!data?.trend?.length" class="py-8 text-center text-sm text-muted">暂无扫码数据</div>
        <div v-else class="flex h-40 items-end gap-0.5">
          <div v-for="t in data.trend" :key="t.date" class="group relative flex flex-1 flex-col items-center justify-end">
            <span class="pointer-events-none absolute -top-6 hidden whitespace-nowrap rounded bg-muted px-1.5 py-0.5 text-[10px] group-hover:block">{{ t.date.slice(5) }}:{{ t.count }}</span>
            <div class="w-full rounded-t-sm bg-primary/70" :style="{ height: Math.max(2, Math.round(t.count / trendMax * 130)) + 'px' }" />
          </div>
        </div>
      </div>

      <!-- 24 小时分布 -->
      <div class="rounded-xl border border-border bg-elevated p-5 shadow-sm">
        <h2 class="mb-4 text-sm font-semibold text-default">扫码时段分布（24 小时）</h2>
        <div v-if="!data?.hourDist?.length" class="py-8 text-center text-sm text-muted">暂无扫码数据</div>
        <div v-else class="flex h-40 items-end gap-0.5">
          <div v-for="h in data.hourDist" :key="h.hour" class="flex flex-1 flex-col items-center justify-end">
            <div class="w-full rounded-t-sm bg-sky/70" :style="{ height: Math.max(2, Math.round(h.count / hourMax * 130)) + 'px' }" />
            <span class="mt-1 text-[9px] text-muted">{{ h.hour }}</span>
          </div>
        </div>
      </div>

      <!-- 产品分布 -->
      <div class="rounded-xl border border-border bg-elevated p-5 shadow-sm">
        <h2 class="mb-4 text-sm font-semibold text-default">产品扫码分布（Top 10）</h2>
        <div v-if="!data?.productDist?.length" class="py-8 text-center text-sm text-muted">暂无扫码数据</div>
        <div v-else class="space-y-3">
          <div v-for="p in data.productDist" :key="p.name" class="flex items-center gap-3 text-sm">
            <span class="w-44 truncate text-muted">{{ p.name }}</span>
            <div class="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div class="h-full rounded-full bg-primary" :style="{ width: Math.round(p.count / data.productDist[0].count * 100) + '%' }" />
            </div>
            <span class="w-16 text-right font-medium text-default">{{ p.count }}</span>
          </div>
        </div>
      </div>

      <!-- 地区分布 -->
      <div class="rounded-xl border border-border bg-elevated p-5 shadow-sm">
        <h2 class="mb-4 text-sm font-semibold text-default">扫码地区分布（Top 10）</h2>
        <div v-if="!data?.regionDist?.length" class="py-8 text-center text-sm text-muted">暂无扫码数据（IP 归属地接入后展示）</div>
        <div v-else class="space-y-3">
          <div v-for="r in data.regionDist" :key="r.name" class="flex items-center gap-3 text-sm">
            <span class="w-20 text-muted">{{ r.name || '未知' }}</span>
            <div class="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div class="h-full rounded-full bg-warning" :style="{ width: Math.round(r.count / data.regionDist[0].count * 100) + '%' }" />
            </div>
            <span class="w-16 text-right font-medium text-default">{{ r.count }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 扫码明细 -->
    <div class="overflow-hidden rounded-xl border border-border bg-elevated shadow-sm">
      <div class="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <span class="text-sm font-semibold text-default">扫码明细</span>
        <span class="text-xs text-muted">共 {{ data?.detail?.total || 0 }} 条</span>
      </div>
      <div class="border-b border-border/60 bg-muted/20 px-4 py-3">
        <div class="grid gap-3 md:grid-cols-5">
          <UInput v-model="filters.keyword" placeholder="追溯码 / 产品名" icon="i-lucide-search" @keyup.enter="doSearch" />
          <UInput v-model="filters.province" placeholder="省份" @keyup.enter="doSearch" />
          <UInput v-model="filters.dateFrom" type="date" placeholder="起" />
          <UInput v-model="filters.dateTo" type="date" placeholder="止" />
          <div class="flex gap-2">
            <UButton color="primary" size="sm" icon="i-lucide-search" :loading="pending" @click="doSearch">查询</UButton>
            <UButton variant="outline" color="neutral" size="sm" icon="i-lucide-rotate-ccw" @click="resetSearch">重置</UButton>
          </div>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-border/60 bg-muted/30 text-xs text-muted">
              <th class="px-4 py-3 font-medium">扫码时间</th>
              <th class="px-4 py-3 font-medium">追溯码</th>
              <th class="px-4 py-3 font-medium">产品</th>
              <th class="px-4 py-3 font-medium">地区</th>
              <th class="px-4 py-3 font-medium">店铺</th>
              <th class="px-4 py-3 font-medium">价格</th>
              <th class="px-4 py-3 font-medium">设备</th>
              <th class="px-4 py-3 font-medium">主体</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in data?.detail?.rows || []" :key="r.id" class="border-b border-border/40 transition-colors hover:bg-muted/30">
              <td class="px-4 py-3 text-muted">{{ String(r.scan_time).slice(0, 19) }}</td>
              <td class="px-4 py-3 font-code text-xs">{{ r.code }}</td>
              <td class="px-4 py-3 text-muted">{{ r.product_name || '-' }}</td>
              <td class="px-4 py-3 text-muted">{{ r.province || '-' }}{{ r.city ? ' ' + r.city : '' }}</td>
              <td class="px-4 py-3 text-muted">{{ r.shop_name || '-' }}</td>
              <td class="px-4 py-3 text-muted">{{ r.price !== null && r.price !== undefined ? '¥' + r.price : '-' }}</td>
              <td class="px-4 py-3 text-muted">{{ r.scan_device || '-' }}</td>
              <td class="px-4 py-3">
                <span class="rounded-full px-2 py-0.5 text-xs font-medium bg-info/10 text-info">{{ r.scan_subject }}</span>
              </td>
            </tr>
            <tr v-if="!pending && !data?.detail?.rows?.length">
              <td colspan="8" class="px-4 py-10 text-center text-sm text-muted">暂无扫码记录</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="data?.detail?.total" class="flex items-center justify-between border-t border-border/60 px-4 py-3">
        <span class="text-xs text-muted">第 {{ data.detail.page }} / {{ totalPages }} 页</span>
        <div class="flex gap-2">
          <UButton variant="outline" color="neutral" size="sm" :disabled="page <= 1" @click="page--; refresh()">上一页</UButton>
          <UButton variant="outline" color="neutral" size="sm" :disabled="page >= totalPages" @click="page++; refresh()">下一页</UButton>
        </div>
      </div>
    </div>
  </div>
</template>
