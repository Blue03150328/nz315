<script setup lang="ts">
// 产品管理（PRD 5.4：SKU 化，规格来自主数据下拉选择）
// 2026-09 改造：新增/编辑弹窗接入「农药登记数据源」——选择登记产品自动回填 8 个只读字段，
// 原药两字段按「剂型原药/制剂匹配」动态切换（只读回填 / 下拉选择 / 手动补充），保质期字段整体移除
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
const pickedReg = ref<any>(null)      // 当前已选登记产品行（服务端数据源行）
const regLocked = ref(false)          // true=登记信息来自数据源（只读）；编辑回显不锁定，重新选产品后锁定

// 原药匹配状态：idle(未处理) / loading / original(产品本身为原药·自身回填只读) /
// auto(制剂唯一匹配·自动回填只读) / select(多匹配·必须下拉选择) / manual(无匹配·手动补充)
const orig = reactive({ mode: 'idle' as string, candidates: [] as any[], hint: '' })
const origSelectItems = computed(() =>
  orig.candidates.map((c: any) => ({ value: c.registration_no, label: c.registration_no + ' | ' + (c.company || '') + '（原药）' }))
)
const origCompanyOf = (regNo: string) => (orig.candidates.find((c: any) => c.registration_no === regNo) || {}).company || ''

const selectedSpec = computed(() => (specData.value?.rows || []).find((s: any) => Number(s.id) === Number(form.specId)))

/** 清空「数据源回填」的全部字段（产品切换/生产类型过滤后调用） */
function clearRegFields() {
  Object.assign(form, {
    name: '', registrationNo: '', registrationExpire: '', regCategory: 1, holderName: '',
    dosage: '', toxicity: '低毒', content: '', originalRegNo: '', originalCompany: '',
  })
  Object.assign(orig, { mode: 'idle', candidates: [], hint: '' })
  regLocked.value = false
}

/** 选中登记产品 → 回填 8 个只读字段 + 重算原药匹配 */
async function onRegSelected(row: any) {
  pickedReg.value = row
  regLocked.value = true
  Object.assign(form, {
    name: row.product_name || '',
    registrationNo: row.registration_no || '',
    registrationExpire: row.expire_date ? String(row.expire_date).slice(0, 10) : '',
    regCategory: Number(row.reg_category ?? 1),
    holderName: row.company || '',
    dosage: row.dosage || '',
    toxicity: TOXICITY.includes(row.toxicity) ? row.toxicity : (row.toxicity || '低毒'),
    content: row.content || '',
  })
  await computeOriginal(row)
}

/** 按选中产品剂型计算原药两字段的三态模式（需求方案B） */
async function computeOriginal(row: any) {
  const dosage = String(row.dosage || '')
  const isOriginal = /原药|母药/.test(dosage)
  if (isOriginal) {
    // ① 产品本身是原药/母药：原药登记证号=本条登记证号，持有人=本条厂家（只读回填）
    form.originalRegNo = row.registration_no || ''
    form.originalCompany = row.company || ''
    Object.assign(orig, { mode: 'original', candidates: [], hint: '该产品为原药（母药），原药信息即其自身登记信息' })
    return
  }
  // ② 制剂：解析有效成分 → 匹配数据源中原药/母药记录
  const main = String(row.ingredient_main || '').trim()
  if (!main) {
    form.originalRegNo = ''
    form.originalCompany = ''
    Object.assign(orig, { mode: 'manual', candidates: [], hint: '未匹配到对应原药数据，请手动补充' })
    return
  }
  Object.assign(orig, { mode: 'loading', candidates: [], hint: '正在匹配原药登记…' })
  try {
    const data = await $fetch<any>('/api/admin/regdata/originals', { query: { ingredient: main } })
    const cands = data?.rows || []
    if (cands.length === 0) {
      // 无匹配：留空提示手动补充
      form.originalRegNo = ''
      form.originalCompany = ''
      Object.assign(orig, { mode: 'manual', candidates: [], hint: '未匹配到对应原药数据，请手动补充' })
    } else if (cands.length === 1) {
      // 唯一匹配：自动回填只读
      form.originalRegNo = cands[0].registration_no
      form.originalCompany = cands[0].company || ''
      Object.assign(orig, { mode: 'auto', candidates: [], hint: '已按有效成分「' + main + '」自动匹配唯一原药登记' })
    } else {
      // 多匹配：下拉选择，保存时必须选择
      form.originalRegNo = ''
      form.originalCompany = ''
      Object.assign(orig, { mode: 'select', candidates: cands, hint: '有效成分「' + main + '」匹配到 ' + cands.length + ' 家原药登记，请选择' })
    }
  } catch (e: any) {
    form.originalRegNo = ''
    form.originalCompany = ''
    Object.assign(orig, { mode: 'manual', candidates: [], hint: '原药匹配服务异常，请手动补充' })
  }
}

