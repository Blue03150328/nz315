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
  <div class="space-y-4">
    <!-- 页面标题区 -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="b-page-title">扫码统计</h1>
        <p class="b-page-desc">消费者扫码查询数据分析（扫码不改变码状态，仅记录日志）</p>
      </div>
    </div>

    <!-- 关键指标卡 -->
    <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <div class="b-stat">
        <div class="b-stat-label">
          <UIcon name="i-lucide-eye" class="h-3.5 w-3.5" />
          <span>累计扫码</span>
        </div>
        <div class="b-stat-value">{{ data?.totalScans ?? '--' }}</div>
        <div class="b-stat-foot">历史全部扫码查询次数</div>
      </div>
      <div class="b-stat">
        <div class="b-stat-label">
          <UIcon name="i-lucide-calendar-check" class="h-3.5 w-3.5" />
          <span>今日扫码</span>
        </div>
        <div class="b-stat-value">{{ data?.todayScans ?? '--' }}</div>
        <div class="b-stat-foot">当日 00:00 起累计</div>
      </div>
      <div class="b-stat">
        <div class="b-stat-label">
          <UIcon name="i-lucide-boxes" class="h-3.5 w-3.5" />
          <span>涉及产品</span>
        </div>
        <div class="b-stat-value">{{ data?.productDist?.length ?? '--' }}</div>
        <div class="b-stat-foot">被扫码查询的产品数</div>
      </div>
      <div class="b-stat">
        <div class="b-stat-label">
          <UIcon name="i-lucide-map-pin" class="h-3.5 w-3.5" />
          <span>涉及地区</span>
        </div>
        <div class="b-stat-value">{{ data?.regionDist?.length ?? '--' }}</div>
        <div class="b-stat-foot">扫码来源地区数</div>
      </div>
    </div>

    <!-- 图表区：趋势 / 时段 / 产品 / 地区 -->
    <div class="grid gap-4 lg:grid-cols-2">
      <!-- 近 30 天趋势 -->
      <div class="b-card">
        <div class="b-card-head">
          <span class="b-card-title">近 30 天扫码趋势</span>
          <span class="b-card-extra">按日统计</span>
        </div>
        <div class="b-card-body">
          <div v-if="!data?.trend?.length" class="flex h-40 flex-col items-center justify-center gap-1.5 text-[var(--b-text-muted)]">
            <UIcon name="i-lucide-inbox" class="b-empty-icon h-8 w-8" />
            <span class="text-sm">暂无扫码数据</span>
          </div>
          <div v-else class="flex h-40 items-end gap-0.5">
            <div v-for="t in data.trend" :key="t.date" class="group relative flex flex-1 flex-col items-center justify-end">
              <span class="pointer-events-none absolute -top-6 hidden whitespace-nowrap rounded bg-[var(--b-text-strong)] px-1.5 py-0.5 text-[10px] text-white group-hover:block">{{ t.date.slice(5) }}:{{ t.count }}</span>
              <div class="w-full rounded-t-sm bg-primary/70" :style="{ height: Math.max(2, Math.round(t.count / trendMax * 130)) + 'px' }" />
            </div>
          </div>
        </div>
      </div>

      <!-- 24 小时分布 -->
      <div class="b-card">
        <div class="b-card-head">
          <span class="b-card-title">扫码时段分布（24 小时）</span>
          <span class="b-card-extra">按小时统计</span>
        </div>
        <div class="b-card-body">
          <div v-if="!data?.hourDist?.length" class="flex h-40 flex-col items-center justify-center gap-1.5 text-[var(--b-text-muted)]">
            <UIcon name="i-lucide-inbox" class="b-empty-icon h-8 w-8" />
            <span class="text-sm">暂无扫码数据</span>
          </div>
          <div v-else class="flex h-40 items-end gap-0.5">
            <div v-for="h in data.hourDist" :key="h.hour" class="flex flex-1 flex-col items-center justify-end">
              <div class="w-full rounded-t-sm bg-sky/70" :style="{ height: Math.max(2, Math.round(h.count / hourMax * 130)) + 'px' }" />
              <span class="mt-1 text-[9px] text-[var(--b-text-muted)]">{{ h.hour }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 产品分布 -->
      <div class="b-card">
        <div class="b-card-head">
          <span class="b-card-title">产品扫码分布（Top 10）</span>
          <span class="b-card-extra">按扫码次数排序</span>
        </div>
        <div class="b-card-body">
          <div v-if="!data?.productDist?.length" class="flex flex-col items-center justify-center gap-1.5 py-10 text-[var(--b-text-muted)]">
            <UIcon name="i-lucide-inbox" class="b-empty-icon h-8 w-8" />
            <span class="text-sm">暂无扫码数据</span>
          </div>
          <div v-else class="space-y-3">
            <div v-for="p in data.productDist" :key="p.name" class="flex items-center gap-3 text-sm">
              <span class="w-44 truncate text-[var(--b-text-regular)]">{{ p.name }}</span>
              <div class="h-2 flex-1 overflow-hidden rounded-sm bg-[var(--b-fill)]">
                <div class="h-full rounded-sm bg-primary" :style="{ width: Math.round(p.count / data.productDist[0].count * 100) + '%' }" />
              </div>
              <span class="w-16 text-right font-medium b-strong">{{ p.count }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 地区分布 -->
      <div class="b-card">
        <div class="b-card-head">
          <span class="b-card-title">扫码地区分布（Top 10）</span>
          <span class="b-card-extra">按扫码次数排序</span>
        </div>
        <div class="b-card-body">
          <div v-if="!data?.regionDist?.length" class="flex flex-col items-center justify-center gap-1.5 py-10 text-[var(--b-text-muted)]">
            <UIcon name="i-lucide-inbox" class="b-empty-icon h-8 w-8" />
            <span class="text-sm">暂无扫码数据（IP 归属地接入后展示）</span>
          </div>
          <div v-else class="space-y-3">
            <div v-for="r in data.regionDist" :key="r.name" class="flex items-center gap-3 text-sm">
              <span class="w-20 text-[var(--b-text-regular)]">{{ r.name || '未知' }}</span>
              <div class="h-2 flex-1 overflow-hidden rounded-sm bg-[var(--b-fill)]">
                <div class="h-full rounded-sm bg-warning" :style="{ width: Math.round(r.count / data.regionDist[0].count * 100) + '%' }" />
              </div>
              <span class="w-16 text-right font-medium b-strong">{{ r.count }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 筛选查询区 -->
    <div class="b-card">
      <div class="b-card-head">
        <span class="b-card-title">筛选查询</span>
      </div>
      <div class="b-form-grid md:grid-cols-2 xl:grid-cols-4">
        <div>
          <label class="b-label">追溯码 / 产品名</label>
          <UInput v-model="filters.keyword" placeholder="输入追溯码或产品名" icon="i-lucide-search" @keyup.enter="doSearch" />
        </div>
        <div>
          <label class="b-label">省份</label>
          <UInput v-model="filters.province" placeholder="输入省份名称" @keyup.enter="doSearch" />
        </div>
        <div>
          <label class="b-label">开始日期</label>
          <UInput v-model="filters.dateFrom" type="date" placeholder="起" />
        </div>
        <div>
          <label class="b-label">结束日期</label>
          <UInput v-model="filters.dateTo" type="date" placeholder="止" />
        </div>
      </div>
      <div class="b-card-foot">
        <span class="b-card-extra">共 <span class="font-medium b-strong">{{ data?.detail?.total || 0 }}</span> 条扫码记录</span>
        <div class="flex items-center gap-2">
          <UButton color="neutral" variant="solid" :loading="pending" @click="doSearch">查询</UButton>
          <UButton variant="outline" color="neutral" @click="resetSearch">重置</UButton>
        </div>
      </div>
    </div>

    <!-- 扫码明细 -->
    <div class="b-card b-card-clip">
      <div class="b-card-head">
        <span class="b-card-title">扫码明细</span>
        <span class="b-card-extra">每页 {{ pageSize }} 条 · 共 {{ data?.detail?.total || 0 }} 条</span>
      </div>
      <div class="b-scroll-x">
        <table class="b-table">
          <thead>
            <tr>
              <th>扫码时间</th>
              <th>追溯码</th>
              <th>产品</th>
              <th>地区</th>
              <th>店铺</th>
              <th>价格</th>
              <th>设备</th>
              <th>主体</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in data?.detail?.rows || []" :key="r.id">
              <td>{{ String(r.scan_time).slice(0, 19) }}</td>
              <td><span class="font-code text-[13px] b-strong">{{ r.code }}</span></td>
              <td>{{ r.product_name || '-' }}</td>
              <td>{{ r.province || '-' }}{{ r.city ? ' ' + r.city : '' }}</td>
              <td>{{ r.shop_name || '-' }}</td>
              <td>{{ r.price !== null && r.price !== undefined ? '¥' + r.price : '-' }}</td>
              <td>{{ r.scan_device || '-' }}</td>
              <td>
                <span class="b-tag b-tag-info">{{ r.scan_subject }}</span>
              </td>
            </tr>
            <tr v-if="!pending && !data?.detail?.rows?.length">
              <td colspan="8" class="b-empty">
                <div class="b-empty-inner">
                  <UIcon name="i-lucide-inbox" class="b-empty-icon h-8 w-8" />
                  <span class="text-sm">暂无扫码记录</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="data?.detail?.total" class="b-pager">
        <span class="b-card-extra">共 {{ data?.detail?.total || 0 }} 条 · 第 {{ data.detail.page }} / {{ totalPages }} 页</span>
        <div class="flex items-center gap-2">
          <UButton variant="outline" color="neutral" size="sm" :disabled="page <= 1" @click="page--; refresh()">上一页</UButton>
          <UButton variant="outline" color="neutral" size="sm" :disabled="page >= totalPages" @click="page++; refresh()">下一页</UButton>
        </div>
      </div>
    </div>
  </div>
</template>
