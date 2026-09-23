<script setup lang="ts">
import type { TraceOutcome } from '#shared/types/trace'

const props = defineProps<{ outcome: TraceOutcome }>()
const router = useRouter()
const toast = useToast()

const product = computed(() => props.outcome.product)
const batch = computed(() => props.outcome.batch)

const copyCode = async () => {
  try {
    await navigator.clipboard.writeText(props.outcome.code)
    toast.add({ title: '追溯码已复制', color: 'success' })
  } catch {
    toast.add({ title: '复制失败，请手动选择复制', color: 'warning' })
  }
}

// 信息栏分三栏，1049 六项必显字段按性质归栏：
//   产品信息 → 农药名称、登记证持有人名称
//   生产信息 → 生产日期、生产批次
//   原药信息 → 原药（母药）登记证号、原药生产企业名称
// 厂商信息栏按需求不设
type TabKey = 'product' | 'batch' | 'original'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'product', label: '产品信息' },
  { key: 'batch', label: '生产信息' },
  { key: 'original', label: '原药信息' },
]

const activeTab = ref<TabKey>('product')

// 产品信息栏
const productFields = computed(() => {
  const p = product.value
  if (!p) return []
  return [
    { label: '农药名称', value: p.name || '-' },
    { label: '登记证持有人名称', value: p.holderName || '-' },
    { label: '登记证号', value: p.registrationNo || '-' },
    { label: '剂型', value: p.formulation || '-' },
    { label: '毒性', value: p.toxicity || '-' },
    { label: '产品规格', value: p.spec || '-' },
    { label: '净含量', value: p.netContent || '-' },
    { label: '查询次数', value: String(props.outcome.queryCount ?? 0) },
  ]
})

// 生产信息栏（生产日期、生产批次为 1049 必显项，须与标签印刷值一致）
const batchFields = computed(() => {
  const b = batch.value
  return [
    { label: '生产日期', value: b?.produceDate || '-' },
    { label: '生产批次', value: b?.batchNo || '-' },
    { label: '有效期至', value: b?.expireDate || '-' },
    { label: '质检结果', value: b?.qcResult || '-' },
    { label: '质量合格证号', value: b?.qualityCertNo || '-' },
  ]
})

// 原药（母药）信息多行：复配产品全部原药组分逐个成块完整展示
const originals = computed(() => product.value?.originals || [])
const hasOriginalInfo = computed(() => originals.value.length > 0)

const shareText = computed(() =>
  '我查询了「' + (product.value?.name || '') + '」的农药追溯码，查询结果正常',
)

const handleShare = async () => {
  const text = shareText.value + ' 追溯码：' + props.outcome.formattedCode
  if (navigator.share) {
    try { await navigator.share({ title: '农资315', text }) } catch { /* 用户取消 */ }
  } else {
    try {
      await navigator.clipboard.writeText(text)
      toast.add({ title: '已复制查询结果，可粘贴分享', color: 'success' })
    } catch {
      toast.add({ title: '分享失败', color: 'warning' })
    }
  }
}
</script>

