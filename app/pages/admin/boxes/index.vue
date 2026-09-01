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
  <div class="space-y-4">
    <!-- 页面标题区 -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="b-page-title">外箱码管理</h1>
        <p class="b-page-desc">外箱码关联箱内单品码（一对多）· 单品码不可重复归属 · 外箱码本身不参与扫码追溯</p>
      </div>
    </div>

    <!-- 上传绑定区：粘贴关联清单 → 解析校验 → 确认绑定 -->
    <div class="b-card">
      <div class="b-card-head">
        <span class="b-card-title">上传外箱码文件</span>
        <span class="b-card-extra">格式：每行「外箱码,单品码」（32 位数字，CSV 两列）</span>
      </div>
      <div class="b-card-body">
        <label class="b-label">外箱码与单品码关联清单</label>
        <UTextarea v-model="pasteText" :rows="6" placeholder="12301011001000000000000000000001,12301011001000000000000000001001&#10;12301011001000000000000000000001,12301011001000000000000000001002" class="font-code text-xs" />
        <p class="b-help">每行一条：外箱码在前、单品码在后，可用英文逗号、空格或制表符分隔</p>

        <!-- 解析结果：三项指标 + 失败原因分布 + 涉及外箱 -->
        <div v-if="parseResult" class="mt-4 rounded-sm border border-[var(--b-border)] bg-[var(--b-fill)] p-3.5">
          <div class="mb-3 flex items-center justify-between">
            <span class="b-card-title">解析结果</span>
            <span class="b-card-extra">共 {{ parseResult.total }} 行关联记录</span>
          </div>
          <div class="grid grid-cols-3 gap-3">
            <div class="b-stat">
              <div class="b-stat-label">总关联行</div>
              <div class="b-stat-value">{{ parseResult.total }}</div>
            </div>
            <div class="b-stat">
              <div class="b-stat-label">校验通过</div>
              <div class="b-stat-value text-emerald-700">{{ parseResult.validCount }}</div>
            </div>
            <div class="b-stat">
              <div class="b-stat-label">校验失败</div>
              <div class="b-stat-value text-red-600">{{ parseResult.invalidCount }}</div>
            </div>
          </div>
          <div v-if="reasonChips.length" class="mt-3 flex flex-wrap gap-2">
            <span v-for="c in reasonChips" :key="c.label" class="b-tag b-tag-danger">{{ c.label }} × {{ c.count }}</span>
          </div>
          <div v-if="parseResult.boxGroups?.length" class="mt-3 text-xs text-[var(--b-text-regular)]">
            涉及外箱：<span v-for="g in parseResult.boxGroups" :key="g.code" class="mr-3 font-code text-[var(--b-text-strong)]">{{ g.code }}（{{ g.count }} 条）</span>
          </div>
          <div class="mt-3.5 flex justify-end">
            <UButton color="neutral" variant="solid" icon="i-lucide-link-2" :loading="binding" @click="doBind">
              确认绑定（{{ parseResult.validCount }} 条有效关联）
            </UButton>
          </div>
        </div>
      </div>
      <!-- 上传区底部操作条：左侧校验规则说明，右侧解析按钮 -->
      <div class="b-card-foot">
        <span class="b-card-extra">校验规则：外箱码全局唯一 · 单品码在系统内且异常标记为正常 · 单品码未归属其他外箱</span>
        <UButton color="neutral" variant="solid" icon="i-lucide-scan-search" :loading="parsing" @click="doParse">解析校验</UButton>
      </div>
    </div>

    <!-- 筛选查询区 -->
    <div class="b-card">
      <div class="b-card-head">
        <span class="b-card-title">筛选查询</span>
      </div>
      <div class="b-form-grid md:grid-cols-2 xl:grid-cols-4">
        <div>
          <label class="b-label">外箱码</label>
          <UInput v-model="filters.keyword" placeholder="输入外箱码" icon="i-lucide-search" @keyup.enter="doSearch" />
        </div>
      </div>
      <div class="b-card-foot">
        <span class="b-card-extra">共 <span class="font-medium b-strong">{{ data?.total || 0 }}</span> 个外箱</span>
        <div class="flex items-center gap-2">
          <UButton color="neutral" variant="solid" :loading="pending" @click="doSearch">查询</UButton>
          <UButton variant="outline" color="neutral" @click="filters.keyword = ''; doSearch()">重置</UButton>
        </div>
      </div>
    </div>

    <!-- 外箱码列表 -->
    <div class="b-card b-card-clip">
      <div class="b-card-head">
        <span class="b-card-title">外箱码列表</span>
        <span class="b-card-extra">每页 {{ pageSize }} 条 · 共 {{ data?.total || 0 }} 个外箱</span>
      </div>
      <div class="b-scroll-x">
        <table class="b-table">
          <thead>
            <tr>
              <th>外箱码</th>
              <th>箱内单品码数</th>
              <th>箱状态</th>
              <th>最近关联时间</th>
              <th class="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in data?.rows || []" :key="r.outer_box_code">
              <td><span class="font-code text-[13px] b-strong">{{ r.outer_box_code }}</span></td>
              <td class="b-strong font-medium">{{ r.inner_count }}</td>
              <td>
                <span class="b-tag" :class="r.max_flag === 2 ? 'b-tag-danger' : r.max_flag === 1 ? 'b-tag-warning' : 'b-tag-success'">
                  {{ r.flagLabel }}
                </span>
              </td>
              <td>{{ String(r.updated_at).slice(0, 19) }}</td>
              <td>
                <div class="b-actions">
                  <UButton variant="link" color="neutral" size="xs" @click="openDetail(r.outer_box_code)">查看</UButton>
                  <span class="b-sep" />
                  <UButton variant="link" color="error" size="xs" @click="openUnbind(r.outer_box_code)">解绑</UButton>
                </div>
              </td>
            </tr>
            <tr v-if="!pending && !data?.rows?.length">
              <td colspan="5" class="b-empty">
                <div class="b-empty-inner">
                  <UIcon name="i-lucide-inbox" class="b-empty-icon h-8 w-8" />
                  <span class="text-sm">暂无外箱码，请先在上方上传关联清单并确认绑定</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <!-- 分页区 -->
      <div v-if="data?.total" class="b-pager">
        <span class="b-card-extra">共 {{ data?.total || 0 }} 个外箱 · 第 {{ data.page }} / {{ totalPages }} 页</span>
        <div class="flex items-center gap-2">
          <UButton variant="outline" color="neutral" size="sm" :disabled="page <= 1" @click="page--; refresh()">上一页</UButton>
          <UButton variant="outline" color="neutral" size="sm" :disabled="page >= totalPages" @click="page++; refresh()">下一页</UButton>
        </div>
      </div>
    </div>

    <!-- 箱内码详情（Nuxt UI v4：v-model:open 绑定 open 状态，内容必须放 #content 插槽） -->
    <UModal v-model:open="showDetail">
      <template #content>
      <div class="b-modal">
        <!-- 弹窗头部：外箱码本身 -->
        <div class="b-modal-head">
          <div class="b-modal-icon">
            <UIcon name="i-lucide-package-search" class="h-4 w-4 text-[var(--b-text-regular)]" />
          </div>
          <div class="min-w-0">
            <h3 class="b-modal-title">外箱码详情</h3>
            <p class="b-modal-sub break-all font-code">{{ detail?.outerBoxCode }}</p>
          </div>
        </div>
        <div class="b-modal-body">
          <!-- 箱内单品码清单 -->
          <div class="overflow-hidden rounded-sm border border-[var(--b-border)]">
            <div class="b-scroll-x">
              <table class="b-table">
                <thead>
                  <tr>
                    <th>单品码</th>
                    <th>产品</th>
                    <th>状态</th>
                    <th>标记</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in detail?.rows || []" :key="r.id">
                    <td><span class="font-code text-[13px] b-strong">{{ r.code }}</span></td>
                    <td>{{ r.product_name || '-' }}</td>
                    <td>{{ r.statusLabel }}</td>
                    <td>
                      <span class="b-tag" :class="r.abnormal_flag === 2 ? 'b-tag-danger' : r.abnormal_flag === 1 ? 'b-tag-warning' : 'b-tag-success'">{{ r.flagLabel }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="b-modal-foot">
          <UButton variant="outline" color="neutral" @click="showDetail = false">关闭</UButton>
        </div>
      </div>
      </template>
    </UModal>

    <!-- 解绑确认（Nuxt UI v4：v-model:open 绑定 open 状态，内容必须放 #content 插槽） -->
    <UModal v-model:open="showUnbind">
      <template #content>
      <div class="b-modal">
        <!-- 弹窗头部：待解绑的外箱码 -->
        <div class="b-modal-head">
          <div class="b-modal-icon">
            <UIcon name="i-lucide-unlink" class="h-4 w-4 text-red-600" />
          </div>
          <div class="min-w-0">
            <h3 class="b-modal-title">解绑外箱码</h3>
            <p class="b-modal-sub break-all font-code">{{ unbindOuter }}</p>
          </div>
        </div>
        <div class="b-modal-body">
          <div class="b-note">
            <UIcon name="i-lucide-alert-triangle" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--b-text-muted)]" />
            <p class="b-note-text">解绑后箱内单品码可重新归属其他外箱码，此操作不可撤销</p>
          </div>
          <div>
            <label class="b-label-lg">输入「确认解绑」以确认 <span class="b-required">*</span></label>
            <UInput v-model="unbindConfirm" placeholder="确认解绑" />
          </div>
        </div>
        <div class="b-modal-foot">
          <UButton variant="outline" color="neutral" @click="showUnbind = false">取消</UButton>
          <UButton color="error" :loading="unbinding" :disabled="unbindConfirm !== '确认解绑'" @click="doUnbind">确认解绑</UButton>
        </div>
      </div>
      </template>
    </UModal>
  </div>
</template>
