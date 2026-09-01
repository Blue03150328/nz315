<script setup lang="ts">
// 产品规格管理（PRD 5.3：主数据，规格码对应 32 位码第 9-11 位）
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '产品规格管理' })

const toast = useToast()
const filters = reactive({ keyword: '', contentUnit: undefined as string | undefined, packUnit: undefined as string | undefined, status: undefined as string | undefined })
const page = ref(1)
const pageSize = 20

const UNITS = ['ml', 'L', 'g', 'kg', '片', '包', '粒']
const PACKS = ['瓶', '袋', '桶', '盒', '罐', '支', '箱']
const FORMS = ['乳油', '可湿性粉剂', '水剂', '悬浮剂', '颗粒剂', '水分散粒剂', '微乳剂', '粉剂', '烟剂', '其他']

const { data, pending, refresh, error } = await useFetch<any>('/api/admin/specs', {
  key: 'admin-specs',
  query: computed(() => ({
    keyword: filters.keyword || undefined,
    contentUnit: filters.contentUnit || undefined,
    packUnit: filters.packUnit || undefined,
    status: filters.status || undefined,
    page: page.value, pageSize,
  })),
})

const totalPages = computed(() => Math.max(1, Math.ceil((data.value?.total || 0) / pageSize)))

// 新增/编辑对话框
const showModal = ref(false)
const editingId = ref<number | null>(null)
const saving = ref(false)
const form = reactive({
  specName: '', netContent: null as number | null, contentUnit: '', packUnit: '',
  specCode: '', dosageForms: [] as string[], status: 1,
})

const openCreate = () => {
  editingId.value = null
  Object.assign(form, { specName: '', netContent: null, contentUnit: 'ml', packUnit: '瓶', specCode: '', dosageForms: [], status: 1 })
  showModal.value = true
}
const openEdit = (row: any) => {
  editingId.value = row.id
  Object.assign(form, {
    specName: row.spec_name, netContent: row.net_content === null ? null : Number(row.net_content),
    contentUnit: row.content_unit, packUnit: row.pack_unit, specCode: row.spec_code,
    dosageForms: row.dosage_forms || [], status: Number(row.status),
  })
  showModal.value = true
}

const save = async () => {
  if (!form.specName.trim()) { toast.add({ title: '请输入规格名称', color: 'warning' }); return }
  if (!/^\d{3}$/.test(form.specCode)) { toast.add({ title: '企业规格码必须为 3 位数字', color: 'warning' }); return }
  saving.value = true
  try {
    if (editingId.value) {
      await $fetch('/api/admin/specs/' + editingId.value, { method: 'PATCH', body: { ...form } })
      toast.add({ title: '规格已更新', color: 'success' })
    } else {
      await $fetch('/api/admin/specs', { method: 'POST', body: { ...form } })
      toast.add({ title: '规格已创建', color: 'success' })
    }
    showModal.value = false
    refresh()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '保存失败', color: 'error' })
  } finally {
    saving.value = false
  }
}

const toggleStatus = async (row: any) => {
  const next = Number(row.status) === 1 ? 0 : 1
  try {
    await $fetch('/api/admin/specs/' + row.id, { method: 'PATCH', body: { status: next } })
    toast.add({ title: next === 1 ? '规格已启用' : '规格已停用', color: 'success' })
    refresh()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '操作失败', color: 'error' })
  }
}

const doSearch = () => { page.value = 1; refresh() }
const resetSearch = () => { filters.keyword = ''; filters.contentUnit = undefined; filters.packUnit = undefined; filters.status = undefined; page.value = 1; refresh() }
</script>

