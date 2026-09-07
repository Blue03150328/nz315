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
          <div class="mt-1 text-sm text-white/90">农药追溯信息核验通过</div>
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

      <!-- 产品基本信息（唯一业务信息卡片：基础字段 + 批次小节 + 原药（母药）小节 + 产品图片小节收拢于一体；
           质检信息、查询记录模块已按要求整体移除） -->
      <div class="rounded-xl border border-border bg-elevated shadow-sm">
        <div class="flex items-center gap-2 border-b border-border/60 px-4 py-3 text-sm font-semibold">
          <UIcon name="i-lucide-package" class="h-4 w-4 text-primary" />
          产品基本信息
        </div>
        <div class="divide-y divide-border/60">
          <!-- 基础信息 -->
          <div v-for="f in productFields" :key="f.label" class="flex justify-between gap-3 px-4 py-2.5 text-sm">
            <span class="shrink-0 text-muted">{{ f.label }}</span>
            <span class="text-right font-medium text-default">{{ f.value }}</span>
          </div>

          <!-- 批次信息小节（生产批次号/生产日期/有效期至；质检相关字段已移除） -->
          <div>
            <div class="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-default">
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
            <!-- 未绑定时无批次数据：此处直接留空（按需求移除橙色提示与警告图标，保留【批次信息】标题模块） -->
          </div>

          <!-- 原药（母药）信息小节：单原药 1 组；复合多原药循环完整展示全部组分 -->
          <div v-if="hasOriginalInfo">
            <div class="flex items-center justify-between px-4 py-2.5">
              <div class="flex items-center gap-2 text-sm font-semibold text-default">
                <UIcon name="i-lucide-flask-conical" class="h-4 w-4 text-primary" />
                原药（母药）信息
              </div>
              <span v-if="originals.length > 1" class="text-xs text-muted">共 {{ originals.length }} 个原药组分</span>
            </div>
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

          <!-- 产品图片小节（标签图/说明书图） -->
          <div v-if="product?.labelImage || product?.manualImage">
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
      </div>

      <!-- 操作（信息反馈入口已移除，仅保留返回） -->
      <UButton variant="outline" color="neutral" size="lg" icon="i-lucide-arrow-left" class="w-full" @click="router.back()">
        返回
      </UButton>
      <p class="px-2 text-center text-xs text-muted">
        查询结果仅供参考，如有疑问请联系生产企业核实
      </p>
    </div>
  </div>
</template>
