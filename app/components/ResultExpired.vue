<script setup lang="ts">
import type { QueryOutcome } from '#shared/types/compare'

const props = defineProps<{ outcome: QueryOutcome }>()
const router = useRouter()
const toast = useToast()

const compare = computed(() => props.outcome.compare)
const product = computed(() => props.outcome.product)
const validEnd = computed(() => compare.value?.registration?.validEnd || '未知')

/** 复制追溯码 */
const copyCode = async () => {
  try {
    await navigator.clipboard.writeText(props.outcome.traceCode)
    toast.add({ title: '追溯码已复制', color: 'success' })
  } catch {
    toast.add({ title: '复制失败，请手动选择复制', color: 'warning' })
  }
}

// 举报功能待后端需求确认后实现
const handleReportTap = () => {
  toast.add({ title: '举报功能建设中，敬请期待', color: 'primary' })
}
</script>

<template>
  <div class="pb-6 lg:mx-auto lg:w-full lg:max-w-2xl">
    <PageHeader title="登记证过期" :show-back="true" />

    <!-- 顶部警示横幅 -->
    <div class="bg-gradient-to-br from-destructive to-red-800 px-5 py-8 text-white">
      <div class="flex items-center gap-3">
        <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15"><UIcon name="i-lucide-calendar-clock" class="h-7 w-7 text-white" /></span>
        <div>
          <div class="text-[28px] font-extrabold leading-tight">登记证已过期</div>
          <div class="mt-1 text-sm text-white/90">
            该产品登记证{{ outcome.expiredText ? '已' + outcome.expiredText : '已过期' }}，请勿购买使用
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

      <!-- 过期详情 -->
      <div class="rounded-xl border border-error/30 bg-error/5">
        <div class="flex items-center gap-2 border-b border-error/20 px-4 py-3 text-lg font-semibold text-error">
          <UIcon name="i-lucide-shield-alert" class="h-5 w-5" />
          过期详情
        </div>
        <div class="space-y-2.5 p-4 text-sm">
          <div class="flex justify-between">
            <span class="text-muted">产品名称</span>
            <span class="font-medium">{{ product?.name }} {{ product?.content }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted">登记证号</span>
            <span class="font-medium">{{ product?.registrationNo || '-' }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted">登记有效期</span>
            <span class="font-medium text-error">{{ compare?.registration?.validStart }} 至 {{ validEnd }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted">生产厂家</span>
            <span class="text-right font-medium">{{ product?.manufacturer }}</span>
          </div>
        </div>
      </div>

      <!-- 风险提示 -->
      <div class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
        <div class="mb-2 flex items-center gap-2 text-sm font-semibold">
          <UIcon name="i-lucide-lightbulb" class="h-4 w-4 text-warning" />
          请注意
        </div>
        <ul class="space-y-2 text-xs text-muted">
          <li>• 农药登记证过期后，产品不得继续生产、销售和使用</li>
          <li>• 市面上流通的过期登记证产品涉嫌违法，请勿购买</li>
          <li>• 已购买的产品可保留证据并举报</li>
        </ul>
      </div>

      <!-- 7项比对 -->
      <RegistrationCompareCard v-if="compare" :items="compare.items" :pass-count="compare.passCount" :total-count="compare.totalCount" />

      <!-- 操作 -->
      <div class="grid grid-cols-2 gap-3">
        <UButton color="error" size="lg" icon="i-lucide-megaphone" @click="handleReportTap">
          举报该产品
        </UButton>
        <UButton variant="outline" color="neutral" size="lg" icon="i-lucide-phone" @click="router.push('/')">
          返回首页
        </UButton>
      </div>
    </div>
  </div>
</template>
