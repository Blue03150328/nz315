<script setup lang="ts">
// 产品管理（PRD 5.4：SKU 化，规格来自主数据下拉选择）
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '产品管理' })

const toast = useToast()
const filters = reactive({ keyword: '', category: '', status: '' })
const page = ref(1)
const pageSize = 20

const CATEGORIES = ['杀虫剂', '杀菌剂', '除草剂', '植物生长调节剂', '其他']
const TOXICITY = ['微毒', '低毒', '中等毒', '高毒', '剧毒']
const REG_CATEGORIES = [{ value: 1, label: 'PD（代码1）' }, { value: 2, label: 'WP（代码2）' }]
const PRODUCE_TYPES = [{ value: 1, label: '持有人生产' }, { value: 2, label: '委托加工' }, { value: 3, label: '委托分装' }]

// 启用中的规格（供下拉选择）
const { data: specData, error: specError } = await useFetch<any>('/api/admin/specs', {
  key: 'admin-specs-all',
  query: { page: 1, pageSize: 100, status: 1 },
})

const { data, pending, refresh, error } = await useFetch<any>('/api/admin/products', {
  key: 'admin-products',
  query: computed(() => ({
    keyword: filters.keyword || undefined,
    category: filters.category || undefined,
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
  trademark: '', name: '', registrationNo: '', registrationExpire: '',
  regCategory: 1, holderName: '', produceType: 1, dosage: '', toxicity: '低毒',
  specId: null as number | null, content: '', shelfLife: '', category: '杀虫剂',
  isRestricted: false, originalRegNo: '', originalCompany: '', status: 1,
})

const selectedSpec = computed(() => (specData.value?.rows || []).find((s: any) => Number(s.id) === Number(form.specId)))

const openCreate = () => {
  editingId.value = null
  Object.assign(form, {
    trademark: '', name: '', registrationNo: '', registrationExpire: '', regCategory: 1, holderName: '',
    produceType: 1, dosage: '', toxicity: '低毒', specId: null, content: '', shelfLife: '',
    category: '杀虫剂', isRestricted: false, originalRegNo: '', originalCompany: '', status: 1,
  })
  showModal.value = true
}
const openEdit = (row: any) => {
  editingId.value = row.id
  Object.assign(form, {
    trademark: row.trademark || '', name: row.name, registrationNo: row.registration_no,
    registrationExpire: row.registration_expire ? String(row.registration_expire).slice(0, 10) : '',
    regCategory: Number(row.reg_category || 1), holderName: row.holder_name || '',
    produceType: Number(row.produce_type || 1), dosage: row.dosage || '', toxicity: row.toxicity || '低毒',
    specId: row.spec_id, content: row.content || '', shelfLife: row.shelf_life || '',
    category: row.category || '杀虫剂', isRestricted: Number(row.is_restricted) === 1,
    originalRegNo: row.original_reg_no || '', originalCompany: row.original_company || '',
    status: Number(row.status),
  })
  showModal.value = true
}

const save = async () => {
  if (!form.name.trim()) { toast.add({ title: '请输入农药名称', color: 'warning' }); return }
  if (!form.registrationNo.trim()) { toast.add({ title: '请输入登记证号', color: 'warning' }); return }
  if (!form.specId) { toast.add({ title: '请选择规格', color: 'warning' }); return }
  saving.value = true
  try {
    if (editingId.value) {
      await $fetch('/api/admin/products/' + editingId.value, { method: 'PATCH', body: { ...form } })
      toast.add({ title: '产品已更新', color: 'success' })
    } else {
      await $fetch('/api/admin/products', { method: 'POST', body: { ...form } })
      toast.add({ title: '产品已创建', color: 'success' })
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
    await $fetch('/api/admin/products/' + row.id, { method: 'PATCH', body: { status: next } })
    toast.add({ title: next === 1 ? '产品已启用' : '产品已停用', color: 'success' })
    refresh()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '操作失败', color: 'error' })
  }
}

const doSearch = () => { page.value = 1; refresh() }
const resetSearch = () => { filters.keyword = ''; filters.category = ''; filters.status = ''; page.value = 1; refresh() }
</script>

<template>
  <div class="space-y-5">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold text-default">产品管理</h1>
        <p class="mt-1 text-sm text-muted">产品 SKU 化 · 规格来自主数据下拉选择，不可手填</p>
      </div>
      <UButton color="primary" icon="i-lucide-plus" @click="openCreate">新增产品</UButton>
    </div>

    <!-- 筛选 -->
    <div class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
      <div class="grid gap-3 md:grid-cols-4">
        <UInput v-model="filters.keyword" placeholder="产品名称 / 商标 / 登记证号" icon="i-lucide-search" @keyup.enter="doSearch" />
        <USelect v-model="filters.category" :items="[{ value: '', label: '全部类别' }, ...CATEGORIES.map(c => ({ value: c, label: c }))]" />
        <USelect v-model="filters.status" :items="[{ value: '', label: '全部状态' }, { value: '1', label: '启用' }, { value: '0', label: '停用' }]" />
      </div>
      <div class="mt-3 flex gap-2">
        <UButton color="primary" icon="i-lucide-search" :loading="pending" @click="doSearch">查询</UButton>
        <UButton variant="outline" color="neutral" icon="i-lucide-rotate-ccw" @click="resetSearch">重置</UButton>
      </div>
    </div>

    <!-- 列表 -->
    <div v-if="error" class="rounded-xl border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">
      产品列表加载失败，请刷新重试
    </div>
    <div v-else class="overflow-hidden rounded-xl border border-border bg-elevated shadow-sm">
      <div class="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <span class="text-sm font-semibold text-default">产品列表</span>
        <span class="text-xs text-muted">共 {{ data?.total || 0 }} 条</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-border/60 bg-muted/30 text-xs text-muted">
              <th class="px-4 py-3 font-medium">产品商标</th>
              <th class="px-4 py-3 font-medium">农药名称</th>
              <th class="px-4 py-3 font-medium">登记证号</th>
              <th class="px-4 py-3 font-medium">有效期至</th>
              <th class="px-4 py-3 font-medium">规格</th>
              <th class="px-4 py-3 font-medium">追溯码数</th>
              <th class="px-4 py-3 font-medium">状态</th>
              <th class="px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in data?.rows || []" :key="r.id" class="border-b border-border/40 transition-colors hover:bg-muted/30">
              <td class="px-4 py-3 text-muted">{{ r.trademark || '-' }}</td>
              <td class="px-4 py-3 font-medium text-default">{{ r.name }}</td>
              <td class="px-4 py-3 font-code text-muted">{{ r.registration_no }}</td>
              <td class="px-4 py-3 text-muted">{{ r.registration_expire ? String(r.registration_expire).slice(0, 10) : '-' }}</td>
              <td class="px-4 py-3 text-muted">{{ r.spec_name || '-' }}</td>
              <td class="px-4 py-3 font-medium text-default">{{ r.code_count }}</td>
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
              <td colspan="8" class="px-4 py-10 text-center text-sm text-muted">暂无数据，点击右上角「新增产品」创建</td>
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

    <!-- 新增/编辑对话框 -->
    <UModal v-model="showModal">
      <div class="max-h-[80vh] overflow-y-auto p-5">
        <h3 class="text-base font-semibold text-default">{{ editingId ? '编辑产品' : '新增产品' }}</h3>
        <div class="mt-4 space-y-4">
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <label class="block text-sm font-medium text-default">产品商标 <span class="text-error">*</span></label>
              <UInput v-model="form.trademark" placeholder="如：绿丰" />
            </div>
            <div class="space-y-1.5">
              <label class="block text-sm font-medium text-default">农药名称 <span class="text-error">*</span></label>
              <UInput v-model="form.name" placeholder="与登记证一致" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <label class="block text-sm font-medium text-default">登记证号 <span class="text-error">*</span></label>
              <UInput v-model="form.registrationNo" placeholder="如：PD20040767（全局唯一）" />
            </div>
            <div class="space-y-1.5">
              <label class="block text-sm font-medium text-default">登记证有效期至 <span class="text-error">*</span></label>
              <UInput v-model="form.registrationExpire" type="date" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <label class="block text-sm font-medium text-default">登记类别 <span class="text-error">*</span></label>
              <USelect v-model="form.regCategory" :items="REG_CATEGORIES" />
            </div>
            <div class="space-y-1.5">
              <label class="block text-sm font-medium text-default">生产类型 <span class="text-error">*</span></label>
              <USelect v-model="form.produceType" :items="PRODUCE_TYPES" />
            </div>
          </div>
          <div class="space-y-1.5">
            <label class="block text-sm font-medium text-default">登记证持有人名称 <span class="text-error">*</span></label>
            <UInput v-model="form.holderName" placeholder="扫码必显字段" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <label class="block text-sm font-medium text-default">剂型 <span class="text-error">*</span></label>
              <UInput v-model="form.dosage" placeholder="如：可湿性粉剂" />
            </div>
            <div class="space-y-1.5">
              <label class="block text-sm font-medium text-default">毒性 <span class="text-error">*</span></label>
              <USelect v-model="form.toxicity" :items="TOXICITY.map(t => ({ value: t, label: t }))" />
            </div>
          </div>
          <div class="space-y-1.5">
            <label class="block text-sm font-medium text-default">规格（来自主数据，不可手填）<span class="text-error">*</span></label>
            <USelect
              v-model="form.specId"
              :items="(specData?.rows || []).map((s: any) => ({ value: Number(s.id), label: s.spec_name + '（码 ' + s.spec_code + '）' }))"
              placeholder="选择规格"
            />
            <p v-if="selectedSpec" class="text-xs text-muted">
              净含量：{{ selectedSpec.net_content ?? '-' }} {{ selectedSpec.content_unit }} / {{ selectedSpec.pack_unit }}（自动带出，只读）
            </p>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <label class="block text-sm font-medium text-default">总含量</label>
              <UInput v-model="form.content" placeholder="如：25%" />
            </div>
            <div class="space-y-1.5">
              <label class="block text-sm font-medium text-default">保质期</label>
              <UInput v-model="form.shelfLife" placeholder="如：2年（批次有效期自动计算）" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <label class="block text-sm font-medium text-default">产品类别 <span class="text-error">*</span></label>
              <USelect v-model="form.category" :items="CATEGORIES.map(c => ({ value: c, label: c }))" />
            </div>
            <div class="space-y-1.5">
              <label class="block text-sm font-medium text-default">是否限制使用</label>
              <div class="flex items-center gap-2 pt-2">
                <USwitch v-model="form.isRestricted" />
                <span class="text-sm text-muted">{{ form.isRestricted ? '是（触发实名购买）' : '否' }}</span>
              </div>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <label class="block text-sm font-medium text-default">原药登记证号</label>
              <UInput v-model="form.originalRegNo" placeholder="制剂产品扫码必显" />
            </div>
            <div class="space-y-1.5">
              <label class="block text-sm font-medium text-default">原药生产企业名称</label>
              <UInput v-model="form.originalCompany" placeholder="与登记证号配套填写" />
            </div>
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <UButton variant="outline" color="neutral" @click="showModal = false">取消</UButton>
          <UButton color="primary" :loading="saving" @click="save">保存</UButton>
        </div>
      </div>
    </UModal>
  </div>
</template>
