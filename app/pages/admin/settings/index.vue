<script setup lang="ts">
// 系统设置（PRD 5.12：企业信息维护 / 用户权限 / 操作日志）
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
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

// ============ 用户管理（PRD 5.12.3） ============
const ufilters = reactive({ keyword: '', role: '', status: '' })
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
const lfilters = reactive({ keyword: '', module: '', action: '', result: '', dateFrom: '', dateTo: '' })
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
</script>

<template>
  <div class="space-y-5">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold text-default">系统设置</h1>
        <p class="mt-1 text-sm text-muted">企业信息 · 用户权限 · 操作日志（日志保留至少 3 年，不可删除）</p>
      </div>
    </div>

    <!-- Tab 切换 -->
    <UTabs v-model="tab" :items="[
      { label: '企业信息', icon: 'i-lucide-building-2' },
      { label: '用户权限', icon: 'i-lucide-users' },
      { label: '操作日志', icon: 'i-lucide-scroll-text' },
    ]" />

    <!-- 企业信息 -->
    <div v-if="tab === 'enterprise'" class="rounded-xl border border-border bg-elevated p-5 shadow-sm">
      <div class="grid gap-4 md:grid-cols-2">
        <div class="space-y-1.5">
          <label class="block text-sm font-medium text-default">企业名称 <span class="text-error">*</span></label>
          <UInput v-model="entForm.name" placeholder="企业全称" />
        </div>
        <div class="space-y-1.5">
          <label class="block text-sm font-medium text-default">统一社会信用代码</label>
          <UInput v-model="entForm.creditCode" placeholder="18 位信用代码" />
        </div>
        <div class="space-y-1.5">
          <label class="block text-sm font-medium text-default">单元识别码</label>
          <UInput v-model="entForm.unitCode" placeholder="1049号公告口径（登记类别+登记证后6位+生产类型）" />
        </div>
        <div class="space-y-1.5">
          <label class="block text-sm font-medium text-default">联系人</label>
          <UInput v-model="entForm.contact" placeholder="联系人姓名" />
        </div>
        <div class="space-y-1.5">
          <label class="block text-sm font-medium text-default">联系电话</label>
          <UInput v-model="entForm.phone" placeholder="联系电话" />
        </div>
        <div class="space-y-1.5">
          <label class="block text-sm font-medium text-default">法定代表人</label>
          <UInput v-model="entForm.legalPerson" placeholder="法人姓名" />
        </div>
        <div class="space-y-1.5">
          <label class="block text-sm font-medium text-default">企业官网</label>
          <UInput v-model="entForm.website" placeholder="https://..." />
        </div>
        <div class="space-y-1.5">
          <label class="block text-sm font-medium text-default">农药生产许可证号</label>
          <UInput v-model="entForm.licenseNo" placeholder="生产许可证号" />
        </div>
        <div class="space-y-1.5">
          <label class="block text-sm font-medium text-default">资质到期日</label>
          <UInput v-model="entForm.qualificationExpire" type="date" />
          <p class="text-xs text-muted">到期前 30/60/90 天提醒</p>
        </div>
        <div class="space-y-1.5 md:col-span-2">
          <label class="block text-sm font-medium text-default">注册地址</label>
          <UInput v-model="entForm.address" placeholder="企业注册地址" />
        </div>
        <div class="space-y-1.5 md:col-span-2">
          <label class="block text-sm font-medium text-default">企业简介</label>
          <UTextarea v-model="entForm.description" :rows="3" placeholder="企业简介" />
        </div>
      </div>
      <div class="mt-5 flex justify-end">
        <UButton color="primary" icon="i-lucide-save" :loading="entSaving" @click="saveEnterprise">保存企业信息</UButton>
      </div>
    </div>

    <!-- 用户权限 -->
    <div v-if="tab === 'users'" class="space-y-4">
      <div class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
        <div class="flex items-center justify-between">
          <div class="grid flex-1 gap-3 md:grid-cols-4">
            <UInput v-model="ufilters.keyword" placeholder="登录名 / 姓名 / 手机号" icon="i-lucide-search" @keyup.enter="upage = 1; refreshUsers()" />
            <USelect v-model="ufilters.role" :options="[{ value: '', label: '全部角色' }, { value: 'enterprise_admin', label: '厂家主账号' }, { value: 'code_admin', label: '码管理员' }, { value: 'viewer', label: '只读账号' }]" />
            <USelect v-model="ufilters.status" :options="[{ value: '', label: '全部状态' }, { value: '1', label: '启用' }, { value: '0', label: '禁用' }]" />
            <div class="flex gap-2">
              <UButton color="primary" size="sm" icon="i-lucide-search" :loading="userPending" @click="upage = 1; refreshUsers()">查询</UButton>
            </div>
          </div>
          <UButton color="primary" icon="i-lucide-user-plus" class="ml-3 shrink-0" @click="openCreateUser">新增用户</UButton>
        </div>
      </div>

      <div class="overflow-hidden rounded-xl border border-border bg-elevated shadow-sm">
        <div class="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <span class="text-sm font-semibold text-default">用户列表</span>
          <span class="text-xs text-muted">共 {{ userData?.total || 0 }} 条</span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead>
              <tr class="border-b border-border/60 bg-muted/30 text-xs text-muted">
                <th class="px-4 py-3 font-medium">登录名</th>
                <th class="px-4 py-3 font-medium">姓名</th>
                <th class="px-4 py-3 font-medium">手机号</th>
                <th class="px-4 py-3 font-medium">角色</th>
                <th class="px-4 py-3 font-medium">所属企业</th>
                <th class="px-4 py-3 font-medium">最后登录</th>
                <th class="px-4 py-3 font-medium">状态</th>
                <th class="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in userData?.rows || []" :key="r.id" class="border-b border-border/40 transition-colors hover:bg-muted/30">
                <td class="px-4 py-3 font-medium text-default">{{ r.username }}</td>
                <td class="px-4 py-3 text-muted">{{ r.name || '-' }}</td>
                <td class="px-4 py-3 text-muted">{{ r.phone || '-' }}</td>
                <td class="px-4 py-3">
                  <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="r.role === 'platform_admin' ? 'bg-error/10 text-error' : r.role === 'enterprise_admin' ? 'bg-primary/10 text-primary' : 'bg-sky/10 text-sky'">
                    {{ r.roleLabel }}
                  </span>
                </td>
                <td class="px-4 py-3 text-muted">{{ r.enterprise_name || '-' }}</td>
                <td class="px-4 py-3 text-muted">{{ r.last_login_at ? String(r.last_login_at).slice(0, 19) : '-' }}</td>
                <td class="px-4 py-3">
                  <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="Number(r.status) === 1 ? 'bg-success/10 text-success' : 'bg-error/10 text-error'">
                    {{ Number(r.status) === 1 ? '启用' : '禁用' }}
                  </span>
                </td>
                <td class="px-4 py-3">
                  <div v-if="r.role !== 'platform_admin'" class="flex gap-1.5">
                    <UButton variant="ghost" color="neutral" size="xs" icon="i-lucide-key-round" @click="resetPw(r)">重置密码</UButton>
                    <UButton variant="ghost" color="neutral" size="xs" :icon="Number(r.status) === 1 ? 'i-lucide-ban' : 'i-lucide-check-circle'" @click="toggleUserStatus(r)">
                      {{ Number(r.status) === 1 ? '禁用' : '启用' }}
                    </UButton>
                  </div>
                  <span v-else class="text-xs text-muted">总部账号</span>
                </td>
              </tr>
              <tr v-if="!userPending && !userData?.rows?.length">
                <td colspan="8" class="px-4 py-10 text-center text-sm text-muted">暂无用户</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="userData?.total" class="flex items-center justify-between border-t border-border/60 px-4 py-3">
          <span class="text-xs text-muted">第 {{ userData.page }} / {{ userTotalPages }} 页</span>
          <div class="flex gap-2">
            <UButton variant="outline" color="neutral" size="sm" :disabled="upage <= 1" @click="upage--; refreshUsers()">上一页</UButton>
            <UButton variant="outline" color="neutral" size="sm" :disabled="upage >= userTotalPages" @click="upage++; refreshUsers()">下一页</UButton>
          </div>
        </div>
      </div>

      <!-- 新增用户对话框 -->
      <UModal v-model="showUserModal">
        <div class="p-5">
          <h3 class="text-base font-semibold text-default">新增用户</h3>
          <div class="mt-4 space-y-4">
            <div class="grid grid-cols-2 gap-3">
              <div class="space-y-1.5">
                <label class="block text-sm font-medium text-default">登录名 <span class="text-error">*</span></label>
                <UInput v-model="uform.username" placeholder="3-30 位字母/数字/下划线" />
              </div>
              <div class="space-y-1.5">
                <label class="block text-sm font-medium text-default">初始密码 <span class="text-error">*</span></label>
                <UInput v-model="uform.password" type="password" placeholder="至少 6 位" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div class="space-y-1.5">
                <label class="block text-sm font-medium text-default">姓名</label>
                <UInput v-model="uform.name" placeholder="姓名" />
              </div>
              <div class="space-y-1.5">
                <label class="block text-sm font-medium text-default">手机号</label>
                <UInput v-model="uform.phone" placeholder="手机号" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div class="space-y-1.5">
                <label class="block text-sm font-medium text-default">角色 <span class="text-error">*</span></label>
                <USelect v-model="uform.role" :options="[
                  { value: 'enterprise_admin', label: '厂家主账号' },
                  { value: 'code_admin', label: '码管理员' },
                  { value: 'viewer', label: '只读账号' },
                ]" />
              </div>
              <div v-if="isPlatformAdmin" class="space-y-1.5">
                <label class="block text-sm font-medium text-default">所属企业 <span class="text-error">*</span></label>
                <USelect v-model="uform.enterpriseId" :options="(entList?.rows || []).map((e: any) => ({ value: Number(e.id), label: e.name }))" placeholder="选择企业" />
              </div>
            </div>
          </div>
          <div class="mt-6 flex justify-end gap-2">
            <UButton variant="outline" color="neutral" @click="showUserModal = false">取消</UButton>
            <UButton color="primary" :loading="userSaving" @click="saveUser">创建</UButton>
          </div>
        </div>
      </UModal>
    </div>

    <!-- 操作日志 -->
    <div v-if="tab === 'logs'" class="space-y-4">
      <div class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
        <div class="grid gap-3 md:grid-cols-6">
          <UInput v-model="lfilters.keyword" placeholder="操作人 / 模块 / 内容" icon="i-lucide-search" @keyup.enter="lpage = 1; refreshLogs()" />
          <USelect v-model="lfilters.module" :options="[{ value: '', label: '全部模块' }, { value: '登录', label: '登录' }, { value: '系统设置', label: '系统设置' }, { value: '用户管理', label: '用户管理' }]" />
          <UInput v-model="lfilters.action" placeholder="操作类型" />
          <USelect v-model="lfilters.result" :options="[{ value: '', label: '全部结果' }, { value: '1', label: '成功' }, { value: '0', label: '失败' }]" />
          <UInput v-model="lfilters.dateFrom" type="date" placeholder="起" />
          <UInput v-model="lfilters.dateTo" type="date" placeholder="止" />
        </div>
        <div class="mt-3">
          <UButton color="primary" icon="i-lucide-search" :loading="logPending" @click="lpage = 1; refreshLogs()">查询</UButton>
        </div>
      </div>

      <div class="overflow-hidden rounded-xl border border-border bg-elevated shadow-sm">
        <div class="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <span class="text-sm font-semibold text-default">日志列表</span>
          <span class="text-xs text-muted">共 {{ logData?.total || 0 }} 条 · 保留至少 3 年不可删除</span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead>
              <tr class="border-b border-border/60 bg-muted/30 text-xs text-muted">
                <th class="px-4 py-3 font-medium">操作时间</th>
                <th class="px-4 py-3 font-medium">操作人</th>
                <th class="px-4 py-3 font-medium">模块</th>
                <th class="px-4 py-3 font-medium">操作</th>
                <th class="px-4 py-3 font-medium">内容</th>
                <th class="px-4 py-3 font-medium">IP</th>
                <th class="px-4 py-3 font-medium">结果</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in logData?.rows || []" :key="r.id" class="border-b border-border/40 transition-colors hover:bg-muted/30">
                <td class="px-4 py-3 whitespace-nowrap text-muted">{{ String(r.created_at).slice(0, 19) }}</td>
                <td class="px-4 py-3 text-muted">{{ r.username || '-' }}</td>
                <td class="px-4 py-3 text-muted">{{ r.module || '-' }}</td>
                <td class="px-4 py-3 font-medium text-default">{{ r.action || '-' }}</td>
                <td class="max-w-72 truncate px-4 py-3 text-xs text-muted" :title="r.content || ''">{{ r.content || '-' }}</td>
                <td class="px-4 py-3 font-code text-xs text-muted">{{ r.ip || '-' }}</td>
                <td class="px-4 py-3">
                  <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="Number(r.result) === 1 ? 'bg-success/10 text-success' : 'bg-error/10 text-error'">
                    {{ Number(r.result) === 1 ? '成功' : '失败' }}
                  </span>
                </td>
              </tr>
              <tr v-if="!logPending && !logData?.rows?.length">
                <td colspan="7" class="px-4 py-10 text-center text-sm text-muted">暂无日志</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="logData?.total" class="flex items-center justify-between border-t border-border/60 px-4 py-3">
          <span class="text-xs text-muted">第 {{ logData.page }} / {{ logTotalPages }} 页</span>
          <div class="flex gap-2">
            <UButton variant="outline" color="neutral" size="sm" :disabled="lpage <= 1" @click="lpage--; refreshLogs()">上一页</UButton>
            <UButton variant="outline" color="neutral" size="sm" :disabled="lpage >= logTotalPages" @click="lpage++; refreshLogs()">下一页</UButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