<template>
  <div class="space-y-5">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold text-default">产品规格管理</h1>
        <p class="mt-1 text-sm text-muted">企业规格主数据 · 规格码对应 32 位追溯码第 9-11 位</p>
      </div>
      <UButton color="primary" icon="i-lucide-plus" @click="openCreate">新增规格</UButton>
    </div>

    <!-- 筛选 -->
    <div class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
      <div class="grid gap-3 md:grid-cols-4">
        <UInput v-model="filters.keyword" placeholder="规格名称 / 规格码" icon="i-lucide-search" @keyup.enter="doSearch" />
        <USelect v-model="filters.contentUnit" :items="UNITS.map(u => ({ value: u, label: u }))" placeholder="全部含量单位" />
        <USelect v-model="filters.packUnit" :items="PACKS.map(p => ({ value: p, label: p }))" placeholder="全部包装单位" />
        <USelect v-model="filters.status" :items="[{ value: '1', label: '启用' }, { value: '0', label: '停用' }]" placeholder="全部状态" />
      </div>
      <div class="mt-3 flex gap-2">
        <UButton color="primary" icon="i-lucide-search" :loading="pending" @click="doSearch">查询</UButton>
        <UButton variant="outline" color="neutral" icon="i-lucide-rotate-ccw" @click="resetSearch">重置</UButton>
      </div>
    </div>

    <!-- 列表 -->
    <div v-if="error" class="rounded-xl border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">
      规格列表加载失败，请刷新重试
    </div>
    <div v-else class="overflow-hidden rounded-xl border border-border bg-elevated shadow-sm">
      <div class="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <span class="text-sm font-semibold text-default">规格列表</span>
        <span class="text-xs text-muted">共 {{ data?.total || 0 }} 条</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-border/60 bg-muted/30 text-xs text-muted">
              <th class="px-4 py-3 font-medium">规格名称</th>
              <th class="px-4 py-3 font-medium">净含量</th>
              <th class="px-4 py-3 font-medium">规格码</th>
              <th class="px-4 py-3 font-medium">适用剂型</th>
              <th class="px-4 py-3 font-medium">被引用</th>
              <th class="px-4 py-3 font-medium">状态</th>
              <th class="px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in data?.rows || []" :key="r.id" class="border-b border-border/40 transition-colors hover:bg-muted/30">
              <td class="px-4 py-3 font-medium text-default">{{ r.spec_name }}</td>
              <td class="px-4 py-3 text-muted">{{ r.net_content !== null && r.net_content !== undefined ? Number(r.net_content) : '-' }} {{ r.content_unit }} / {{ r.pack_unit }}</td>
              <td class="px-4 py-3 font-code text-muted">{{ r.spec_code }}</td>
              <td class="px-4 py-3 text-muted">{{ (r.dosage_forms || []).join('、') || '-' }}</td>
              <td class="px-4 py-3 text-muted">{{ r.ref_count }} 个产品</td>
              <td class="px-4 py-3">
                <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="Number(r.status) === 1 ? 'bg-success/10 text-success' : 'bg-muted text-muted'">
                  {{ Number(r.status) === 1 ? '启用' : '停用' }}
                </span>
              </td>
              <td class="px-4 py-3">
                <div class="flex gap-1.5">
                  <UButton variant="ghost" color="neutral" size="xs" icon="i-lucide-pencil" @click="openEdit(r)">编辑</UButton>
                  <UButton variant="ghost" color="neutral" size="xs" :icon="Number(r.status) === 1 ? 'i-lucide-pause' : 'i-lucide-play'" @click="toggleStatus(r)">
                    {{ Number(r.status) === 1 ? '停用' : '启用' }}
                  </UButton>
                </div>
              </td>
            </tr>
            <tr v-if="!pending && !data?.rows?.length">
              <td colspan="7" class="px-4 py-10 text-center text-sm text-muted">暂无数据，点击右上角「新增规格」创建</td>
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

    <!-- 新增/编辑对话框（Nuxt UI v4：v-model:open 绑定 open 状态，内容放 #content 插槽） -->
    <UModal v-model:open="showModal">
      <template #content>
      <div class="p-5">
        <h3 class="text-base font-semibold text-default">{{ editingId ? '编辑规格' : '新增规格' }}</h3>
        <div class="mt-4 space-y-4">
          <div class="space-y-1.5">
            <label class="block text-sm font-medium text-default">规格名称 <span class="text-error">*</span></label>
            <UInput v-model="form.specName" placeholder="如：200ml/瓶（企业内唯一）" />
          </div>
          <div class="grid grid-cols-3 gap-3">
            <div class="space-y-1.5">
              <label class="block text-sm font-medium text-default">净含量数值 <span class="text-error">*</span></label>
              <UInput v-model.number="form.netContent" type="number" placeholder="200" />
            </div>
            <div class="space-y-1.5">
              <label class="block text-sm font-medium text-default">含量单位 <span class="text-error">*</span></label>
              <USelect v-model="form.contentUnit" :items="UNITS.map(u => ({ value: u, label: u }))" />
            </div>
            <div class="space-y-1.5">
              <label class="block text-sm font-medium text-default">包装单位 <span class="text-error">*</span></label>
              <USelect v-model="form.packUnit" :items="PACKS.map(p => ({ value: p, label: p }))" />
            </div>
          </div>
          <div class="space-y-1.5">
            <label class="block text-sm font-medium text-default">企业规格码（码第 9-11 位）<span class="text-error">*</span></label>
            <UInput v-model="form.specCode" placeholder="3 位数字，如 001（企业内唯一）" maxlength="3" />
            <p class="text-xs text-muted">已被追溯码使用的规格码不可修改</p>
          </div>
          <div class="space-y-1.5">
            <label class="block text-sm font-medium text-default">适用剂型</label>
            <USelect v-model="form.dosageForms" :items="FORMS.map(f => ({ value: f, label: f }))" multiple placeholder="选择适用剂型" />
          </div>
          <div class="flex items-center gap-2">
            <USwitch v-model="form.status" />
            <span class="text-sm text-muted">启用（停用后不可被新产品选择）</span>
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <UButton variant="outline" color="neutral" @click="showModal = false">取消</UButton>
          <UButton color="primary" :loading="saving" @click="save">保存</UButton>
        </div>
      </div>
      </template>
    </UModal>
  </div>
</template>