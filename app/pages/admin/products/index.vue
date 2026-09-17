<script setup lang="ts">
// 产品管理（PRD 5.4：SKU 化，规格来自主数据下拉选择）
// 迭代史：登记数据源自动回填（默认值可编辑）→ 原药双通道组合框 → 2026-09-04：
//   ① 归属企业选择器：无论生产类型都展示完整厂家列表 + 可输入搜索（EnterprisePicker）
//   ② 原药（母药）信息多行化：复配产品多原药（product_original 表）；切换登记产品重置并按数据源初始化首行
// Keep-Alive 页面缓存：菜单切换后保留页面状态；刷新/登出自动清空；【重置】恢复初始
definePageMeta({ layout: 'admin', middleware: 'backend-guard', keepalive: true })
useHead({ title: '产品管理' })

const toast = useToast()
const { user, isPlatformAdmin } = useUser()
const filters = reactive({ keyword: '', category: undefined as string | undefined, status: undefined as string | undefined })
const page = ref(1)
const pageSize = 20

const CATEGORIES = ['杀虫剂', '杀菌剂', '除草剂', '植物生长调节剂', '其他']
const TOXICITY = ['微毒', '低毒', '中等毒', '高毒', '剧毒']
const REG_CATEGORIES = [{ value: 1, label: 'PD（代码1）' }, { value: 2, label: 'WP（代码2）' }]
const PRODUCE_TYPES = [{ value: 1, label: '持有人生产' }, { value: 2, label: '委托加工' }, { value: 3, label: '委托分装' }]

