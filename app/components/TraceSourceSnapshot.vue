<script setup lang="ts">
import type { SourceSnapshot } from '#shared/types/source-snapshot'
const props = defineProps<{ snapshot?: SourceSnapshot; historical?: boolean }>()
const source = computed(() => props.snapshot?.source)
const labels = { match: '一致', mismatch: '存在差异', insufficient: '资料不足', review: '待人工核实' }
const comparisonCounts = computed(() => Object.entries(labels).map(([status, label]) => ({ label, count: props.snapshot?.comparisons.filter(item => item.status === status).length || 0 })))
const retry = () => reloadNuxtApp()
const production = computed(() => [
  { label: '生产日期', value: source.value?.produceDate || '来源页未提供具体日期' },
  { label: '生产日期及批号说明', value: source.value?.productionNote || '来源页未提供' },
  { label: '生产批号', value: source.value?.batchNo || '来源页未提供具体批号' },
  { label: '保质期', value: source.value?.shelfLife || '来源页未提供' },
  { label: '产品有效期至', value: source.value?.productExpiry || '来源页未提供' },
])
</script>
<template>
  <div class="space-y-4">
    <section class="rounded-xl border border-border bg-elevated p-4 text-sm shadow-sm">
      <h2 class="font-semibold">{{ historical ? '历史查询快照' : '外部查询页来源' }}</h2>
      <template v-if="snapshot">
        <p class="mt-2 break-words">{{ snapshot.message }}</p>
        <p class="mt-2 text-xs text-muted">获取时间：{{ new Date(snapshot.fetchedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) }}（北京时间）</p>
        <p class="mt-1 text-xs text-muted">{{ snapshot.saved ? '本次内容和比对结果已保存' : '本次历史快照未保存' }}</p>
        <p v-if="snapshot.comparisons.length" class="mt-2 text-xs text-muted">已完成 {{ snapshot.comparisons.length }} 项登记资料比对，逐项结果见下方。</p>
        <div class="mt-3 flex flex-wrap gap-4">
          <a v-if="snapshot.sourceUrl" :href="snapshot.sourceUrl" target="_blank" rel="noopener noreferrer" class="break-all text-primary underline">查看原查询页（{{ snapshot.platform || '外部页面' }}）</a>
          <NuxtLink v-if="snapshot.saved && snapshot.id && !historical" :to="'/trace-snapshot/' + snapshot.id" class="text-primary underline">查看本次历史快照</NuxtLink>
          <UButton v-if="snapshot.status === 'unavailable' && !historical" size="xs" variant="outline" @click="retry">重新查询</UButton>
        </div>
        <p v-if="historical" class="mt-2 text-xs text-muted">这是当时保存的结果，不重新抓取外站，也不按当前登记资料重算。</p>
      </template>
      <p v-else class="mt-2 text-muted">未提供原查询网址，无法获取厂家声明的原药、生产日期和批号。请扫描原始二维码或粘贴完整链接。</p>
    </section>
    <template v-if="source">
      <section v-for="section in [{ title: '产品信息（来源页声明）', fields: source.productFields }, { title: '生产信息（来源页声明）', fields: production }]" :key="section.title" class="overflow-hidden rounded-xl border border-border bg-elevated shadow-sm">
        <h2 class="border-b border-border px-4 py-3 text-sm font-semibold">{{ section.title }}</h2>
        <dl class="divide-y divide-border"><div v-for="field in section.fields" :key="field.label" class="flex text-sm"><dt class="w-32 shrink-0 bg-muted/40 px-3 py-2.5 text-muted">{{ field.label }}</dt><dd class="min-w-0 flex-1 break-words px-3 py-2.5">{{ field.value }}</dd></div></dl>
      </section>
      <section class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
        <h2 class="text-sm font-semibold">原药信息（来源页声明）</h2>
        <p v-if="!source.originals.length" class="mt-3 text-sm text-muted">来源页未提取到原药信息，未使用同成分候选替代。</p>
        <div v-for="(o, index) in source.originals" :key="index" class="mt-3 overflow-hidden rounded-lg border border-border">
          <div class="bg-primary/10 px-3 py-2 text-xs text-primary">原药 {{ index + 1 }}</div>
          <dl class="divide-y divide-border"><div v-for="field in [{ label: '原药名称', value: o.ingredient }, { label: '原药证号', value: o.regNo }, { label: '原药生产企业', value: o.company }]" :key="field.label" class="flex text-sm"><dt class="w-32 shrink-0 bg-muted/40 px-3 py-2.5 text-muted">{{ field.label }}</dt><dd class="min-w-0 flex-1 break-words px-3 py-2.5">{{ field.value || '来源页未提供' }}</dd></div></dl>
        </div>
      </section>
    </template>
    <section v-if="snapshot?.comparisons.length" class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
      <h2 class="text-sm font-semibold">与本地登记资料逐项比对</h2>
      <div class="mt-3 flex flex-wrap gap-2 text-xs"><span v-for="item in comparisonCounts" :key="item.label" class="rounded-md bg-muted px-2 py-1">{{ item.label }} {{ item.count }} 项</span></div>
      <p class="mt-2 text-xs text-muted">登记资料来自本地导入数据，可能存在更新滞后；命中登记证不能证明商品为正品。</p>
      <div v-for="(item, index) in snapshot.comparisons" :key="index" class="mt-3 rounded-lg border border-border p-3 text-sm">
        <div class="flex flex-wrap justify-between gap-2 font-medium"><span>{{ item.label }}</span><span :class="item.status === 'mismatch' ? 'text-error' : item.status === 'match' ? 'text-primary' : 'text-warning'">{{ labels[item.status] }}</span></div>
        <p class="mt-2 break-words"><span class="text-muted">{{ item.label === '来源页单元识别码' ? '本次查询码' : '农资315登记资料' }}：</span>{{ item.referenceValue || '无可比对资料' }}</p><p class="mt-1 break-words"><span class="text-muted">{{ item.label === '码内登记类别及后六位' ? '查询码编码' : '外部来源页' }}：</span>{{ item.sourceValue || '未提供' }}</p><p class="mt-2 text-xs text-muted">{{ item.reason }}</p>
      </div>
    </section>
  </div>
</template>