<template>
  <div class="pb-6 lg:mx-auto lg:w-full lg:max-w-2xl">
    <PageHeader title="追溯查询结果" :show-back="true">
      <template #right>
        <UButton variant="ghost" color="neutral" square icon="i-lucide-share-2" aria-label="分享" @click="handleShare" />
      </template>
    </PageHeader>

    <!-- 顶部绿色横幅 -->
    <div class="bg-gradient-to-br from-success to-emerald-600 px-5 py-8 text-white">
      <div class="flex items-center gap-3">
        <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15"><UIcon name="i-lucide-check-circle-2" class="h-7 w-7 text-white" /></span>
        <div>
          <div class="text-[28px] font-extrabold leading-tight">查询结果正常</div>
          <div class="mt-1 text-sm text-white/90">正品保障 · 放心使用</div>
        </div>
      </div>
    </div>

    <div class="-mt-4 space-y-4 px-4">
      <!-- 追溯码 -->
      <div class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
        <div class="flex items-center justify-between">
          <div class="text-xs text-muted">32位单元识别代码</div>
          <UButton variant="ghost" color="neutral" size="xs" icon="i-lucide-copy" aria-label="复制追溯码" @click="copyCode">
            复制
          </UButton>
        </div>
        <div class="mt-1 font-code text-sm font-medium break-all text-default">{{ outcome.formattedCode }}</div>
      </div>

      <!-- 信息栏：产品信息 / 生产信息 / 原药信息（左浅底标签列 + 右值列的表格版式） -->
      <div class="overflow-hidden rounded-xl border border-border bg-elevated shadow-sm">
        <div class="flex border-b border-border">
          <button
            v-for="t in TABS"
            :key="t.key"
            type="button"
            class="-mb-px flex-1 border-b-2 py-3 text-sm transition-colors"
            :class="activeTab === t.key
              ? 'border-primary font-semibold text-primary'
              : 'border-transparent text-muted hover:text-default'"
            @click="activeTab = t.key"
          >
            {{ t.label }}
          </button>
        </div>

        <!-- 产品信息栏 -->
        <div v-if="activeTab === 'product'" class="divide-y divide-border/60">
          <div v-for="f in productFields" :key="f.label" class="flex text-sm">
            <div class="w-36 shrink-0 border-r border-border/60 bg-muted/40 px-4 py-2.5 text-muted">{{ f.label }}</div>
            <div class="min-w-0 flex-1 px-4 py-2.5 font-medium break-words text-default">{{ f.value }}</div>
          </div>
        </div>

        <!-- 生产信息栏 -->
        <div v-else-if="activeTab === 'batch'">
          <!-- 码已生成但未绑定批次：生产日期与批次确实无从取出，明确告知而非留空 -->
          <div v-if="!batch" class="flex items-start gap-2 border-b border-border/60 bg-warning-soft px-4 py-3 text-xs">
            <UIcon name="i-lucide-info" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <span class="text-default">该追溯码尚未绑定生产信息，生产日期与生产批次暂不可查。如包装标签已印刷这两项，请联系生产企业核实。</span>
          </div>
          <div class="divide-y divide-border/60">
            <div v-for="f in batchFields" :key="f.label" class="flex text-sm">
              <div class="w-36 shrink-0 border-r border-border/60 bg-muted/40 px-4 py-2.5 text-muted">{{ f.label }}</div>
              <div class="min-w-0 flex-1 px-4 py-2.5 font-medium break-words text-default">{{ f.value }}</div>
            </div>
          </div>
        </div>

        <!-- 原药信息栏 -->
        <div v-else class="p-4">
          <div v-if="hasOriginalInfo" class="space-y-3">
            <div v-for="(o, idx) in originals" :key="idx" class="overflow-hidden rounded-lg border border-border">
              <div v-if="originals.length > 1" class="border-b border-border/60 bg-primary/10 px-4 py-2 text-xs font-medium text-primary">
                原药组分 {{ idx + 1 }}
              </div>
              <div class="flex text-sm">
                <div class="w-36 shrink-0 border-r border-border/60 bg-muted/40 px-4 py-2.5 text-muted">原药（母药）登记证号</div>
                <div class="min-w-0 flex-1 px-4 py-2.5 font-medium break-words text-default">{{ o.regNo || '-' }}</div>
              </div>
              <div class="flex border-t border-border/60 text-sm">
                <div class="w-36 shrink-0 border-r border-border/60 bg-muted/40 px-4 py-2.5 text-muted">原药生产企业名称</div>
                <div class="min-w-0 flex-1 px-4 py-2.5 font-medium break-words text-default">{{ o.company || '-' }}</div>
              </div>
            </div>
          </div>
          <div v-else class="flex items-start gap-2 rounded-lg bg-muted/40 px-4 py-3 text-xs">
            <UIcon name="i-lucide-info" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
            <span class="text-muted">该产品未录入原药（母药）信息，请联系生产企业核实。</span>
          </div>
        </div>

        <!-- 产品图片小节（标签图/说明书图） -->
        <div v-if="product?.labelImage || product?.manualImage" class="border-t border-border/60">
          <div class="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-default">
            <UIcon name="i-lucide-image" class="h-4 w-4 text-primary" />
            产品图片
          </div>
          <div class="grid grid-cols-2 gap-3 px-4 pb-4 pt-1">
            <button v-if="product?.labelImage" type="button" class="overflow-hidden rounded-lg border border-border">
              <img :src="product.labelImage" alt="产品标签图" class="aspect-square w-full object-cover" />
              <div class="py-1.5 text-center text-xs text-muted">产品标签图</div>
            </button>
            <button v-if="product?.manualImage" type="button" class="overflow-hidden rounded-lg border border-border">
              <img :src="product.manualImage" alt="产品说明书图" class="aspect-square w-full object-cover" />
              <div class="py-1.5 text-center text-xs text-muted">说明书图</div>
            </button>
          </div>
        </div>
      </div>

      <!-- 反馈入口（2026-09-23 N2 修复新增）：消费者要发现「信息与包装标签不符」，
           **必须先在页面上看到产品信息**，而产品信息只在正品页（本组件）展示 ⇒
           只把入口放在异常页 = 把最该反馈的人挡在外面。故正品页也放一个低调的文字入口。 -->
      <div class="text-center">
        <TraceFeedback
          :code="outcome.code"
          :result-type="outcome.resultType"
          label="信息与包装标签不一致？点此反馈"
          variant="link"
          color="neutral"
          size="sm"
        />
      </div>

      <!-- 操作 -->
      <UButton variant="outline" color="neutral" size="lg" icon="i-lucide-arrow-left" class="w-full" @click="router.back()">
        返回
      </UButton>
      <p class="px-2 text-center text-xs text-muted">
        查询结果仅供参考，如有疑问请联系生产企业核实
      </p>
    </div>
  </div>
</template>
