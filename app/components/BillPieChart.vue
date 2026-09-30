<script setup lang="ts">
// 类别花费环形图（零依赖纯 SVG 自绘，2026-09-23；理由见 BillBarChart.vue 头部注释）
//
// 实现要点：用**单个 circle 的 `stroke-dasharray` 分段**画环，而不是 path 弧线 ——
//   path 弧线要算起止角与 large-arc-flag，12 个类别里只要有一段是 100% 就会退化（首尾同点画不出来）；
//   dasharray 方案天然没有这个问题（每段就是一个 dash），代码量还少一半。
//   整环旋转 -90° 让起点回到 12 点方向（符合"从顶部顺时针"的阅读直觉）。
//
// 🔴 颜色按**原始数组索引**取（不按"过滤掉 0 之后的顺序"）：
//    否则某一类别为 0 时，后面所有类别的颜色都会前移错位，用户会看到"肥料变成了灰色"这种诡异现象。
const props = defineProps<{
  /** 全量类别（含金额为 0 的项），顺序即颜色映射顺序 */
  data: { label: string; amount: number }[]
  height?: number
}>()

/** 固定调色板：全部走主题 CSS 变量（不硬编码十六进制，保证跟随主题） */
const PALETTE = [
  'var(--ui-primary)',   // 深绿
  'var(--ui-success)',   // 绿
  'var(--ui-warning)',   // 橙
  'var(--ui-info)',      // 蓝
  'var(--brown)',        // 棕
  'var(--ui-text-muted)', // 灰（其他）
]

const CX = 90
const CY = 90
const R = 58
const STROKE = 26
const C = 2 * Math.PI * R

const total = computed(() => props.data.reduce((s, d) => s + (Number(d.amount) || 0), 0))

const segments = computed(() => {
  let acc = 0
  const out: { label: string; amount: number; percent: number; dash: string; offset: number; color: string }[] = []
  props.data.forEach((d, idx) => {
    const amount = Number(d.amount) || 0
    if (amount <= 0) return
    const len = total.value > 0 ? (amount / total.value) * C : 0
    // 段间留 2px 视觉缝隙；太短的段不留（否则小占比会被缝隙吃掉看不见）
    const gap = len > 6 ? 2 : 0
    out.push({
      label: d.label,
      amount,
      percent: total.value > 0 ? Math.round((amount / total.value) * 1000) / 10 : 0,
      dash: Math.max(0, len - gap) + ' ' + (C - Math.max(0, len - gap)),
      offset: -acc,
      color: PALETTE[idx % PALETTE.length],
    })
    acc += len
  })
  return out
})

const fmt = (n: number) => (Math.round(n * 100) / 100).toFixed(2)
</script>

<template>
  <div class="flex flex-col items-center gap-4 sm:flex-row">
    <svg viewBox="0 0 180 180" class="shrink-0" :style="{ width: (height || 150) + 'px', height: (height || 150) + 'px' }">
      <g transform="rotate(-90 90 90)">
        <!-- 空态底环：没有数据时也画一圈浅灰，避免一块空白 -->
        <circle
          :cx="CX" :cy="CY" :r="R"
          fill="none" stroke-width="26" :stroke="'var(--ui-border-muted)'"
        />
        <circle
          v-for="s in segments"
          :key="s.label"
          :cx="CX" :cy="CY" :r="R"
          fill="none"
          :stroke="s.color"
          :stroke-width="STROKE"
          :stroke-dasharray="s.dash"
          :stroke-dashoffset="s.offset"
        >
          <title>{{ s.label }}：¥{{ fmt(s.amount) }}（{{ s.percent }}%）</title>
        </circle>
      </g>
      <!-- 圆心总额 -->
      <text x="90" y="86" text-anchor="middle" font-size="11" :fill="'var(--ui-text-muted)'">合计</text>
      <text x="90" y="103" text-anchor="middle" font-size="16" font-weight="700" :fill="'var(--ui-text)'">
        {{ total > 0 ? '¥' + fmt(total) : '—' }}
      </text>
    </svg>

    <!-- 图例 + 金额（比只看饼图更能读出具体数字） -->
    <div class="w-full min-w-0 flex-1 space-y-1.5">
      <div
        v-for="(s, i) in segments"
        :key="s.label"
        class="flex items-center gap-2 text-sm"
      >
        <span class="h-2.5 w-2.5 shrink-0 rounded-full" :style="{ background: s.color }" />
        <span class="flex-1 truncate text-default">{{ s.label }}</span>
        <span class="shrink-0 font-medium text-default">¥{{ fmt(s.amount) }}</span>
        <span class="w-12 shrink-0 text-right text-xs text-muted">{{ s.percent }}%</span>
      </div>
      <div v-if="!segments.length" class="text-xs text-muted">暂无花费记录</div>
    </div>
  </div>
</template>
