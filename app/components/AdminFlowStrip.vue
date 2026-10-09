<script setup lang="ts">
// 数据概览页常驻的精简建档流程条（2026-10-09 新增）
//
// 为什么需要它：建档指引组件（AdminOnboarding）此前只在「系统设置 → 建档指引」主动打开时才加载，
// 新厂家最需要流程引导的前几次登录反而一次都看不到 —— 指示牌锁在仓库里。
// 本组件把它释放到登录后的首页（数据概览），用真实进度告诉用户「下一步该点哪」。
//
// 与 AdminOnboarding 的区别（刻意为之，别合并）：
//   · 无企业选择器 —— 平台管理员在概览页未选企业时不显示本条（多企业进度塞不进一行流程条，
//     按企业查进度仍去系统设置）；
//   · 四步全部完成后自动隐藏 —— 已建档企业的首屏还给统计数据，不常驻一块永远全绿的卡片。
//
// 注意 fetch key 与 AdminOnboarding 不同（'flowstrip-' 前缀）：那边带 enterpriseId 查询参数，
// 共用 key 会让厂家自己的进度被「按企业查询」的缓存覆盖。
import type { AdminOnboarding } from '#shared/types/admin-onboarding'

const { user, canWrite } = useUser()

const { data } = await useFetch<AdminOnboarding>('/api/admin/onboarding', {
  key: 'flowstrip-' + user.value?.id,
})

const steps = computed(() => [
  { label: '维护规格', done: !!data.value?.specsReady, to: '/admin/specs' },
  { label: '建立产品', done: !!data.value?.productsReady, to: '/admin/products' },
  { label: '生成或上传追溯码', done: !!data.value?.codesReady, to: canWrite.value ? '/admin/collection' : '/admin/codes' },
  { label: '查看绑定结果', done: !!data.value?.bindingReady, to: '/admin/codes' },
])

const doneCount = computed(() => steps.value.filter(s => s.done).length)
const allDone = computed(() => steps.value.length > 0 && doneCount.value === steps.value.length)

/** 未取到企业（平台管理员未选企业）或已全绿时，整条隐藏 */
const visible = computed(() => !!data.value?.enterpriseId && !allDone.value)
</script>

<template>
  <div v-if="visible" class="b-card">
    <div class="b-card-head">
      <span class="b-card-title">建档流程</span>
      <span class="b-card-extra">{{ data?.enterpriseName }} · 已完成 {{ doneCount }}/{{ steps.length }} 步</span>
    </div>
    <div class="b-card-body">
      <p class="b-help mb-3 -mt-0">
        {{ canWrite ? '按顺序完成以下步骤，追溯码即可投入查询；已有外部码文件可直接上传，无需先生成。' : '当前为只读账号，可查看各步骤资料；建档请联系企业管理员。' }}
      </p>
      <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <NuxtLink
          v-for="(step, i) in steps"
          :key="step.to + i"
          :to="step.to"
          class="flex items-center gap-2.5 rounded border px-3 py-2.5 text-sm transition-colors"
          :class="step.done
            ? 'border-[var(--b-divider)] bg-[var(--b-fill-weak)] text-[var(--b-text-muted)]'
            : 'border-primary/40 bg-[var(--success-soft)] font-medium text-[var(--b-text-strong)] hover:border-primary'"
        >
          <span
            class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold"
            :class="step.done ? 'bg-[var(--success)] text-white' : 'border border-primary text-primary'"
          >
            {{ step.done ? '✓' : i + 1 }}
          </span>
          <span class="min-w-0 flex-1 truncate">{{ step.label }}</span>
          <UIcon v-if="!step.done" name="i-lucide-arrow-right" class="h-4 w-4 shrink-0 text-primary" />
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
