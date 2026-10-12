<script setup lang="ts">
// 系统设置（PRD 5.12：企业信息维护 / 用户权限 / 操作日志）
// Keep-Alive 页面缓存：左侧菜单切换后返回保留页面状态（表单/筛选/页码/预览）；刷新、退出登录自动清空；页内【重置】恢复初始
definePageMeta({ layout: 'admin', middleware: 'backend-guard', keepalive: true })
useHead({ title: '系统设置' })

const toast = useToast()
const tab = ref('enterprise')
const { user, isPlatformAdmin, canManageUsers } = useUser()
// 面板按角色收口（2026-09-19）：用户权限仅总部管理员与厂家主账号可见；数据备份仅总部管理员。
// 后端对这两类接口已分别要求 enterprise_admin 及以上 / platform_admin，此处避免"看得到面板、点了吃 403"
const settingsTabs = computed(() => {
  const items = [{ label: '企业信息', icon: 'i-lucide-building-2', value: 'enterprise' }]
  if (canManageUsers.value) items.push({ label: '用户权限', icon: 'i-lucide-users', value: 'users' })
  items.push({ label: '操作日志', icon: 'i-lucide-scroll-text', value: 'logs' })
  if (isPlatformAdmin.value) items.push({ label: '数据备份', icon: 'i-lucide-database-backup', value: 'backup' })
  items.push({ label: '建档指引', icon: 'i-lucide-list-checks', value: 'onboarding' })
  return items
})

// ============ 企业信息（PRD 5.12.1） ============
// 企业信息表单字段（2026-09-08 精简：删 企业官网/注册地址/企业简介；单元识别码保留可空）
const entForm = reactive({
  name: '', creditCode: '', unitCode: '', contact: '', phone: '', legalPerson: '',
  licenseNo: '', qualificationExpire: '',
})
const entSaving = ref(false)

const { data: entData, refresh: refreshEnt } = await useFetch<any>('/api/admin/settings/enterprise', {
  key: 'settings-enterprise',
})

// —— 总部视角：入驻企业列表（enterprise 表全部租户；factories API 即企业列表源）——
const entKeyword = ref('')
const entSearch = ref('')
const entPage = ref(1)
const entPageSize = 20
const { data: entAdminData, pending: entPending, error: entError, refresh: refreshEntAdmin } = await useFetch<any>('/api/admin/factories', {
  key: 'settings-ent-admin-list',
  query: computed(() => ({ page: entPage.value, pageSize: entPageSize, keyword: entSearch.value || undefined })),
  immediate: isPlatformAdmin,
})
const entTotalPages = computed(() => Math.max(1, Math.ceil((entAdminData.value?.total || 0) / entPageSize)))
const searchEnterprises = () => {
  entPage.value = 1
  entSearch.value = entKeyword.value.trim()
  refreshEntAdmin()
}
const showEntModal = ref(false)
const entEditId = ref<number | null>(null)
const entEditName = ref('')
const entStatus = ref(1) // 编辑弹窗内的企业启用/禁用状态（仅总部可改）
const entRenewExpire = ref('')
const createdEnterprise = ref<{ id: number; name: string; contact: string; phone: string } | null>(null)
watch(entData, (d) => {
  if (d && !isPlatformAdmin.value) {
    Object.assign(entForm, {
      name: d.name || '', creditCode: d.credit_code || '', unitCode: d.unit_code || '',
      contact: d.contact || '', phone: d.phone || '', legalPerson: d.legal_person || '',
      licenseNo: d.license_no || '', qualificationExpire: d.qualification_expire ? String(d.qualification_expire).slice(0, 10) : '',
    })
  }
}, { immediate: true })

// 企业信息必填项（前端与后端同口径校验）：名称/信用代码/联系人/电话/法人/许可证号/资质到期日；单元识别码保留可空
const ENT_REQUIRED = [
  ['name', '企业名称'], ['creditCode', '统一社会信用代码'], ['contact', '联系人'],
  ['phone', '联系电话'], ['legalPerson', '法定代表人'], ['licenseNo', '农药生产许可证号'],
  ['qualificationExpire', '资质到期日'],
] as const
const checkEntRequired = (): string | null => {
  for (const [key, label] of ENT_REQUIRED) {
    if (!String((entForm as Record<string, unknown>)[key] ?? '').trim()) return label
  }
  return null
}

