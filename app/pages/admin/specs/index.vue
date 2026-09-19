<script setup lang="ts">
// 产品规格管理（PRD 5.3：主数据，规格码对应 32 位码第 9-11 位）
// Keep-Alive 页面缓存：左侧菜单切换后返回保留页面状态（表单/筛选/页码/预览）；刷新、退出登录自动清空；页内【重置】恢复初始
definePageMeta({ layout: 'admin', middleware: 'backend-guard', keepalive: true })
useHead({ title: '产品规格管理' })

const toast = useToast()
const filters = reactive({ keyword: '', contentUnit: undefined as string | undefined, packUnit: undefined as string | undefined, status: undefined as string | undefined })
const page = ref(1)
const pageSize = 20

// 含量单位选项：全中文（2026-09-03 用户决策，英改中；新增记录存储即中文，存量英文数据由用户在库中自行修改）
const UNITS = ['毫升', '升', '克', '千克', '片', '包', '粒']
const PACKS = ['瓶', '袋', '桶', '盒', '罐', '支', '箱']

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

// ===== 批量导入（2026-09-07：右上角按钮 + 弹窗；模板 public/templates/spec-import-template.xlsx）=====
const { isPlatformAdmin, canWrite } = useUser()
const showImportModal = ref(false)
const importing = ref(false)
const importFile = ref<File | null>(null)
const importFileInput = ref<HTMLInputElement | null>(null)
const importEid = ref<number | null>(null) // 平台管理员指定导入归属企业
const impResult = ref<null | { success: number; failed: number; errors: { row: number; value: string; reason: string }[] }>(null)
const importFileName = computed(() => importFile.value?.name || '')
// 企业下拉（平台管理员场景；企业角色隐藏，走自身 enterprise_id）
const { data: factoryOptions, refresh: refreshFactories } = await useFetch<any>('/api/admin/factories', {
  key: 'admin-factories-specs-import',
  query: { page: 1, pageSize: 100 },
  immediate: false,
})
const openImport = () => {
  showImportModal.value = true
  impResult.value = null
  importFile.value = null
  if (importFileInput.value) importFileInput.value.value = ''
  // 打开时企业列表为空则客户端刷新（keepalive/条件 immediate 缓存路径双保险，仿 products 页先例）
  if (isPlatformAdmin.value && !(factoryOptions.value?.rows?.length)) refreshFactories()
}
const onImportFile = (e: Event) => {
  const input = e.target as HTMLInputElement
  importFile.value = input.files?.[0] || null
  impResult.value = null // 换文件后旧结果作废
}
const doImport = async () => {
  if (!importFile.value) { toast.add({ title: '请先选择要导入的 Excel 文件', color: 'warning' }); return }
  if (isPlatformAdmin.value && !importEid.value) { toast.add({ title: '请选择导入规格归属的企业', color: 'warning' }); return }
  importing.value = true
  impResult.value = null
  try {
    const fd = new FormData()
    fd.append('file', importFile.value)
    if (isPlatformAdmin.value) fd.append('enterpriseId', String(importEid.value))
    const r: any = await $fetch('/api/admin/specs/import', { method: 'POST', body: fd })
    impResult.value = r
    if (Number(r.success) > 0) {
      toast.add({ title: '成功导入 ' + r.success + ' 条规格', color: 'success' })
      refresh()
    }
    if (Number(r.failed) > 0) {
      toast.add({ title: '有 ' + r.failed + ' 条未导入，请查看失败明细', color: 'warning' })
    }
  } catch (err: any) {
    toast.add({ title: err?.data?.statusMessage || '导入失败', color: 'error' })
  } finally {
    importing.value = false
  }
}
/** 模板下载：走 fetch → Blob → 临时 a 标签下载。
 *  不用 <a href download> 直链——实测点击会被 SPA 客户端路由拦截导航到无路由路径显示 404（无网络请求） */
