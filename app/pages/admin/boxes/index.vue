<script setup lang="ts">
// 外箱码管理（PRD 5.5.6：上传绑定/查询/解绑）
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '外箱码管理' })

const toast = useToast()
const pasteText = ref('')
const fileName = ref('')
const parsing = ref(false)
const parseResult = ref<any>(null)
const binding = ref(false)

const filters = reactive({ keyword: '' })
const page = ref(1)
const pageSize = 20

const { data, pending, refresh } = await useFetch<any>('/api/admin/boxes', {
  key: 'admin-boxes',
  query: computed(() => ({
    keyword: filters.keyword || undefined,
    page: page.value, pageSize,
  })),
})
const totalPages = computed(() => Math.max(1, Math.ceil((data.value?.total || 0) / pageSize)))

// 详情对话框
const showDetail = ref(false)
const detail = ref<any>(null)

const openDetail = async (outer: string) => {
  try {
    detail.value = await $fetch('/api/admin/boxes/' + encodeURIComponent(outer))
    showDetail.value = true
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '查询失败', color: 'error' })
  }
}

// 解绑对话框
const showUnbind = ref(false)
const unbindOuter = ref('')
const unbindConfirm = ref('')
const unbinding = ref(false)

const openUnbind = (outer: string) => {
  unbindOuter.value = outer
  unbindConfirm.value = ''
  showUnbind.value = true
}
const doUnbind = async () => {
  unbinding.value = true
  try {
    const res = await $fetch('/api/admin/boxes/unbind', { method: 'POST', body: { outer: unbindOuter.value, confirm: unbindConfirm.value } })
    toast.add({ title: '已解绑 ' + res.unbound + ' 条单品码', color: 'success' })
    showUnbind.value = false
    refresh()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '解绑失败', color: 'error' })
  } finally {
    unbinding.value = false
  }
}

const doParse = async () => {
  if (!pasteText.value.trim()) { toast.add({ title: '请粘贴外箱码文件内容', color: 'warning' }); return }
  parsing.value = true
  try {
    parseResult.value = await $fetch('/api/admin/boxes/parse', { method: 'POST', body: { content: pasteText.value, fileName: fileName.value } })
    toast.add({ title: '解析完成：有效 ' + parseResult.value.validCount + ' / 无效 ' + parseResult.value.invalidCount, color: 'success' })
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '解析失败', color: 'error' })
  } finally {
    parsing.value = false
  }
}

const doBind = async () => {
  const validPairs = (parseResult.value?.preview || []).length ? [] : []
  // 从 preview 拿不全所有行——重新用原始内容：这里简化，后端 bind 用全量
  // 由于 parse 返回 preview 仅前 20 条，改为传原始 content 行：bind 需要 pairs，这里直接按 preview 绑定会丢数据。
  // 解决方案：parse 返回全部 valid pairs 的引用（文件不大时）——前端重新解析文本
  binding.value = true
  try {
    const lines = pasteText.value.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    const pairs = lines.map(l => {
      const parts = l.split(/[, \t]+/).filter(Boolean)
      return { outer: parts[0], inner: parts[1] }
    }).filter(p => p.outer && p.inner)
    const res = await $fetch('/api/admin/boxes/bind', { method: 'POST', body: { pairs } })
    toast.add({ title: '绑定成功：' + res.bound + ' 条单品码（' + res.boxes + ' 个外箱）', color: 'success' })
    parseResult.value = null
    pasteText.value = ''
    refresh()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '绑定失败', color: 'error' })
  } finally {
    binding.value = false
  }
}

const reasonChips = computed(() => {
  const rc = parseResult.value?.reasonCount || {}
  return Object.entries(rc).map(([label, count]) => ({ label, count }))
})

const doSearch = () => { page.value = 1; refresh() }
</script>

