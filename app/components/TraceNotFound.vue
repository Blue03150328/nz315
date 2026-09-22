<script setup lang="ts">
import type { TraceOutcome } from '#shared/types/trace'
import { isUnitCodeStructureValid, unitCodeCategoryText, unitCodeProductionTypeText } from '#shared/utils/unit-code'

const props = defineProps<{ outcome: TraceOutcome }>()
const router = useRouter()
const toast = useToast()

const copyCode = async () => {
  try {
    await navigator.clipboard.writeText(props.outcome.code)
    toast.add({ title: '追溯码已复制', color: 'success' })
  } catch {
    toast.add({ title: '复制失败，请手动选择复制', color: 'warning' })
  }
}

// 32 位码结构解析（接口在「未命中本平台码」时返回）：让用户看清码本身是否合规，
// 比只给一句「未查询到」更有判断价值。
const parts = computed(() => props.outcome.codeParts)
const structureFields = computed(() => {
  const p = parts.value
  if (!p) return []
  return [
    { label: '农药类别', value: unitCodeCategoryText(p.categoryLabel) },
    { label: '登记证号后六位', value: p.registrationLast6 || '-' },
    { label: '生产类型', value: unitCodeProductionTypeText(p.productionTypeLabel) },
  ]
})
const structureValid = computed(() => isUnitCodeStructureValid(parts.value))
// 接口给出的动态原因：含「登记资料库比对是否命中」的结论，比静态的 4 条通用原因更贴近本次扫码
const apiReasons = computed(() => props.outcome.reasons || [])

// 静态可能原因：第 2 条要随「结构是否合规」切换说法 ——
// 否则会出现「结构卡说结构合规、原因 2 却说不符合编码规则」的自相矛盾（实测踩到）
const reasons = computed(() => {
  const second = structureValid.value
    ? { num: 2, title: '登记证号未被登记资料库收录', desc: '该码的32位编码结构合规，但登记证后六位在农药登记资料库中没有对应记录，登记证号可能为伪造' }
    : { num: 2, title: '登记证号可能为伪造', desc: '该登记证号或单元识别代码不符合农业农村部第1049号公告32位编码规则，可能为伪造' }
  return [
    { num: 1, title: '二维码为伪造', desc: '假冒产品私自印制的虚假追溯码，无法在平台查询到' },
    second,
    { num: 3, title: '旧规产品未接入新系统', desc: '部分早年生产的农药产品可能尚未接入追溯系统' },
    { num: 4, title: '扫码有误', desc: '扫描不清晰、识别错误，或输入的追溯码有错误' },
  ]
})
</script>

<template>
  <div class="pb-6 lg:mx-auto lg:w-full lg:max-w-2xl">
    <PageHeader title="追溯查询结果" :show-back="true" />

    <!-- 顶部红色横幅 -->
    <div class="bg-gradient-to-br from-destructive to-red-700 px-5 py-10 text-white">
      <div class="flex flex-col items-center text-center">
        <span class="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-white/15"><UIcon name="i-lucide-alert-octagon" class="h-8 w-8 text-white" /></span>
        <div class="text-[26px] font-extrabold leading-tight">未查询到该追溯码信息</div>
        <div class="mt-2 text-sm text-white/80">
          请核对追溯码是否正确，或联系人工客服
        </div>
      </div>
    </div>

    <div class="-mt-4 space-y-4 px-4">
      <!-- 输入的码 -->
      <div class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
        <div class="flex items-center justify-between">
          <div class="text-xs text-muted">您查询的代码</div>
          <UButton variant="ghost" color="neutral" size="xs" icon="i-lucide-copy" aria-label="复制追溯码" @click="copyCode">
            复制
          </UButton>
        </div>
        <div class="mt-1 font-code text-sm font-medium break-all">{{ outcome.code }}</div>
      </div>

      <!-- 编码结构解析：本平台没有该码，也让它和登记资料库比一次（接口侧完成），
           结构是否合规 + 登记证后六位是否有对应登记证，是判断「伪造」还是「别人家的码」的关键 -->
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
          <span>{{ structureValid ? '编码结构符合32位单元识别代码规则；但该登记证后六位在农药登记资料库中没有对应登记证，且本平台无此码记录。' : '编码结构不符合32位单元识别代码规则，请高度警惕该产品。' }}</span>
        </div>
      </div>

      <!-- 可能的原因 -->
      <div class="rounded-xl border border-border bg-elevated shadow-sm">
        <div class="flex items-center gap-2 border-b border-border/60 px-4 py-3 text-lg font-semibold">
          <UIcon name="i-lucide-circle-help" class="h-5 w-5 text-warning" />
          可能的原因
        </div>
        <div class="space-y-3 p-4">
          <!-- 本次查询的接口结论（含登记资料库比对结果），比通用原因更贴近实际 -->
          <div v-for="(r, i) in apiReasons" :key="'api-' + i" class="flex items-start gap-2 rounded-lg bg-primary/5 p-3 text-sm">
            <UIcon name="i-lucide-info" class="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span class="text-default">{{ r }}</span>
          </div>
          <div v-for="item in reasons" :key="item.num" class="flex gap-3 rounded-lg bg-muted/50 p-3">
            <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-error/10 text-sm font-bold text-error">
              {{ item.num }}
            </div>
            <div>
              <div class="text-sm font-medium text-default">{{ item.title }}</div>
              <div class="mt-0.5 text-xs text-muted">{{ item.desc }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 操作 -->
      <div class="grid grid-cols-2 gap-3">
        <UButton variant="outline" color="neutral" size="lg" icon="i-lucide-arrow-left" @click="router.back()">
          返回
        </UButton>
        <UButton color="primary" size="lg" icon="i-lucide-rotate-ccw" @click="router.push('/')">
          重新查询
        </UButton>
      </div>
    </div>
  </div>
</template>
