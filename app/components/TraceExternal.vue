<script setup lang="ts">
// 公众端扫码结果页：非本平台追溯码（resultType='external-reg'）
//
// 场景：消费者扫到的是别的追溯平台（或别的企业自建系统）签发的 32 位码，
// 本平台没有这个码的生成/生产记录，但它的前 8 位能与国家农药登记资料库比对。
// 页面任务：① 明确告知「这不是本平台的码」；② 把比对到的登记资料摆出来供核对；
//           ③ 讲清哪些信息「本平台确实给不了」（生产日期/生产批次）；
//           ④ 不越界 —— 登记资料命中 ≠ 产品为正品。
import type { TraceOutcome, TraceRegistryCandidate } from '#shared/types/trace'
import { isUnitCodeStructureValid, unitCodeCategoryText, unitCodeProductionTypeText } from '#shared/utils/unit-code'
import { summarizeExternal } from '#shared/utils/external-summary'

const props = defineProps<{ outcome: TraceOutcome }>()
const router = useRouter()
const toast = useToast()

const parts = computed(() => props.outcome.codeParts)
const candidates = computed<TraceRegistryCandidate[]>(() => props.outcome.registryCandidates || [])
const summary = computed(() => summarizeExternal(props.outcome, new Date().toISOString().slice(0, 10)))
// 后六位撞车时会出现多个候选：唯一候选直接给结论式表格，多候选则逐条列出、由用户按标签核对
const single = computed(() => (candidates.value.length === 1 ? candidates.value[0] : undefined))

const structureFields = computed(() => {
  const p = parts.value
  if (!p) return []
  return [
    { label: '农药类别', value: unitCodeCategoryText(p.categoryLabel) },
    { label: '登记证号后六位', value: p.registrationLast6 || '-' },
    { label: '生产类型', value: unitCodeProductionTypeText(p.productionTypeLabel) },
  ]
})

// 前 8 位结构是否合规：结构都不合规的码，基本可以按伪造对待
const structureValid = computed(() => isUnitCodeStructureValid(parts.value))

const candidateFields = (c: TraceRegistryCandidate) => [
  { label: '农药名称', value: c.productName || '-' },
  { label: '登记证持有人名称', value: c.holderName || '-' },
  { label: '登记证号', value: c.registrationNo || '-' },
  { label: '剂型', value: c.formulation || '-' },
  { label: '毒性', value: c.toxicity || '-' },
  { label: '总有效成分含量', value: c.content || '-' },
  { label: '有效成分', value: c.ingredientMain || '-' },
  { label: '登记证有效期至', value: c.expireDate || '-' },
]

const copyCode = async () => {
  try {
    await navigator.clipboard.writeText(props.outcome.code)
    toast.add({ title: '追溯码已复制', color: 'success' })
  } catch {
    toast.add({ title: '复制失败，请手动选择复制', color: 'warning' })
  }
}
</script>