/** 多匹配下拉选中原药 → 联动企业名称 */
function onOrigSelect() {
  if (form.originalRegNo) form.originalCompany = origCompanyOf(form.originalRegNo)
}

/** 登记产品被清除 */
function onRegCleared() {
  pickedReg.value = null
  clearRegFields()
}

/** 生产类型切换：重新过滤产品列表；当前已选产品不在新范围内则清空产品与全部回填（需求1.1） */
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

const origIsReadonly = computed(() => ['original', 'auto'].includes(orig.mode))

const openCreate = () => {
  editingId.value = null
  Object.assign(form, {
    trademark: '', name: '', registrationNo: '', registrationExpire: '', regCategory: 1, holderName: '',
    produceType: 1, dosage: '', toxicity: '低毒', specId: null, content: '',
    category: '杀虫剂', isRestricted: false, originalRegNo: '', originalCompany: '', status: 1,
  })
  pickedReg.value = null
  Object.assign(orig, { mode: 'idle', candidates: [], hint: '' })
  regLocked.value = false
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
  // 编辑回显：登记产品摘要取自现有产品行（数据源信息可能滞后，不自动覆盖）
  pickedReg.value = {
    registration_no: row.registration_no,
    product_name: row.name,
    company: row.holder_name,
    dosage: row.dosage,
    content: row.content,
    expire_date: row.registration_expire,
  }
  regLocked.value = false
  // 原药：编辑态已有值直接回显可编辑；重新选择产品后按数据源规则重新处理
  Object.assign(orig, { mode: 'idle', candidates: [], hint: '重新选择登记产品后将按有效成分自动匹配原药' })
  showModal.value = true
}

