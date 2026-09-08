<script setup lang="ts">
// 系统设置（PRD 5.12：企业信息维护 / 用户权限 / 操作日志）
// Keep-Alive 页面缓存：左侧菜单切换后返回保留页面状态（表单/筛选/页码/预览）；刷新、退出登录自动清空；页内【重置】恢复初始
definePageMeta({ layout: 'admin', middleware: 'backend-guard', keepalive: true })
useHead({ title: '系统设置' })

const toast = useToast()
const tab = ref('enterprise')
const { user, isPlatformAdmin } = useUser()

// ============ 企业信息（PRD 5.12.1） ============
const entForm = reactive({
  name: '', creditCode: '', unitCode: '', contact: '', phone: '', legalPerson: '',
  website: '', address: '', description: '', licenseNo: '', qualificationExpire: '',
})
const entSaving = ref(false)

const { data: entData, refresh: refreshEnt } = await useFetch<any>('/api/admin/settings/enterprise', {
  key: 'settings-enterprise',
})

// —— 总部视角：入驻企业列表（enterprise 表全部租户；factories API 即企业列表源）——
const { data: entAdminData, refresh: refreshEntAdmin } = await useFetch<any>('/api/admin/factories', {
  key: 'settings-ent-admin-list',
  query: { page: 1, pageSize: 100 },
  immediate: isPlatformAdmin,
})
const showEntModal = ref(false)
const entEditId = ref<number | null>(null)
const entEditName = ref('')
const entStatus = ref(1) // 编辑弹窗内的企业启用/禁用状态（仅总部可改）
watch(entData, (d) => {
  if (d) {
    Object.assign(entForm, {
      name: d.name || '', creditCode: d.credit_code || '', unitCode: d.unit_code || '',
      contact: d.contact || '', phone: d.phone || '', legalPerson: d.legal_person || '',
      website: d.website || '', address: d.address || '', description: d.description || '',
      licenseNo: d.license_no || '', qualificationExpire: d.qualification_expire ? String(d.qualification_expire).slice(0, 10) : '',
    })
  }
}, { immediate: true })

const saveEnterprise = async () => {
  if (!entForm.name.trim()) { toast.add({ title: '请输入企业名称', color: 'warning' }); return }
  entSaving.value = true
  try {
    await $fetch('/api/admin/settings/enterprise/' + entData.value?.id, {
      method: 'PATCH',
      body: { ...entForm },
    })
    toast.add({ title: '企业信息已保存', color: 'success' })
    refreshEnt()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '保存失败', color: 'error' })
  } finally {
    entSaving.value = false
  }
}

// —— 总部：打开某企业编辑弹窗（行字段为 snake_case，映射进表单 camelCase）——
const openEntEdit = (row: any) => {
  entEditId.value = Number(row.id)
  entEditName.value = row.name || ''
  Object.assign(entForm, {
    name: row.name || '', creditCode: row.credit_code || '', unitCode: row.unit_code || '',
    contact: row.contact || '', phone: row.phone || '', legalPerson: row.legal_person || '',
    website: row.website || '', address: row.address || '', description: row.description || '',
    licenseNo: row.license_no || '',
    qualificationExpire: row.qualification_expire ? String(row.qualification_expire).slice(0, 10) : '',
  })
  entStatus.value = Number(row.status) === 1 ? 1 : 0
  showEntModal.value = true
}

// —— 总部：保存企业编辑（PATCH 已支持总部改任意企业，含 status）——
const saveEntEdit = async () => {
  if (!entForm.name.trim()) { toast.add({ title: '请输入企业名称', color: 'warning' }); return }
  entSaving.value = true
  try {
    await $fetch('/api/admin/settings/enterprise/' + entEditId.value, {
      method: 'PATCH',
      body: { ...entForm, status: Number(entStatus.value) === 1 ? 1 : 0 },
    })
    toast.add({ title: '企业信息已保存', color: 'success' })
    showEntModal.value = false
    refreshEntAdmin()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '保存失败', color: 'error' })
  } finally {
    entSaving.value = false
  }
}

