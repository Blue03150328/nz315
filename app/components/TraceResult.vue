<script setup lang="ts">
import type { TraceOutcome } from '#shared/types/trace'

const props = defineProps<{ outcome: TraceOutcome }>()
const toast = useToast()

const product = computed(() => props.outcome.product)
const batch = computed(() => props.outcome.batch)
const isBound = computed(() => props.outcome.status === 'bound')

const copyCode = async () => {
  try {
    await navigator.clipboard.writeText(props.outcome.code)
    toast.add({ title: '追溯码已复制', color: 'success' })
  } catch {
    toast.add({ title: '复制失败，请手动选择复制', color: 'warning' })
  }
}

// 产品基本信息（PRD 5.9：农药名称、登记证持有人名称、剂型、毒性、规格、净含量）
const productFields = computed(() => {
  const p = product.value
  if (!p) return []
  return [
    { label: '农药名称', value: p.name },
    { label: '登记证持有人', value: p.holderName || '-' },
    { label: '登记证号', value: p.registrationNo || '-' },
    { label: '剂型', value: p.formulation || '-' },
    { label: '毒性', value: p.toxicity || '-' },
    { label: '规格', value: p.spec || '-' },
    { label: '净含量', value: p.netContent || '-' },
  ]
})

// 原药（母药）信息（制剂产品 1049 第二条扫码必显）——多行 originals（复合/复配产品全部原药组分）
// 2026-09-07 需求：扫码结果页须把录入的全部原药行完整展示（多行循环渲染，不合并覆盖）
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

