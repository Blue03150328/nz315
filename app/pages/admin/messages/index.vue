<script setup lang="ts">
// 消息中心（PRD 5.11：风险预警/上传完成/库存预警等站内消息）
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '消息中心' })

const toast = useToast()
const typeFilter = ref('')
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

const TYPE_STYLE: Record<string, string> = {
  risk: 'bg-error/10 text-error',
  upload_done: 'bg-success/10 text-success',
  code_stock: 'bg-warning/10 text-warning',
  account: 'bg-info/10 text-info',
  other: 'bg-muted text-muted',
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
  <div class="space-y-5">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold text-default">消息中心</h1>
        <p class="mt-1 text-sm text-muted">风险预警 · 上传完成 · 库存预警等站内通知</p>
      </div>
      <span class="rounded-full bg-error/10 px-3 py-1 text-xs font-medium text-error">
        {{ data?.unread ?? 0 }} 条未读
      </span>
    </div>

    <!-- 筛选 -->
    <div class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
      <div class="flex flex-wrap items-center gap-3">
        <USelect v-model="typeFilter" :items="[
          { value: '', label: '全部类型' },
          { value: 'risk', label: '风险预警' },
          { value: 'upload_done', label: '上传完成' },
          { value: 'code_stock', label: '库存预警' },
          { value: 'account', label: '账号安全' },
          { value: 'other', label: '系统通知' },
        ]" class="w-44" @update:model-value="doSearch" />
        <UCheckbox v-model="unreadOnly" label="只看未读" @update:model-value="doSearch" />
        <UButton color="primary" size="sm" icon="i-lucide-search" :loading="pending" @click="doSearch">查询</UButton>
      </div>
    </div>

    <!-- 消息列表 -->
    <div class="overflow-hidden rounded-xl border border-border bg-elevated shadow-sm">
      <div class="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <span class="text-sm font-semibold text-default">消息列表</span>
        <span class="text-xs text-muted">共 {{ data?.total || 0 }} 条</span>
      </div>
      <div class="divide-y divide-border/60">
        <button
          v-for="r in data?.rows || []"
          :key="r.id"
          type="button"
          class="flex w-full items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/30"
          @click="openLink(r)"
        >
          <span class="mt-0.5 h-2 w-2 shrink-0 rounded-full" :class="Number(r.is_read) === 1 ? 'bg-transparent' : 'bg-error'" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="TYPE_STYLE[r.type] || TYPE_STYLE.other">
                {{ r.typeLabel }}
              </span>
              <span class="truncate text-sm font-medium text-default">{{ r.title }}</span>
            </div>
            <p v-if="r.content" class="mt-1 truncate text-xs text-muted">{{ r.content }}</p>
            <p class="mt-1 text-xs text-muted/70">{{ String(r.created_at).slice(0, 19) }}</p>
          </div>
          <UButton v-if="Number(r.is_read) === 0" variant="ghost" color="neutral" size="xs" @click.stop="markRead(r)">标为已读</UButton>
        </button>
        <div v-if="!pending && !data?.rows?.length" class="px-4 py-12 text-center text-sm text-muted">暂无消息</div>
      </div>
      <div v-if="data?.total" class="flex items-center justify-between border-t border-border/60 px-4 py-3">
        <span class="text-xs text-muted">第 {{ data.page }} / {{ totalPages }} 页</span>
        <div class="flex gap-2">
          <UButton variant="outline" color="neutral" size="sm" :disabled="page <= 1" @click="page--; refresh()">上一页</UButton>
          <UButton variant="outline" color="neutral" size="sm" :disabled="page >= totalPages" @click="page++; refresh()">下一页</UButton>
        </div>
      </div>
    </div>
  </div>
</template>
