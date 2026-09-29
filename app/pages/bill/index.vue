<script setup lang="ts">
// 我的账本（= 档案页，公众端 /bill）—— 2026-09-23 新增，原地替换已下线的「附近门店」
// 详见 docs/handover/29 号
//
// 页面结构（自上而下）：
//   顶部 4 张成本卡（用药 / 用肥 / 总花费 / 覆盖作物）
//   → 年份切换（有多年记录时才出现）
//   → 按月分组列表（组头年月 + 组尾「月小计」）
//   → 全年总计
//   → 每条可编辑 / 删除
//
// 🔴 三个口径必须与后端一致（`server/api/bill.get.ts`）：
//   ① 用药 = 总 − 用肥（后端算好），**不要在前端再各算一遍**，否则两边浮点误差会让
//      「用药 + 用肥 ≠ 总花费」，卡片自己跟自己打架。
//   ② 金额使用正文色，避免账本信息长期大面积使用警示红。
//   ③ 覆盖作物已排除空值，直接展示 `cropCount`。
//
// 登录态：与 `profile.vue` 同口径（微信网页授权，服务端读请求头 + 客户端读 navigator，
// 两侧一致避免水合不匹配）。未登录只能看引导，不能记账（用户已裁定：不做本地暂存）。
const toast = useToast()

const reqHeaders = useRequestHeaders(['user-agent'])
const userAgent = import.meta.client ? navigator.userAgent : (reqHeaders['user-agent'] || '')
const isWechat = /MicroMessenger/i.test(userAgent)

const { data: meData, refresh: refreshMe } = await useFetch<any>('/api/consumer/me', { key: 'consumer-me' })
const loggedIn = computed(() => !!meData.value?.loggedIn)
const wechatConfigured = computed(() => !!meData.value?.wechatConfigured)

const year = ref(new Date().getFullYear())
const filterDraft = reactive({ keyword: '', from: '', to: '', crop: '', channel: '' })
const filters = reactive({ keyword: '', from: '', to: '', crop: '', channel: '' })
const hasFilters = computed(() => Object.values(filters).some(Boolean))
const applyFilters = () => {
  if (filterDraft.from && filterDraft.to && filterDraft.from > filterDraft.to) {
    toast.add({ title: '开始日期不能晚于结束日期', color: 'warning' })
    return
  }
  Object.assign(filters, filterDraft)
}
const resetFilters = () => {
  Object.keys(filterDraft).forEach((key) => { filterDraft[key as keyof typeof filterDraft] = '' })
  Object.assign(filters, filterDraft)
}
// meData 已 await ⇒ 登录态在 setup 阶段已知，登录时立即请求（SSR 首屏直接带数据）
const { data, pending, refresh } = await useFetch<any>('/api/bill', {
  key: 'bill',
  query: computed(() => ({ year: year.value, ...filters })),
  immediate: loggedIn.value,
})
watch(loggedIn, (v) => { if (v) refresh() })

/** 年份列表：数据还没回来时至少让当年可选 */
const years = computed<number[]>(() => {
  const list: number[] = data.value?.years || []
  return list.length ? list : [new Date().getFullYear()]
})

const fmtMoney = (n: any) => (Number(n) || 0).toFixed(2)
/** 数量展示：去掉无意义的小数尾巴（2.000 → 2） */
const fmtNum = (n: any) => String(Number(n))

// ---------------- 新建 / 编辑 ----------------
const formOpen = ref(false)
const formInitial = ref<any>(null)

const openCreate = () => {
  formInitial.value = null
  formOpen.value = true
}
const openEdit = (r: any) => {
  formInitial.value = { ...r }
  formOpen.value = true
}
const onSaved = async () => { await refresh() }

// ---------------- 删除（二次确认） ----------------
const delOpen = ref(false)
const delTarget = ref<any>(null)
const delBusy = ref(false)

const askDelete = (r: any) => {
  delTarget.value = r
  delOpen.value = true
}
const doDelete = async () => {
  if (!delTarget.value) return
  delBusy.value = true
  try {
    await $fetch('/api/bill/' + delTarget.value.id, { method: 'DELETE' })
    toast.add({ title: '已删除', color: 'success' })
    delOpen.value = false
    await refresh()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '删除失败，请稍后再试', color: 'error' })
  } finally {
    delBusy.value = false
  }
}

const goLogin = () => {
  window.location.href = '/api/consumer/wechat/authorize?redirect=' + encodeURIComponent('/bill')
}
const goProfile = () => navigateTo('/profile')

useHead({ title: '我的账本 - 农资315' })
</script>

