<script setup lang="ts">
// 公众端「外码查询」页（扫码命中的码不在本平台 trace_code 表 → 登记资料库兜底 + 外部来源比对）
//
// 版面原则（2026-10-09 瘦身）：**一屏一个答案**，客户扫完码只问三件事 ——
//   ① 靠不靠谱？      → 结论横幅（tone 绿/橙/灰，承担「登记资料一致 ≠ 证明真伪」的语义，不可删）
//   ② 跟手上这瓶对不对得上？ → 登记核对卡，首屏只摆客户能拿包装核对的 4 项；
//                              有效成分/含量/剂型收进「展开完整登记资料」
//   ③ 还能去哪查？    → 厂家原页外链出口（**不再内嵌 iframe**：跨站多被 X-Frame-Options / CSP
//                              拒绝，原先那套「/api/source-frame 预检 + 8 秒提示 + 收起展开」状态机
//                              绝大多数时候的产出就是一句「请打开厂家原页查看」，不如直接给按钮）
// 其余（逐项比对明细 / 厂家声明原文 / 追溯码复制）一律**默认收起**，它们是举证材料而非首屏信息。
// 记账、举报降为文字链（异常 tone 时举报回升主 CTA），**免责声明一字不动**（合规底线）。
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

// 首屏只留客户能拿包装逐字核对的四项（农药名称 / 登记证号 / 持有人 / 有效期）
const coreFields = (candidate: TraceRegistryCandidate) => [
  { label: '农药名称', value: candidate.productName || '登记资料暂未提供' },
  { label: '登记证号', value: candidate.registrationNo },
  { label: '登记证持有人', value: candidate.holderName || '登记资料暂未提供' },
  { label: '登记证有效期至', value: candidate.expireDate || '登记资料暂未提供有效日期' },
]
// 监管与农资店才会逐项看的字段，收进「展开完整登记资料」
const extraFields = (candidate: TraceRegistryCandidate) => [
  { label: '有效成分及含量', value: candidate.ingredients || candidate.ingredientMain || '登记资料暂未提供' },
  { label: '总有效成分含量', value: candidate.content || '登记资料暂未提供' },
  { label: '剂型', value: candidate.formulation || '登记资料暂未提供' },
]

// 外链安全口径：只放行 http/https 且不带凭据的地址（与后端 source-fetch 校验同口径的前端兜底）
const safeSourceUrl = computed(() => {
  try {
    const url = new URL(sourceUrl.value || '')
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''
  } catch { return '' }
})

const copyCode = async () => {
  try { await navigator.clipboard.writeText(props.outcome.code); toast.add({ title: '追溯码已复制', color: 'success' }) }
  catch { toast.add({ title: '复制失败，请手动选择复制', color: 'warning' }) }
}
</script>

