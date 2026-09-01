<script setup lang="ts">
// 产品管理（PRD 5.4：SKU 化，规格来自主数据下拉选择）
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '产品管理' })

const toast = useToast()
const filters = reactive({ keyword: '', category: undefined as string | undefined, status: undefined as string | undefined })
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
const resetSearch = () => { filters.keyword = ''; filters.category = undefined; filters.status = undefined; page.value = 1; refresh() }
</script>

<template>
  <div class="space-y-4">
    <!-- 页面标题区 -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="b-page-title">产品管理</h1>
        <p class="b-page-desc">产品 SKU 化 · 规格来自主数据下拉选择，不可手填</p>
      </div>
      <UButton color="neutral" variant="solid" icon="i-lucide-plus" @click="openCreate">新增产品</UButton>
    </div>

    <!-- 筛选查询区 -->
    <div class="b-card">
      <div class="b-card-head">
        <span class="b-card-title">筛选查询</span>
      </div>
      <div class="b-form-grid md:grid-cols-2 xl:grid-cols-3">
        <div>
          <label class="b-label">产品名称 / 商标 / 登记证号</label>
          <UInput v-model="filters.keyword" placeholder="输入产品名称、商标或登记证号" icon="i-lucide-search" @keyup.enter="doSearch" />
        </div>
        <div>
          <label class="b-label">产品类别</label>
          <USelect v-model="filters.category" :items="CATEGORIES.map(c => ({ value: c, label: c }))" placeholder="全部类别" class="w-full" />
        </div>
        <div>
          <label class="b-label">状态</label>
          <USelect v-model="filters.status" :items="[{ value: '1', label: '启用' }, { value: '0', label: '停用' }]" placeholder="全部状态" class="w-full" />
        </div>
      </div>
      <div class="b-card-foot">
        <span class="b-card-extra">共 <span class="font-medium b-strong">{{ data?.total || 0 }}</span> 条产品</span>
        <div class="flex items-center gap-2">
          <UButton color="neutral" variant="solid" :loading="pending" @click="doSearch">查询</UButton>
          <UButton variant="outline" color="neutral" @click="resetSearch">重置</UButton>
        </div>
      </div>
    </div>

    <!-- 产品列表 -->
    <div v-if="error" class="b-card b-card-body text-sm text-red-600">产品列表加载失败，请刷新重试</div>
    <div v-else class="b-card b-card-clip">
      <div class="b-card-head">
        <span class="b-card-title">产品列表</span>
        <span class="b-card-extra">每页 {{ pageSize }} 条 · 共 {{ data?.total || 0 }} 条</span>
      </div>
      <div class="b-scroll-x">
        <table class="b-table">
          <thead>
            <tr>
              <th>产品商标</th>
              <th>农药名称</th>
              <th>登记证号</th>
              <th>有效期至</th>
              <th>规格</th>
              <th>追溯码数</th>
              <th>状态</th>
              <th class="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in data?.rows || []" :key="r.id">
              <td>{{ r.trademark || '-' }}</td>
              <td class="b-strong font-medium">{{ r.name }}</td>
              <td><span class="font-code text-[13px] b-strong">{{ r.registration_no }}</span></td>
              <td>{{ r.registration_expire ? String(r.registration_expire).slice(0, 10) : '-' }}</td>
              <td>{{ r.spec_name || '-' }}</td>
              <td class="b-strong font-medium">{{ r.code_count }}</td>
              <td>
                <span class="b-tag" :class="Number(r.status) === 1 ? 'b-tag-success' : 'b-tag-default'">
                  {{ Number(r.status) === 1 ? '启用' : '停用' }}
                </span>
              </td>
              <td>
                <div class="b-actions">
                  <UButton variant="link" color="neutral" size="xs" @click="openEdit(r)">编辑</UButton>
                  <span class="b-sep" />
                  <UButton variant="link" color="neutral" size="xs" @click="toggleStatus(r)">
                    {{ Number(r.status) === 1 ? '停用' : '启用' }}
                  </UButton>
                </div>
              </td>
            </tr>
            <tr v-if="!pending && !data?.rows?.length">
              <td colspan="8" class="b-empty">
                <div class="b-empty-inner">
                  <UIcon name="i-lucide-inbox" class="b-empty-icon h-8 w-8" />
                  <span class="text-sm">暂无产品数据，点击右上角「新增产品」创建</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="data?.total" class="b-pager">
        <span class="b-card-extra">共 {{ data?.total || 0 }} 条 · 第 {{ data.page }} / {{ totalPages }} 页</span>
        <div class="flex items-center gap-2">
          <UButton variant="outline" color="neutral" size="sm" :disabled="page <= 1" @click="page--; refresh()">上一页</UButton>
          <UButton variant="outline" color="neutral" size="sm" :disabled="page >= totalPages" @click="page++; refresh()">下一页</UButton>
        </div>
      </div>
    </div>

    <!-- 新增/编辑对话框（Nuxt UI v4：v-model:open 绑定 open 状态，内容放 #content 插槽） -->
    <UModal v-model:open="showModal">
      <template #content>
        <div class="b-modal">
          <div class="b-modal-head">
            <div class="b-modal-icon">
              <UIcon :name="editingId ? 'i-lucide-pencil' : 'i-lucide-plus'" class="h-4 w-4 text-[var(--b-text-regular)]" />
            </div>
            <div>
              <h3 class="b-modal-title">{{ editingId ? '编辑产品' : '新增产品' }}</h3>
              <p class="b-modal-sub">登记证号全局唯一 · 规格取自主数据，净含量自动带出</p>
            </div>
          </div>
          <div class="b-modal-body">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="b-label-lg">产品商标 <span class="b-required">*</span></label>
                <UInput v-model="form.trademark" placeholder="如：绿丰" />
              </div>
              <div>
                <label class="b-label-lg">农药名称 <span class="b-required">*</span></label>
                <UInput v-model="form.name" placeholder="与登记证一致" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="b-label-lg">登记证号 <span class="b-required">*</span></label>
                <UInput v-model="form.registrationNo" placeholder="如：PD20040767（全局唯一）" />
              </div>
              <div>
                <label class="b-label-lg">登记证有效期至 <span class="b-required">*</span></label>
                <UInput v-model="form.registrationExpire" type="date" />
                <p class="b-help">到期后扫码将提示「登记证过期」，请及时更新</p>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="b-label-lg">登记类别 <span class="b-required">*</span></label>
                <USelect v-model="form.regCategory" :items="REG_CATEGORIES" class="w-full" />
              </div>
              <div>
                <label class="b-label-lg">生产类型 <span class="b-required">*</span></label>
                <USelect v-model="form.produceType" :items="PRODUCE_TYPES" class="w-full" />
              </div>
            </div>
            <div>
              <label class="b-label-lg">登记证持有人名称 <span class="b-required">*</span></label>
              <UInput v-model="form.holderName" placeholder="扫码必显字段" />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="b-label-lg">剂型 <span class="b-required">*</span></label>
                <UInput v-model="form.dosage" placeholder="如：可湿性粉剂" />
              </div>
              <div>
                <label class="b-label-lg">毒性 <span class="b-required">*</span></label>
                <USelect v-model="form.toxicity" :items="TOXICITY.map(t => ({ value: t, label: t }))" class="w-full" />
              </div>
            </div>
            <div>
              <label class="b-label-lg">规格（来自主数据，不可手填）<span class="b-required">*</span></label>
              <USelect
                v-model="form.specId"
                :items="(specData?.rows || []).map((s: any) => ({ value: Number(s.id), label: s.spec_name + '（码 ' + s.spec_code + '）' }))"
                placeholder="选择规格"
                class="w-full"
                :content="{ class: 'min-w-72' }"
                :ui="{ itemLabel: { class: 'whitespace-normal break-words' } }"
              />
              <p v-if="selectedSpec" class="b-help">
                净含量：{{ selectedSpec.net_content ?? '-' }} {{ selectedSpec.content_unit }} / {{ selectedSpec.pack_unit }}（自动带出，只读）
              </p>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="b-label-lg">总含量</label>
                <UInput v-model="form.content" placeholder="如：25%" />
              </div>
              <div>
                <label class="b-label-lg">保质期</label>
                <UInput v-model="form.shelfLife" placeholder="如：2年（批次有效期自动计算）" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="b-label-lg">产品类别 <span class="b-required">*</span></label>
                <USelect v-model="form.category" :items="CATEGORIES.map(c => ({ value: c, label: c }))" class="w-full" />
              </div>
              <div>
                <label class="b-label-lg">是否限制使用</label>
                <div class="flex items-center gap-2 pt-1.5">
                  <USwitch v-model="form.isRestricted" />
                  <span class="text-sm text-[var(--b-text-regular)]">{{ form.isRestricted ? '是（触发实名购买）' : '否' }}</span>
                </div>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="b-label-lg">原药登记证号</label>
                <UInput v-model="form.originalRegNo" placeholder="制剂产品扫码必显" />
              </div>
              <div>
                <label class="b-label-lg">原药生产企业名称</label>
                <UInput v-model="form.originalCompany" placeholder="与登记证号配套填写" />
              </div>
            </div>
          </div>
          <div class="b-modal-foot">
            <UButton variant="outline" color="neutral" @click="showModal = false">取消</UButton>
            <UButton color="neutral" variant="solid" :loading="saving" @click="save">保存</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
