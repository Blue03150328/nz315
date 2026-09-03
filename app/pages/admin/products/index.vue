<script setup lang="ts">
// 产品管理（PRD 5.4：SKU 化，规格来自主数据下拉选择）
// 2026-09 迭代：登记产品（数据源）选中后自动回填登记信息作为默认值——
// 回填字段全部可手动编辑修改；产品类别随数据源农药类别回填（不在标准集合时并入选项）；
// 原药两字段：原药/母药自身回填可编辑、制剂按首个有效成分匹配（唯一回填可编辑/多家双下拉联动必选/无匹配手填提示）
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
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

// 启用中的规格（供下拉选择）
const { data: specData } = await useFetch<any>('/api/admin/specs', {
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

// 企业列表（仅总部管理员新建产品时选择归属企业）
const { data: factoryData } = await useFetch<any>('/api/admin/factories', {
  key: 'admin-factories-options',
  query: { page: 1, pageSize: 100 },
  immediate: !!isPlatformAdmin.value,
})

// ============ 新增/编辑弹窗 ============
const showModal = ref(false)
const editingId = ref<number | null>(null)
const saving = ref(false)

// 归属企业：厂家账号固定本企业；总部管理员新建时需选择（决定「本厂」过滤口径与归属）
const enterpriseId = ref<number | null>(isPlatformAdmin.value ? null : (user.value?.enterprise_id || null))

const form = reactive({
  trademark: '', name: '', registrationNo: '', registrationExpire: '',
  regCategory: 1, holderName: '', produceType: 1, dosage: '', toxicity: '低毒',
  specId: null as number | null, content: '', category: '杀虫剂',
  isRestricted: false, originalRegNo: '', originalCompany: '', status: 1,
})

// 登记数据源选择状态
const pickedReg = ref<any>(null) // 当前已选登记产品行（服务端数据源行）

// 原药匹配状态：idle(未处理/编辑回显) / original(产品本身为原药·自身回填可编辑) /
// auto(制剂唯一匹配·自动回填可编辑) / select(多匹配·双下拉联动必选) / manual(无匹配·手动补充)
const orig = reactive({ mode: 'idle' as string, candidates: [] as any[], hint: '', compound: false })
const origSelectItems = computed(() =>
  orig.candidates.map((c: any) => ({ value: c.registration_no, label: c.registration_no + ' | ' + (c.company || '') + '（原药）' }))
)
const origCompanyOf = (regNo: string) => (orig.candidates.find((c: any) => c.registration_no === regNo) || {}).company || ''

// 产品类别下拉：标准 5 类 + 数据源带出的非标类别动态并入（保证回填值可显示、可保留）
const categoryOptions = computed(() => {
  const list = CATEGORIES.map(c => ({ value: c, label: c }))
  if (form.category && !CATEGORIES.includes(form.category)) list.push({ value: form.category, label: form.category })
  return list
})

const selectedSpec = computed(() => (specData.value?.rows || []).find((s: any) => Number(s.id) === Number(form.specId)))

/** 清空「登记数据源回填」的全部字段（产品被清除/切换生产类型被过滤后调用；用户手动字段商标/规格保留） */
function clearRegFields() {
  Object.assign(form, {
    name: '', registrationNo: '', registrationExpire: '', regCategory: 1, holderName: '',
    dosage: '', toxicity: '低毒', content: '', category: '杀虫剂', originalRegNo: '', originalCompany: '',
  })
  Object.assign(orig, { mode: 'idle', candidates: [], hint: '', compound: false })
}

/** 选中登记产品 → 以数据源值覆盖刷新全部回填字段（用户此前手改内容会被覆盖，需求约束1） */
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
    // 产品类别：数据源农药类别原值回填（空值回退默认）
    category: row.category || '杀虫剂',
  })
  await computeOriginal(row)
}

