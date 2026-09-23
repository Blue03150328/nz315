<script setup lang="ts">
// 12 个月花费柱状图（零依赖纯 SVG 自绘，2026-09-23）
//
// 为什么不用 ECharts / chart.js：项目当前零图表依赖，而本页只要一根柱状图 + 一个环形图。
// 引入图表库意味着 ~1MB 体积、还要改 nuxt.config 的 nitro.externals 白名单 —— 收益为负。
// 自绘的代价只有几十行，收益是零依赖、零构建风险、主题色天然跟随 CSS 变量。
//
// ⚠️ 用固定 viewBox（320×180）+ `w-full h-auto` 等比缩放，**不要加 preserveAspectRatio="none"**：
//    那会让文字跟着横向拉伸变形。
const props = defineProps<{
  /** 12 项，month 为 1..12 */
  data: { month: number; amount: number }[]
  /** 需要高亮的月份（如"本季"覆盖 7/8/9 月），其余月份降淡显示 */
  highlight?: number[]
  /** 展示高度（px），宽度自适应父容器 */
  height?: number
}>()

const W = 320
const H = 180
const PAD_TOP = 22
const PAD_BOTTOM = 22
const PLOT_H = H - PAD_TOP - PAD_BOTTOM // 138

/** 纵轴上限档位：1 / 1.2 / 1.5 / 2 / 2.5 / 3 / 4 / 5 / 6 / 8 / 10 × 10^n
 *  比「直接进到下一个 10 的幂」贴合得多 —— 例如 1175 取 1200（柱高 97%）而不是 2000（柱高 59%），
 *  否则柱子会长期只占半截高度，看起来像"数据没画满"（真浏览器截图实测发现） */
const STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
const maxValue = computed(() => {
  const max = Math.max(0, ...props.data.map(d => Number(d.amount) || 0))
  if (max <= 0) return 1 // 全 0 时给 1，防止除零（此时所有柱子都按"空月"画极浅占位）
  const mag = Math.pow(10, Math.floor(Math.log10(max)))
  for (const s of STEPS) {
    if (max <= s * mag) return Math.round(s * mag * 100) / 100
  }
  return mag * 10
})

const slotW = W / 12
const barW = 14

const bars = computed(() => {
  const hl = props.highlight || []
  const hasHl = hl.length > 0
  return props.data.map((d) => {
    const amount = Number(d.amount) || 0
    const h = Math.max(0, (amount / maxValue.value) * PLOT_H)
    const x = (d.month - 1) * slotW + (slotW - barW) / 2
    return {
      month: d.month,
      amount,
      x,
      y: PAD_TOP + (PLOT_H - h),
      h,
      // 有高亮区间时，区间外的柱子降淡 —— 让"当前选中维度"一眼可辨
      dimmed: hasHl && !hl.includes(d.month),
    }
  })
})

/** 金额紧凑展示（图表空间小，用 万/k 缩短） */
const fmt = (n: number) => {
  if (n >= 10000) return (Math.round(n / 1000) / 10) + '万'
  if (n >= 1000) return (Math.round(n / 100) / 10) + 'k'
  return String(n)
}
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="w-full" :style="{ height: (height || 180) + 'px' }">
    <!-- 基线 -->
    <line
      :x1="0" :y1="PAD_TOP + PLOT_H" :x2="W" :y2="PAD_TOP + PLOT_H"
      :stroke="'var(--ui-border)'" stroke-width="1"
    />
    <!-- 纵轴上限刻度 -->
    <text :x="2" :y="PAD_TOP - 8" font-size="9" :fill="'var(--ui-text-muted)'">
      ¥{{ fmt(maxValue) }}
    </text>

    <g v-for="b in bars" :key="b.month">
      <!-- 空月也画一根极浅的占位柱，让"这个月没花钱"看得出来，而不是一片空白 -->
      <rect
        :x="b.x"
        :y="b.h > 0 ? b.y : PAD_TOP + PLOT_H - 2"
        :width="barW"
        :height="b.h > 0 ? b.h : 2"
        rx="2"
        :fill="b.amount > 0
          ? (b.dimmed ? 'var(--ui-border)' : 'var(--ui-primary)')
          : 'var(--ui-border-muted)'"
      />
      <!-- 柱子顶部金额（仅非零显示，避免 12 个 0 糊成一片） -->
      <text
        v-if="b.amount > 0"
        :x="b.x + barW / 2"
        :y="b.y - 3"
        font-size="8"
        text-anchor="middle"
        :fill="b.dimmed ? 'var(--ui-text-muted)' : 'var(--ui-text)'"
      >
        {{ fmt(b.amount) }}
      </text>
      <!-- 月份标签 -->
      <text
        :x="b.x + barW / 2"
        :y="H - 8"
        font-size="9"
        text-anchor="middle"
        :fill="b.dimmed ? 'var(--ui-text-dimmed)' : 'var(--ui-text-muted)'"
      >
        {{ b.month }}
      </text>
      <!-- 原生 tooltip（零 JS） -->
      <title>{{ b.month }}月：¥{{ b.amount.toFixed(2) }}</title>
    </g>
  </svg>
</template>