const saveEnterprise = async () => {
  const missing = checkEntRequired()
  if (missing) { toast.add({ title: '请填写：' + missing, color: 'warning' }); return }
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
const openEntCreate = () => {
  if (!isPlatformAdmin.value) return
  entEditId.value = null
  entEditName.value = ''
  Object.assign(entForm, { name: '', creditCode: '', unitCode: '', contact: '', phone: '', legalPerson: '', licenseNo: '', qualificationExpire: '' })
  entStatus.value = 1
  entRenewExpire.value = ''
  showEntModal.value = true
}
const openEntEdit = (row: any) => {
  entEditId.value = Number(row.id)
  entEditName.value = row.name || ''
  Object.assign(entForm, {
    name: row.name || '', creditCode: row.credit_code || '', unitCode: row.unit_code || '',
    contact: row.contact || '', phone: row.phone || '', legalPerson: row.legal_person || '',
    licenseNo: row.license_no || '',
    qualificationExpire: row.qualification_expire ? String(row.qualification_expire).slice(0, 10) : '',
  })
  entStatus.value = Number(row.status) === 1 ? 1 : 0
  showEntModal.value = true
}

// —— 总部：新建走专用POST，编辑沿用原PATCH；两者均由服务端检查权限。——
const saveEntEdit = async () => {
  if (!isPlatformAdmin.value || entSaving.value) return
  const missing = checkEntRequired()
  if (missing) { toast.add({ title: '请填写：' + missing, color: 'warning' }); return }
  if (!entEditId.value && !entRenewExpire.value) { toast.add({ title: '请填写：服务到期日', color: 'warning' }); return }
  entSaving.value = true
  try {
    if (entEditId.value) {
      await $fetch('/api/admin/settings/enterprise/' + entEditId.value, {
        method: 'PATCH',
        body: { ...entForm, status: Number(entStatus.value) === 1 ? 1 : 0 },
      })
      toast.add({ title: '企业信息已保存', color: 'success' })
    } else {
      const result = await $fetch<{ id: number; name: string }>('/api/admin/enterprises', {
        method: 'POST', body: { ...entForm, status: Number(entStatus.value), renewExpire: entRenewExpire.value },
      })
      createdEnterprise.value = { id: result.id, name: result.name, contact: entForm.contact, phone: entForm.phone }
      entKeyword.value = ''
      entSearch.value = ''
      entPage.value = 1
      toast.add({ title: '企业已创建，可继续创建厂家主账号', color: 'success' })
    }
    showEntModal.value = false
    refreshEntAdmin()
    refreshEntList()
    refreshUsers()
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

// —— 厂家分组视图：展开/折叠状态（一行=厂家；点击行展开用户明细；页切换/刷新后保持展开）——
const expandedEnts = ref<Set<number>>(new Set())
const toggleEnt = (id: number) => {
  const s = new Set(expandedEnts.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  expandedEnts.value = s
}
const isEntExpanded = (id: number) => expandedEnts.value.has(id)
const hasUserFilter = computed(() =>
  !!(String(ufilters.keyword || '').trim() || ufilters.role || (ufilters.status !== undefined && ufilters.status !== '')))
// 需求点 4：筛选时在所有厂家及下属用户中检索——命中厂家自动展开（后端 filtered 标记；无条件/翻页不自动展开）
watch(userData, (d) => {
  if (d?.filtered) {
    const ids = (d.rows || []).map((r: any) => Number(r.id)).filter((i: number) => Number.isInteger(i))
    if (ids.length) expandedEnts.value = new Set(ids)
  }
})

// 企业选项支持独立搜索和翻页，选中项跨页保留，避免第100家之后无法分配账号。
const entOptionKeyword = ref('')
const entOptionSearch = ref('')
const entOptionPage = ref(1)
const selectedEnterprise = ref<{ value: number; label: string } | null>(null)
const { data: entList, pending: entOptionsPending, error: entOptionsError, refresh: refreshEntList } = await useFetch<any>('/api/admin/factories', {
  key: 'settings-factories',
  query: computed(() => ({ page: entOptionPage.value, pageSize: 20, keyword: entOptionSearch.value || undefined })),
  immediate: isPlatformAdmin,
})
const entOptionPages = computed(() => Math.max(1, Math.ceil((entList.value?.total || 0) / 20)))
const enterpriseOptions = computed(() => {
  const options = (entList.value?.rows || []).map((e: any) => ({ value: Number(e.id), label: e.name }))
  if (selectedEnterprise.value && !options.some((e: any) => e.value === selectedEnterprise.value!.value)) options.unshift(selectedEnterprise.value)
  return options
})
const searchEnterpriseOptions = () => {
  entOptionPage.value = 1
  entOptionSearch.value = entOptionKeyword.value.trim()
  refreshEntList()
}

// 新增用户对话框
const showUserModal = ref(false)
const userSaving = ref(false)
const uform = reactive({ username: '', password: '', name: '', phone: '', role: 'code_admin', enterpriseId: null as number | null })
// 角色选项（2026-10-10）：总部管理员仅对总部管理员显示；
// 厂家主账号即使伪造请求也会被服务端提权闸 403，此处仅避免「看得到选项、点了吃 403」
const userRoleOptions = computed(() => {
  const items: { value: string; label: string }[] = [
    { value: 'enterprise_admin', label: '厂家主账号' },
    { value: 'code_admin', label: '码管理员' },
    { value: 'viewer', label: '只读账号' },
  ]
  if (isPlatformAdmin.value) items.unshift({ value: 'platform_admin', label: '总部管理员' })
  return items
})
watch(() => uform.enterpriseId, (id) => {
  selectedEnterprise.value = enterpriseOptions.value.find((e: any) => e.value === id) || null
})

const openCreateUser = () => {
  Object.assign(uform, { username: '', password: '', name: '', phone: '', role: 'code_admin', enterpriseId: null })
  selectedEnterprise.value = null
  entOptionKeyword.value = ''
  entOptionSearch.value = ''
  entOptionPage.value = 1
  if (isPlatformAdmin.value) refreshEntList()
  showUserModal.value = true
}
const createEnterpriseAdmin = (enterprise: { id: number; name: string; contact?: string; phone?: string }) => {
  if (!isPlatformAdmin.value) return
  tab.value = 'users'
  openCreateUser()
  selectedEnterprise.value = { value: Number(enterprise.id), label: enterprise.name }
  Object.assign(uform, { enterpriseId: Number(enterprise.id), role: 'enterprise_admin', name: enterprise.contact || '', phone: enterprise.phone || '' })
}
const saveUser = async () => {
  if (userSaving.value) return
  if (!uform.username.trim()) { toast.add({ title: '请输入登录名', color: 'warning' }); return }
  if ((uform.password || '').length < 6) { toast.add({ title: '密码至少 6 位', color: 'warning' }); return }
  // 总部管理员不挂企业，无需选择；其余角色在总部视角下必须指定所属企业
  if (uform.role !== 'platform_admin' && isPlatformAdmin.value && !uform.enterpriseId) {
    toast.add({ title: '请选择所属企业', color: 'warning' }); return
  }
  userSaving.value = true
  try {
    await $fetch('/api/admin/users', { method: 'POST', body: { ...uform } })
    toast.add({ title: '用户已创建', color: 'success' })
    showUserModal.value = false
    refreshUsers()
    if (isPlatformAdmin.value) {
      refreshEntAdmin()
      if (createdEnterprise.value?.id === uform.enterpriseId && uform.role === 'enterprise_admin') createdEnterprise.value = null
    }
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '创建失败', color: 'error' })
  } finally {
    userSaving.value = false
  }
}

// —— 厂家续费设置弹窗（总部专用：线下缴费后登记到期日；清空=到期未续费）——
const showRenewModal = ref(false)
const renewSaving = ref(false)
const renewForm = reactive({ id: null as number | null, name: '', expire: '' })
const openRenewModal = (g: any) => {
  renewForm.id = Number(g.id)
  renewForm.name = g.name || ''
  renewForm.expire = g.renew_expire || ''
  showRenewModal.value = true
}
const saveRenew = async () => {
  renewSaving.value = true
  try {
    await $fetch('/api/admin/enterprises/' + renewForm.id + '/renew', { method: 'PATCH', body: { renewExpire: renewForm.expire } })
    toast.add({ title: renewForm.expire ? '续费到期日已更新' : '已清空（到期未续费）', color: 'success' })
    showRenewModal.value = false
    refreshUsers()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '保存失败', color: 'error' })
  } finally {
    renewSaving.value = false
  }
}

