<script setup lang="ts">
import type { QueryOutcome } from '#shared/types/compare'

const props = defineProps<{ outcome: QueryOutcome }>()
const router = useRouter()
const toast = useToast()

const copyCode = async () => {
  try {
    await navigator.clipboard.writeText(props.outcome.traceCode)
    toast.add({ title: '追溯码已复制', color: 'success' })
  } catch {
    toast.add({ title: '复制失败，请手动选择复制', color: 'warning' })
  }
}

const reasons = [
  { num: 1, title: '二维码为伪造', desc: '假冒产品私自印制的虚假追溯码，无法在国家平台查询到' },
  { num: 2, title: '登记证号可能为伪造', desc: '该登记证号或单元识别代码不符合农业农村部第1049号公告32位编码规则，可能为伪造' },
  { num: 3, title: '旧规产品未接入新系统', desc: '部分早年生产的农药产品可能尚未接入全国追溯系统' },
  { num: 4, title: '扫码有误', desc: '扫描不清晰、识别错误，或输入的追溯码有错误' },
]

// 举报功能待后端需求确认后实现
const handleReportTap = () => {
  toast.add({ title: '举报功能建设中，敬请期待', color: 'primary' })
}
</script>

<template>
  <div class="pb-6 lg:mx-auto lg:w-full lg:max-w-2xl">
    <PageHeader title="查询结果" :show-back="true" />

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
        <div class="mt-1 font-code text-sm font-medium break-all">{{ outcome.traceCode }}</div>
      </div>

      <!-- 可能的原因 -->
      <div class="rounded-xl border border-border bg-elevated shadow-sm">
        <div class="flex items-center gap-2 border-b border-border/60 px-4 py-3 text-lg font-semibold">
          <UIcon name="i-lucide-circle-help" class="h-5 w-5 text-warning" />
          可能的原因
        </div>
        <div class="space-y-3 p-4">
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

      <!-- 真假码对照 -->
      <div class="rounded-xl border border-border bg-elevated shadow-sm">
        <div class="flex items-center gap-2 border-b border-border/60 px-4 py-3 text-lg font-semibold">
          <UIcon name="i-lucide-image" class="h-5 w-5 text-primary" />
          真假码对照示意
        </div>
        <div class="grid grid-cols-2 gap-3 p-4">
          <div class="rounded-lg border-2 border-success/40 bg-success/5 p-3 text-center">
            <div class="text-xs font-medium text-success">真码特征</div>
            <ul class="mt-2 space-y-1 text-left text-xs text-muted">
              <li>• 印刷清晰、位置规范</li>
              <li>• 涂层完整难刮开</li>
              <li>• 32位数字追溯码（一物一码）</li>
              <li>• 查询显示首次查询</li>
            </ul>
          </div>
          <div class="rounded-lg border-2 border-error/40 bg-error/5 p-3 text-center">
            <div class="text-xs font-medium text-error">假码特征</div>
            <ul class="mt-2 space-y-1 text-left text-xs text-muted">
              <li>• 印刷模糊、位置随意</li>
              <li>• 涂层残缺或过薄</li>
              <li>• 编码位数不足或含字母</li>
              <li>• 查询提示重复或不存在</li>
            </ul>
          </div>
        </div>
      </div>

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