/** 按选中产品剂型计算原药两字段状态（方案B：原药自身回填 / 制剂按首个有效成分匹配） */
async function computeOriginal(row: any) {
  const dosage = String(row.dosage || '')
  const isOriginal = /原药|母药/.test(dosage)
  // 复配制剂检测：数据源成分数组长度 > 1（复配仅取第一个有效成分匹配，需提示核对）
  const ingredientAll = Array.isArray(row.ingredient_all) ? row.ingredient_all : []
  const compound = !isOriginal && ingredientAll.length > 1

  if (isOriginal) {
    // ① 产品本身是原药/母药：原药信息即其自身登记信息（回填后允许编辑）
    form.originalRegNo = row.registration_no || ''
    form.originalCompany = row.company || ''
    Object.assign(orig, { mode: 'original', candidates: [], hint: '该产品为原药（母药），原药登记证号/生产企业已按其自身登记信息回填，可修改', compound: false })
    return
  }
  // ② 制剂：解析有效成分（复配仅取首个成分）→ 匹配数据源中原药/母药记录
  const main = String(row.ingredient_main || '').trim()
  if (!main) {
    form.originalRegNo = ''
    form.originalCompany = ''
    Object.assign(orig, { mode: 'manual', candidates: [], hint: '未匹配到对应原药数据，请手动补充', compound })
    return
  }
  Object.assign(orig, { mode: 'loading', candidates: [], hint: '正在匹配原药登记…', compound })
  try {
    const data = await $fetch<any>('/api/admin/regdata/originals', { query: { ingredient: main } })
    const cands = data?.rows || []
    if (cands.length === 0) {
      // 无匹配：留空提示手动补充（允许输入）
      form.originalRegNo = ''
      form.originalCompany = ''
      Object.assign(orig, { mode: 'manual', candidates: [], hint: '未匹配到对应原药数据，请手动补充', compound })
    } else if (cands.length === 1) {
      // 唯一匹配：自动回填（回填后允许用户编辑）
      form.originalRegNo = cands[0].registration_no
      form.originalCompany = cands[0].company || ''
      Object.assign(orig, { mode: 'auto', candidates: [], hint: '已按有效成分「' + main + '」自动匹配唯一原药登记，可修改', compound })
    } else {
      // 多匹配：两个字段均为下拉选择框（同一候选集，选中任一项双向联动），保存时必填
      form.originalRegNo = ''
      form.originalCompany = ''
      Object.assign(orig, { mode: 'select', candidates: cands, hint: '有效成分「' + main + '」匹配到 ' + cands.length + ' 家原药登记，请选择（保存必填）', compound })
    }
  } catch (e: any) {
    form.originalRegNo = ''
    form.originalCompany = ''
    Object.assign(orig, { mode: 'manual', candidates: [], hint: '原药匹配服务异常，请手动补充', compound })
  }
}

/** 多匹配下拉选中（登记证号下拉与企业下拉共用同一 v-model，天然同步）→ 联动企业名称 */
function onOrigSelect() {
  if (form.originalRegNo) form.originalCompany = origCompanyOf(form.originalRegNo)
}

/** 登记产品被清除：全部登记信息同步清空（商标/规格等手动字段保留） */
function onRegCleared() {
  pickedReg.value = null
  clearRegFields()
}

