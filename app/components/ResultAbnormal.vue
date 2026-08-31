<script setup lang="ts">
import type { QueryOutcome } from '#shared/types/compare'

const props = defineProps<{ outcome: QueryOutcome }>()
const router = useRouter()
const toast = useToast()

const compare = computed(() => props.outcome.compare)
const product = computed(() => props.outcome.product)

/** 复制追溯码 */
const copyCode = async () => {
  try {
    await navigator.clipboard.writeText(props.outcome.traceCode)
    toast.add({ title: '追溯码已复制', color: 'success' })
  } catch {
    toast.add({ title: '复制失败，请手动选择复制', color: 'warning' })
  }
}

const checks = computed(() => {
  const list: { status: 'pass' | 'fail' | 'warning'; text: string }[] = []
  list.push({
    status: props.outcome.formatValid ? 'pass' : 'fail',
    text: props.outcome.formatValid ? '二维码格式符合第1049号公告32位编码规则' : '二维码格式不符合32位编码规则',
  })
  list.push({
    status: 'fail',
    text: '该码已被重复查询 ' + props.outcome.queryCount + ' 次（高风险）',
  })
  const comparePass = compare.value?.items.find((i) => i.key === 'validity')?.result === 'pass'
  list.push({
    status: comparePass ? 'pass' : 'fail',
    text: comparePass ? '登记证状态有效' : '登记证状态异常',
  })
  if (props.outcome.provinces && props.outcome.provinces.length >= 2) {
    list.push({ status: 'warning', text: '查询地域跨 ' + props.outcome.provinces.length + ' 个省份（' + props.outcome.provinces.join('、') + '）' })
  }
  return list
})

// 举报功能待后端需求确认后实现
const handleReportTap = () => {
  toast.add({ title: '举报功能建设中，敬请期待', color: 'primary' })
}
</script>

<template>
  <div class="pb-6 lg:mx-auto lg:w-full lg:max-w-2xl">
    <PageHeader title="异常查询结果" :show-back="true" />

    <!-- 顶部红色横幅 -->
    <div class="bg-gradient-to-br from-destructive to-red-700 px-5 py-8 text-white">
      <div class="flex items-center gap-3">
        <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15"><UIcon name="i-lucide-shield-alert" class="h-7 w-7 text-white" /></span>
        <div>
          <div class="text-[28px] font-extrabold leading-tight">风险提示</div>
          <div class="mt-1 text-sm text-white/90">
            该追溯码已被查询 <span class="font-bold">{{ props.outcome.queryCount }}</span> 次
          </div>
        </div>
      </div>
    </div>

    <div class="-mt-4 space-y-4 px-4">
      <!-- 异常详情 -->
      <div class="rounded-xl border border-error/30 bg-error/5">
        <div class="flex items-center gap-2 border-b border-error/20 px-4 py-3 text-lg font-semibold text-error">
          <UIcon name="i-lucide-alert-triangle" class="h-5 w-5" />
          异常详情
        </div>
        <div class="space-y-3 p-4 text-sm">
          <div
            v-for="(c, i) in checks"
            :key="i"
            class="flex items-start gap-2 rounded-lg bg-white/60 p-3"
          >
            <UIcon
              :name="c.status === 'pass' ? 'i-lucide-check-circle-2' : c.status === 'fail' ? 'i-lucide-x-circle' : 'i-lucide-alert-circle'"
              class="mt-0.5 h-4 w-4 shrink-0"
              :class="{ 'text-success': c.status === 'pass', 'text-error': c.status === 'fail', 'text-warning': c.status === 'warning' }"
            />
            <span>{{ c.text }}</span>
          </div>
          <div v-if="outcome.reasons.length" class="rounded-lg bg-white/60 p-3 text-xs text-muted">
            {{ outcome.reasons.join('；') }}
          </div>
        </div>
      </div>

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
      <div v-if="product" class="rounded-xl border border-border bg-elevated shadow-sm">
        <div class="flex items-center gap-2 border-b border-border/60 px-4 py-3 text-sm font-semibold">
          <UIcon name="i-lucide-package" class="h-4 w-4 text-error" />
          扫码产品信息
        </div>
        <div class="divide-y divide-border/60 text-sm">
          <div class="flex justify-between gap-3 px-4 py-2.5">
            <span class="text-muted">产品名称</span>
            <span class="font-medium">{{ product.name }} {{ product.content }}</span>
          </div>
          <div class="flex justify-between gap-3 px-4 py-2.5">
            <span class="text-muted">登记证号</span>
            <span class="font-medium">{{ product.registrationNo || '-' }}</span>
          </div>
          <div class="flex justify-between gap-3 px-4 py-2.5">
            <span class="text-muted">生产厂家</span>
            <span class="text-right font-medium">{{ product.manufacturer }}</span>
          </div>
        </div>
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
      <p class="px-2 text-center text-xs text-muted">
        举报后线索将进入监管部门核实流程（功能建设中）
      </p>
    </div>
  </div>
</template>