// ============ 用户管理（PRD 5.12.3） ============
// 用户筛选：下拉类默认 undefined（Nuxt UI v4 空值自动显示 placeholder，禁止空字符串 value 选项）
const ufilters = reactive({ keyword: '', role: undefined as string | undefined, status: undefined as string | undefined })
const upage = ref(1)
const pageSize = 20

const { data: userData, pending: userPending, refresh: refreshUsers } = await useFetch<any>('/api/admin/users', {
  key: 'settings-users',
  query: computed(() => ({
    keyword: ufilters.keyword || undefined,
    role: ufilters.role || undefined,
    status: ufilters.status || undefined,
    page: upage.value, pageSize,
  })),
})
const userTotalPages = computed(() => Math.max(1, Math.ceil((userData.value?.total || 0) / pageSize)))

const { data: entList } = await useFetch<any>('/api/admin/factories', {
  key: 'settings-factories',
  query: { page: 1, pageSize: 100 },
}).catch(() => ({ data: ref(null) }))

// 新增用户对话框
const showUserModal = ref(false)
const userSaving = ref(false)
const uform = reactive({ username: '', password: '', name: '', phone: '', role: 'code_admin', enterpriseId: null as number | null })

const openCreateUser = () => {
  Object.assign(uform, { username: '', password: '', name: '', phone: '', role: 'code_admin', enterpriseId: null })
  showUserModal.value = true
}
const saveUser = async () => {
  if (!uform.username.trim()) { toast.add({ title: '请输入登录名', color: 'warning' }); return }
  if ((uform.password || '').length < 6) { toast.add({ title: '密码至少 6 位', color: 'warning' }); return }
  userSaving.value = true
  try {
    await $fetch('/api/admin/users', { method: 'POST', body: { ...uform } })
    toast.add({ title: '用户已创建', color: 'success' })
    showUserModal.value = false
    refreshUsers()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '创建失败', color: 'error' })
  } finally {
    userSaving.value = false
  }
}

const toggleUserStatus = async (row: any) => {
  try {
    await $fetch('/api/admin/users/' + row.id, { method: 'PATCH', body: { name: row.name || '', phone: row.phone || '', status: Number(row.status) === 1 ? 0 : 1 } })
    toast.add({ title: Number(row.status) === 1 ? '账号已禁用' : '账号已启用', color: 'success' })
    refreshUsers()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '操作失败', color: 'error' })
  }
}

const resetPw = async (row: any) => {
  const pw = window.prompt('请输入 ' + row.username + ' 的新密码（至少 6 位）：')
  if (!pw) return
  try {
    await $fetch('/api/admin/users/' + row.id + '/reset-password', { method: 'POST', body: { password: pw } })
    toast.add({ title: '密码已重置', color: 'success' })
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '重置失败', color: 'error' })
  }
}

// ============ 操作日志（PRD 5.12.4） ============
// 日志筛选：下拉类默认 undefined（同上）
const lfilters = reactive({
  keyword: '',
  module: undefined as string | undefined,
  action: '',
  result: undefined as string | undefined,
  dateFrom: '',
  dateTo: '',
})
const lpage = ref(1)

const { data: logData, pending: logPending, refresh: refreshLogs } = await useFetch<any>('/api/admin/logs', {
  key: 'settings-logs',
  query: computed(() => ({
    keyword: lfilters.keyword || undefined,
    module: lfilters.module || undefined,
    action: lfilters.action || undefined,
    result: lfilters.result || undefined,
    dateFrom: lfilters.dateFrom || undefined,
    dateTo: lfilters.dateTo || undefined,
    page: lpage.value, pageSize,
  })),
})
const logTotalPages = computed(() => Math.max(1, Math.ceil((logData.value?.total || 0) / pageSize)))

