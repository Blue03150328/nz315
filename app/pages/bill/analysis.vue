<script setup lang="ts">
const route = useRoute()
const { data: meData } = await useFetch<any>('/api/consumer/me', { key: 'consumer-me' })
const loggedIn = computed(() => !!meData.value?.loggedIn)
const { data, pending, error, refresh } = await useFetch<any>('/api/bill/analysis', {
  key: 'bill-overview',
  query: computed(() => ({ range: 'recent', year: route.query.year })),
  immediate: loggedIn.value,
})
watch(loggedIn, (value) => { if (value) refresh() })
const fmtMoney = (value: any) => (Number(value) || 0).toFixed(2)
// 固定三类与图例顺序；历史不明确分类保守计入其他支出。
const pieData = computed(() => {
  const values = { pesticide: 0, fertilizer: 0, other: 0 }
  for (const row of data.value?.byCategory || []) {
    const amount = Number(row.amount) || 0
    if (row.category === '肥料') values.fertilizer += amount
    else if (['杀虫', '杀菌', '除草', '杀螨'].includes(row.category)) values.pesticide += amount
    else values.other += amount
  }
  return [
    { label: '用肥', amount: values.fertilizer },
    { label: '用药', amount: values.pesticide },
    { label: '其他支出', amount: values.other },
  ]
})
useHead({ title: '支出概览 - 农资315' })
</script>

<template>
  <div class="pb-6">
    <PageHeader title="支出概览" :show-back="true" />
    <div class="space-y-7 px-4 pt-5 lg:mx-auto lg:max-w-2xl">
      <div v-if="!loggedIn" class="py-8 text-center text-sm text-muted">
        <p>登录后可查看支出概览</p>
        <UButton class="mt-4" to="/bill">返回账本登录</UButton>
      </div>
      <div v-else-if="error" class="py-8 text-center text-sm text-muted">
        <p>暂时无法加载支出，请稍后重试</p>
        <UButton class="mt-3" variant="outline" @click="refresh()">重试</UButton>
      </div>
      <div v-else-if="pending" class="py-8 text-center text-sm text-muted" role="status">正在加载支出…</div>
      <template v-else-if="data">
        <div>
          <p class="text-xs text-muted">{{ data.label }} · 近六个月总花费</p>
          <p class="mt-2 text-3xl font-semibold text-default">¥{{ fmtMoney(data.total) }}</p>
        </div>
        <section>
          <h2 class="mb-3 text-sm font-medium">每月支出</h2>
          <BillBarChart :data="data.recentMonthly || []" :height="180" />
        </section>
        <section class="border-t border-border/50 pt-5">
          <h2 class="mb-3 text-sm font-medium">支出构成</h2>
          <BillPieChart :data="pieData" :height="120" />
          <p v-if="!data.total" class="mt-3 text-xs text-muted">这六个月还没有支出记录。</p>
        </section>
      </template>
    </div>
  </div>
</template>