// 信息反馈入口（8类异常-7：扫码信息与标签不符，人工反馈）
const handleFeedback = () => {
  toast.add({ title: '信息反馈功能建设中，敬请期待', color: 'primary' })
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
          <div class="mt-1 text-sm text-white/90">
            {{ outcome.firstQuery ? '首次查询 · 该码未被重复使用' : '第 ' + outcome.queryCount + ' 次查询' }}
          </div>
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
        <div class="mt-1 font-code text-sm font-medium text-default">{{ outcome.formattedCode }}</div>
      </div>

      <!-- 产品基本信息 -->
      <div class="rounded-xl border border-border bg-elevated shadow-sm">
        <div class="flex items-center gap-2 border-b border-border/60 px-4 py-3 text-sm font-semibold">
          <UIcon name="i-lucide-package" class="h-4 w-4 text-primary" />
          产品基本信息
        </div>
        <div class="divide-y divide-border/60">
          <div v-for="f in productFields" :key="f.label" class="flex justify-between gap-3 px-4 py-2.5 text-sm">
            <span class="shrink-0 text-muted">{{ f.label }}</span>
            <span class="text-right font-medium text-default">{{ f.value }}</span>
          </div>
        </div>
      </div>

      <!-- 原药（母药）信息（制剂产品 1049 第二条扫码必显）：
           单原药产品展示 1 组；复合（多原药）产品按录入行循环完整展示全部组分，不合并覆盖 -->
      <div v-if="hasOriginalInfo" class="rounded-xl border border-border bg-elevated shadow-sm">
        <div class="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div class="flex items-center gap-2 text-sm font-semibold">
            <UIcon name="i-lucide-flask-conical" class="h-4 w-4 text-primary" />
            原药（母药）信息
          </div>
          <span v-if="originals.length > 1" class="text-xs text-muted">共 {{ originals.length }} 个原药组分</span>
        </div>
        <!-- 单原药：保持原样式单组展示 -->
        <div v-if="originals.length === 1" class="divide-y divide-border/60">
          <div class="flex justify-between gap-3 px-4 py-2.5 text-sm">
            <span class="shrink-0 text-muted">原药登记证号</span>
            <span class="text-right font-medium text-default">{{ originals[0].regNo || '-' }}</span>
          </div>
          <div class="flex justify-between gap-3 px-4 py-2.5 text-sm">
            <span class="shrink-0 text-muted">原药生产企业</span>
            <span class="text-right font-medium text-default">{{ originals[0].company || '-' }}</span>
          </div>
        </div>
        <!-- 复合（多原药）：按录入顺序分行/分组完整展示每条原药 -->
        <div v-else class="divide-y divide-border/60">
          <div v-for="(o, idx) in originals" :key="idx" class="px-4 py-2.5">
            <div class="mb-1.5 text-xs font-medium text-muted">原药组分 {{ idx + 1 }}</div>
            <div class="flex justify-between gap-3 py-0.5 text-sm">
              <span class="shrink-0 text-muted">原药登记证号</span>
              <span class="text-right font-medium text-default">{{ o.regNo || '-' }}</span>
            </div>
            <div class="flex justify-between gap-3 py-0.5 text-sm">
              <span class="shrink-0 text-muted">原药生产企业</span>
              <span class="text-right font-medium text-default">{{ o.company || '-' }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 批次信息：已绑定展示完整；已生成提示联系企业 -->
      <div class="rounded-xl border border-border bg-elevated shadow-sm">
        <div class="flex items-center gap-2 border-b border-border/60 px-4 py-3 text-sm font-semibold">
          <UIcon name="i-lucide-boxes" class="h-4 w-4 text-primary" />
          批次信息
        </div>
        <template v-if="isBound && batch">
          <div class="divide-y divide-border/60">
            <div class="flex justify-between gap-3 px-4 py-2.5 text-sm">
              <span class="shrink-0 text-muted">生产批次号</span>
              <span class="text-right font-medium text-default">{{ batch.batchNo }}</span>
            </div>
            <div class="flex justify-between gap-3 px-4 py-2.5 text-sm">
              <span class="shrink-0 text-muted">生产日期</span>
              <span class="text-right font-medium text-default">{{ batch.produceDate }}</span>
            </div>
            <div class="flex justify-between gap-3 px-4 py-2.5 text-sm">
              <span class="shrink-0 text-muted">有效期至</span>
              <span class="text-right font-medium text-default">{{ batch.expireDate }}</span>
            </div>
          </div>
        </template>
        <div v-else class="flex items-start gap-2 p-4 text-sm text-muted">
          <UIcon name="i-lucide-circle-help" class="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>该码尚未绑定生产信息，请联系企业（生产厂家）</span>
        </div>
      </div>

      <!-- 质检信息 -->
      <div v-if="isBound && batch" class="rounded-xl border border-border bg-elevated shadow-sm">
        <div class="flex items-center gap-2 border-b border-border/60 px-4 py-3 text-sm font-semibold">
          <UIcon name="i-lucide-clipboard-check" class="h-4 w-4 text-primary" />
          质检信息
        </div>
        <div class="divide-y divide-border/60">
          <div class="flex justify-between gap-3 px-4 py-2.5 text-sm">
            <span class="shrink-0 text-muted">质量检验结果</span>
            <span class="text-right font-medium text-success">{{ batch.qcResult || '-' }}</span>
          </div>
          <div class="flex justify-between gap-3 px-4 py-2.5 text-sm">
            <span class="shrink-0 text-muted">质量合格证号</span>
            <span class="text-right font-medium text-default">{{ batch.qualityCertNo || '-' }}</span>
          </div>
          <div v-if="batch.qcReportNo" class="flex justify-between gap-3 px-4 py-2.5 text-sm">
            <span class="shrink-0 text-muted">质检报告号</span>
            <span class="text-right font-medium text-default">{{ batch.qcReportNo }}</span>
          </div>
        </div>
      </div>

      <!-- 产品图片（标签图/说明书图，可点击放大） -->
      <div v-if="product?.labelImage || product?.manualImage" class="rounded-xl border border-border bg-elevated shadow-sm">
        <div class="flex items-center gap-2 border-b border-border/60 px-4 py-3 text-sm font-semibold">
          <UIcon name="i-lucide-image" class="h-4 w-4 text-primary" />
          产品图片
        </div>
        <div class="grid grid-cols-2 gap-3 p-4">
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

      <!-- 真伪提示：查询次数 + 最近5次扫码 -->
      <div class="rounded-xl border border-border bg-elevated shadow-sm">
        <div class="flex items-center gap-2 border-b border-border/60 px-4 py-3 text-sm font-semibold">
          <UIcon name="i-lucide-eye" class="h-4 w-4 text-primary" />
          查询记录
        </div>
        <div class="p-4 text-sm">
          <div class="flex items-center justify-between">
            <span class="text-muted">该码累计查询</span>
            <span class="font-bold text-default">{{ outcome.queryCount }} 次</span>
          </div>
          <div v-if="outcome.recentScans.length" class="mt-3 space-y-2 border-t border-border/60 pt-3">
            <div v-for="(s, i) in outcome.recentScans.slice(0, 5)" :key="i" class="flex items-center justify-between text-xs text-muted">
              <span class="flex items-center gap-1.5">
                <UIcon name="i-lucide-map-pin" class="h-3.5 w-3.5" />
                {{ s.province }}{{ s.city }}
              </span>
              <span>{{ s.time }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 操作 -->
      <div class="grid grid-cols-2 gap-3">
        <UButton variant="outline" color="neutral" size="lg" icon="i-lucide-circle-help" @click="handleFeedback">
          信息有误，点此反馈
        </UButton>
        <UButton variant="outline" color="neutral" size="lg" icon="i-lucide-arrow-left" @click="router.back()">
          返回
        </UButton>
      </div>
      <p class="px-2 text-center text-xs text-muted">
        查询结果仅供参考，如有疑问请联系生产企业核实
      </p>
    </div>
  </div>
</template>
