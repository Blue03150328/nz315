<script setup lang="ts">
// 个人中心（公众端）：微信登录态 + 我的查询记录
// 决策说明：本项目「查询档案」与「查询历史」为同一份数据，统一呈现为「我的查询记录」，
// 数据来自真实扫码日志 scan_log（登录后扫码才会归属到本人），不额外维护收藏表
const toast = useToast()
const route = useRoute()

// 微信内置浏览器判定：服务端读请求头、客户端读 navigator，两侧一致避免水合不匹配
const reqHeaders = useRequestHeaders(['user-agent'])
const userAgent = import.meta.client ? navigator.userAgent : (reqHeaders['user-agent'] || '')
const isWechat = /MicroMessenger/i.test(userAgent)

const { data: meData, refresh: refreshMe } = await useFetch<any>('/api/consumer/me', { key: 'consumer-me' })
const loggedIn = computed(() => !!meData.value?.loggedIn)
const consumer = computed(() => meData.value?.consumer || null)
const wechatConfigured = computed(() => !!meData.value?.wechatConfigured)

// 查询记录：仅登录后拉取
const page_ = ref(1)
const pageSize = 20
// meData 已 await，登录态在 setup 阶段即已知：登录时立即请求，使 SSR 首屏直接带出记录
// （若用 immediate:false + watch 触发，异步刷新不会被 SSR 等待，首屏会是空列表）
const { data: history, pending, refresh: refreshHistory } = await useFetch<any>('/api/consumer/history', {
  key: 'consumer-history',
  query: computed(() => ({ page: page_.value, pageSize })),
  immediate: loggedIn.value,
})
// 客户端登录态变化（如退出后重新登录）时补拉
watch(loggedIn, (v) => { if (v) refreshHistory() })

const totalPages = computed(() => Math.max(1, Math.ceil((history.value?.total || 0) / pageSize)))

const goLogin = () => {
  // 跳转微信授权，授权后回到本页
  window.location.href = '/api/consumer/wechat/authorize?redirect=' + encodeURIComponent(route.fullPath)
}

const logout = async () => {
  try {
    await $fetch('/api/consumer/logout', { method: 'POST' })
    toast.add({ title: '已退出登录', color: 'success' })
    await refreshMe()
  } catch {
    toast.add({ title: '退出失败，请稍后重试', color: 'error' })
  }
}

// 结果标签：作废/冻结优先于码状态（与扫码页判定口径一致）
const resultBadge = (r: any) => {
  if (Number(r.abnormalFlag) === 2) return { cls: 'bg-error/10 text-error', label: '已作废' }
  if (Number(r.abnormalFlag) === 1) return { cls: 'bg-warning/10 text-warning', label: '已冻结' }
  if (r.codeStatus === null) return { cls: 'bg-muted text-muted', label: '查无此码' }
  if (Number(r.codeStatus) === 2) return { cls: 'bg-success/10 text-success', label: '正常' }
  return { cls: 'bg-info/10 text-info', label: '未绑定生产信息' }
}

useHead({ title: '个人中心 - 农资315' })
</script>

