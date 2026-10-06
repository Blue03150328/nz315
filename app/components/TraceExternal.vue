<script setup lang="ts">
import type { TraceOutcome, TraceRegistryCandidate } from '#shared/types/trace'
import { unitCodeProductionTypeText } from '#shared/utils/unit-code'
import { summarizeExternal, selectExternalRegistry } from '#shared/utils/external-summary'
import { chinaDate } from '#shared/utils/production-info'

const props = defineProps<{ outcome: TraceOutcome }>()
const router = useRouter()
const toast = useToast()
// 首屏与水合使用同一天，日期一律按北京时间。
const today = useState('external-comparison-date', () => chinaDate())
onMounted(() => { today.value = chinaDate() })
const summary = computed(() => summarizeExternal(props.outcome, today.value))
const single = computed(() => selectExternalRegistry(props.outcome))
const candidates = computed(() => props.outcome.registryCandidates || [])
const displayed = computed(() => single.value ? [single.value] : candidates.value)
const snapshot = computed(() => props.outcome.sourceSnapshot)
const sourceUrl = computed(() => snapshot.value?.sourceUrl || snapshot.value?.source?.sourceUrl)
const platform = computed(() => snapshot.value?.platform || snapshot.value?.source?.platform)
const expired = (candidate: TraceRegistryCandidate) => !!candidate.expireDate && candidate.expireDate < today.value
const candidateFields = (candidate: TraceRegistryCandidate) => [
  { label: '登记证号', value: candidate.registrationNo },
  { label: '登记证有效期至', value: candidate.expireDate || '登记资料暂未提供有效日期' },
  { label: '农药名称', value: candidate.productName || '登记资料暂未提供' },
  { label: '有效成分及含量', value: candidate.ingredients || candidate.ingredientMain || '登记资料暂未提供' },
  { label: '总有效成分含量', value: candidate.content || '登记资料暂未提供' },
  { label: '剂型', value: candidate.formulation || '登记资料暂未提供' },
  { label: '登记证持有人', value: candidate.holderName || '登记资料暂未提供' },
]
const copyCode = async () => {
  try { await navigator.clipboard.writeText(props.outcome.code); toast.add({ title: '追溯码已复制', color: 'success' }) }
  catch { toast.add({ title: '复制失败，请手动选择复制', color: 'warning' }) }
}
</script>

<template>
  <div class="pb-6 lg:mx-auto lg:w-full lg:max-w-2xl">
    <PageHeader title="农资315 · 外码查询" :show-back="true" />
    <div class="space-y-4 px-4">
      <section class="rounded-xl border p-5" :class="summary.tone === 'success' ? 'border-green-200 bg-green-50 text-green-900' : summary.tone === 'warning' ? 'border-orange-200 bg-orange-50 text-orange-900' : 'border-slate-200 bg-slate-50 text-slate-800'">
        <div class="flex items-center gap-3">
          <UIcon :name="summary.tone === 'success' ? 'i-lucide-shield-check' : summary.tone === 'warning' ? 'i-lucide-triangle-alert' : 'i-lucide-circle-help'" class="h-8 w-8 shrink-0" />
          <h1 class="text-2xl font-bold">{{ summary.title }}</h1>
        </div>
        <p class="mt-3 text-sm leading-relaxed">{{ summary.detail }}</p>
        <p class="mt-3 text-xs opacity-80">该码由外部平台提供，农资315核对登记资料。</p>
        <UButton v-if="summary.tone === 'neutral'" class="mt-3" size="sm" color="neutral" variant="outline" @click="reloadNuxtApp({ force: true })">重新查询</UButton>
      </section>

      <section class="overflow-hidden rounded-xl border border-border bg-elevated">
        <div class="border-b border-border px-4 py-3">
          <h2 class="flex items-center gap-2 text-base font-semibold"><UIcon name="i-lucide-library" class="h-5 w-5 text-primary" />农资315登记资料</h2>
          <p class="mt-2 text-sm text-primary">请与包装标签核对以下信息</p>
        </div>
        <p v-if="!single && candidates.length > 1" class="bg-warning-soft px-4 py-3 text-sm">找到 {{ candidates.length }} 个登记候选，尚未唯一确定。请核对完整登记证号，各候选有效期分别显示。</p>
        <div v-for="(candidate, index) in displayed" :key="candidate.registrationNo">
          <h3 v-if="displayed.length > 1" class="bg-muted px-4 py-2 text-sm font-medium">候选 {{ index + 1 }} · {{ candidate.registrationNo }}</h3>
          <dl class="divide-y divide-border/60">
            <div v-for="field in candidateFields(candidate)" :key="field.label" class="flex gap-3 px-4 py-2.5 text-sm">
              <dt class="w-28 shrink-0 text-muted">{{ field.label }}</dt>
              <dd class="min-w-0 flex-1 break-words font-medium" :class="field.label === '登记证有效期至' && expired(candidate) ? 'text-orange-700' : 'text-default'">{{ field.value }}</dd>
            </div>
          </dl>
          <p v-if="expired(candidate)" class="border-t border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">登记证当前已到期，请结合产品生产日期核实。</p>
          <p class="border-t border-border/60 px-4 py-3 text-xs text-muted">资料来源：本平台导入的农药登记资料库<span v-if="candidate.importedAt"> · 资料入库时间：{{ candidate.importedAt }}</span>。非实时查询，可能存在更新滞后。</p>
        </div>
        <p v-if="!displayed.length" class="px-4 py-4 text-sm text-muted">登记资料库暂未找到对应资料，请核对包装上的完整登记证号。</p>
        <p v-if="outcome.codeParts" class="border-t border-border px-4 py-3 text-sm"><b>生产类型：</b>{{ unitCodeProductionTypeText(outcome.codeParts.productionTypeLabel) }}</p>
      </section>

      <!-- 异常自动展开证据，其他结果收起，原页紧接登记资料与结论。 -->
      <TraceSourceSnapshot :snapshot="snapshot" comparisons-only :expand-comparisons="summary.tone === 'warning'" />
      <TraceExternalPage :source-url="sourceUrl" :platform="platform" />
      <TraceSourceSnapshot :snapshot="snapshot" hide-comparisons compact />

      <div class="grid grid-cols-3 items-stretch gap-2">
        <TraceBillEntry :code="outcome.code" :product-name="single?.productName || ''" :dosage="single?.formulation || ''" :bill-date="snapshot?.source?.produceDate || ''" size="lg" block />
        <TraceReport :code="outcome.code" size="lg" block />
        <UButton color="primary" variant="outline" size="lg" block icon="i-lucide-scan-line" @click="router.push('/scan')">重新扫码</UButton>
      </div>
      <details class="rounded-xl border border-border bg-elevated p-4 text-sm">
        <summary class="cursor-pointer font-medium">查看本次追溯码</summary>
        <div class="mt-3 flex items-center gap-2"><span class="min-w-0 flex-1 break-all font-code">{{ outcome.formattedCode }}</span><UButton size="xs" variant="ghost" aria-label="复制追溯码" @click="copyCode">复制</UButton></div>
      </details>
      <p class="px-1 text-xs leading-relaxed text-muted">登记资料一致不能证明产品真伪。厂家页面中的“质量合格”为厂家声明，生产日期、批次和产品有效期请与包装核对；登记证有效期与产品有效期分别核实。</p>
    </div>
  </div>
</template>