// 规格主数据（含停用）：编辑已绑定「已停用规格」的产品时下拉需能显示当前值
const { data: specData } = await useFetch<any>('/api/admin/specs', {
  key: 'admin-specs-all',
  query: { page: 1, pageSize: 100 },
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

// ============ 归属厂家（2026-09-07 用户需求：候选 = 登记数据源全部厂家，EnterprisePicker 远程搜索） ============
// 总部管理员新建时选择「归属厂家」（数据源 company 原文），决定持有人生产时登记产品候选范围；
// 厂家账号无选择器（归属=自己企业，走 enterpriseId 路径）

// ============ 新增/编辑弹窗 ============
const showModal = ref(false)
const editingId = ref<number | null>(null)
const saving = ref(false)

// 归属：厂家账号固定本企业（enterpriseId）；总部管理员新建时选择数据源厂家名（pickedCompany，决定登记产品过滤）
const enterpriseId = ref<number | null>(isPlatformAdmin.value ? null : (user.value?.enterprise_id || null))
const pickedCompany = ref<string | null>(null)

const form = reactive({
  trademark: '', name: '', registrationNo: '', registrationExpire: '',
  regCategory: 1, holderName: '', produceType: 1, dosage: '', toxicity: '低毒',
  specId: null as number | null, content: '', category: '杀虫剂',
  isRestricted: false, status: 1,
})

// 登记数据源选择状态
const pickedReg = ref<any>(null) // 当前已选登记产品行（服务端数据源行）

// ============ 原药（母药）多行（2026-09-04 需求 2） ============
// 每行 = 原药登记证号 + 原药生产企业名称（RegOrigCombobox：下拉选择 + 手动输入，行内双向联动）；
// 候选池 origPool = 登记产品全有效成分匹配到的原药候选合并（复配多成分可从中选任意成分原药）
type OrigRow = { ingredient: string; regNo: string; company: string }
const makeOrigRow = (ingredient = ''): OrigRow => ({ ingredient, regNo: '', company: '' })
const origRows = ref<OrigRow[]>([])            // 原药行（至少保留 1 行）
const origPool = ref<any[]>([])                // 行级下拉候选池
const origHint = ref('')                       // 标题右侧提示
const origCompound = ref(false)                // 复配制剂提醒
const origBusy = ref(false)                    // 候选匹配中

function resetOrigRows() {
  origRows.value = [makeOrigRow()]
}
function addOrigRow() {
  origRows.value.push(makeOrigRow())
}
function removeOrigRow(idx: number) {
  if (origRows.value.length <= 1) return // 至少保留 1 行
  origRows.value.splice(idx, 1)
}

/** 行内双向联动（下拉选择或手动输入）：命中候选池自动带出对方；不命中清空对方（无匹配可自由录入） */
function syncOrigRow(row: OrigRow, changed: 'regNo' | 'company') {
  const pool = origPool.value.filter(c => !row.ingredient || c.ingredient === row.ingredient)
  if (!pool.length) return
  if (changed === 'regNo') {
    if (!row.regNo) return
    const hit = pool.find(c => c.registration_no === row.regNo && c.company === row.company) || pool.find(c => c.registration_no === row.regNo)
    if (hit) row.company = hit.company
  } else {
    if (!row.company) return
    const hit = pool.find(c => c.company === row.company && c.registration_no === row.regNo) || pool.find(c => c.company === row.company)
    if (hit) row.regNo = hit.registration_no
  }
}

// 产品类别下拉：标准 5 类 + 数据源带出的非标类别动态并入
const categoryOptions = computed(() => {
  const list = CATEGORIES.map(c => ({ value: c, label: c }))
  if (form.category && !CATEGORIES.includes(form.category)) list.push({ value: form.category, label: form.category })
  return list
})

const selectedSpec = computed(() => (specData.value?.rows || []).find((s: any) => Number(s.id) === Number(form.specId)))

/** 清空「登记数据源回填」字段并重置原药行（产品被清除/切换生产类型被过滤后调用） */
function clearRegFields() {
  Object.assign(form, {
    name: '', registrationNo: '', registrationExpire: '', regCategory: 1, holderName: '',
    dosage: '', toxicity: '低毒', content: '', category: '杀虫剂',
  })
  resetOrigRows()
  origPool.value = []
  origHint.value = ''
  origCompound.value = false
  origBusy.value = false
}

/** 选中登记产品 → 数据源覆盖刷新登记字段 + 重置并按有效成分初始化原药行（需求2.6） */
async function onRegSelected(row: any) {
  pickedReg.value = row
  Object.assign(form, {
    name: row.product_name || '',
    registrationNo: row.registration_no || '',
    registrationExpire: row.expire_date ? String(row.expire_date).slice(0, 10) : '',
    regCategory: Number(row.reg_category ?? 1),
    holderName: row.company || '',
    dosage: row.dosage || '',
    toxicity: TOXICITY.includes(row.toxicity) ? row.toxicity : (row.toxicity || '低毒'),
    content: row.content || '',
    category: row.category || '杀虫剂',
  })
  await initOrigRows(row)
}

/** 按登记产品初始化原药行：全有效成分候选池 → 首行回填（需求2.3/2.6） */
async function initOrigRows(row: any) {
  const dosage = String(row.dosage || '')
  const isOriginal = /原药|母药/.test(dosage)
  const ingredientAll = Array.isArray(row.ingredient_all) ? row.ingredient_all : []
  origCompound.value = !isOriginal && ingredientAll.length > 1 // 复配制剂（多有效成分）
  resetOrigRows()
  origPool.value = []
  origHint.value = ''
  origBusy.value = true
  try {
    // 产品级候选池：按登记证号返回全成分合并候选（原药/母药产品自身必在池内）
    const data = await $fetch<any>('/api/admin/regdata/originals', { query: { regNo: row.registration_no } })
    const pool = data?.rows || []
    origPool.value = pool
    if (isOriginal) {
      // 剂型=原药/母药：首行回填自身登记信息（可下拉重选/手输修改）
      origRows.value[0].ingredient = String(row.ingredient_main || ingredientAll[0] || '')
      origRows.value[0].regNo = row.registration_no || ''
      origRows.value[0].company = row.company || ''
      origHint.value = '原药（母药）登记：已回填其自身登记证号与企业，可下拉选择或手动输入修改'
    } else if (pool.length === 0) {
      origHint.value = '未匹配到对应原药数据，请手动补充'
    } else if (pool.length === 1) {
      // 唯一匹配：自动回填首行（可编辑）
      origRows.value[0].regNo = pool[0].registration_no
      origRows.value[0].company = pool[0].company || ''
      origHint.value = '已按有效成分自动匹配唯一原药登记，可下拉选择或手动输入修改'
    } else {
      // 多匹配：首行待选择（必填），复配可添加行补其它成分原药
      origHint.value = '有效成分匹配到 ' + pool.length + ' 家原药登记，可下拉选择或手动输入（保存必填，多原药请点击添加行）'
    }
  } catch {
    origHint.value = '原药匹配服务异常，请手动补充'
  } finally {
    origBusy.value = false
  }
}

/** 编辑态加载候选池（原药行下拉可用；不覆盖行值） */
async function loadPoolForReg(registrationNo: string) {
  if (!registrationNo) return
  origBusy.value = true
  try {
    const data = await $fetch<any>('/api/admin/regdata/originals', { query: { regNo: registrationNo } })
    origPool.value = data?.rows || []
  } catch { origPool.value = [] } finally { origBusy.value = false }
}

/** 登记产品被清除 */
function onRegCleared() {
  pickedReg.value = null
  clearRegFields()
}

/** 生产类型切换：登记产品范围变化，当前已选产品不在新范围则清空（含原药行重置） */
async function onProduceTypeChange(v: number) {
  if (!pickedReg.value) return
  try {
    const chk = await $fetch<any>('/api/admin/regdata', {
      query: {
        exact: pickedReg.value.registration_no,
        produceType: v,
        company: isPlatformAdmin.value ? (pickedCompany.value || undefined) : undefined,
        enterpriseId: enterpriseId.value || undefined,
      },
    })
    if (!chk?.ok) {
      pickedReg.value = null
      clearRegFields()
      toast.add({ title: '该产品不在当前生产类型的可选范围内，已清空选择', color: 'warning' })
    }
  } catch { /* 网络异常时保留原选择，避免误清 */ }
}

/** 总部切换归属厂家：登记产品候选范围变化，若已选产品则清空（保守处理） */
function onCompanyChange() {
  if (pickedReg.value) {
    pickedReg.value = null
    clearRegFields()
  }
}

const openCreate = async () => {
  editingId.value = null
  Object.assign(form, {
    trademark: '', name: '', registrationNo: '', registrationExpire: '', regCategory: 1, holderName: '',
    produceType: 1, dosage: '', toxicity: '低毒', specId: null, content: '',
    category: '杀虫剂', isRestricted: false, status: 1,
  })
  pickedReg.value = null
  resetOrigRows()
  origPool.value = []
  origHint.value = ''
  origCompound.value = false
  origBusy.value = false
  enterpriseId.value = isPlatformAdmin.value ? null : (user.value?.enterprise_id || null)
  pickedCompany.value = null
  showModal.value = true
}

const openEdit = (row: any) => {
  editingId.value = row.id
  // 编辑沿用产品原归属，清除上次新增弹窗的厂家选择，避免登记候选串用其他企业。
  enterpriseId.value = Number(row.enterprise_id) || null
  pickedCompany.value = null
  Object.assign(form, {
    trademark: row.trademark || '', name: row.name, registrationNo: row.registration_no,
    registrationExpire: row.registration_expire ? String(row.registration_expire).slice(0, 10) : '',
    regCategory: Number(row.reg_category || 1), holderName: row.holder_name || '',
    produceType: Number(row.produce_type || 1), dosage: row.dosage || '', toxicity: row.toxicity || '低毒',
    specId: row.spec_id, content: row.content || '',
    category: row.category || '杀虫剂', isRestricted: Number(row.is_restricted) === 1,
    status: Number(row.status),
  })
  pickedReg.value = {
    registration_no: row.registration_no,
    product_name: row.name,
    company: row.holder_name,
    dosage: row.dosage,
    content: row.content,
    expire_date: row.registration_expire,
  }
  // 原药行回显（product_original 聚合数组；空则默认 1 行）
  const saved = Array.isArray(row.originals) && row.originals.length ? row.originals : []
  origRows.value = saved.length
    ? saved.map((o: any) => ({ ingredient: String(o.ingredient || ''), regNo: String(o.regNo || ''), company: String(o.company || '') }))
    : [makeOrigRow()]
  origHint.value = saved.length ? '已有原药记录回显，可修改；重新选择登记产品后将按有效成分重新初始化' : '该产品暂无原药记录，请补充（每行两字段必填）'
  origCompound.value = false
  // 编辑态行级候选池（按现有登记证号加载，不覆盖行值）
  loadPoolForReg(row.registration_no)
  showModal.value = true
}

const save = async () => {
  if (!form.registrationNo.trim()) { toast.add({ title: '请输入登记证号（可先选择登记产品自动带出）', color: 'warning' }); return }
  if (!form.name.trim()) { toast.add({ title: '请输入农药名称', color: 'warning' }); return }
  if (!form.specId) { toast.add({ title: '请选择规格', color: 'warning' }); return }
  if (origBusy.value) { toast.add({ title: '原药匹配中，请稍候再保存', color: 'warning' }); return }
  // 原药行校验：至少 1 行，每行两字段必填（需求2.5）
  if (!origRows.value.length) { toast.add({ title: '原药信息至少保留 1 行', color: 'warning' }); return }
  for (let i = 0; i < origRows.value.length; i++) {
    const r = origRows.value[i]
    if ((r.regNo.trim() || r.company.trim()) && (!r.regNo.trim() || !r.company.trim())) {
      toast.add({ title: '第 ' + (i + 1) + ' 行原药：登记证号与原药企业均必填（可下拉选择或手动输入）', color: 'warning' })
      return
    }
  }
  saving.value = true
  try {
    const body: any = {
      trademark: form.trademark, name: form.name, registrationNo: form.registrationNo,
      registrationExpire: form.registrationExpire, regCategory: form.regCategory, holderName: form.holderName,
      produceType: form.produceType, dosage: form.dosage, toxicity: form.toxicity,
      specId: form.specId, content: form.content, category: form.category,
      isRestricted: form.isRestricted, status: form.status,
      originals: origRows.value.map(r => ({ ingredient: r.ingredient, regNo: r.regNo.trim(), company: r.company.trim() })),
    }
    if (isPlatformAdmin.value && !editingId.value) {
      // 仅新增时选择厂家；编辑接口按现有产品保留归属，不要求重选或提交厂家。
      if (!pickedCompany.value) { toast.add({ title: '请选择归属厂家（登记数据源厂家）', color: 'warning' }); saving.value = false; return }
      body.company = pickedCompany.value
    }
    if (editingId.value) {
      await $fetch('/api/admin/products/' + editingId.value, { method: 'PATCH', body })
      toast.add({ title: '产品已更新', color: 'success' })
    } else {
      await $fetch('/api/admin/products', { method: 'POST', body })
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
        <p class="b-page-desc">产品 SKU 化 · 规格来自主数据下拉选择 · 登记信息可从登记数据源自动带出后修改 · 原药信息支持多行（复配多原药）</p>
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

    <!-- 新增/编辑对话框 -->
    <UModal v-model:open="showModal" :ui="{ content: 'max-w-3xl' }">
      <template #content>
        <div class="b-modal">
          <div class="b-modal-head">
            <div class="b-modal-icon">
              <UIcon :name="editingId ? 'i-lucide-pencil' : 'i-lucide-plus'" class="h-4 w-4 text-[var(--b-text-regular)]" />
            </div>
            <div>
              <h3 class="b-modal-title">{{ editingId ? '编辑产品' : '新增产品' }}</h3>
            </div>
          </div>
          <div class="b-modal-body">
            <!-- 第 1 步：生产类型 + 归属企业（总部；完整厂家列表 + 可输入搜索，2026-09-04 需求 1） -->
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="b-label-lg">生产类型 <span class="b-required">*</span></label>
                <USelect
                  v-model="form.produceType"
                  :items="PRODUCE_TYPES"
                  class="w-full"
                  @update:model-value="onProduceTypeChange"
                />
              </div>
              <div v-if="isPlatformAdmin && !editingId">
                <label class="b-label-lg">归属企业（登记数据源厂家）<span class="b-required">*</span></label>
                <EnterprisePicker
                  v-model="pickedCompany"
                  placeholder="输入厂家名搜索（登记数据源全部 3,637 家厂家）"
                  @update:model-value="onCompanyChange"
                />
              </div>
            </div>

            <!-- 第 2 步：登记产品选择（登记数据源） -->
            <div>
              <label class="b-label-lg">登记产品（数据源）<span class="b-required">*</span></label>
              <RegProductPicker
                v-model:selected="pickedReg"
                :produce-type="form.produceType"
                :enterprise-id="enterpriseId"
                :company="isPlatformAdmin ? pickedCompany : null"
                @select="onRegSelected"
                @clear="onRegCleared"
              />
            </div>

            <!-- 第 3 步：登记信息（数据源带出默认值，全部可修改） -->
            <div class="rounded border border-[var(--b-border)] p-3">
              <div class="mb-2 flex items-center justify-between">
                <span class="text-[13px] font-medium text-[var(--b-text-title)]">登记信息（数据源带出，可修改）</span>
                <span class="text-xs text-[var(--b-text-muted)]">切换登记产品后按数据源覆盖刷新</span>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="b-label">农药名称 <span class="b-required">*</span></label>
                  <UInput v-model="form.name" placeholder="选中产品自动带出，可修改" />
                </div>
                <div>
                  <label class="b-label">登记证号 <span class="b-required">*</span></label>
                  <UInput v-model="form.registrationNo" class="font-code" placeholder="选中产品自动带出，可修改" />
                </div>
                <div>
                  <label class="b-label">登记证有效期至</label>
                  <UInput v-model="form.registrationExpire" type="date" />
                </div>
                <div>
                  <label class="b-label">登记类别</label>
                  <USelect v-model="form.regCategory" :items="REG_CATEGORIES" class="w-full" />
                </div>
                <div>
                  <label class="b-label">登记证持有人名称</label>
                  <UInput v-model="form.holderName" placeholder="扫码必显字段" />
                </div>
                <div>
                  <label class="b-label">产品类别 <span class="b-required">*</span></label>
                  <USelect v-model="form.category" :items="categoryOptions" class="w-full" />
                </div>
                <div>
                  <label class="b-label">剂型</label>
                  <UInput v-model="form.dosage" placeholder="如：可湿性粉剂" />
                </div>
                <div>
                  <label class="b-label">毒性</label>
                  <USelect v-model="form.toxicity" :items="TOXICITY.map(t => ({ value: t, label: t }))" class="w-full" />
                </div>
                <div>
                  <label class="b-label">总含量</label>
                  <UInput v-model="form.content" placeholder="如：25%" />
                </div>
              </div>
            </div>

            <!-- 第 4 步：用户手动字段（商标非必填 + 规格必选 + 限制使用） -->
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="b-label-lg">产品商标</label>
                <UInput v-model="form.trademark" placeholder="如：绿丰（选填）" />
              </div>
              <div>
                <label class="b-label-lg">规格（来自主数据，不可手填）<span class="b-required">*</span></label>
                <USelect
                  v-model="form.specId"
                  :items="(specData?.rows || []).map((s: any) => ({
                    value: Number(s.id),
                    label: Number(s.status) === 1 ? s.spec_name : s.spec_name + '（已停用）',
                    disabled: Number(s.status) !== 1 && Number(s.id) !== Number(form.specId),
                  }))"
                  placeholder="选择规格"
                  class="w-full"
                  :content="{ class: 'min-w-72' }"
                  :ui="{ itemLabel: { class: 'whitespace-normal break-words' } }"
                />
                <p v-if="selectedSpec" class="b-help">
                  净含量：{{ selectedSpec.net_content ?? '-' }} {{ selectedSpec.content_unit }} / {{ selectedSpec.pack_unit }}（自动带出）
                </p>
              </div>
            </div>
            <div>
              <label class="b-label-lg">是否限制使用</label>
              <div class="flex items-center gap-2 pt-1.5">
                <USwitch v-model="form.isRestricted" />
                <span class="text-sm text-[var(--b-text-regular)]">{{ form.isRestricted ? '是（触发实名购买）' : '否' }}</span>
              </div>
            </div>

            <!-- 第 5 步：原药（母药）信息（多行，2026-09-04 需求 2） -->
            <div class="rounded border border-[var(--b-border)] p-3">
              <div class="mb-2 flex items-center justify-between">
                <span class="text-[13px] font-medium text-[var(--b-text-title)]">原药（母药）信息</span>
                <span v-if="origHint" class="text-xs text-[var(--b-text-muted)]">{{ origHint }}</span>
              </div>
              <!-- 复配制剂提醒：核对每个有效成分对应的原药 -->
              <div v-if="origCompound" class="mb-2 rounded bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
                本产品为复配制剂，请核对每个有效成分对应的原药信息
              </div>
              <!-- 原药行列表 -->
              <div v-for="(row, idx) in origRows" :key="idx" class="mb-2 rounded border border-[var(--b-divider)] px-3 py-2">
                <div class="mb-1 flex items-center justify-between">
                  <span class="text-xs font-medium text-[var(--b-text-muted)]">原药记录 {{ idx + 1 }}</span>
                  <UButton
                    variant="link"
                    color="neutral"
                    size="xs"
                    icon="i-lucide-trash-2"
                    :disabled="origRows.length <= 1"
                    @click="removeOrigRow(idx)"
                  >
                    删除
                  </UButton>
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <div v-if="origCompound || row.ingredient" class="col-span-2">
                    <label class="b-label">对应有效成分 <span v-if="origCompound" class="b-required">*</span></label>
                    <USelect v-if="origCompound" v-model="row.ingredient" :items="(pickedReg?.ingredient_all || []).map((i: string) => ({ label: i, value: i }))" class="w-full" />
                    <div v-else class="rounded border border-[var(--b-border)] px-3 py-2 text-sm text-[var(--b-text-regular)]">{{ row.ingredient || '原药' }}</div>
                  </div>
                  <div>
                    <label class="b-label">原药登记证号 <span class="b-required">*</span></label>
                    <RegOrigCombobox
                      :model-value="row.regNo"
                      :items="origPool.filter(c => !row.ingredient || c.ingredient === row.ingredient)"
                      value-of="reg"
                      placeholder="下拉选择或手动输入"
                      @update:model-value="row.regNo = $event; syncOrigRow(row, 'regNo')"
                    />
                  </div>
                  <div>
                    <label class="b-label">原药生产企业名称 <span class="b-required">*</span></label>
                    <RegOrigCombobox
                      :model-value="row.company"
                      :items="origPool.filter(c => !row.ingredient || c.ingredient === row.ingredient)"
                      value-of="company"
                      placeholder="下拉选择或手动输入"
                      @update:model-value="row.company = $event; syncOrigRow(row, 'company')"
                    />
                  </div>
                </div>
              </div>
              <div class="flex items-center justify-between">
                <p class="text-xs text-[var(--b-text-muted)]">
                  每行两字段支持下拉选择与手动输入并双向联动；复配多原药请点击「添加行」补充（至少保留 1 行）
                </p>
                <UButton variant="outline" color="neutral" size="xs" icon="i-lucide-plus" @click="addOrigRow">添加行</UButton>
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