<template>
  <div class="space-y-5 px-4 pb-6 pt-5 lg:px-0 lg:pt-8">
    <div>
      <h1 class="text-3xl font-bold text-default">个人中心</h1>
      <p class="mt-1 text-sm text-muted">查看我的农药追溯查询记录</p>
    </div>

    <!-- 已登录：用户卡片 -->
    <div v-if="loggedIn" class="flex items-center gap-3 rounded-2xl border border-border bg-elevated p-4 shadow-sm">
      <img v-if="consumer?.avatar" :src="consumer.avatar" alt="微信头像" class="h-14 w-14 shrink-0 rounded-full object-cover" >
      <span v-else class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <UIcon name="i-lucide-user" class="h-7 w-7" />
      </span>
      <div class="min-w-0 flex-1">
        <div class="truncate text-lg font-semibold text-default">{{ consumer?.nickname || '微信用户' }}</div>
        <div class="mt-0.5 text-xs text-muted">已通过微信登录</div>
      </div>
      <UButton variant="outline" color="neutral" size="sm" @click="logout">退出登录</UButton>
    </div>

    <!-- 未登录：按环境给出不同引导（不做任何模拟登录） -->
    <div v-else class="rounded-2xl border border-border bg-elevated p-6 text-center shadow-sm">
      <span class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
        <UIcon name="i-lucide-user-round" class="h-8 w-8" />
      </span>
      <div class="mt-3 text-base font-semibold text-default">登录后可查看我的查询记录</div>

      <template v-if="!wechatConfigured">
        <p class="mx-auto mt-2 max-w-sm text-sm text-muted">微信登录尚未开放，请稍后再试。</p>
      </template>
      <template v-else-if="isWechat">
        <p class="mx-auto mt-2 max-w-sm text-sm text-muted">使用微信一键登录，登录后每次扫码查询会自动归入你的记录。</p>
        <UButton class="mt-4" size="lg" icon="i-lucide-log-in" @click="goLogin">微信一键登录</UButton>
      </template>
      <template v-else>
        <p class="mx-auto mt-2 max-w-sm text-sm text-muted">
          个人中心需要微信授权登录，请在<span class="font-medium text-default">微信中打开</span>本页面。
        </p>
        <div class="mx-auto mt-3 flex max-w-sm items-start gap-2 rounded-xl bg-muted/50 p-3 text-left text-xs text-muted">
          <UIcon name="i-lucide-info" class="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>在微信中扫描农药瓶身二维码，或把本页链接发送到微信后打开即可登录。</span>
        </div>
      </template>
    </div>

    <!-- 我的查询记录 -->
    <div v-if="loggedIn" class="overflow-hidden rounded-2xl border border-border bg-elevated shadow-sm">
      <div class="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <span class="flex items-center gap-2 text-sm font-semibold text-default">
          <UIcon name="i-lucide-history" class="h-4 w-4 text-primary" />
          我的查询记录
        </span>
        <span class="text-xs text-muted">共 {{ history?.total || 0 }} 条</span>
      </div>

      <div v-if="history?.rows?.length" class="divide-y divide-border/60">
        <NuxtLink
          v-for="r in history.rows"
          :key="r.id"
          :to="'/trace?code=' + encodeURIComponent(r.code)"
          class="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/30"
        >
          <span class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <UIcon name="i-lucide-package" class="h-4.5 w-4.5" />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate text-sm font-medium text-default">{{ r.productName || '未知产品' }}</span>
              <span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium" :class="resultBadge(r).cls">{{ resultBadge(r).label }}</span>
            </div>
            <div v-if="r.spec || r.holderName" class="mt-0.5 truncate text-xs text-muted">
              {{ [r.spec, r.holderName].filter(Boolean).join(' · ') }}
            </div>
            <div class="mt-1 font-code text-xs text-muted">{{ r.code }}</div>
            <div class="mt-1 flex items-center gap-3 text-xs text-muted/80">
              <span>{{ String(r.scanTime).slice(0, 16) }}</span>
              <span v-if="r.location" class="flex items-center gap-1">
                <UIcon name="i-lucide-map-pin" class="h-3 w-3" />{{ r.location }}
              </span>
            </div>
          </div>
          <UIcon name="i-lucide-chevron-right" class="mt-2 h-4 w-4 shrink-0 text-muted" />
        </NuxtLink>
      </div>

      <div v-else-if="!pending" class="px-4 py-12 text-center">
        <UIcon name="i-lucide-inbox" class="mx-auto h-10 w-10 text-muted/50" />
        <p class="mt-2 text-sm text-muted">还没有查询记录</p>
        <p class="mt-1 text-xs text-muted/80">在微信中扫描农药瓶身二维码后，记录会自动出现在这里</p>
      </div>

      <div v-if="(history?.total || 0) > pageSize" class="flex items-center justify-between border-t border-border/60 px-4 py-3">
        <span class="text-xs text-muted">第 {{ history.page }} / {{ totalPages }} 页</span>
        <div class="flex gap-2">
          <UButton variant="outline" color="neutral" size="sm" :disabled="page_ <= 1" @click="page_--; refreshHistory()">上一页</UButton>
          <UButton variant="outline" color="neutral" size="sm" :disabled="page_ >= totalPages" @click="page_++; refreshHistory()">下一页</UButton>
        </div>
      </div>
    </div>
  </div>
</template>