const downloadTemplate = async () => {
  try {
    const blob: any = await $fetch('/templates/spec-import-template.xlsx', { responseType: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '农药产品规格模板.xlsx'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast.add({ title: '模板下载已开始', color: 'success' })
  } catch {
    toast.add({ title: '模板下载失败，请重试', color: 'error' })
  }
}

const totalPages = computed(() => Math.max(1, Math.ceil((data.value?.total || 0) / pageSize)))

// 新增/编辑对话框
const showModal = ref(false)
const editingId = ref<number | null>(null)
const saving = ref(false)
const form = reactive({
  specName: '', netContent: null as number | null, contentUnit: '', packUnit: '',
  status: 1,
})
// 规格码由系统自动分配（= 32 位追溯码第 9-11 位）；编辑时仅回显展示，不可修改
const displayCode = ref('')

const openCreate = () => {
  editingId.value = null
  Object.assign(form, { specName: '', netContent: null, contentUnit: '毫升', packUnit: '瓶', status: 1 })
  displayCode.value = ''
  showModal.value = true
}
const openEdit = (row: any) => {
  editingId.value = row.id
  Object.assign(form, {
    specName: row.spec_name, netContent: row.net_content === null ? null : Number(row.net_content),
    contentUnit: row.content_unit, packUnit: row.pack_unit, status: Number(row.status),
  })
  displayCode.value = String(row.spec_code || '')
  showModal.value = true
}

const save = async () => {
  if (!form.specName.trim()) { toast.add({ title: '请输入规格名称', color: 'warning' }); return }
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

// 删除确认对话框（2026-09-07：操作列停用/启用按钮移除，新增【删除】）
// 置灰约束：被引用（ref_count）> 0 时按钮禁用——服务端 DELETE 同语义校验，双保险防绕过
const delOpen = ref(false)
const delTarget = ref<any>(null) // 待删除的规格行（弹窗回显名称/规格码）
const deleting = ref(false)

const askDelete = (row: any) => {
  delTarget.value = row
  delOpen.value = true
}
const confirmDelete = async () => {
  if (!delTarget.value) return
  deleting.value = true
  try {
    await $fetch('/api/admin/specs/' + delTarget.value.id, { method: 'DELETE' })
    toast.add({ title: '规格已删除', color: 'success' })
    delOpen.value = false
    refresh()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '删除失败', color: 'error' })
  } finally {
    deleting.value = false
  }
}

const doSearch = () => { page.value = 1; refresh() }
const resetSearch = () => { filters.keyword = ''; filters.contentUnit = undefined; filters.packUnit = undefined; filters.status = undefined; page.value = 1; refresh() }
</script>

<template>
  <div class="space-y-4">
    <!-- 页面标题区 -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="b-page-title">产品规格管理</h1>
        <p class="b-page-desc">企业规格主数据 · 规格码对应 32 位追溯码第 9-11 位</p>
      </div>
      <div class="flex items-center gap-2">
        <UButton v-if="canWrite" color="neutral" variant="solid" icon="i-lucide-plus" @click="openCreate">新增规格</UButton>
        <UButton v-if="canWrite" color="neutral" variant="outline" icon="i-lucide-file-up" @click="openImport">批量导入</UButton>
      </div>
    </div>

    <!-- 筛选查询区 -->
    <div class="b-card">
      <div class="b-card-head">
        <span class="b-card-title">筛选查询</span>
      </div>
      <div class="b-form-grid md:grid-cols-2 xl:grid-cols-4">
        <div>
          <label class="b-label">规格名称 / 规格码</label>
          <UInput v-model="filters.keyword" placeholder="输入规格名称或规格码" icon="i-lucide-search" @keyup.enter="doSearch" />
        </div>
        <div>
          <label class="b-label">含量单位</label>
          <USelect v-model="filters.contentUnit" :items="UNITS.map(u => ({ value: u, label: u }))" placeholder="全部含量单位" class="w-full" />
        </div>
        <div>
          <label class="b-label">包装单位</label>
          <USelect v-model="filters.packUnit" :items="PACKS.map(p => ({ value: p, label: p }))" placeholder="全部包装单位" class="w-full" />
        </div>
        <div>
          <label class="b-label">状态</label>
          <USelect v-model="filters.status" :items="[{ value: '1', label: '启用' }, { value: '0', label: '停用' }]" placeholder="全部状态" class="w-full" />
        </div>
      </div>
      <div class="b-card-foot">
        <span class="b-card-extra">共 <span class="font-medium b-strong">{{ data?.total || 0 }}</span> 条规格</span>
        <div class="flex items-center gap-2">
          <UButton color="neutral" variant="solid" :loading="pending" @click="doSearch">查询</UButton>
          <UButton variant="outline" color="neutral" @click="resetSearch">重置</UButton>
        </div>
      </div>
    </div>

    <!-- 规格列表 -->
    <div v-if="error" class="b-card b-card-body text-sm text-red-600">规格列表加载失败，请刷新重试</div>
    <div v-else class="b-card b-card-clip">
      <div class="b-card-head">
        <span class="b-card-title">规格列表</span>
        <span class="b-card-extra">每页 {{ pageSize }} 条 · 共 {{ data?.total || 0 }} 条</span>
      </div>
      <div class="b-scroll-x">
        <table class="b-table">
          <thead>
            <tr>
              <th>规格名称</th>
              <th>净含量</th>
              <th>规格码</th>
              <th>被引用</th>
              <th>状态</th>
              <th class="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in data?.rows || []" :key="r.id">
              <td class="b-strong font-medium">{{ r.spec_name }}</td>
              <td>{{ r.net_content !== null && r.net_content !== undefined ? Number(r.net_content) : '-' }} {{ r.content_unit }} / {{ r.pack_unit }}</td>
              <td><span class="font-code text-[13px] b-strong">{{ r.spec_code }}</span></td>
              <td>{{ r.ref_count }} 个产品</td>
              <td>
                <span class="b-tag" :class="Number(r.status) === 1 ? 'b-tag-success' : 'b-tag-default'">
                  {{ Number(r.status) === 1 ? '启用' : '停用' }}
                </span>
              </td>
              <td>
                <div class="b-actions">
                  <UButton v-if="canWrite" variant="link" color="neutral" size="xs" @click="openEdit(r)">编辑</UButton>
                  <span class="b-sep" />
                  <!-- 被引用 > 0：删除置灰并提示原因（disabled 按钮自身不触发 title，由外层 span 承载）；= 0 可正常点击 -->
                  <span v-if="canWrite && Number(r.ref_count) > 0" :title="'已被 ' + r.ref_count + ' 个产品引用，不可删除'">
                    <UButton variant="link" color="neutral" size="xs" disabled>删除</UButton>
                  </span>
                  <UButton v-else-if="canWrite" variant="link" color="neutral" size="xs" @click="askDelete(r)">删除</UButton>
                </div>
              </td>
            </tr>
            <tr v-if="!pending && !data?.rows?.length">
              <td colspan="6" class="b-empty">
                <div class="b-empty-inner">
                  <UIcon name="i-lucide-inbox" class="b-empty-icon h-8 w-8" />
                  <span class="text-sm">暂无规格数据，点击右上角「新增规格」创建</span>
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
              <h3 class="b-modal-title">{{ editingId ? '编辑规格' : '新增规格' }}</h3>
              <p class="b-modal-sub">规格码对应 32 位追溯码第 9-11 位，企业内唯一</p>
            </div>
          </div>
          <div class="b-modal-body">
            <div>
              <label class="b-label-lg">规格名称 <span class="b-required">*</span></label>
              <UInput v-model="form.specName" placeholder="如：200毫升/瓶（企业内唯一）" />
            </div>
            <div class="grid grid-cols-3 gap-3">
              <div>
                <label class="b-label-lg">净含量数值 <span class="b-required">*</span></label>
                <UInput v-model.number="form.netContent" type="number" placeholder="200" />
              </div>
              <div>
                <label class="b-label-lg">含量单位 <span class="b-required">*</span></label>
                <USelect v-model="form.contentUnit" :items="UNITS.map(u => ({ value: u, label: u }))" class="w-full" />
              </div>
              <div>
                <label class="b-label-lg">包装单位 <span class="b-required">*</span></label>
                <USelect v-model="form.packUnit" :items="PACKS.map(p => ({ value: p, label: p }))" class="w-full" />
              </div>
            </div>
            <div>
              <label class="b-label-lg">企业规格码</label>
              <div v-if="displayCode" class="w-fit rounded border border-[var(--b-border)] bg-[var(--b-fill)] px-2.5 py-1.5 font-code text-[13px] font-medium text-[var(--b-text-title)]">{{ displayCode }}</div>
              <p v-else class="b-help">保存后由系统自动分配（001 起，对应 32 位追溯码第 9-11 位），无需填写</p>
              <p v-if="displayCode" class="b-help">系统自动分配（对应 32 位追溯码第 9-11 位），不可修改</p>
            </div>
            <div class="flex items-center gap-2">
              <USwitch v-model="form.status" />
              <span class="text-sm text-[var(--b-text-regular)]">启用（停用后不可被新产品选择）</span>
            </div>
          </div>
          <div class="b-modal-foot">
            <UButton variant="outline" color="neutral" @click="showModal = false">取消</UButton>
            <UButton v-if="canWrite" color="neutral" variant="solid" :loading="saving" @click="save">保存</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- 删除确认对话框（确认后物理删除规格，不可恢复；被引用规格按钮已置灰不会走到这里） -->
    <UModal v-model:open="delOpen">
      <template #content>
        <div class="b-modal">
          <div class="b-modal-head">
            <div class="b-modal-icon">
              <UIcon name="i-lucide-trash-2" class="h-4 w-4 text-red-600" />
            </div>
            <div>
              <h3 class="b-modal-title">删除规格</h3>
              <p class="b-modal-sub max-w-xl truncate" :title="delTarget?.spec_name">{{ delTarget?.spec_name }}</p>
            </div>
          </div>
          <div class="b-modal-body">
            <div class="b-note">
              <UIcon name="i-lucide-shield-alert" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
              <p class="b-note-text">
                确认删除规格「{{ delTarget?.spec_name }}」（规格码 {{ delTarget?.spec_code }}）？删除后数据不可恢复，请谨慎操作。
              </p>
            </div>
          </div>
          <div class="b-modal-foot">
            <UButton variant="outline" color="neutral" @click="delOpen = false">取消</UButton>
            <UButton v-if="canWrite" color="error" variant="solid" :loading="deleting" @click="confirmDelete">确认删除</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- 批量导入弹窗：模板下载 → 选企业（平台）→ 选文件 → 导入结果（成功/失败明细） -->
    <UModal v-model:open="showImportModal" :ui="{ content: 'sm:max-w-2xl' }">
      <template #content>
        <div class="b-modal">
          <div class="b-modal-head">
            <div class="b-modal-icon">
              <UIcon name="i-lucide-file-up" class="h-4 w-4 text-[var(--b-text-regular)]" />
            </div>
            <div>
              <h3 class="b-modal-title">批量导入规格</h3>
              <p class="b-modal-sub">按模板格式填写后上传 Excel（.xlsx / .xls），一次最多 5000 条</p>
            </div>
          </div>
          <div class="b-modal-body">
            <div class="b-note">
              <UIcon name="i-lucide-circle-help" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--b-text-muted)]" />
              <p class="b-note-text">
                模板仅一列「规格」，每行格式：净含量数值 + 中文含量单位（毫升/升/克/千克）+ / + 包装单位（瓶/袋/桶/盒/罐/支/箱），如「200毫升/瓶」。无法识别的行不计入导入，会在结果中列出失败原因。
              </p>
            </div>
            <!-- ① 模板下载 -->
            <div class="flex items-center justify-between rounded border border-[var(--b-border)] bg-[var(--b-fill)] px-3 py-2">
              <span class="text-sm text-[var(--b-text-regular)]">规格导入模板.xlsx（表头「规格」+ 示例数据）</span>
              <UButton variant="outline" color="neutral" size="sm" icon="i-lucide-download" @click="downloadTemplate">下载模板</UButton>
            </div>
            <!-- ② 归属企业（仅平台管理员；企业账号导入本企业） -->
            <div v-if="isPlatformAdmin">
              <label class="b-label-lg">归属企业 <span class="b-required">*</span></label>
              <USelect
                v-model="importEid"
                :items="(factoryOptions?.rows || []).map((f: any) => ({ value: Number(f.id), label: f.name }))"
                placeholder="选择导入规格归属的企业"
                class="w-full"
                :ui="{ itemLabel: { class: 'whitespace-normal break-words' } }"
              />
            </div>
            <!-- ③ 文件选择 -->
            <div>
              <label class="b-label-lg">Excel 文件 <span class="b-required">*</span></label>
              <div class="flex items-center gap-3">
                <input ref="importFileInput" type="file" accept=".xlsx,.xls" class="hidden" @change="onImportFile" />
                <UButton v-if="canWrite" variant="outline" color="neutral" icon="i-lucide-folder-open" @click="importFileInput?.click()">选择文件</UButton>
                <span class="text-sm" :class="importFileName ? 'text-[var(--b-text-regular)]' : 'text-[var(--b-text-muted)]'">
                  {{ importFileName || '未选择文件（仅支持 .xlsx / .xls）' }}
                </span>
              </div>
            </div>
            <!-- ④ 导入结果 -->
            <div v-if="impResult">
              <label class="b-label-lg">导入结果</label>
              <div class="rounded border border-[var(--b-border)] p-3">
                <div class="mb-2 flex items-center gap-4 text-sm">
                  <span class="font-medium text-[var(--b-text-title)]">共处理 {{ impResult.success + impResult.failed }} 条</span>
                  <span class="text-green-600">成功 {{ impResult.success }} 条</span>
                  <span :class="impResult.failed ? 'text-red-600' : 'text-[var(--b-text-muted)]'">失败 {{ impResult.failed }} 条</span>
                </div>
                <div v-if="impResult.errors?.length" class="max-h-56 overflow-y-auto">
                  <table class="b-table">
                    <thead>
                      <tr><th class="w-16">Excel 行</th><th>规格内容</th><th>失败原因</th></tr>
                    </thead>
                    <tbody>
                      <tr v-for="(er, idx) in impResult.errors" :key="idx">
                        <td class="font-code">{{ er.row }}</td>
                        <td class="max-w-52 truncate" :title="er.value">{{ er.value || '（空）' }}</td>
                        <td class="text-red-600">{{ er.reason }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
          <div class="b-modal-foot">
            <UButton variant="outline" color="neutral" @click="showImportModal = false">关闭</UButton>
            <UButton v-if="canWrite" color="neutral" variant="solid" :loading="importing" :disabled="!importFile" @click="doImport">开始导入</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