const save = async () => {
  // 校验：新增必须从登记数据源选择产品；原登记信息为回填来源
  if (!form.registrationNo) { toast.add({ title: '请先从登记数据源选择产品', color: 'warning' }); return }
  if (!form.name) { toast.add({ title: '请先选择登记产品并回填登记信息', color: 'warning' }); return }
  if (!form.specId) { toast.add({ title: '请选择规格', color: 'warning' }); return }
  if (orig.mode === 'loading') { toast.add({ title: '原药匹配中，请稍候再保存', color: 'warning' }); return }
  // 制剂匹配多条原药：必须选择（需求重点 6）
  if (orig.mode === 'select' && !form.originalRegNo) {
    toast.add({ title: '该产品匹配到多家原药登记，请选择原药登记证号', color: 'warning' })
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
        <p class="b-page-desc">产品 SKU 化 · 规格来自主数据下拉选择 · 登记信息可从登记数据源自动回填</p>
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
              <p class="b-modal-sub">选择登记产品自动回填登记信息 · 登记证号全局唯一 · 规格取自主数据</p>
            </div>
          </div>
          <div class="b-modal-body">
            <!-- 第 1 步：生产类型（决定产品下拉过滤范围）+ 归属企业（总部） -->
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

            <!-- 第 3 步：登记信息自动回填（只读） -->
            <div class="rounded border border-[var(--b-border)] p-3">
              <div class="mb-2 flex items-center justify-between">
                <span class="text-[13px] font-medium text-[var(--b-text-title)]">登记信息（自动回填）</span>
                <span v-if="regLocked" class="b-tag b-tag-info">数据源回填 · 只读</span>
                <span v-else-if="editingId" class="text-xs text-[var(--b-text-muted)]">编辑回显 · 重新选择产品后进入数据源只读</span>
                <span v-else class="text-xs text-[var(--b-text-muted)]">选择登记产品后自动回填，不可手动编辑</span>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="b-label">农药名称</label>
                  <UInput v-model="form.name" :disabled="regLocked" placeholder="选中产品后自动回填" />
                </div>
                <div>
                  <label class="b-label">登记证号</label>
                  <UInput v-model="form.registrationNo" :disabled="regLocked" class="font-code" placeholder="选中产品后自动回填" />
                </div>
                <div>
                  <label class="b-label">登记证有效期至</label>
                  <UInput v-model="form.registrationExpire" type="date" :disabled="regLocked" />
                </div>
                <div>
                  <label class="b-label">登记类别</label>
                  <USelect v-model="form.regCategory" :items="REG_CATEGORIES" :disabled="regLocked" class="w-full" />
                </div>
                <div>
                  <label class="b-label">登记证持有人名称</label>
                  <UInput v-model="form.holderName" :disabled="regLocked" placeholder="扫码必显字段" />
                </div>
                <div>
                  <label class="b-label">剂型</label>
                  <UInput v-model="form.dosage" :disabled="regLocked" placeholder="如：可湿性粉剂" />
                </div>
                <div>
                  <label class="b-label">毒性</label>
                  <USelect v-model="form.toxicity" :items="TOXICITY.map(t => ({ value: t, label: t }))" :disabled="regLocked" class="w-full" />
                </div>
                <div>
                  <label class="b-label">总含量</label>
                  <UInput v-model="form.content" :disabled="regLocked" placeholder="如：25%" />
                </div>
              </div>
            </div>

            <!-- 第 4 步：用户手动字段（商标非必填 + 规格必选） -->
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
                  净含量：{{ selectedSpec.net_content ?? '-' }} {{ selectedSpec.content_unit }} / {{ selectedSpec.pack_unit }}（自动带出，只读）
                </p>
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

            <!-- 第 5 步：原药信息（按剂型与匹配结果动态切换状态） -->
            <div class="rounded border border-[var(--b-border)] p-3">
              <div class="mb-2 flex items-center justify-between">
                <span class="text-[13px] font-medium text-[var(--b-text-title)]">原药（母药）信息</span>
                <span v-if="orig.hint" class="text-xs text-[var(--b-text-muted)]">{{ orig.hint }}</span>
              </div>
              <div v-if="orig.mode === 'idle' && !editingId" class="py-1 text-xs text-[var(--b-text-muted)]">
                选择登记产品后，将按剂型自动匹配原药登记（原药产品自动回填自身；制剂按有效成分匹配）
              </div>
              <div v-else class="grid grid-cols-2 gap-3">
                <div>
                  <label class="b-label-lg">原药登记证号</label>
                  <template v-if="orig.mode === 'select'">
                    <USelect
                      v-model="form.originalRegNo"
                      :items="origSelectItems"
                      placeholder="请选择原药登记（匹配到多家）"
                      class="w-full"
                      :content="{ class: 'min-w-80' }"
                      :ui="{ itemLabel: { class: 'whitespace-normal break-words' } }"
                      @update:model-value="onOrigSelect"
                    />
                    <p class="b-help">匹配到多家原药登记，必须选择其一</p>
                  </template>
                  <UInput v-else v-model="form.originalRegNo" :disabled="origIsReadonly" placeholder="制剂产品扫码必显" />
                </div>
                <div>
                  <label class="b-label-lg">原药生产企业名称</label>
                  <template v-if="orig.mode === 'select'">
                    <UInput :model-value="form.originalCompany" disabled placeholder="选择原药登记证号后自动带出" />
                  </template>
                  <UInput v-else v-model="form.originalCompany" :disabled="origIsReadonly" placeholder="与登记证号配套填写" />
                </div>
              </div>
              <p v-if="orig.mode === 'manual'" class="mt-1 text-xs text-amber-600">未匹配到对应原药数据，请手动补充原药登记证号与生产企业名称</p>
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
