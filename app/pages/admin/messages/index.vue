<script setup lang="ts">
// 消息中心（PRD 5.11：风险预警/上传完成/库存预警等站内消息）
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '消息中心' })

const toast = useToast()
// 类型筛选：默认 undefined（Nuxt UI v4 空值自动显示 placeholder，禁止空字符串 value 选项）
const typeFilter = ref<string | undefined>(undefined)
const unreadOnly = ref(false)
const page = ref(1)
const pageSize = 20

const { data, pending, refresh } = await useFetch<any>('/api/admin/messages', {
  key: 'admin-messages',
  query: computed(() => ({
    type: typeFilter.value || undefined,
    unread: unreadOnly.value ? '1' : undefined,
    page: page.value, pageSize,
  })),
})

const totalPages = computed(() => Math.max(1, Math.ceil((data.value?.total || 0) / pageSize)))

// 消息类型标签配色：统一 B 端「浅底深字」语义类
const TYPE_STYLE: Record<string, string> = {
  risk: 'b-tag-danger',
  upload_done: 'b-tag-success',
  code_stock: 'b-tag-warning',
  account: 'b-tag-info',
  other: 'b-tag-default',
}

const markRead = async (row: any) => {
  if (Number(row.is_read) === 1) return
  try {
    await $fetch('/api/admin/messages/' + row.id, { method: 'PATCH', body: { isRead: 1 } })
    row.is_read = 1
    refresh()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '操作失败', color: 'error' })
  }
}

const openLink = (row: any) => {
  markRead(row)
  if (row.link) navigateTo(row.link)
}

const doSearch = () => { page.value = 1; refresh() }
</script>

<template>
  <div class="space-y-4">
    <!-- 页面标题区 -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="b-page-title">消息中心</h1>
        <p class="b-page-desc">风险预警 · 上传完成 · 库存预警等站内通知</p>
      </div>
      <span class="b-tag" :class="(data?.unread ?? 0) > 0 ? 'b-tag-danger' : 'b-tag-default'">{{ data?.unread ?? 0 }} 条未读</span>
    </div>

    <!-- 筛选查询区 -->
    <div class="b-card">
      <div class="b-card-head">
        <span class="b-card-title">筛选查询</span>
      </div>
      <div class="b-form-grid md:grid-cols-2 xl:grid-cols-4">
        <div>
          <label class="b-label">消息类型</label>
          <USelect
            v-model="typeFilter" placeholder="全部类型" class="w-full"
            :items="[
              { value: 'risk', label: '风险预警' },
              { value: 'upload_done', label: '上传完成' },
              { value: 'code_stock', label: '库存预警' },
              { value: 'account', label: '账号安全' },
              { value: 'other', label: '系统通知' },
            ]"
            @update:model-value="doSearch"
          />
        </div>
        <div>
          <label class="b-label">阅读状态</label>
          <div class="flex h-8 items-center">
            <UCheckbox v-model="unreadOnly" color="neutral" label="只看未读" @update:model-value="doSearch" />
          </div>
        </div>
      </div>
      <div class="b-card-foot">
        <span class="b-card-extra">共 <span class="font-medium b-strong">{{ data?.total || 0 }}</span> 条消息 · 未读 {{ data?.unread ?? 0 }} 条</span>
        <div class="flex items-center gap-2">
          <UButton color="neutral" variant="solid" :loading="pending" @click="doSearch">查询</UButton>
        </div>
      </div>
    </div>

    <!-- 消息列表 -->
    <div class="b-card b-card-clip">
      <div class="b-card-head">
        <span class="b-card-title">消息列表</span>
        <span class="b-card-extra">每页 {{ pageSize }} 条 · 共 {{ data?.total || 0 }} 条</span>
      </div>
      <div>
        <button
          v-for="r in data?.rows || []"
          :key="r.id"
          type="button"
          class="flex w-full items-start gap-2.5 border-b border-[var(--b-divider)] px-4 py-3 text-left transition-colors hover:bg-[var(--b-fill)]"
          @click="openLink(r)"
        >
          <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" :class="Number(r.is_read) === 1 ? 'bg-transparent' : 'bg-red-500'" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="b-tag" :class="TYPE_STYLE[r.type] || TYPE_STYLE.other">{{ r.typeLabel }}</span>
              <span class="truncate text-sm font-medium b-strong">{{ r.title }}</span>
            </div>
            <p v-if="r.content" class="mt-1 truncate text-xs text-[var(--b-text-regular)]">{{ r.content }}</p>
            <p class="mt-1 text-xs text-[var(--b-text-muted)]">{{ String(r.created_at).slice(0, 19) }}</p>
          </div>
          <UButton v-if="Number(r.is_read) === 0" variant="link" color="neutral" size="xs" @click.stop="markRead(r)">标为已读</UButton>
        </button>
        <div v-if="!pending && !data?.rows?.length" class="b-empty">
          <div class="b-empty-inner">
            <UIcon name="i-lucide-inbox" class="b-empty-icon h-8 w-8" />
            <span class="text-sm">暂无消息</span>
          </div>
        </div>
      </div>
      <div v-if="data?.total" class="b-pager">
        <span class="b-card-extra">共 {{ data?.total || 0 }} 条 · 第 {{ data.page }} / {{ totalPages }} 页</span>
        <div class="flex items-center gap-2">
          <UButton variant="outline" color="neutral" size="sm" :disabled="page <= 1" @click="page--; refresh()">上一页</UButton>
          <UButton variant="outline" color="neutral" size="sm" :disabled="page >= totalPages" @click="page++; refresh()">下一页</UButton>
        </div>
      </div>
    </div>
  </div>
</template>