<template>
  <div class="pb-6 lg:mx-auto lg:w-full lg:max-w-2xl">
    <PageHeader title="追溯查询结果" :show-back="true" />
    <!-- 顶部三列等宽操作区；仅唯一登记候选时预填记账产品，避免多候选误填。 -->
    <div class="grid grid-cols-3 items-stretch gap-2 px-4 pb-4">
      <TraceBillEntry
        :code="outcome.code"
        :product-name="single ? (single.productName || '') : ''"
        :dosage="single ? (single.formulation || '') : ''"
        :bill-date="outcome.sourceSnapshot?.source?.produceDate || ''"
        size="lg"
        block
      />
      <TraceReport :code="outcome.code" size="lg" block />
      <UButton color="primary" variant="outline" size="lg" block icon="i-lucide-scan-line" @click="router.push('/scan')">
        重新扫码
      </UButton>
    </div>

    <!-- 汇总已完成的比对，资料不足不当作异常，也不作产品合格鉴定。 -->
    <div class="bg-gradient-to-br px-5 py-8 text-white" :class="summary.tone === 'success' ? 'from-green-700 to-emerald-800' : summary.tone === 'warning' ? 'from-warning to-orange-700' : 'from-slate-600 to-slate-800'">
      <div class="flex items-center gap-3">
        <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15"><UIcon :name="summary.tone === 'success' ? 'i-lucide-shield-check' : 'i-lucide-shield-question'" class="h-7 w-7 text-white" /></span>
        <div>
          <div class="text-[26px] font-extrabold leading-tight">{{ summary.title }}</div>
          <div class="mt-2 text-xs text-white/90">此页面仅为农资315数据与外部对比页</div>
          <div class="mt-1 text-xs text-white/80">该码不是由农资315签发，本平台无该码生产记录</div>
        </div>
      </div>
    </div>

    <div class="-mt-4 space-y-4 px-4">
      <p class="relative rounded-xl border border-border bg-elevated p-4 text-sm text-default shadow-sm">{{ summary.detail }}</p>
      <!-- 登记资料比对结果 -->
      <div class="overflow-hidden rounded-xl border border-border bg-elevated shadow-sm">
        <div class="flex items-center gap-2 border-b border-border/60 px-4 py-3 text-sm font-semibold">
          <UIcon name="i-lucide-library" class="h-4 w-4 text-primary" />
          农资315登记资料库信息
        </div>

        <!-- 唯一候选：直接给结论式表格 -->
        <div v-if="single">
          <div class="divide-y divide-border/60">
            <div v-for="f in candidateFields(single)" :key="f.label" class="flex text-sm">
              <div class="w-36 shrink-0 border-r border-border/60 bg-muted/40 px-4 py-2.5 text-muted">{{ f.label }}</div>
              <div class="min-w-0 flex-1 px-4 py-2.5 font-medium break-words text-default">{{ f.value }}</div>
            </div>
          </div>
          <div v-if="single.expired" class="flex items-start gap-2 border-t border-border/60 bg-error/5 px-4 py-3 text-xs text-error">
            <UIcon name="i-lucide-calendar-x" class="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>该登记证当前已于 {{ single.expireDate }} 到期，请结合实际生产日期核实。</span>
          </div>
        </div>

        <!-- 多个候选：后六位撞车，需人工核对 -->
        <div v-else-if="candidates.length" class="space-y-3 p-4">
          <div class="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-xs">
            <UIcon name="i-lucide-info" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <span class="text-default">该后六位对应 {{ candidates.length }} 个登记证，无法唯一确定。请按包装标签上印刷的登记证号核对是下列哪一个。</span>
          </div>
          <div v-for="(c, idx) in candidates" :key="c.registrationNo" class="overflow-hidden rounded-lg border border-border">
            <div class="border-b border-border/60 bg-primary/10 px-4 py-2 text-xs font-medium text-primary">
              候选 {{ idx + 1 }} · {{ c.registrationNo }}
            </div>
            <div class="divide-y divide-border/60">
              <div v-for="f in candidateFields(c)" :key="f.label" class="flex text-sm">
                <div class="w-36 shrink-0 border-r border-border/60 bg-muted/40 px-4 py-2.5 text-muted">{{ f.label }}</div>
                <div class="min-w-0 flex-1 px-4 py-2.5 font-medium break-words text-default">{{ f.value }}</div>
              </div>
            </div>
          </div>
        </div>
        <p v-else class="p-4 text-sm text-muted">本地登记资料库暂未找到对应登记资料，请核对包装上的完整登记证号。</p>
      </div>

      <TraceSourceSnapshot :snapshot="outcome.sourceSnapshot" />

      <!-- 追溯码 -->
      <div class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
        <div class="flex items-center justify-between">
          <div class="text-xs text-muted">您查询的代码</div>
          <UButton variant="ghost" color="neutral" size="xs" icon="i-lucide-copy" aria-label="复制追溯码" @click="copyCode">
            复制
          </UButton>
        </div>
        <div class="mt-1 font-code text-sm font-medium break-all text-default">{{ outcome.formattedCode }}</div>
      </div>

      <!-- 编码结构解析 -->
      <div v-if="parts" class="overflow-hidden rounded-xl border border-border bg-elevated shadow-sm">
        <div class="flex items-center gap-2 border-b border-border/60 px-4 py-3 text-sm font-semibold">
          <UIcon name="i-lucide-binary" class="h-4 w-4 text-primary" />
          32位码前8位结构解析
        </div>
        <div class="divide-y divide-border/60">
          <div v-for="f in structureFields" :key="f.label" class="flex text-sm">
            <div class="w-36 shrink-0 border-r border-border/60 bg-muted/40 px-4 py-2.5 text-muted">{{ f.label }}</div>
            <div class="min-w-0 flex-1 px-4 py-2.5 font-medium break-words text-default">{{ f.value }}</div>
          </div>
        </div>
        <div class="flex items-start gap-2 border-t border-border/60 px-4 py-3 text-xs" :class="structureValid ? 'bg-muted/30 text-muted' : 'bg-error/5 text-error'">
          <UIcon :name="structureValid ? 'i-lucide-check-circle-2' : 'i-lucide-alert-octagon'" class="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{{ structureValid ? '编码结构符合农业农村部第1049号公告的32位单元识别代码规则。' : '编码结构不符合32位单元识别代码规则，请高度警惕该产品。' }}</span>
        </div>
      </div>


      <!-- 必须说清的边界：本平台给不了什么 + 不能据此认定真伪 -->
      <div class="rounded-xl border border-warning/30 bg-warning-soft/60">
        <div class="flex items-center gap-2 border-b border-warning/20 px-4 py-3 text-sm font-semibold">
          <UIcon name="i-lucide-triangle-alert" class="h-4 w-4 text-warning" />
          必须注意的三点
        </div>
        <div class="space-y-2.5 p-4 text-xs leading-relaxed text-default">
          <div class="flex items-start gap-2">
            <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
            <span><b>登记资料能查到，不等于产品是正品。</b>登记证号是公开信息，仿冒产品同样可以印上一个真实存在的登记证号。</span>
          </div>
          <div class="flex items-start gap-2">
            <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
            <span><b>生产日期、生产批次优先显示外部来源页面原文。</b>如果来源页面没有提供，请以包装标签实物或该码所属的平台为准。</span>
          </div>
          <div class="flex items-start gap-2">
            <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
            <span><b>如包装上印的是「农资315」追溯说明，但本页显示本平台无此码，请高度警惕并联系购买渠道核实。</b></span>
          </div>
        </div>
      </div>

      <p class="px-2 text-center text-xs text-muted">
        查询结果仅供参考，如有疑问请联系生产企业或购买渠道核实
      </p>
    </div>
  </div>
</template>