<template>
  <div class="space-y-5 px-4 pb-6 pt-5 lg:px-0 lg:pt-8">
    <!-- 页头 -->
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-3xl font-bold text-default">我的账本</h1>
        <p class="mt-1 text-sm text-muted">记录每一笔用药用肥花费</p>
      </div>
      <div v-if="loggedIn" class="flex items-center gap-2">
        <UButton to="/bill/analysis" variant="outline" color="neutral" size="sm" icon="i-lucide-chart-column">
          成本分析
        </UButton>
        <UButton size="sm" icon="i-lucide-plus" @click="openCreate">记一笔</UButton>
      </div>
    </div>

    <!-- ============ 未登录：微信登录引导 ============ -->
    <div v-if="!loggedIn" class="rounded-2xl border border-border bg-elevated p-6 text-center shadow-sm">
      <span class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
        <UIcon name="i-lucide-receipt" class="h-8 w-8" />
      </span>
      <div class="mt-3 text-base font-semibold text-default">登录后可记账、看花费统计</div>

      <template v-if="!wechatConfigured">
        <p class="mx-auto mt-2 max-w-sm text-sm text-muted">微信登录尚未开放，请稍后再试。</p>
      </template>
      <template v-else-if="isWechat">
        <p class="mx-auto mt-2 max-w-sm text-sm text-muted">
          扫码后可以顺手把这一笔记下来，登录后随时查看用药、用肥花了多少钱。
        </p>
        <UButton class="mt-4" size="lg" icon="i-lucide-log-in" @click="goLogin">微信一键登录</UButton>
      </template>
      <template v-else>
        <p class="mx-auto mt-2 max-w-sm text-sm text-muted">
          记账需要微信授权登录，请在<span class="font-medium text-default">微信中打开</span>本页面。
        </p>
        <div class="mx-auto mt-3 flex max-w-sm items-start gap-2 rounded-xl bg-muted/50 p-3 text-left text-xs text-muted">
          <UIcon name="i-lucide-info" class="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>在微信中扫描农药瓶身二维码，或把本页链接发送到微信后打开即可登录。</span>
        </div>
      </template>
    </div>

    <!-- ============ 已登录 ============ -->
    <template v-else>
      <!-- 顶部 4 张成本卡 -->
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
          <div class="flex items-center gap-2 text-muted">
            <span class="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary"><UIcon name="i-lucide-spray-can" class="h-4 w-4" /></span>
            <span class="text-xs">用药花费</span>
          </div>
          <div class="mt-1 text-xl font-bold text-default">¥{{ fmtMoney(data?.totals?.pesticide) }}</div>
        </div>
        <div class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
          <div class="flex items-center gap-2 text-muted">
            <span class="flex h-8 w-8 items-center justify-center rounded-full bg-brown/10 text-brown"><UIcon name="i-lucide-leaf" class="h-4 w-4" /></span>
            <span class="text-xs">用肥花费</span>
          </div>
          <div class="mt-1 text-xl font-bold text-default">¥{{ fmtMoney(data?.totals?.fertilizer) }}</div>
        </div>
        <div class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
          <div class="flex items-center gap-2 text-muted">
            <span class="flex h-8 w-8 items-center justify-center rounded-full bg-error/10 text-error"><UIcon name="i-lucide-wallet" class="h-4 w-4" /></span>
            <span class="text-xs">总花费</span>
          </div>
          <div class="mt-1 text-xl font-bold text-default">¥{{ fmtMoney(data?.totals?.total) }}</div>
        </div>
        <div class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
          <div class="flex items-center gap-2 text-muted">
            <span class="flex h-8 w-8 items-center justify-center rounded-full bg-success/10 text-success"><UIcon name="i-lucide-sprout" class="h-4 w-4" /></span>
            <span class="text-xs">覆盖作物</span>
          </div>
          <div class="mt-1 text-xl font-bold text-default">{{ data?.totals?.cropCount || 0 }} <span class="text-sm font-normal text-muted">种</span></div>
        </div>
      </div>

      <!-- 年份切换（仅多年份时出现） -->
      <div v-if="years.length > 1" class="flex flex-wrap gap-1.5">
        <button
          v-for="y in years"
          :key="y"
          type="button"
          class="rounded-full border px-3 py-1 text-sm transition-colors"
          :class="Number(year) === Number(y) ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border text-muted hover:text-default'"
          @click="year = Number(y)"
        >
          {{ y }} 年
        </button>
      </div>

      <!-- 搜索与筛选：默认按当前年份查询，日期范围用于缩小当前年份内的记录。 -->
      <form class="rounded-2xl border border-border bg-elevated p-4 shadow-sm" @submit.prevent="applyFilters">
        <div class="flex items-center justify-between gap-3">
          <div class="text-sm font-semibold text-default">查找账单</div>
          <button v-if="hasFilters" type="button" class="text-xs text-primary" @click="resetFilters">清除筛选</button>
        </div>
        <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
          <UInput v-model="filterDraft.keyword" class="lg:col-span-2" placeholder="搜索产品名称" icon="i-lucide-search" />
          <UInput v-model="filterDraft.from" type="date" aria-label="开始日期" />
          <UInput v-model="filterDraft.to" type="date" aria-label="结束日期" />
          <UInput v-model="filterDraft.crop" placeholder="作物（可输入）" />
          <UInput v-model="filterDraft.channel" placeholder="购买渠道（可输入）" />
          <UButton type="submit" class="sm:col-span-2 lg:col-span-1" icon="i-lucide-search">查询</UButton>
        </div>
        <p v-if="hasFilters && data" class="mt-2 text-xs text-muted">当前筛选到 {{ data.count || 0 }} 笔记录</p>
      </form>

      <!-- 数据被截断的提示（统计数字仍是全年完整值 —— 后端统计走独立聚合） -->
      <div v-if="data?.truncated" class="flex items-start gap-2 rounded-xl bg-warning-soft px-4 py-3 text-xs">
        <UIcon name="i-lucide-info" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
        <span class="text-default">本年度账单过多，列表仅显示最近 {{ 2000 }} 条；上方统计为全年完整值。</span>
      </div>

      <!-- 按月分组列表 -->
      <div v-if="data?.groups?.length" class="space-y-4">
        <div
          v-for="g in data.groups"
          :key="g.ym"
          class="overflow-hidden rounded-2xl border border-border bg-elevated shadow-sm"
        >
          <!-- 组头：年月 + 笔数 -->
          <div class="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
            <span class="text-sm font-semibold text-default">{{ g.label }}</span>
            <span class="text-xs text-muted">{{ g.count }} 笔</span>
          </div>

          <div class="divide-y divide-border/60">
            <div v-for="r in g.rows" :key="r.id" class="flex items-start gap-3 px-4 py-3">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="truncate text-sm font-medium text-default">{{ r.productName }}</span>
                  <span v-if="r.dosage" class="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{{ r.dosage }}</span>
                  <span v-if="Number(r.source) === 1" class="shrink-0 rounded-full bg-info/10 px-2 py-0.5 text-xs font-medium text-info">扫码</span>
                </div>
                <div v-if="r.category || r.crop || r.channel" class="mt-0.5 truncate text-xs text-muted">
                  {{ [r.category ? '用途：' + r.category : null, r.crop ? '作物：' + r.crop : null, r.channel].filter(Boolean).join(' · ') }}
                </div>
                <div class="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
                  <span>{{ r.billDate }}</span>
                  <span v-if="r.quantity !== null || r.unitPrice !== null">
                    {{ [r.quantity !== null ? fmtNum(r.quantity) + (r.unit || '') : null, r.unitPrice !== null ? '¥' + fmtMoney(r.unitPrice) + '/单位' : null].filter(Boolean).join(' × ') }}
                  </span>
                </div>
                <div v-if="r.remark" class="mt-0.5 truncate text-xs text-muted/80">备注：{{ r.remark }}</div>
              </div>

              <div class="shrink-0 text-right">
                <div class="text-base font-bold text-default">¥{{ fmtMoney(r.totalAmount) }}</div>
                <div class="mt-1 flex justify-end gap-0.5">
                  <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-pencil" aria-label="编辑" @click="openEdit(r)" />
                  <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" aria-label="删除" @click="askDelete(r)" />
                </div>
              </div>
            </div>
          </div>

          <!-- 组尾：月小计 -->
          <div class="flex items-center justify-between border-t border-border/60 bg-muted/30 px-4 py-2.5">
            <span class="text-xs text-muted">{{ g.label }}小计</span>
            <span class="text-sm font-semibold text-default">¥{{ fmtMoney(g.subtotal) }}</span>
          </div>
        </div>

        <!-- 全年总计 -->
        <div class="flex items-center justify-between rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3.5">
          <span class="text-sm font-semibold text-default">{{ data.year }} 年总计</span>
          <span class="text-xl font-bold text-default">¥{{ fmtMoney(data.grandTotal) }}</span>
        </div>
      </div>

      <!-- 空态 -->
      <div v-else-if="!pending" class="rounded-2xl border border-border bg-elevated px-4 py-12 text-center shadow-sm">
        <UIcon name="i-lucide-receipt" class="mx-auto h-10 w-10 text-muted/50" />
        <p class="mt-2 text-sm text-muted">{{ hasFilters ? '没有符合条件的记账记录' : data?.year + ' 年还没有记账' }}</p>
        <p class="mt-1 text-xs text-muted/80">{{ hasFilters ? '可以调整筛选条件，或清除筛选查看全部记录' : '扫农药瓶身二维码后可一键记一笔，也可以手动添加' }}</p>
        <UButton v-if="!hasFilters" class="mt-4" icon="i-lucide-plus" @click="openCreate">手动记一笔</UButton>
        <UButton v-else class="mt-4" variant="outline" color="neutral" @click="resetFilters">清除筛选</UButton>
      </div>
    </template>

    <!-- 记账表单（新建 / 编辑） -->
    <BillFormModal v-model:open="formOpen" :initial="formInitial" @saved="onSaved" />

    <!-- 删除确认 -->
    <UModal v-model:open="delOpen">
      <template #content>
        <div class="p-5">
          <h3 class="text-base font-semibold text-default">删除这条记账？</h3>
          <p class="mt-2 text-sm text-muted">
            {{ delTarget?.productName }}
            <span class="font-medium text-default">¥{{ fmtMoney(delTarget?.totalAmount) }}</span>
          </p>
          <p class="mt-1 text-xs text-muted">删除后不可恢复。</p>
          <div class="mt-5 flex justify-end gap-2">
            <UButton variant="outline" color="neutral" @click="delOpen = false">取消</UButton>
            <UButton color="error" :loading="delBusy" @click="doDelete">删除</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