/** 生产类型切换：产品下拉按新范围重新过滤；当前已选产品不在范围内则清空（需求1.1） */
async function onProduceTypeChange(v: number) {
  if (!pickedReg.value) return
  try {
    const chk = await $fetch<any>('/api/admin/regdata', {
      query: {
        exact: pickedReg.value.registration_no,
        produceType: v,
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

/** 总部管理员切换归属企业：本厂口径变化，若已选产品则清空（保守处理） */
function onEnterpriseChange() {
  if (pickedReg.value) {
    pickedReg.value = null
    clearRegFields()
  }
}

const openCreate = () => {
  editingId.value = null
  Object.assign(form, {
    trademark: '', name: '', registrationNo: '', registrationExpire: '', regCategory: 1, holderName: '',
    produceType: 1, dosage: '', toxicity: '低毒', specId: null, content: '',
    category: '杀虫剂', isRestricted: false, originalRegNo: '', originalCompany: '', status: 1,
  })
  pickedReg.value = null
  Object.assign(orig, { mode: 'idle', candidates: [], hint: '', compound: false })
  enterpriseId.value = isPlatformAdmin.value ? null : (user.value?.enterprise_id || null)
  showModal.value = true
}

const openEdit = (row: any) => {
  editingId.value = row.id
  Object.assign(form, {
    trademark: row.trademark || '', name: row.name, registrationNo: row.registration_no,
    registrationExpire: row.registration_expire ? String(row.registration_expire).slice(0, 10) : '',
    regCategory: Number(row.reg_category || 1), holderName: row.holder_name || '',
    produceType: Number(row.produce_type || 1), dosage: row.dosage || '', toxicity: row.toxicity || '低毒',
    specId: row.spec_id, content: row.content || '',
    category: row.category || '杀虫剂', isRestricted: Number(row.is_restricted) === 1,
    originalRegNo: row.original_reg_no || '', originalCompany: row.original_company || '',
    status: Number(row.status),
  })
  // 编辑回显：登记产品摘要取自现有产品行（不自动覆盖用户数据）
  pickedReg.value = {
    registration_no: row.registration_no,
    product_name: row.name,
    company: row.holder_name,
    dosage: row.dosage,
    content: row.content,
    expire_date: row.registration_expire,
  }
  // 原药：已有值直接回显可编辑；重新选择登记产品后按数据源规则重新处理
  Object.assign(orig, { mode: 'idle', candidates: [], hint: '重新选择登记产品后将按有效成分自动匹配原药', compound: false })
  showModal.value = true
}

const save = async () => {
  // 基础校验（登记证号全局唯一由服务端校验；此处为必填与格式校验）
  if (!form.registrationNo.trim()) { toast.add({ title: '请输入登记证号（可先选择登记产品自动带出）', color: 'warning' }); return }
  if (!form.name.trim()) { toast.add({ title: '请输入农药名称', color: 'warning' }); return }
  if (!form.specId) { toast.add({ title: '请选择规格', color: 'warning' }); return }
  if (orig.mode === 'loading') { toast.add({ title: '原药匹配中，请稍候再保存', color: 'warning' }); return }
  // 制剂匹配多条原药：两字段必填，不允许空提交（需求重点3）
  if (orig.mode === 'select' && !form.originalRegNo) {
    toast.add({ title: '该产品匹配到多家原药登记，请选择原药登记证号与原药企业', color: 'warning' })
    return
  }
  saving.value = true
  try {
    const body: any = { ...form }
    if (isPlatformAdmin.value) {
      if (!enterpriseId.value) { toast.add({ title: '请选择归属企业', color: 'warning' }); saving.value = false; return }
      body.enterpriseId = enterpriseId.value
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
        <p class="b-page-desc">产品 SKU 化 · 规格来自主数据下拉选择 · 登记信息可从登记数据源自动带出后修改</p>
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

    <!-- 新增/编辑对话框（Nuxt UI v4：v-model:open + #content；内容多，加宽弹窗） -->
    <UModal v-model:open="showModal" :ui="{ content: 'max-w-3xl' }">
      <template #content>
        <div class="b-modal">
          <div class="b-modal-head">
            <div class="b-modal-icon">
              <UIcon :name="editingId ? 'i-lucide-pencil' : 'i-lucide-plus'" class="h-4 w-4 text-[var(--b-text-regular)]" />
            </div>
            <div>
              <h3 class="b-modal-title">{{ editingId ? '编辑产品' : '新增产品' }}</h3>
              <p class="b-modal-sub">选择登记产品自动带出登记信息（可修改）· 登记证号全局唯一 · 规格取自主数据</p>
            </div>
          </div>
          <div class="b-modal-body">
            <!-- 第 1 步：生产类型（决定登记产品过滤范围）+ 归属企业（总部） -->
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="b-label-lg">生产类型 <span class="b-required">*</span></label>
                <USelect
                  v-model="form.produceType"
                  :items="PRODUCE_TYPES"
                  class="w-full"
                  @update:model-value="onProduceTypeChange"
                />
                <p class="b-help">持有人生产仅可选本厂产品；委托加工 / 委托分装可选全部登记产品</p>
              </div>
              <div v-if="isPlatformAdmin && !editingId">
                <label class="b-label-lg">归属企业 <span class="b-required">*</span></label>
                <USelect
                  v-model="enterpriseId"
                  :items="(factoryData?.rows || []).map((e: any) => ({ value: Number(e.id), label: e.name }))"
                  placeholder="选择归属企业"
                  class="w-full"
                  @update:model-value="onEnterpriseChange"
                />
                <p class="b-help">持有人生产时按该企业名称过滤本厂登记产品</p>
              </div>
            </div>

            <!-- 第 2 步：登记产品选择（登记数据源） -->
            <div>
              <label class="b-label-lg">登记产品（数据源）<span class="b-required">*</span></label>
              <RegProductPicker
                v-model:selected="pickedReg"
                :produce-type="form.produceType"
                :enterprise-id="enterpriseId"
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
                  :items="(specData?.rows || []).map((s: any) => ({ value: Number(s.id), label: s.spec_name + '（码 ' + s.spec_code + '）' }))"
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

            <!-- 第 5 步：原药信息（按剂型与匹配结果动态切换） -->
            <div class="rounded border border-[var(--b-border)] p-3">
              <div class="mb-2 flex items-center justify-between">
                <span class="text-[13px] font-medium text-[var(--b-text-title)]">原药（母药）信息</span>
                <span v-if="orig.hint" class="text-xs text-[var(--b-text-muted)]">{{ orig.hint }}</span>
              </div>
              <!-- 复配制剂提示：仅基于第一个有效成分匹配 -->
              <div v-if="orig.compound" class="mb-2 rounded bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
                本产品为复配制剂，仅基于第一个有效成分匹配原药，请仔细核对
              </div>
              <div v-if="orig.mode === 'idle' && !editingId" class="py-1 text-xs text-[var(--b-text-muted)]">
                选择登记产品后，将按剂型自动匹配原药登记（原药产品自动回填自身；制剂按有效成分匹配）
              </div>
              <div v-else class="grid grid-cols-2 gap-3">
                <div>
                  <label class="b-label-lg">原药登记证号</label>
                  <USelect
                    v-if="orig.mode === 'select'"
                    v-model="form.originalRegNo"
                    :items="origSelectItems"
                    placeholder="请选择原药登记（匹配到多家）"
                    class="w-full"
                    :content="{ class: 'min-w-80' }"
                    :ui="{ itemLabel: { class: 'whitespace-normal break-words' } }"
                    @update:model-value="onOrigSelect"
                  />
                  <UInput v-else v-model="form.originalRegNo" placeholder="制剂产品扫码必显" />
                </div>
                <div>
                  <label class="b-label-lg">原药生产企业名称</label>
                  <USelect
                    v-if="orig.mode === 'select'"
                    v-model="form.originalRegNo"
                    :items="origSelectItems"
                    placeholder="请选择原药企业（与登记证号联动）"
                    class="w-full"
                    :content="{ class: 'min-w-80' }"
                    :ui="{ itemLabel: { class: 'whitespace-normal break-words' } }"
                    @update:model-value="onOrigSelect"
                  />
                  <UInput v-else v-model="form.originalCompany" placeholder="与登记证号配套填写" />
                </div>
              </div>
              <p v-if="orig.mode === 'manual'" class="mt-1 text-xs text-amber-600">未匹配到对应原药数据，请手动补充原药登记证号与生产企业名称</p>
              <p v-else-if="orig.mode === 'select'" class="mt-1 text-xs text-[var(--b-text-muted)]">选中原药登记证号后原药企业名称自动带出（两处下拉均可选择，联动一致）</p>
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
