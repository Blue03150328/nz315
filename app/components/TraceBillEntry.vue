<script setup lang="ts">
// 公众端扫码结果页「一键记账」入口（2026-09-23 新增）
//
// 为什么需要它：记账功能上线时（29 号方案）**后端与表单都已按「扫码记账」设计好了** ——
//   · `POST /api/bill` 的 `source` 字段：1 = 扫码、2 = 手动（`bill-input.ts` 里带 `code` 时默认 1）
//   · `BillFormModal` 的 `initial` prop 注释写着「扫码预填：调用方把 initial 传进来即自动带入产品名/类别/追溯码」
//   · `bill-category.ts` 开头写着类别要供「① 扫码结果页按产品原始类别自动预填」使用
//   · `/bill` 空态文案也写着「扫码后可以顺手把这一笔记下来」
// —— **唯独扫码结果页上没有这个入口**，于是整条链路断在最后一步：用户扫完码，
//   拿不到产品名，回头还得自己去账本里手打一遍。
//
// 交互（一次点击 + 一次保存）：
//   已登录 → 直接打开**预填好**的记账表单（产品名 / 类别 / 追溯码已带入），用户只补数量金额；
//   未登录 → 先弹一句说明（账目归属、为何要登录），再一键直达微信授权；
//            授权回跳时带 `bill=1`，本组件自动把表单打开，用户不必再点一次。
//
// 未登录不做本地暂存（用户已裁定），也不在非微信环境给假登录入口 —— 微信网页授权在普通浏览器里走不通。
//
// ✅ 2026-09-23 已**统一到本组件**（用户裁定「和新组件统一」）：正品页 `TraceResult.vue` 里那份
//    内联实现已删除 —— 现在四个结果页全部走这里：正品页（页头小按钮）/ 外码页 / 异常页 / 查无此码页。
//    统一前那份的差异：未登录时引导去 `/profile` 绕一圈、弹窗文案少一句、不支持授权回跳自动开表单。
//    （同类抽取的理由见 `TraceFeedback.vue`：两套实现必然漂移。）
//
// ⚠️ 各结果页的预填口径**有意不同，别顺手"统一"掉**：
//   · 正品页 / 异常页（非作废码）→ 产品名与类别都预填（产品已知）
//   · 异常页里的**作废码** → 都不预填（该页刻意不展示产品信息，不把没展示的东西写进用户账本）
//   · 外码页 → **仅在唯一候选时**才预填（后六位撞车多候选时，预填错误产品名比不预填更糟）
//   · 查无此码页 → 都不预填（码本身就不存在，无产品信息可给）
import { normalizeBillCategory } from '#shared/utils/bill-category'

const props = defineProps<{
  /** 本次扫码的 32 位追溯码（作为账单来源，`source=1 扫码`） */
  code: string
  /** 预填的产品名称 */
  productName?: string
  /** 产品原始类别（登记库/产品库原文，如「除草剂」）—— 交给 `normalizeBillCategory` 归一化到 6 类白名单 */
  category?: string
  label?: string
  variant?: 'solid' | 'outline' | 'soft' | 'subtle' | 'ghost' | 'link'
  color?: 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'
  size?: 'xs' | 'sm' | 'md' | 'lg'
  icon?: string
  block?: boolean
}>()

const route = useRoute()
const router = useRouter()
const toast = useToast()

// 登录态：与 `bill/index.vue`、`profile.vue` 同口径（微信网页授权；服务端读请求头、客户端读 navigator，
// 两侧一致以避免水合不匹配）。`key: 'consumer-me'` 与账本页共用同一份 payload 缓存，不会多打一次请求。
const reqHeaders = useRequestHeaders(['user-agent'])
const userAgent = import.meta.client ? navigator.userAgent : (reqHeaders['user-agent'] || '')
const isWechat = /MicroMessenger/i.test(userAgent)

const { data: meData } = useFetch<any>('/api/consumer/me', { key: 'consumer-me' })
const loggedIn = computed(() => !!meData.value?.loggedIn)
const wechatConfigured = computed(() => !!meData.value?.wechatConfigured)

const open = ref(false)
/** 未登录时的说明弹窗：先讲清「账目归属本人 + 为何要登录」，再给直达授权的按钮 */
const loginTipOpen = ref(false)

/** 记账表单预填值（带 `code` ⇒ 服务端落 `source=1 扫码`） */
const initial = computed(() => ({
  productName: props.productName || '',
  category: normalizeBillCategory(props.category || props.productName || ''),
  code: props.code || '',
}))

/** 授权回跳目标：本页原样 + `bill=1`（回跳后自动打开表单，用户不用再点一次） */
const backWithBill = computed(() => {
  const p = route.fullPath || '/'
  return p + (p.includes('?') ? '&' : '?') + 'bill=1'
})

// ⚠️ 刻意不用 `await useFetch`：本组件嵌在扫码结果页里，`await` 会让**整个页面**的 SSR
//    等这次请求（扫码场景首屏秒开是硬指标）。代价是 `meData` 可能尚未就绪，
//    故点击时补一次按需取数，避免「已登录却被判成未登录、白弹一次登录提示」。
const onEntry = async () => {
  if (!meData.value) {
    try { meData.value = await $fetch<any>('/api/consumer/me') } catch { /* 取不到就按未登录处理 */ }
  }
  if (loggedIn.value) { open.value = true; return }
  loginTipOpen.value = true
}

/** 直达微信授权；授权后回跳本页并自动打开记账表单 */
const goLogin = () => {
  if (!wechatConfigured.value) {
    toast.add({ title: '微信登录尚未开放，暂时无法记账', color: 'warning' })
    return
  }
  if (!isWechat) {
    toast.add({ title: '请在微信中打开本页后再登录记账', color: 'warning' })
    return
  }
  window.location.href = '/api/consumer/wechat/authorize?redirect=' + encodeURIComponent(backWithBill.value)
}

// 授权回跳后自动打开；同时清掉 URL 上的记号，避免用户刷新时反复弹窗
onMounted(() => {
  if (route.query.bill !== '1') return
  const q: Record<string, any> = { ...route.query }
  delete q.bill
  router.replace({ query: q })
  if (loggedIn.value) open.value = true
})
</script>

<template>
  <div :class="block ? 'w-full' : 'inline-block'">
    <UButton
      :variant="variant || 'solid'"
      :color="color || 'primary'"
      :size="size || 'lg'"
      :icon="icon || 'i-lucide-receipt-text'"
      :block="block"
      @click="onEntry"
    >
      {{ label || '记一笔账' }}
    </UButton>

    <BillFormModal v-model:open="open" :initial="initial" />

    <!-- 未登录：先解释，再一键直达微信授权（不绕「我的」页，扫码场景少两步） -->
    <UModal v-model:open="loginTipOpen">
      <template #content>
        <div class="p-5">
          <h3 class="text-base font-semibold text-default">记账需要先登录</h3>
          <p class="mt-1 text-xs leading-relaxed text-muted">
            账目保存在你的微信账号下，只有你自己能看。登录后每次扫码都能顺手记一笔，
            随时查看用药、用肥花了多少钱。
          </p>
          <div class="mt-5 flex justify-end gap-2">
            <UButton variant="outline" color="neutral" @click="loginTipOpen = false">取消</UButton>
            <UButton color="primary" icon="i-lucide-log-in" @click="goLogin">微信一键登录</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