// 页内【重置】：重置当前激活面板——企业信息回填「已保存值」（放弃未保存草稿），
// 用户/日志清空筛选并刷新；数据备份面板无表单内容（Keep-Alive 缓存页互不影响）
const resetPanel = async () => {
  if (tab.value === 'enterprise') {
    if (isPlatformAdmin.value) {
      // 总部视角为企业列表：重置=刷新列表（无表单草稿）
      refreshEntAdmin()
      toast.add({ title: '已刷新企业列表', color: 'primary' })
    } else {
      await refreshEnt() // watch(entData) 回填已保存值，丢弃草稿
      toast.add({ title: '企业信息已恢复为已保存值', color: 'primary' })
    }
  } else if (tab.value === 'users') {
    Object.assign(ufilters, { keyword: '', role: undefined, status: undefined })
    upage.value = 1
    refreshUsers()
    toast.add({ title: '已重置，用户列表恢复初始筛选', color: 'primary' })
  } else if (tab.value === 'logs') {
    Object.assign(lfilters, { keyword: '', module: undefined, action: '', result: undefined, dateFrom: '', dateTo: '' })
    lpage.value = 1
    refreshLogs()
    toast.add({ title: '已重置，操作日志恢复初始筛选', color: 'primary' })
  } else {
    toast.add({ title: '当前面板无表单内容可重置', color: 'primary' })
  }
}

// ============ 数据备份（PRD 5.12.6） ============
const backingUp = ref(false)
const backupRows = ref<any[]>([])

const refreshBackups = async () => {
  try {
    const d = await $fetch('/api/admin/backup')
    backupRows.value = d.rows || []
  } catch { /* 非平台管理员或未创建 */ }
}
refreshBackups()

const doBackup = async () => {
  backingUp.value = true
  try {
    const res = await $fetch('/api/admin/backup', { method: 'POST' })
    toast.add({ title: '备份完成：' + res.file + '（' + (res.size / 1024).toFixed(1) + ' KB）', color: 'success' })
    refreshBackups()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '备份失败', color: 'error' })
  } finally {
    backingUp.value = false
  }
}