<template>
  <div class="pb-6 lg:mx-auto lg:w-full lg:max-w-2xl">
    <PageHeader title="农资315 · 外码查询" :show-back="true" />
    <div class="space-y-4 px-4">
      <!-- ① 结论：这个码是什么性质、要不要留意（页面的魂，不可删） -->
      <section class="rounded-xl border p-5" :class="summary.tone === 'success' ? 'border-green-200 bg-green-50 text-green-900' : summary.tone === 'warning' ? 'border-orange-200 bg-orange-50 text-orange-900' : 'border-slate-200 bg-slate-50 text-slate-800'">
        <div class="flex items-center gap-3">
          <UIcon :name="summary.tone === 'success' ? 'i-lucide-shield-check' : summary.tone === 'warning' ? 'i-lucide-triangle-alert' : 'i-lucide-circle-help'" class="h-8 w-8 shrink-0" />
          <h1 class="text-2xl font-bold">{{ summary.title }}</h1>
        </div>
        <p class="mt-3 text-sm leading-relaxed">{{ summary.detail }}</p>
        <p class="mt-3 text-xs opacity-80">该码由外部平台提供，农资315核对登记资料。</p>
        <UButton v-if="summary.tone === 'neutral'" class="mt-3" size="sm" color="neutral" variant="outline" @click="reloadNuxtApp({ force: true })">重新查询</UButton>
      </section>

      <!-- ② 核对：首屏只摆客户会拿去对包装的四项 -->
      <section class="overflow-hidden rounded-xl border border-border bg-elevated">
        <div class="border-b border-border px-4 py-3">
          <h2 class="flex items-center gap-2 text-base font-semibold"><UIcon name="i-lucide-library" class="h-5 w-5 text-primary" />农资315登记资料</h2>
          <p class="mt-2 text-sm text-primary">请与包装标签核对以下信息</p>
        </div>
        <p v-if="!single && candidates.length > 1" class="bg-warning-soft px-4 py-3 text-sm">找到 {{ candidates.length }} 个登记候选，尚未唯一确定。请核对完整登记证号，各候选有效期分别显示。</p>
        <div v-for="(candidate, index) in displayed" :key="candidate.registrationNo">
          <h3 v-if="displayed.length > 1" class="bg-muted px-4 py-2 text-sm font-medium">候选 {{ index + 1 }} · {{ candidate.registrationNo }}</h3>
          <dl class="divide-y divide-border/60">
            <div v-for="field in coreFields(candidate)" :key="field.label" class="flex gap-3 px-4 py-2.5 text-sm">
              <dt class="w-28 shrink-0 text-muted">{{ field.label }}</dt>
              <dd class="min-w-0 flex-1 break-words font-medium" :class="field.label === '登记证有效期至' && expired(candidate) ? 'text-orange-700' : 'text-default'">{{ field.value }}</dd>
            </div>
          </dl>
          <p v-if="expired(candidate)" class="border-t border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">登记证当前已到期，请结合产品生产日期核实。</p>
          <details class="border-t border-border/60">
            <summary class="cursor-pointer px-4 py-2.5 text-sm text-primary">展开完整登记资料（有效成分及含量、总含量、剂型）</summary>
            <dl class="divide-y divide-border/60">
              <div v-for="field in extraFields(candidate)" :key="field.label" class="flex gap-3 px-4 py-2.5 text-sm">
                <dt class="w-28 shrink-0 text-muted">{{ field.label }}</dt>
                <dd class="min-w-0 flex-1 break-words font-medium text-default">{{ field.value }}</dd>
              </div>
            </dl>
            <p class="border-t border-border/60 px-4 py-3 text-xs text-muted">资料来源：本平台导入的农药登记资料库<span v-if="candidate.importedAt"> · 资料入库时间：{{ candidate.importedAt }}</span>。非实时查询，可能存在更新滞后。</p>
          </details>
        </div>
        <p v-if="!displayed.length" class="px-4 py-4 text-sm text-muted">登记资料库暂未找到对应资料，请核对包装上的完整登记证号。</p>
        <p v-if="outcome.codeParts" class="border-t border-border px-4 py-2.5 text-xs text-muted">生产类型：{{ unitCodeProductionTypeText(outcome.codeParts.productionTypeLabel) }}</p>
      </section>

      <!-- ③ 出口：只给外链按钮，不再内嵌厂家原页 -->
      <section class="rounded-xl border border-border bg-elevated p-4">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-package-search" class="h-4 w-4 text-primary" />
          <h2 class="text-base font-semibold">厂家原查询页</h2>
        </div>
        <p class="mt-1 text-xs text-muted">来源：{{ platform || '外部追溯平台' }} · 页面内容由来源平台提供</p>
        <UButton
          v-if="safeSourceUrl"
          class="mt-3"
          color="primary"
          size="lg"
          block
          icon="i-lucide-external-link"
          :to="safeSourceUrl"
          target="_blank"
          rel="noopener noreferrer"
          external
        >
          打开厂家原页查看
        </UButton>
        <p v-else class="mt-3 text-sm text-muted">没有取得厂家网址，请核对包装上的追溯说明。</p>
      </section>

      <!-- 举证材料：默认收起，异常 tone 时比对明细自动展开 -->
      <TraceSourceSnapshot :snapshot="snapshot" comparisons-only :expand-comparisons="summary.tone === 'warning'" />
      <details v-if="snapshot?.source" class="rounded-xl border border-border bg-elevated p-4">
        <summary class="cursor-pointer text-sm font-semibold">查看厂家声明原文（产品信息 / 生产信息 / 原药信息）</summary>
        <div class="mt-3">
          <TraceSourceSnapshot :snapshot="snapshot" hide-comparisons compact />
        </div>
      </details>
      <details class="rounded-xl border border-border bg-elevated p-4 text-sm">
        <summary class="cursor-pointer font-medium">查看本次追溯码</summary>
        <div class="mt-3 flex items-center gap-2"><span class="min-w-0 flex-1 break-all font-code">{{ outcome.formattedCode }}</span><UButton size="xs" variant="ghost" aria-label="复制追溯码" @click="copyCode">复制</UButton></div>
      </details>

      <!-- 行动区：正常/中性结果以「重新扫码」为主，异常结果把举报提上来 -->
      <TraceReport v-if="summary.tone === 'warning'" :code="outcome.code" size="lg" block label="举报投诉" />
      <UButton v-else color="primary" size="lg" block icon="i-lucide-scan-line" @click="router.push('/scan')">重新扫码</UButton>
      <div class="flex items-center justify-center gap-3 text-sm">
        <TraceBillEntry
          :code="outcome.code"
          :product-name="single?.productName || ''"
          :dosage="single?.formulation || ''"
          :bill-date="snapshot?.source?.produceDate || ''"
          variant="ghost"
          color="primary"
          size="sm"
          label="记一笔账"
        />
        <template v-if="summary.tone === 'warning'">
          <span class="text-muted">·</span>
          <UButton variant="ghost" color="primary" size="sm" icon="i-lucide-scan-line" @click="router.push('/scan')">重新扫码</UButton>
        </template>
        <template v-else>
          <span class="text-muted">·</span>
          <TraceReport :code="outcome.code" variant="ghost" color="neutral" size="sm" label="举报投诉" />
        </template>
      </div>

      <p class="px-1 text-xs leading-relaxed text-muted">登记资料一致不能证明产品真伪。厂家页面中的“质量合格”为厂家声明，生产日期、批次和产品有效期请与包装核对；登记证有效期与产品有效期分别核实。</p>
    </div>
  </div>
</template>