// —— 删除厂家确认弹窗（总部专用：级联清除该厂全部账号；有业务数据引用时按钮置灰）——
const showDelEntModal = ref(false)
const delEntSaving = ref(false)
const delEnt = reactive({ id: null as number | null, name: '', userCount: 0 })
const openDelEntModal = (g: any) => {
  delEnt.id = Number(g.id)
  delEnt.name = g.name || ''
  delEnt.userCount = Number(g.user_count) || 0
  showDelEntModal.value = true
}
const confirmDelEnt = async () => {
  delEntSaving.value = true
  try {
    await $fetch('/api/admin/enterprises/' + delEnt.id, { method: 'DELETE' })
    toast.add({ title: '厂家已删除', color: 'success' })
    showDelEntModal.value = false
    // 清理展开态并回退空页
    const s = new Set(expandedEnts.value); s.delete(Number(delEnt.id)); expandedEnts.value = s
    const beforeTotal = userData.value?.total || 0
    if (upage.value > 1 && beforeTotal - 1 <= (upage.value - 1) * pageSize) upage.value -= 1
    refreshUsers()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '删除失败', color: 'error' })
  } finally {
    delEntSaving.value = false
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

// 日志筛选参数公共构造（分组列表与组内明细拉取共用同一筛选口径）
const buildLogQuery = (extra: Record<string, unknown> = {}) => ({
  keyword: lfilters.keyword || undefined,
  module: lfilters.module || undefined,
  action: lfilters.action || undefined,
  result: lfilters.result || undefined,
  dateFrom: lfilters.dateFrom || undefined,
  dateTo: lfilters.dateTo || undefined,
  page: lpage.value, pageSize,
  ...extra,
})
const { data: logData, pending: logPending, refresh: refreshLogs } = await useFetch<any>('/api/admin/logs', {
  key: 'settings-logs',
  query: computed(() => buildLogQuery()),
})
const logTotalPages = computed(() => Math.max(1, Math.ceil((logData.value?.total || 0) / pageSize)))

// —— 日志分组视图：展开/折叠 + 组内明细（内部可独立分页，每页 10 条）——
const LOG_DETAIL_SIZE = 10
const expandedLogEnts = ref<Set<number>>(new Set())
const logDetailSeq: Record<number, number> = {}
const logDetailMap = ref<Record<number, { rows: any[]; total: number; page: number }>>({})
const hasLogFilter = computed(() =>
  !!(String(lfilters.keyword || '').trim() || lfilters.module || lfilters.action || (lfilters.result !== undefined && lfilters.result !== '') || lfilters.dateFrom || lfilters.dateTo))
const isLogEntExpanded = (id: number) => expandedLogEnts.value.has(id)
const toggleLogEnt = (g: any) => {
  const id = Number(g.id)
  const s = new Set(expandedLogEnts.value)
  if (s.has(id)) { s.delete(id); expandedLogEnts.value = s; return }
  s.add(id); expandedLogEnts.value = s
  if (!logDetailMap.value[id]) fetchLogDetail(id, 1) // 首次展开拉第 1 页明细
}
const fetchLogDetail = async (entId: number, dPage: number) => {
  const seq = (logDetailSeq[entId] = (logDetailSeq[entId] || 0) + 1) // 防旧请求晚到覆盖新请求
  try {
    const d = await $fetch<any>('/api/admin/logs', { query: buildLogQuery({ entId, dPage, dPageSize: LOG_DETAIL_SIZE }) })
    if (logDetailSeq[entId] === seq) {
      logDetailMap.value = { ...logDetailMap.value, [entId]: { rows: d.rows || [], total: Number(d.total) || 0, page: dPage } }
    }
  } catch { /* 拉取失败保留空态 */ }
}
const logDetailOf = (entId: number) => logDetailMap.value[entId] || { rows: [], total: 0, page: 1 }
const logDetailPages = (entId: number) => Math.max(1, Math.ceil((logDetailOf(entId).total || 0) / LOG_DETAIL_SIZE))
// 筛选条件变化 → 组内明细缓存失效（缓存按 entId 索引，不含筛选口径；
// 若不失效：「筛选→展开组」缓存的是筛选口径明细，随后清空筛选再查询（filtered=false 不触发下方 watch）
// 会继续展示旧筛选口径的明细，与全量列表口径不一致）
watch(() => [lfilters.keyword, lfilters.module, lfilters.action, lfilters.result, lfilters.dateFrom, lfilters.dateTo], () => {
  logDetailMap.value = {}
  expandedLogEnts.value = new Set() // 同步折叠：避免「缓存已清但组仍展开」的空白中间态（查询后筛选态会自动展开命中组）
})

// 筛选命中时自动展开全部命中组并拉各自明细第 1 页
watch(logData, (d) => {
  if (d?.filtered) {
    const ids = (d.rows || []).map((r: any) => Number(r.id)).filter((i: number) => Number.isInteger(i))
    if (ids.length) {
      expandedLogEnts.value = new Set(ids)
      for (const id of ids) fetchLogDetail(id, 1)
    }
  }
})

// 页内【重置】：重置当前激活面板——企业信息回填「已保存值」（放弃未保存草稿），
// 用户/日志清空筛选并刷新；数据备份面板无表单内容（Keep-Alive 缓存页互不影响）
const resetPanel = async () => {
  if (tab.value === 'enterprise') {
    if (isPlatformAdmin.value) {
      // 总部视角重置搜索与分页，返回完整企业列表。
      entKeyword.value = ''
      entSearch.value = ''
      entPage.value = 1
      refreshEntAdmin()
      toast.add({ title: '已刷新企业列表', color: 'primary' })
    } else {
      await refreshEnt() // watch(entData) 回填已保存值，丢弃草稿
      toast.add({ title: '企业信息已恢复为已保存值', color: 'primary' })
    }
  } else if (tab.value === 'users') {
    Object.assign(ufilters, { keyword: '', role: undefined, status: undefined })
    upage.value = 1
    expandedEnts.value = new Set() // 重置回全折叠
    refreshUsers()
    toast.add({ title: '已重置，用户列表恢复初始筛选', color: 'primary' })
  } else if (tab.value === 'logs') {
    Object.assign(lfilters, { keyword: '', module: undefined, action: '', result: undefined, dateFrom: '', dateTo: '' })
    lpage.value = 1
    expandedLogEnts.value = new Set() // 重置回全折叠
    logDetailMap.value = {}
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
    <!-- 列表由 settingsTabs 计算：只读/码管理员看不到「用户权限」、非总部看不到「数据备份」 -->
    <UTabs v-model="tab" :items="settingsTabs" />

    <!-- 建档指引仅在主动进入时加载；厂家数据范围由服务端登录身份确定。 -->
    <AdminOnboarding v-if="tab === 'onboarding'" />

    <!-- 企业信息（总部=入驻企业列表维护；厂家/码管理员=编辑本企业资料） -->
    <div v-if="tab === 'enterprise'" class="space-y-4">
      <!-- 总部视角：使用本系统的企业（租户）列表 -->
      <template v-if="isPlatformAdmin">
        <div v-if="createdEnterprise" class="b-card p-4 flex flex-wrap items-center justify-between gap-3">
          <span>企业「{{ createdEnterprise.name }}」已创建，下一步可创建厂家主账号。</span>
          <UButton color="neutral" variant="outline" icon="i-lucide-user-plus" @click="createEnterpriseAdmin(createdEnterprise)">创建厂家主账号</UButton>
        </div>
        <div class="b-card b-card-clip">
          <div class="b-card-head">
            <span class="b-card-title">入驻企业列表</span>
            <span class="b-card-extra">共 {{ entAdminData?.total || 0 }} 家{{ entSearch ? '匹配企业' : '入驻企业' }} · 扫码页展示的企业资料以此为准</span>
            <UButton color="neutral" variant="solid" icon="i-lucide-plus" @click="openEntCreate">新增企业</UButton>
          </div>
          <div class="flex flex-wrap items-center gap-2 p-4">
            <UInput v-model="entKeyword" placeholder="企业名称、信用代码或联系人" class="w-72" @keyup.enter="searchEnterprises" />
            <UButton color="neutral" variant="outline" :loading="entPending" @click="searchEnterprises">查询企业</UButton>
            <span v-if="entError" class="text-sm text-red-600">企业列表加载失败，请重试查询</span>
          </div>
          <div class="b-scroll-x">
            <table class="b-table">
              <thead>
                <tr>
                  <th>企业名称</th>
                  <th>统一社会信用代码</th>
                  <th>联系人</th>
                  <th>联系电话</th>
                  <th>服务到期日</th>
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
                  <td>{{ e.renew_expire ? String(e.renew_expire).slice(0, 10) : '未设置' }}</td>
                  <td>
                    <span class="b-tag" :class="Number(e.status) === 1 ? 'b-tag-success' : 'b-tag-danger'">
                      {{ Number(e.status) === 1 ? '启用' : '禁用' }}
                    </span>
                  </td>
                  <td>{{ e.user_count || 0 }}</td>
                  <td class="whitespace-nowrap text-xs text-[var(--b-text-muted)]">{{ e.created_at ? String(e.created_at).slice(0, 10) : '-' }}</td>
                  <td>
                    <UButton variant="link" color="neutral" size="xs" icon="i-lucide-pencil" @click="openEntEdit(e)">编辑</UButton>
                    <UButton v-if="Number(e.user_count) === 0" variant="link" color="neutral" size="xs" @click="createEnterpriseAdmin(e)">创建厂家主账号</UButton>
                  </td>
                </tr>
                <tr v-if="!entAdminData?.rows?.length">
                  <td colspan="9" class="b-empty">
                    <div class="b-empty-inner">
                      <UIcon name="i-lucide-building-2" class="b-empty-icon h-8 w-8" />
                      <span class="text-sm">{{ entPending ? '正在加载企业' : entError ? '企业列表加载失败' : entSearch ? '未找到匹配企业，请调整查询条件' : '暂无入驻企业' }}</span>
                      <UButton v-if="!entPending && !entError && !entSearch" color="neutral" variant="outline" @click="openEntCreate">新增企业</UButton>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="entAdminData?.total" class="b-pager">
            <span class="b-card-extra">第 {{ entPage }} / {{ entTotalPages }} 页</span>
            <div class="flex items-center gap-2">
              <UButton color="neutral" variant="outline" size="sm" :disabled="entPending || entPage <= 1" @click="entPage--">上一页</UButton>
              <UButton color="neutral" variant="outline" size="sm" :disabled="entPending || entPage >= entTotalPages" @click="entPage++">下一页</UButton>
            </div>
          </div>
        </div>

        <!-- 编辑企业弹窗（Nuxt UI v4：v-model:open + #content 插槽） -->
        <UModal v-model:open="showEntModal" :dismissible="!entSaving">
          <template #content>
            <div class="b-modal">
              <div class="b-modal-head">
                <div class="b-modal-icon">
                  <UIcon name="i-lucide-building-2" class="h-4 w-4 text-[var(--b-text-regular)]" />
                </div>
                <div>
                  <h3 class="b-modal-title">{{ entEditId ? '编辑企业信息（' + entEditName + '）' : '新增企业' }}</h3>
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
                    <label class="b-label">统一社会信用代码 <span class="b-required">*</span></label>
                    <UInput v-model="entForm.creditCode" placeholder="18 位信用代码" />
                  </div>
                  <div>
                    <label class="b-label">单元识别码</label>
                    <UInput v-model="entForm.unitCode" placeholder="1049号公告口径（登记类别+登记证后6位+生产类型）" />
                  </div>
                  <div>
                    <label class="b-label">联系人 <span class="b-required">*</span></label>
                    <UInput v-model="entForm.contact" placeholder="联系人姓名" />
                  </div>
                  <div>
                    <label class="b-label">联系电话 <span class="b-required">*</span></label>
                    <UInput v-model="entForm.phone" placeholder="联系电话" />
                  </div>
                  <div>
                    <label class="b-label">法定代表人 <span class="b-required">*</span></label>
                    <UInput v-model="entForm.legalPerson" placeholder="法人姓名" />
                  </div>
                  <div>
                    <label class="b-label">农药生产许可证号 <span class="b-required">*</span></label>
                    <UInput v-model="entForm.licenseNo" placeholder="生产许可证号" />
                  </div>
                  <div>
                    <label class="b-label">资质到期日 <span class="b-required">*</span></label>
                    <UInput v-model="entForm.qualificationExpire" type="date" />
                    <p class="b-help">到期前 30/60/90 天提醒</p>
                  </div>
                  <div>
                    <label class="b-label">状态</label>
                    <USelect v-model="entStatus" :items="[{ value: 1, label: '启用' }, { value: 0, label: '禁用' }]" class="w-full" />
                  </div>
                  <div v-if="!entEditId">
                    <label class="b-label">服务到期日 <span class="b-required">*</span></label>
                    <UInput v-model="entRenewExpire" type="date" />
                    <p class="b-help">与资质到期日分别填写；服务到期日当天可使用，次日起禁止登录。后续可在用户权限中设置续费。</p>
                  </div>
                </div>
              </div>
              <div class="b-modal-foot">
                <span class="b-card-extra">带 <span class="b-required">*</span> 的为必填项，保存后立即生效</span>
                <div class="flex items-center gap-2">
                  <UButton variant="outline" color="neutral" :disabled="entSaving" @click="showEntModal = false">取消</UButton>
                  <UButton color="neutral" variant="solid" icon="i-lucide-save" :loading="entSaving" @click="saveEntEdit">{{ entEditId ? '保存企业信息' : '创建企业' }}</UButton>
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
        <!-- 只读账号/码管理员：可查看但不可修改（后端企业信息接口要求厂家主账号及以上） -->
        <div v-if="!canManageUsers" class="mx-4 mt-3 rounded-md bg-warning-soft px-3 py-2 text-xs text-default">
          当前角色（{{ user?.role === 'viewer' ? '只读账号' : '码管理员' }}）不可修改企业信息，如需变更请联系厂家主账号或平台。
        </div>
        <div class="b-form-grid md:grid-cols-2">
          <div>
            <label class="b-label">企业名称 <span class="b-required">*</span></label>
            <UInput v-model="entForm.name" placeholder="企业全称" />
          </div>
          <div>
            <label class="b-label">统一社会信用代码 <span class="b-required">*</span></label>
            <UInput v-model="entForm.creditCode" placeholder="18 位信用代码" />
          </div>
          <div>
            <label class="b-label">单元识别码</label>
            <UInput v-model="entForm.unitCode" placeholder="1049号公告口径（登记类别+登记证后6位+生产类型）" />
          </div>
          <div>
            <label class="b-label">联系人 <span class="b-required">*</span></label>
            <UInput v-model="entForm.contact" placeholder="联系人姓名" />
          </div>
          <div>
            <label class="b-label">联系电话 <span class="b-required">*</span></label>
            <UInput v-model="entForm.phone" placeholder="联系电话" />
          </div>
          <div>
            <label class="b-label">法定代表人 <span class="b-required">*</span></label>
            <UInput v-model="entForm.legalPerson" placeholder="法人姓名" />
          </div>
          <div>
            <label class="b-label">农药生产许可证号 <span class="b-required">*</span></label>
            <UInput v-model="entForm.licenseNo" placeholder="生产许可证号" />
          </div>
          <div>
            <label class="b-label">资质到期日 <span class="b-required">*</span></label>
            <UInput v-model="entForm.qualificationExpire" type="date" />
            <p class="b-help">到期前 30/60/90 天提醒</p>
          </div>
        </div>
        <div class="b-card-foot">
          <span class="b-card-extra">带 <span class="b-required">*</span> 的为必填项，保存后立即生效</span>
          <UButton v-if="canManageUsers" color="neutral" variant="solid" icon="i-lucide-save" :loading="entSaving" @click="saveEnterprise">保存企业信息</UButton>
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
          <span class="b-card-extra">
            共 <span class="font-medium b-strong">{{ userData?.total || 0 }}</span> 个厂家 ·
            <span class="font-medium b-strong">{{ userData?.totalUsers || 0 }}</span> 个账号
            <span v-if="hasUserFilter" class="b-tag b-tag-info ml-2">已筛选</span>
          </span>
          <div class="flex items-center gap-2">
            <UButton color="neutral" variant="solid" :loading="userPending" @click="upage = 1; refreshUsers()">查询</UButton>
            <UButton color="neutral" variant="outline" icon="i-lucide-user-plus" @click="openCreateUser">新增用户</UButton>
          </div>
        </div>
      </div>

      <!-- 用户列表（厂家分组：一行=一个厂家，点击行展开/折叠该厂家用户明细；外层分页=厂家分页） -->
      <div class="b-card b-card-clip">
        <div class="b-card-head">
          <span class="b-card-title">用户列表</span>
          <span class="b-card-extra">按厂家分组 · 点击厂家行展开/折叠该厂家用户明细</span>
        </div>
        <div class="b-scroll-x">
          <table class="b-table">
            <thead>
              <tr>
                <th>厂家名称</th>
                <th>用户总数</th>
                <th>续费状态</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="g in userData?.rows || []" :key="g.id">
                <!-- 厂家行：点击展开/折叠 -->
                <tr class="cursor-pointer select-none" @click="toggleEnt(g.id)">
                  <td>
                    <div class="flex items-center gap-2">
                      <UIcon :name="isEntExpanded(g.id) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="h-3.5 w-3.5 shrink-0 text-[var(--b-text-muted)]" />
                      <span class="b-strong font-medium">{{ g.name }}</span>
                      <span v-if="g.id === 0" class="b-tag b-tag-danger">平台</span>
                      <span v-if="hasUserFilter" class="b-tag b-tag-info">命中 {{ g.users.length }} 人</span>
                    </div>
                  </td>
                  <td>
                    <span class="font-medium">{{ g.user_count }}</span>
                    <span class="text-xs text-[var(--b-text-muted)]">个账号</span>
                  </td>
                  <td>
                    <!-- 续费状态：有效期内(绿) / 到期未续费(红)；平台组无续费概念 -->
                    <span v-if="g.renew_status === 'active'" class="b-tag b-tag-success" :title="'续费至 ' + (g.renew_expire || '')">有效期内</span>
                    <span v-else-if="g.renew_status === 'expired'" class="b-tag b-tag-danger" :title="(g.renew_expire ? '已于 ' + g.renew_expire + ' 到期' : '未设置续费') + '，该厂家账号将禁止登录'">到期未续费</span>
                    <span v-else class="text-xs text-[var(--b-text-muted)]">—</span>
                  </td>
                  <td class="text-right">
                    <div class="b-actions justify-end">
                      <UButton variant="link" color="neutral" size="xs" @click.stop="toggleEnt(g.id)">
                        {{ isEntExpanded(g.id) ? '收起' : '展开' }}
                      </UButton>
                      <template v-if="isPlatformAdmin && g.id !== 0">
                        <span class="b-sep" />
                        <UButton variant="link" color="neutral" size="xs" @click.stop="openRenewModal(g)">续费设置</UButton>
                        <span class="b-sep" />
                        <!-- 有业务数据引用时删除置灰（title 由外层 span 承载，disabled 按钮自身不触发 title） -->
                        <span v-if="!g.can_delete" class="inline-flex" :title="'该厂家存在产品/规格/批次/追溯码等业务数据，不可删除'">
                          <UButton variant="link" color="error" size="xs" disabled>删除厂家</UButton>
                        </span>
                        <UButton v-else variant="link" color="error" size="xs" @click.stop="openDelEntModal(g)">删除厂家</UButton>
                      </template>
                    </div>
                  </td>
                </tr>
                <!-- 展开行：该厂家用户明细（不单独分页） -->
                <tr v-if="isEntExpanded(g.id)">
                  <td colspan="3" class="p-0">
                    <table class="b-table">
                      <thead>
                        <tr>
                          <th>登录名</th>
                          <th>姓名</th>
                          <th>手机号</th>
                          <th>角色</th>
                          <th>最后登录</th>
                          <th>状态</th>
                          <th class="text-right">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="r in g.users" :key="r.id">
                          <td class="b-strong font-medium">{{ r.username }}</td>
                          <td>{{ r.name || '-' }}</td>
                          <td>{{ r.phone || '-' }}</td>
                          <td>
                            <span class="b-tag" :class="r.role === 'platform_admin' ? 'b-tag-danger' : r.role === 'enterprise_admin' ? 'b-tag-success' : 'b-tag-info'">
                              {{ r.roleLabel }}
                            </span>
                          </td>
                          <td>{{ r.last_login_at ? String(r.last_login_at).slice(0, 19) : '-' }}</td>
                          <td>
                            <span class="b-tag" :class="Number(r.status) === 1 ? 'b-tag-success' : 'b-tag-danger'">
                              {{ Number(r.status) === 1 ? '启用' : '禁用' }}
                            </span>
                          </td>
                          <td>
                            <!-- 2026-10-10：总部管理员账号同样可重置密码/禁用；当前登录的自己仅保留重置密码，避免触发「不能修改自己的账号」 -->
                            <div class="b-actions">
                              <UButton variant="link" color="neutral" size="xs" @click="resetPw(r)">重置密码</UButton>
                              <span class="b-sep" />
                              <span v-if="Number(r.id) === Number(user?.id)" class="text-xs text-[var(--b-text-muted)]">当前登录账号</span>
                              <UButton v-else variant="link" color="neutral" size="xs" @click="toggleUserStatus(r)">
                                {{ Number(r.status) === 1 ? '禁用' : '启用' }}
                              </UButton>
                            </div>
                          </td>
                        </tr>
                        <tr v-if="!g.users.length">
                          <td colspan="7" class="b-empty">
                            <div class="b-empty-inner">
                              <UIcon name="i-lucide-inbox" class="b-empty-icon h-8 w-8" />
                              <span class="text-sm">{{ hasUserFilter ? '该厂家无命中用户' : '该厂家暂无账号，可点击「新增用户」创建' }}</span>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              </template>
              <tr v-if="!userPending && !userData?.rows?.length">
                <td colspan="3" class="b-empty">
                  <div class="b-empty-inner">
                    <UIcon name="i-lucide-inbox" class="b-empty-icon h-8 w-8" />
                    <span class="text-sm">暂无匹配的厂家或用户，请调整筛选条件后重试</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="userData?.total" class="b-pager">
          <span class="b-card-extra">共 {{ userData?.total || 0 }} 个厂家 · 第 {{ userData.page }} / {{ userTotalPages }} 页</span>
          <div class="flex items-center gap-2">
            <UButton variant="outline" color="neutral" size="sm" :disabled="upage <= 1" @click="upage--; refreshUsers()">上一页</UButton>
            <UButton variant="outline" color="neutral" size="sm" :disabled="upage >= userTotalPages" @click="upage++; refreshUsers()">下一页</UButton>
          </div>
        </div>
      </div>

      <!-- 续费设置对话框（总部：线下缴费完成后登记到期日；清空=到期未续费） -->
      <UModal v-model:open="showRenewModal">
        <template #content>
          <div class="b-modal">
            <div class="b-modal-head">
              <div class="b-modal-icon">
                <UIcon name="i-lucide-calendar-clock" class="h-4 w-4 text-[var(--b-text-regular)]" />
              </div>
              <div>
                <h3 class="b-modal-title">续费设置（{{ renewForm.name }}）</h3>
                <p class="b-modal-sub">登记厂家续费有效期至：到期日当天仍可登录，次日 0 点起该厂家全部账号禁止登录</p>
              </div>
            </div>
            <div class="b-modal-body">
              <div>
                <label class="b-label">续费到期日</label>
                <UInput v-model="renewForm.expire" type="date" placeholder="清空即视为到期未续费" />
                <p class="b-help">清空日期 = 到期未续费（立即停用该厂家全部账号）；续费请按实际缴费周期填写到期日</p>
              </div>
            </div>
            <div class="b-modal-foot">
              <span class="b-card-extra">保存后立即生效</span>
              <div class="flex items-center gap-2">
                <UButton variant="outline" color="neutral" @click="showRenewModal = false">取消</UButton>
                <UButton color="neutral" variant="solid" icon="i-lucide-save" :loading="renewSaving" @click="saveRenew">保存</UButton>
              </div>
            </div>
          </div>
        </template>
      </UModal>

      <!-- 删除厂家确认对话框（总部：级联清除该厂全部账号，不可恢复） -->
      <UModal v-model:open="showDelEntModal">
        <template #content>
          <div class="b-modal">
            <div class="b-modal-head">
              <div class="b-modal-icon">
                <UIcon name="i-lucide-trash-2" class="h-4 w-4 text-[var(--b-text-regular)]" />
              </div>
              <div>
                <h3 class="b-modal-title">删除厂家</h3>
                <p class="b-modal-sub">该操作不可恢复，请谨慎确认</p>
              </div>
            </div>
            <div class="b-modal-body space-y-3">
              <div class="b-note">
                <UIcon name="i-lucide-shield-alert" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--b-text-muted)]" />
                <p class="b-note-text">
                  删除厂家「{{ delEnt.name }}」将<strong>同步级联清除该厂家下 {{ delEnt.userCount }} 个账号</strong>（登录名不可恢复），
                  且该厂家将不再占用「入驻企业」名额。
                </p>
              </div>
              <p class="b-help">注：存在产品/规格/批次/追溯码等业务数据的厂家不可删除（删除按钮已置灰），需先迁移或清理业务数据。</p>
            </div>
            <div class="b-modal-foot">
              <div class="flex items-center gap-2">
                <UButton variant="outline" color="neutral" @click="showDelEntModal = false">取消</UButton>
                <UButton color="error" variant="solid" icon="i-lucide-trash-2" :loading="delEntSaving" @click="confirmDelEnt">确认删除</UButton>
              </div>
            </div>
          </div>
        </template>
      </UModal>

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
                <UInput v-model="uform.username" autocomplete="off" placeholder="3-30 位字母/数字/下划线" />
              </div>
              <div>
                <label class="b-label-lg">初始密码 <span class="b-required">*</span></label>
                <UInput v-model="uform.password" type="password" autocomplete="new-password" placeholder="至少 6 位" />
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
                <USelect v-model="uform.role" class="w-full" :items="userRoleOptions" />
              </div>
              <div v-if="isPlatformAdmin && uform.role !== 'platform_admin'">
                <label class="b-label-lg">所属企业 <span class="b-required">*</span></label>
                <div class="flex gap-2 mb-2">
                  <UInput v-model="entOptionKeyword" placeholder="搜索企业名称或信用代码" class="min-w-0 flex-1" @keyup.enter="searchEnterpriseOptions" />
                  <UButton color="neutral" variant="outline" :loading="entOptionsPending" @click="searchEnterpriseOptions">查询</UButton>
                </div>
                <USelect v-model="uform.enterpriseId" :items="enterpriseOptions" placeholder="选择企业" class="w-full" :loading="entOptionsPending" />
                <p v-if="entOptionsError" class="b-help text-red-600">企业选项加载失败，请重新查询</p>
                <div class="flex items-center gap-2 mt-2">
                  <UButton color="neutral" variant="outline" size="xs" :disabled="entOptionsPending || entOptionPage <= 1" @click="entOptionPage--">上一页</UButton>
                  <span class="b-card-extra">{{ entOptionPage }} / {{ entOptionPages }} 页</span>
                  <UButton color="neutral" variant="outline" size="xs" :disabled="entOptionsPending || entOptionPage >= entOptionPages" @click="entOptionPage++">下一页</UButton>
                </div>
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
          <span class="b-card-extra">
            共 <span class="font-medium b-strong">{{ logData?.total || 0 }}</span> 个分组 ·
            <span class="font-medium b-strong">{{ logData?.totalLogs || 0 }}</span> 条日志
            <span v-if="hasLogFilter" class="b-tag b-tag-info ml-2">已筛选</span>
          </span>
          <div class="flex items-center gap-2">
            <UButton color="neutral" variant="solid" :loading="logPending" @click="lpage = 1; refreshLogs()">查询</UButton>
          </div>
        </div>
      </div>

      <!-- 日志列表（厂家/平台分组：一行=一个分组，点击行展开/折叠明细；外层分页=分组分页，组内明细可独立分页） -->
      <div class="b-card b-card-clip">
        <div class="b-card-head">
          <span class="b-card-title">日志列表</span>
          <span class="b-card-extra">按厂家/平台分组 · 点击分组行展开/折叠明细日志 · 保留至少 3 年不可删除</span>
        </div>
        <div class="b-scroll-x">
          <table class="b-table">
            <thead>
              <tr>
                <th>分组</th>
                <th>日志总数</th>
                <th class="text-right">明细</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="g in logData?.rows || []" :key="g.id">
                <!-- 分组行 -->
                <tr class="cursor-pointer select-none" @click="toggleLogEnt(g)">
                  <td>
                    <div class="flex items-center gap-2">
                      <UIcon :name="isLogEntExpanded(g.id) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="h-3.5 w-3.5 shrink-0 text-[var(--b-text-muted)]" />
                      <span class="b-strong font-medium">{{ g.name }}</span>
                      <span v-if="g.id === 0" class="b-tag b-tag-danger">平台</span>
                      <span v-if="hasLogFilter" class="b-tag b-tag-info">命中 {{ g.hit_count }} 条</span>
                    </div>
                  </td>
                  <td>
                    <span class="font-medium">{{ g.log_count }}</span>
                    <span class="text-xs text-[var(--b-text-muted)]">条</span>
                  </td>
                  <td class="text-right">
                    <UButton variant="link" color="neutral" size="xs" @click.stop="toggleLogEnt(g)">
                      {{ isLogEntExpanded(g.id) ? '收起' : '展开' }}
                    </UButton>
                  </td>
                </tr>
                <!-- 展开行：组内明细（内部可分页） -->
                <tr v-if="isLogEntExpanded(g.id)">
                  <td colspan="3" class="p-0">
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
                        <tr v-for="r in logDetailOf(g.id).rows" :key="r.id">
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
                        <tr v-if="!logDetailOf(g.id).rows.length">
                          <td colspan="7" class="b-empty">
                            <div class="b-empty-inner">
                              <UIcon name="i-lucide-inbox" class="b-empty-icon h-8 w-8" />
                              <span class="text-sm">{{ hasLogFilter ? '该分组无命中日志' : '该分组暂无日志' }}</span>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    <!-- 组内明细分页器（每组独立） -->
                    <div v-if="logDetailOf(g.id).total" class="b-pager">
                      <span class="b-card-extra">共 {{ logDetailOf(g.id).total }} 条 · 第 {{ logDetailOf(g.id).page }} / {{ logDetailPages(g.id) }} 页</span>
                      <div class="flex items-center gap-2">
                        <UButton variant="outline" color="neutral" size="sm" :disabled="logDetailOf(g.id).page <= 1" @click="fetchLogDetail(g.id, logDetailOf(g.id).page - 1)">上一页</UButton>
                        <UButton variant="outline" color="neutral" size="sm" :disabled="logDetailOf(g.id).page >= logDetailPages(g.id)" @click="fetchLogDetail(g.id, logDetailOf(g.id).page + 1)">下一页</UButton>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
              <tr v-if="!logPending && !logData?.rows?.length">
                <td colspan="3" class="b-empty">
                  <div class="b-empty-inner">
                    <UIcon name="i-lucide-inbox" class="b-empty-icon h-8 w-8" />
                    <span class="text-sm">暂无符合条件的操作日志，请调整筛选条件后重试</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <!-- 外层分页：厂家分组分页 -->
        <div v-if="logData?.total" class="b-pager">
          <span class="b-card-extra">共 {{ logData?.total || 0 }} 个分组 · 第 {{ logData.page }} / {{ logTotalPages }} 页</span>
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