const deleteBackup = async (b: any) => {
  if (!window.confirm('确定删除备份 ' + b.file + ' ？')) return
  try {
    await $fetch('/api/admin/backup?file=' + encodeURIComponent(b.file), { method: 'DELETE' })
    toast.add({ title: '备份已删除', color: 'success' })
    refreshBackups()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '删除失败', color: 'error' })
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- 页面标题区 -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="b-page-title">系统设置</h1>
        <p class="b-page-desc">企业信息 · 用户权限 · 操作日志 · 数据备份（日志保留至少 3 年，不可删除）</p>
      </div>
      <UButton variant="outline" color="neutral" icon="i-lucide-rotate-ccw" title="重置当前面板的表单/筛选为初始状态" @click="resetPanel">重置</UButton>
    </div>

    <!-- Tab 切换：Nuxt UI v4 的 UTabs 必须显式给 value，否则回退为索引（'0'/'1'…），下方面板的 v-if 会全部落空导致内容空白 -->
    <UTabs v-model="tab" :items="[
      { label: '企业信息', icon: 'i-lucide-building-2', value: 'enterprise' },
      { label: '用户权限', icon: 'i-lucide-users', value: 'users' },
      { label: '操作日志', icon: 'i-lucide-scroll-text', value: 'logs' },
      { label: '数据备份', icon: 'i-lucide-database-backup', value: 'backup' },
    ]" />

    <!-- 企业信息（总部=入驻企业列表维护；厂家/码管理员=编辑本企业资料） -->
    <div v-if="tab === 'enterprise'" class="space-y-4">
      <!-- 总部视角：使用本系统的企业（租户）列表 -->
      <template v-if="isPlatformAdmin">
        <div class="b-card b-card-clip">
          <div class="b-card-head">
            <span class="b-card-title">入驻企业列表</span>
            <span class="b-card-extra">使用本系统的企业（租户）共 {{ entAdminData?.total || 0 }} 家 · 扫码页展示的企业资料以此为准</span>
          </div>
          <div class="b-scroll-x">
            <table class="b-table">
              <thead>
                <tr>
                  <th>企业名称</th>
                  <th>统一社会信用代码</th>
                  <th>联系人</th>
                  <th>联系电话</th>
                  <th>状态</th>
                  <th>账号数</th>
                  <th>入驻时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="e in entAdminData?.rows || []" :key="e.id">
                  <td class="b-strong font-medium">{{ e.name }}</td>
                  <td class="font-code text-xs">{{ e.credit_code || '-' }}</td>
                  <td>{{ e.contact || '-' }}</td>
                  <td>{{ e.phone || '-' }}</td>
                  <td>
                    <span class="b-tag" :class="Number(e.status) === 1 ? 'b-tag-success' : 'b-tag-danger'">
                      {{ Number(e.status) === 1 ? '启用' : '禁用' }}
                    </span>
                  </td>
                  <td>{{ e.user_count || 0 }}</td>
                  <td class="whitespace-nowrap text-xs text-[var(--b-text-muted)]">{{ e.created_at ? String(e.created_at).slice(0, 10) : '-' }}</td>
                  <td>
                    <UButton variant="link" color="neutral" size="xs" icon="i-lucide-pencil" @click="openEntEdit(e)">编辑</UButton>
                  </td>
                </tr>
                <tr v-if="!entAdminData?.rows?.length">
                  <td colspan="8" class="b-empty">
                    <div class="b-empty-inner">
                      <UIcon name="i-lucide-building-2" class="b-empty-icon h-8 w-8" />
                      <span class="text-sm">暂无入驻企业</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 编辑企业弹窗（Nuxt UI v4：v-model:open + #content 插槽） -->
        <UModal v-model:open="showEntModal">
          <template #content>
            <div class="b-modal">
              <div class="b-modal-head">
                <div class="b-modal-icon">
                  <UIcon name="i-lucide-building-2" class="h-4 w-4 text-[var(--b-text-regular)]" />
                </div>
                <div>
                  <h3 class="b-modal-title">编辑企业信息（{{ entEditName }}）</h3>
                  <p class="b-modal-sub">1049 号公告主体信息，扫码页展示的企业资料以此为准</p>
                </div>
              </div>
              <div class="b-modal-body">
                <div class="b-form-grid md:grid-cols-2">
                  <div>
                    <label class="b-label">企业名称 <span class="b-required">*</span></label>
                    <UInput v-model="entForm.name" placeholder="企业全称" />
                  </div>
                  <div>
                    <label class="b-label">统一社会信用代码</label>
                    <UInput v-model="entForm.creditCode" placeholder="18 位信用代码" />
                  </div>
                  <div>
                    <label class="b-label">单元识别码</label>
                    <UInput v-model="entForm.unitCode" placeholder="1049号公告口径（登记类别+登记证后6位+生产类型）" />
                  </div>
                  <div>
                    <label class="b-label">联系人</label>
                    <UInput v-model="entForm.contact" placeholder="联系人姓名" />
                  </div>
                  <div>
                    <label class="b-label">联系电话</label>
                    <UInput v-model="entForm.phone" placeholder="联系电话" />
                  </div>
                  <div>
                    <label class="b-label">法定代表人</label>
                    <UInput v-model="entForm.legalPerson" placeholder="法人姓名" />
                  </div>
                  <div>
                    <label class="b-label">企业官网</label>
                    <UInput v-model="entForm.website" placeholder="https://..." />
                  </div>
                  <div>
                    <label class="b-label">农药生产许可证号</label>
                    <UInput v-model="entForm.licenseNo" placeholder="生产许可证号" />
                  </div>
                  <div>
                    <label class="b-label">资质到期日</label>
                    <UInput v-model="entForm.qualificationExpire" type="date" />
                    <p class="b-help">到期前 30/60/90 天提醒</p>
                  </div>
                  <div>
                    <label class="b-label">状态</label>
                    <USelect v-model="entStatus" :items="[{ value: 1, label: '启用' }, { value: 0, label: '禁用' }]" class="w-full" />
                  </div>
                  <div class="md:col-span-2">
                    <label class="b-label">注册地址</label>
                    <UInput v-model="entForm.address" placeholder="企业注册地址" />
                  </div>
                  <div class="md:col-span-2">
                    <label class="b-label">企业简介</label>
                    <UTextarea v-model="entForm.description" :rows="3" placeholder="企业简介" />
                  </div>
                </div>
              </div>
              <div class="b-modal-foot">
                <span class="b-card-extra">带 <span class="b-required">*</span> 的为必填项，保存后立即生效</span>
                <div class="flex items-center gap-2">
                  <UButton variant="outline" color="neutral" @click="showEntModal = false">取消</UButton>
                  <UButton color="neutral" variant="solid" icon="i-lucide-save" :loading="entSaving" @click="saveEntEdit">保存企业信息</UButton>
                </div>
              </div>
            </div>
          </template>
        </UModal>
      </template>

      <!-- 厂家/码管理员视角：编辑本企业资料 -->
      <div v-else class="b-card">
        <div class="b-card-head">
          <span class="b-card-title">企业基本信息</span>
          <span class="b-card-extra">1049 号公告主体信息，扫码页展示的企业资料以此为准</span>
        </div>
        <div class="b-form-grid md:grid-cols-2">
          <div>
            <label class="b-label">企业名称 <span class="b-required">*</span></label>
            <UInput v-model="entForm.name" placeholder="企业全称" />
          </div>
          <div>
            <label class="b-label">统一社会信用代码</label>
            <UInput v-model="entForm.creditCode" placeholder="18 位信用代码" />
          </div>
          <div>
            <label class="b-label">单元识别码</label>
            <UInput v-model="entForm.unitCode" placeholder="1049号公告口径（登记类别+登记证后6位+生产类型）" />
          </div>
          <div>
            <label class="b-label">联系人</label>
            <UInput v-model="entForm.contact" placeholder="联系人姓名" />
          </div>
          <div>
            <label class="b-label">联系电话</label>
            <UInput v-model="entForm.phone" placeholder="联系电话" />
          </div>
          <div>
            <label class="b-label">法定代表人</label>
            <UInput v-model="entForm.legalPerson" placeholder="法人姓名" />
          </div>
          <div>
            <label class="b-label">企业官网</label>
            <UInput v-model="entForm.website" placeholder="https://..." />
          </div>
          <div>
            <label class="b-label">农药生产许可证号</label>
            <UInput v-model="entForm.licenseNo" placeholder="生产许可证号" />
          </div>
          <div>
            <label class="b-label">资质到期日</label>
            <UInput v-model="entForm.qualificationExpire" type="date" />
            <p class="b-help">到期前 30/60/90 天提醒</p>
          </div>
          <div class="md:col-span-2">
            <label class="b-label">注册地址</label>
            <UInput v-model="entForm.address" placeholder="企业注册地址" />
          </div>
          <div class="md:col-span-2">
            <label class="b-label">企业简介</label>
            <UTextarea v-model="entForm.description" :rows="3" placeholder="企业简介" />
          </div>
        </div>
        <div class="b-card-foot">
          <span class="b-card-extra">带 <span class="b-required">*</span> 的为必填项，保存后立即生效</span>
          <UButton color="neutral" variant="solid" icon="i-lucide-save" :loading="entSaving" @click="saveEnterprise">保存企业信息</UButton>
        </div>
      </div>
    </div>

    <!-- 用户权限 -->
    <div v-if="tab === 'users'" class="space-y-4">
      <!-- 筛选查询区 -->
      <div class="b-card">
        <div class="b-card-head">
          <span class="b-card-title">筛选查询</span>
        </div>
        <div class="b-form-grid md:grid-cols-2 xl:grid-cols-3">
          <div>
            <label class="b-label">登录名 / 姓名 / 手机号</label>
            <UInput v-model="ufilters.keyword" placeholder="输入登录名、姓名或手机号" icon="i-lucide-search" @keyup.enter="upage = 1; refreshUsers()" />
          </div>
          <div>
            <label class="b-label">角色</label>
            <USelect v-model="ufilters.role" :items="[{ value: 'enterprise_admin', label: '厂家主账号' }, { value: 'code_admin', label: '码管理员' }, { value: 'viewer', label: '只读账号' }]" placeholder="全部角色" class="w-full" />
          </div>
          <div>
            <label class="b-label">状态</label>
            <USelect v-model="ufilters.status" :items="[{ value: '1', label: '启用' }, { value: '0', label: '禁用' }]" placeholder="全部状态" class="w-full" />
          </div>
        </div>
        <div class="b-card-foot">
          <span class="b-card-extra">共 <span class="font-medium b-strong">{{ userData?.total || 0 }}</span> 个账号</span>
          <div class="flex items-center gap-2">
            <UButton color="neutral" variant="solid" :loading="userPending" @click="upage = 1; refreshUsers()">查询</UButton>
            <UButton color="neutral" variant="outline" icon="i-lucide-user-plus" @click="openCreateUser">新增用户</UButton>
          </div>
        </div>
      </div>

      <!-- 用户列表 -->
      <div class="b-card b-card-clip">
        <div class="b-card-head">
          <span class="b-card-title">用户列表</span>
          <span class="b-card-extra">每页 {{ pageSize }} 条 · 共 {{ userData?.total || 0 }} 条</span>
        </div>
        <div class="b-scroll-x">
          <table class="b-table">
            <thead>
              <tr>
                <th>登录名</th>
                <th>姓名</th>
                <th>手机号</th>
                <th>角色</th>
                <th>所属企业</th>
                <th>最后登录</th>
                <th>状态</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in userData?.rows || []" :key="r.id">
                <td class="b-strong font-medium">{{ r.username }}</td>
                <td>{{ r.name || '-' }}</td>
                <td>{{ r.phone || '-' }}</td>
                <td>
                  <span class="b-tag" :class="r.role === 'platform_admin' ? 'b-tag-danger' : r.role === 'enterprise_admin' ? 'b-tag-success' : 'b-tag-info'">
                    {{ r.roleLabel }}
                  </span>
                </td>
                <td>{{ r.enterprise_name || '-' }}</td>
                <td>{{ r.last_login_at ? String(r.last_login_at).slice(0, 19) : '-' }}</td>
                <td>
                  <span class="b-tag" :class="Number(r.status) === 1 ? 'b-tag-success' : 'b-tag-danger'">
                    {{ Number(r.status) === 1 ? '启用' : '禁用' }}
                  </span>
                </td>
                <td>
                  <div v-if="r.role !== 'platform_admin'" class="b-actions">
                    <UButton variant="link" color="neutral" size="xs" @click="resetPw(r)">重置密码</UButton>
                    <span class="b-sep" />
                    <UButton variant="link" color="neutral" size="xs" @click="toggleUserStatus(r)">
                      {{ Number(r.status) === 1 ? '禁用' : '启用' }}
                    </UButton>
                  </div>
                  <div v-else class="b-actions">
                    <span class="text-xs text-[var(--b-text-muted)]">总部账号</span>
                  </div>
                </td>
              </tr>
              <tr v-if="!userPending && !userData?.rows?.length">
                <td colspan="8" class="b-empty">
                  <div class="b-empty-inner">
                    <UIcon name="i-lucide-inbox" class="b-empty-icon h-8 w-8" />
                    <span class="text-sm">暂无用户，点击「新增用户」创建账号</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="userData?.total" class="b-pager">
          <span class="b-card-extra">共 {{ userData?.total || 0 }} 条 · 第 {{ userData.page }} / {{ userTotalPages }} 页</span>
          <div class="flex items-center gap-2">
            <UButton variant="outline" color="neutral" size="sm" :disabled="upage <= 1" @click="upage--; refreshUsers()">上一页</UButton>
            <UButton variant="outline" color="neutral" size="sm" :disabled="upage >= userTotalPages" @click="upage++; refreshUsers()">下一页</UButton>
          </div>
        </div>
      </div>

      <!-- 新增用户对话框（Nuxt UI v4：v-model:open 绑定 open 状态，内容必须放 #content 插槽） -->
      <UModal v-model:open="showUserModal">
        <template #content>
        <div class="b-modal">
          <div class="b-modal-head">
            <div class="b-modal-icon">
              <UIcon name="i-lucide-user-plus" class="h-4 w-4 text-[var(--b-text-regular)]" />
            </div>
            <div>
              <h3 class="b-modal-title">新增用户</h3>
              <p class="b-modal-sub">账号创建后可重置密码或禁用，登录名不可重复</p>
            </div>
          </div>
          <div class="b-modal-body">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="b-label-lg">登录名 <span class="b-required">*</span></label>
                <UInput v-model="uform.username" placeholder="3-30 位字母/数字/下划线" />
              </div>
              <div>
                <label class="b-label-lg">初始密码 <span class="b-required">*</span></label>
                <UInput v-model="uform.password" type="password" placeholder="至少 6 位" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="b-label-lg">姓名</label>
                <UInput v-model="uform.name" placeholder="姓名" />
              </div>
              <div>
                <label class="b-label-lg">手机号</label>
                <UInput v-model="uform.phone" placeholder="手机号" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="b-label-lg">角色 <span class="b-required">*</span></label>
                <USelect v-model="uform.role" class="w-full" :items="[
                  { value: 'enterprise_admin', label: '厂家主账号' },
                  { value: 'code_admin', label: '码管理员' },
                  { value: 'viewer', label: '只读账号' },
                ]" />
              </div>
              <div v-if="isPlatformAdmin">
                <label class="b-label-lg">所属企业 <span class="b-required">*</span></label>
                <USelect v-model="uform.enterpriseId" :items="(entList?.rows || []).map((e: any) => ({ value: Number(e.id), label: e.name }))" placeholder="选择企业" class="w-full" />
              </div>
            </div>
          </div>
          <div class="b-modal-foot">
            <UButton variant="outline" color="neutral" @click="showUserModal = false">取消</UButton>
            <UButton color="neutral" variant="solid" :loading="userSaving" @click="saveUser">创建</UButton>
          </div>
        </div>
        </template>
      </UModal>
    </div>

    <!-- 操作日志 -->
    <div v-if="tab === 'logs'" class="space-y-4">
      <!-- 筛选查询区 -->
      <div class="b-card">
        <div class="b-card-head">
          <span class="b-card-title">筛选查询</span>
        </div>
        <div class="b-form-grid md:grid-cols-2 xl:grid-cols-3">
          <div>
            <label class="b-label">操作人 / 模块 / 内容</label>
            <UInput v-model="lfilters.keyword" placeholder="输入操作人、模块或内容关键词" icon="i-lucide-search" @keyup.enter="lpage = 1; refreshLogs()" />
          </div>
          <div>
            <label class="b-label">模块</label>
            <USelect v-model="lfilters.module" :items="[{ value: '登录', label: '登录' }, { value: '系统设置', label: '系统设置' }, { value: '用户管理', label: '用户管理' }]" placeholder="全部模块" class="w-full" />
          </div>
          <div>
            <label class="b-label">操作类型</label>
            <UInput v-model="lfilters.action" placeholder="如：新增、修改、删除" />
          </div>
          <div>
            <label class="b-label">操作结果</label>
            <USelect v-model="lfilters.result" :items="[{ value: '1', label: '成功' }, { value: '0', label: '失败' }]" placeholder="全部结果" class="w-full" />
          </div>
          <div>
            <label class="b-label">操作日期起</label>
            <UInput v-model="lfilters.dateFrom" type="date" placeholder="起" />
          </div>
          <div>
            <label class="b-label">操作日期止</label>
            <UInput v-model="lfilters.dateTo" type="date" placeholder="止" />
          </div>
        </div>
        <div class="b-card-foot">
          <span class="b-card-extra">共 <span class="font-medium b-strong">{{ logData?.total || 0 }}</span> 条日志</span>
          <div class="flex items-center gap-2">
            <UButton color="neutral" variant="solid" :loading="logPending" @click="lpage = 1; refreshLogs()">查询</UButton>
          </div>
        </div>
      </div>

      <!-- 日志列表 -->
      <div class="b-card b-card-clip">
        <div class="b-card-head">
          <span class="b-card-title">日志列表</span>
          <span class="b-card-extra">共 {{ logData?.total || 0 }} 条 · 保留至少 3 年不可删除</span>
        </div>
        <div class="b-scroll-x">
          <table class="b-table">
            <thead>
              <tr>
                <th>操作时间</th>
                <th>操作人</th>
                <th>模块</th>
                <th>操作</th>
                <th>内容</th>
                <th>IP</th>
                <th>结果</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in logData?.rows || []" :key="r.id">
                <td class="whitespace-nowrap">{{ String(r.created_at).slice(0, 19) }}</td>
                <td>{{ r.username || '-' }}</td>
                <td>{{ r.module || '-' }}</td>
                <td class="b-strong font-medium">{{ r.action || '-' }}</td>
                <td class="max-w-72 truncate text-xs text-[var(--b-text-muted)]" :title="r.content || ''">{{ r.content || '-' }}</td>
                <td class="font-code text-xs text-[var(--b-text-muted)]">{{ r.ip || '-' }}</td>
                <td>
                  <span class="b-tag" :class="Number(r.result) === 1 ? 'b-tag-success' : 'b-tag-danger'">
                    {{ Number(r.result) === 1 ? '成功' : '失败' }}
                  </span>
                </td>
              </tr>
              <tr v-if="!logPending && !logData?.rows?.length">
                <td colspan="7" class="b-empty">
                  <div class="b-empty-inner">
                    <UIcon name="i-lucide-inbox" class="b-empty-icon h-8 w-8" />
                    <span class="text-sm">暂无符合条件的操作日志，请调整筛选条件后重试</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="logData?.total" class="b-pager">
          <span class="b-card-extra">共 {{ logData?.total || 0 }} 条 · 第 {{ logData.page }} / {{ logTotalPages }} 页</span>
          <div class="flex items-center gap-2">
            <UButton variant="outline" color="neutral" size="sm" :disabled="lpage <= 1" @click="lpage--; refreshLogs()">上一页</UButton>
            <UButton variant="outline" color="neutral" size="sm" :disabled="lpage >= logTotalPages" @click="lpage++; refreshLogs()">下一页</UButton>
          </div>
        </div>
      </div>
    </div>
  
    <!-- 数据备份（PRD 5.12.6） -->
    <div v-if="tab === 'backup'" class="space-y-4">
      <div v-if="!isPlatformAdmin" class="b-card b-card-body">
        <div class="b-note">
          <UIcon name="i-lucide-shield-alert" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--b-text-muted)]" />
          <p class="b-note-text">数据备份仅总部管理员可用</p>
        </div>
      </div>
      <div v-else class="b-card">
        <div class="b-card-head">
          <span class="b-card-title">手动备份</span>
        </div>
        <div class="b-card-body">
          <div class="b-note">
            <UIcon name="i-lucide-info" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--b-text-muted)]" />
            <p class="b-note-text">mysqldump 全库导出（--single-transaction 不锁表），备份文件仅保存在本机 backup 目录</p>
          </div>
        </div>
        <div class="b-card-foot">
          <span class="b-card-extra">建议定期下载备份文件至异地存储</span>
          <UButton color="neutral" variant="solid" icon="i-lucide-database-backup" :loading="backingUp" @click="doBackup">立即备份</UButton>
        </div>
      </div>

      <!-- 备份历史 -->
      <div class="b-card b-card-clip">
        <div class="b-card-head">
          <span class="b-card-title">备份历史</span>
          <span class="b-card-extra">共 {{ backupRows.length }} 个备份</span>
        </div>
        <div class="b-scroll-x">
          <table class="b-table">
            <thead>
              <tr>
                <th>文件名</th>
                <th>大小</th>
                <th>备份时间</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="b in backupRows" :key="b.file">
                <td class="font-code text-xs b-strong">{{ b.file }}</td>
                <td>{{ (b.size / 1024).toFixed(1) }} KB</td>
                <td>{{ b.time }}</td>
                <td>
                  <div class="b-actions">
                    <a :href="'/api/admin/backup/download?file=' + encodeURIComponent(b.file)" class="px-1.5 text-xs text-[var(--b-text-regular)] hover:text-[var(--b-text-title)]">下载</a>
                    <span class="b-sep" />
                    <UButton variant="link" color="error" size="xs" @click="deleteBackup(b)">删除</UButton>
                  </div>
                </td>
              </tr>
              <tr v-if="!backupRows.length">
                <td colspan="4" class="b-empty">
                  <div class="b-empty-inner">
                    <UIcon name="i-lucide-inbox" class="b-empty-icon h-8 w-8" />
                    <span class="text-sm">暂无备份，点击「立即备份」创建</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
