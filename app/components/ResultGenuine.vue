<script setup lang="ts">
import type { QueryOutcome } from '#shared/types/compare'

const props = defineProps<{ outcome: QueryOutcome }>()
const router = useRouter()
const toast = useToast()

const product = computed(() => props.outcome.product)
const compare = computed(() => props.outcome.compare)

const productFields = computed(() => {
  const p = product.value
  if (!p) return []
  return [
    { label: '产品名称', value: p.name + ' ' + p.content },
    { label: '剂型', value: p.formulation },
    { label: '规格', value: p.spec },
    { label: '生产许可证号', value: p.productionLicenseNo || '-' },
    { label: '生产厂家', value: p.manufacturer },
    { label: '生产日期', value: p.productionDate },
    { label: '生产批号', value: p.batchNo },
    { label: '有效期至', value: p.expiryDate },
  ]
})

const shareText = computed(() =>
  '我查询了「' + (product.value?.name || '') + '」的农药追溯码，结果为【正品】✓',
)

const copyCode = async () => {
  try {
    await navigator.clipboard.writeText(props.outcome.traceCode)
    toast.add({ title: '追溯码已复制', color: 'success' })
  } catch {
    toast.add({ title: '复制失败，请手动选择复制', color: 'warning' })
  }
}

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

// 登记证详情页待后端需求确认后实现
const handleRegistrationTap = () => {
  toast.add({ title: '登记证详情功能建设中，敬请期待', color: 'primary' })
}

// 用药档案待后端需求确认后实现
const handleArchiveTap = () => {
  toast.add({ title: '用药档案功能建设中，敬请期待', color: 'primary' })
}
</script>

<template>
  <div class="pb-6 lg:mx-auto lg:w-full lg:max-w-2xl">
    <PageHeader title="正品查询结果" :show-back="true">
      <template #right>
        <UButton variant="ghost" color="neutral" square icon="i-lucide-share-2" aria-label="分享" @click="handleShare" />
      </template>
    </PageHeader>

    <!-- 顶部绿色横幅 -->
    <div class="bg-gradient-to-br from-success to-emerald-600 px-5 py-8 text-white">
      <div class="flex items-center gap-3">
        <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15"><UIcon name="i-lucide-check-circle-2" class="h-7 w-7 text-white" /></span>
        <div>
          <div class="text-[28px] font-extrabold leading-tight">查询结果：正品</div>
          <div class="mt-1 text-sm text-white/90">
            {{ outcome.firstQuery ? '首次查询 · 该码未被重复使用' : '第 ' + outcome.queryCount + ' 次查询 · 查询次数正常' }}
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

      <!-- 产品信息 -->
      <div class="rounded-xl border border-border bg-elevated shadow-sm">
        <div class="flex items-center gap-2 border-b border-border/60 px-4 py-3 text-sm font-semibold">
          <UIcon name="i-lucide-package" class="h-4 w-4 text-primary" />
          产品信息
        </div>
        <div class="divide-y divide-border/60">
          <div class="flex justify-between gap-3 px-4 py-2.5 text-sm">
            <span class="shrink-0 text-muted">登记证号</span>
            <button
              v-if="product?.registrationNo"
              type="button"
              class="text-right font-medium text-primary underline underline-offset-2"
              @click="handleRegistrationTap"
            >
              {{ product.registrationNo }}
            </button>
            <span v-else class="text-right font-medium text-default">-</span>
          </div>
          <div v-for="f in productFields" :key="f.label" class="flex justify-between gap-3 px-4 py-2.5 text-sm">
            <span class="shrink-0 text-muted">{{ f.label }}</span>
            <span class="text-right font-medium text-default">{{ f.value }}</span>
          </div>
        </div>
      </div>

      <!-- 7项比对 -->
      <RegistrationCompareCard v-if="compare" :items="compare.items" :pass-count="compare.passCount" :total-count="compare.totalCount" />

      <!-- 操作 -->
      <div class="grid grid-cols-2 gap-3">
        <UButton color="success" size="lg" icon="i-lucide-folder-plus" @click="handleArchiveTap">
          加入用药档案
        </UButton>
        <UButton variant="outline" color="neutral" size="lg" icon="i-lucide-shield-check" @click="router.push('/')">
          继续查询
        </UButton>
      </div>
      <p class="px-2 text-center text-xs text-muted">
        加入用药档案、举报异常等扩展功能待后端需求确认后开放
      </p>
    </div>
  </div>
</template>
