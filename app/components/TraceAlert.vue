<script setup lang="ts">
import type { TraceOutcome } from '#shared/types/trace'

const props = defineProps<{ outcome: TraceOutcome }>()
const router = useRouter()
const toast = useToast()

// 各异常类型配置：标题/副标题/图标/横幅渐变
const CONFIG: Record<string, { title: string; subtitle: string; icon: string; gradient: string }> = {
  'reg-expired': {
    title: '登记证已过期',
    subtitle: '该产品登记证已过期，请勿购买使用',
    icon: 'i-lucide-calendar-clock',
    gradient: 'from-destructive to-red-800',
  },
  expired: {
    title: '产品已过有效期',
    subtitle: '该产品已过有效期，请勿使用',
    icon: 'i-lucide-calendar-x',
    gradient: 'from-destructive to-red-700',
  },
  repeat: {
    title: '重复查询提示',
    subtitle: '该追溯码已被查询 ' + (props.outcome.queryCount || 0) + ' 次，存在假冒风险',
    icon: 'i-lucide-shield-alert',
    gradient: 'from-warning to-orange-700',
  },
  frozen: {
    title: '追溯码暂不可用',
    subtitle: '该追溯码暂不可用，请联系企业（生产厂家）',
    icon: 'i-lucide-snowflake',
    gradient: 'from-slate-500 to-slate-700',
  },
  voided: {
    title: '追溯码已作废',
    subtitle: '该追溯码已作废，请勿购买',
    icon: 'i-lucide-ban',
    gradient: 'from-destructive to-red-800',
  },
}

const cfg = computed(() => CONFIG[props.outcome.resultType] || CONFIG.frozen)
const product = computed(() => props.outcome.product)
const batch = computed(() => props.outcome.batch)

// 作废码不展示产品与批次信息（PRD 5.5.5）
const showProductInfo = computed(() => props.outcome.resultType !== 'voided')

// 反馈入口可见性（2026-09-23 N2 修复）：**除作废码外都可反馈**。
// 原实现的门是 `outcome.resultType === 'mismatch'`，而 `trace.get.ts` **从不产出该值** ⇒ 入口永不出现；
// 且那时点开也只弹「信息反馈功能建设中，敬请期待」（已删）。
// 作废码是终态，不必收集反馈。
const showFeedback = computed(() => props.outcome.resultType !== 'voided')

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

    <!-- 顶部异常横幅 -->
    <div class="bg-gradient-to-br px-5 py-8 text-white" :class="cfg.gradient">
      <div class="flex items-center gap-3">
        <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15"><UIcon :name="cfg.icon" class="h-7 w-7 text-white" /></span>
        <div>
          <div class="text-[28px] font-extrabold leading-tight">{{ cfg.title }}</div>
          <div class="mt-1 text-sm text-white/90">{{ cfg.subtitle }}</div>
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

      <!-- 异常说明 -->
      <div class="rounded-xl border border-error/30 bg-error/5">
        <div class="flex items-center gap-2 border-b border-error/20 px-4 py-3 text-lg font-semibold text-error">
          <UIcon name="i-lucide-alert-triangle" class="h-5 w-5" />
          异常说明
        </div>
        <div class="space-y-2.5 p-4 text-sm">
          <div v-for="(r, i) in outcome.reasons" :key="i" class="flex items-start gap-2">
            <UIcon name="i-lucide-alert-circle" class="mt-0.5 h-4 w-4 shrink-0 text-error" />
            <span>{{ r }}</span>
          </div>
          <div v-if="outcome.recentScans.length >= 2" class="rounded-lg bg-white/60 p-3 text-xs text-muted">
            <div class="mb-1 font-medium text-default">最近查询记录</div>
            <div v-for="(s, i) in outcome.recentScans.slice(0, 5)" :key="i" class="flex items-center justify-between py-0.5">
              <span>{{ s.province }}{{ s.city }}</span>
              <span>{{ s.time }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 产品信息（作废码不展示） -->
      <div v-if="showProductInfo && product" class="rounded-xl border border-border bg-elevated shadow-sm">
        <div class="flex items-center gap-2 border-b border-border/60 px-4 py-3 text-sm font-semibold">
          <UIcon name="i-lucide-package" class="h-4 w-4 text-error" />
          产品基本信息
        </div>
        <div class="divide-y divide-border/60">
          <div class="flex justify-between gap-3 px-4 py-2.5 text-sm">
            <span class="text-muted">农药名称</span>
            <span class="text-right font-medium">{{ product.name }}</span>
          </div>
          <div v-if="product.holderName" class="flex justify-between gap-3 px-4 py-2.5 text-sm">
            <span class="text-muted">登记证持有人</span>
            <span class="text-right font-medium">{{ product.holderName }}</span>
          </div>
          <div v-if="product.registrationNo" class="flex justify-between gap-3 px-4 py-2.5 text-sm">
            <span class="text-muted">登记证号</span>
            <span class="font-medium">{{ product.registrationNo }}</span>
          </div>
          <div v-if="batch" class="flex justify-between gap-3 px-4 py-2.5 text-sm">
            <span class="text-muted">生产日期</span>
            <span class="font-medium">{{ batch.produceDate }}</span>
          </div>
        </div>
      </div>

      <!-- 记一笔账（2026-09-23 新增，用户裁定「异常页也加」）：异常 ≠ 没花钱 ——
           消费者往往是**已经买回来了**才扫码核对（甚至正因为觉得不对劲才来扫），
           此时「把这笔支出记下来」与「举报维权」是两件独立的事，不该因为页面显示异常就没了记账口。
           预填口径与上方「产品信息」卡片严格一致：作废码不展示产品信息 ⇒ 也不预填产品名
           （不把页面上刻意不展示的产品名悄悄写进用户账本）；其余异常类型产品已知，正常预填。 -->
      <TraceBillEntry
        :code="outcome.code"
        :product-name="showProductInfo ? (product?.name || '') : ''"
        :category="showProductInfo ? (product?.category || '') : ''"
        block
      />

      <!-- 一键举报（2026-09-23 新增）：本组件服务的是**异常结果**
           （登记证过期 / 产品过有效期 / 重复查询 / 已冻结 / 已作废）。
           此前页面上只有一句「请勿购买使用」，消费者看完没有任何下一步 ——
           现在给出主管部门渠道（12316 热线 + 当地农业农村局），并把追溯码备好供其举报时提供。
           ⚠️ 与「信息有误，点此反馈」是两个不同去向：反馈是「平台内纠错」（落 risk_alert 由企业核实），
              举报是「找主管部门投诉」，两者不可互相替代。 -->
      <TraceReport :code="outcome.code" block />

      <!-- 操作：反馈入口（2026-09-23 N2 修复 —— 除作废码外都可反馈，见 script 里 showFeedback 注释） -->
      <div class="grid gap-3" :class="showFeedback ? 'grid-cols-2' : 'grid-cols-1'">
        <TraceFeedback
          v-if="showFeedback"
          :code="outcome.code"
          :result-type="outcome.resultType"
          label="信息有误，点此反馈"
          variant="outline"
          color="warning"
          size="lg"
          icon="i-lucide-message-square-warning"
        />
        <UButton variant="outline" color="neutral" size="lg" icon="i-lucide-arrow-left" @click="router.back()">
          返回
        </UButton>
      </div>
    </div>
  </div>
</template>