<template>
  <div class="space-y-5">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold text-default">外箱码管理</h1>
        <p class="mt-1 text-sm text-muted">外箱码关联箱内单品码（一对多）· 单品码不可重复归属 · 外箱码本身不参与扫码追溯</p>
      </div>
    </div>

    <!-- 上传绑定 -->
    <div class="rounded-xl border border-border bg-elevated p-5 shadow-sm">
      <h2 class="text-sm font-semibold text-default">1. 上传外箱码文件</h2>
      <p class="mt-1 text-xs text-muted">格式：每行"外箱码,单品码"（32 位数字，CSV 两列）</p>
      <div class="mt-3">
        <UTextarea v-model="pasteText" :rows="6" placeholder="12301011001000000000000000000001,12301011001000000000000000001001&#10;12301011001000000000000000000001,12301011001000000000000000001002" class="font-code text-xs" />
      </div>
      <div class="mt-3 flex items-center gap-2">
        <UButton color="primary" icon="i-lucide-scan-search" :loading="parsing" @click="doParse">解析校验</UButton>
        <span class="text-xs text-muted">校验：外箱码全局唯一 · 单品码在系统内且异常标记为正常 · 单品码未归属其他外箱</span>
      </div>

      <div v-if="parseResult" class="mt-4 rounded-lg border border-border/60 bg-muted/20 p-4">
        <div class="grid grid-cols-3 gap-3">
          <div class="rounded-lg bg-elevated p-3 text-center">
            <div class="text-2xl font-bold text-default">{{ parseResult.total }}</div>
            <div class="mt-1 text-xs text-muted">总关联行</div>
          </div>
          <div class="rounded-lg bg-success/5 p-3 text-center">
            <div class="text-2xl font-bold text-success">{{ parseResult.validCount }}</div>
            <div class="mt-1 text-xs text-muted">校验通过</div>
          </div>
          <div class="rounded-lg bg-error/5 p-3 text-center">
            <div class="text-2xl font-bold text-error">{{ parseResult.invalidCount }}</div>
            <div class="mt-1 text-xs text-muted">校验失败</div>
          </div>
        </div>
        <div v-if="reasonChips.length" class="mt-3 flex flex-wrap gap-2">
          <span v-for="c in reasonChips" :key="c.label" class="rounded-full bg-error/10 px-3 py-1 text-xs text-error">{{ c.label }} × {{ c.count }}</span>
        </div>
        <div v-if="parseResult.boxGroups?.length" class="mt-3 text-xs text-primary">
          涉及外箱：<span v-for="g in parseResult.boxGroups" :key="g.code" class="mr-3 font-code">{{ g.code }}（{{ g.count }} 条）</span>
        </div>
        <UButton class="mt-4" color="primary" icon="i-lucide-link-2" :loading="binding" @click="doBind">
          确认绑定（{{ parseResult.validCount }} 条有效关联）
        </UButton>
      </div>
    </div>

    <!-- 外箱码列表 -->
    <div class="overflow-hidden rounded-xl border border-border bg-elevated shadow-sm">
      <div class="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div class="flex items-center gap-3">
          <span class="text-sm font-semibold text-default">外箱码列表</span>
          <UInput v-model="filters.keyword" placeholder="外箱码" icon="i-lucide-search" size="sm" class="w-64" @keyup.enter="doSearch" />
          <UButton color="primary" size="sm" icon="i-lucide-search" :loading="pending" @click="doSearch">查询</UButton>
        </div>
        <span class="text-xs text-muted">共 {{ data?.total || 0 }} 个外箱</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-border/60 bg-muted/30 text-xs text-muted">
              <th class="px-4 py-3 font-medium">外箱码</th>
              <th class="px-4 py-3 font-medium">箱内单品码数</th>
              <th class="px-4 py-3 font-medium">箱状态</th>
              <th class="px-4 py-3 font-medium">最近关联时间</th>
              <th class="px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in data?.rows || []" :key="r.outer_box_code" class="border-b border-border/40 transition-colors hover:bg-muted/30">
              <td class="px-4 py-3 font-code text-xs text-default">{{ r.outer_box_code }}</td>
              <td class="px-4 py-3 font-medium text-default">{{ r.inner_count }}</td>
              <td class="px-4 py-3">
                <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="r.max_flag === 2 ? 'bg-error/10 text-error' : r.max_flag === 1 ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'">
                  {{ r.flagLabel }}
                </span>
              </td>
              <td class="px-4 py-3 text-muted">{{ String(r.updated_at).slice(0, 19) }}</td>
              <td class="px-4 py-3">
                <div class="flex gap-1.5">
                  <UButton variant="ghost" color="primary" size="xs" icon="i-lucide-eye" @click="openDetail(r.outer_box_code)">查看</UButton>
                  <UButton variant="ghost" color="error" size="xs" icon="i-lucide-unlink" @click="openUnbind(r.outer_box_code)">解绑</UButton>
                </div>
              </td>
            </tr>
            <tr v-if="!pending && !data?.rows?.length">
              <td colspan="5" class="px-4 py-10 text-center text-sm text-muted">暂无外箱码，请先上传绑定</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="data?.total" class="flex items-center justify-between border-t border-border/60 px-4 py-3">
        <span class="text-xs text-muted">第 {{ data.page }} / {{ totalPages }} 页</span>
        <div class="flex gap-2">
          <UButton variant="outline" color="neutral" size="sm" :disabled="page <= 1" @click="page--; refresh()">上一页</UButton>
          <UButton variant="outline" color="neutral" size="sm" :disabled="page >= totalPages" @click="page++; refresh()">下一页</UButton>
        </div>
      </div>
    </div>

    <!-- 箱内码详情 -->
    <UModal v-model="showDetail">
      <div class="max-h-[70vh] overflow-y-auto p-5">
        <h3 class="text-base font-semibold text-default">外箱码详情</h3>
        <p class="mt-1 break-all font-code text-xs text-muted">{{ detail?.outerBoxCode }}</p>
        <div class="mt-4 overflow-x-auto rounded-lg border border-border/60">
          <table class="w-full text-left text-xs">
            <thead>
              <tr class="border-b border-border/60 bg-muted/30 text-muted">
                <th class="px-3 py-2 font-medium">单品码</th>
                <th class="px-3 py-2 font-medium">产品</th>
                <th class="px-3 py-2 font-medium">状态</th>
                <th class="px-3 py-2 font-medium">标记</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in detail?.rows || []" :key="r.id" class="border-b border-border/40">
                <td class="px-3 py-2 font-code">{{ r.code }}</td>
                <td class="px-3 py-2 text-muted">{{ r.product_name || '-' }}</td>
                <td class="px-3 py-2">{{ r.statusLabel }}</td>
                <td class="px-3 py-2" :class="r.abnormal_flag === 2 ? 'text-error' : r.abnormal_flag === 1 ? 'text-warning' : 'text-success'">{{ r.flagLabel }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </UModal>

    <!-- 解绑确认 -->
    <UModal v-model="showUnbind">
      <div class="p-5">
        <h3 class="text-base font-semibold text-default">解绑外箱码</h3>
        <p class="mt-1 break-all font-code text-xs text-muted">{{ unbindOuter }}</p>
        <p class="mt-2 rounded-lg bg-error/5 p-3 text-xs text-error">解绑后箱内单品码可重新归属其他外箱码，此操作不可撤销</p>
        <div class="mt-3 space-y-1.5">
          <label class="block text-sm font-medium text-default">输入"确认解绑"以确认 <span class="text-error">*</span></label>
          <UInput v-model="unbindConfirm" placeholder="确认解绑" />
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <UButton variant="outline" color="neutral" @click="showUnbind = false">取消</UButton>
          <UButton color="error" :loading="unbinding" :disabled="unbindConfirm !== '确认解绑'" @click="doUnbind">确认解绑</UButton>
        </div>
      </div>
    </UModal>
  </div>
</template>
