<script setup lang="ts">
// 门店管理（自建农资店库，供公众端「附近农资店」检索使用）
// 坐标系为 GCJ-02（与高德地图一致），无坐标的门店不参与附近搜索
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '门店管理' })

const toast = useToast()
const filters = reactive({
  keyword: '',
  isAuthorized: undefined as string | undefined,
  status: undefined as string | undefined,
})
const page = ref(1)
const pageSize = 20

// 下拉选项（Nuxt UI v4：value 禁止空字符串，「全部」由 placeholder 承载）
const AUTH_OPTIONS = [
  { value: '1', label: '授权经销商' },
  { value: '0', label: '普通门店' },
]
const STATUS_OPTIONS = [
  { value: '1', label: '启用' },
  { value: '0', label: '停用' },
]

const { data, pending, refresh, error } = await useFetch<any>('/api/admin/stores', {
  key: 'admin-stores',
  query: computed(() => ({
    keyword: filters.keyword || undefined,
    isAuthorized: filters.isAuthorized ?? undefined,
    status: filters.status ?? undefined,
    page: page.value, pageSize,
  })),
})

const totalPages = computed(() => Math.max(1, Math.ceil((data.value?.total || 0) / pageSize)))

// 拼接省市区，全部为空时显示占位
const regionText = (row: any) => [row.province, row.city, row.district].filter(Boolean).join('') || '-'
// 判断是否已标注坐标（经纬度需同时存在才可用于附近搜索）
const hasCoord = (row: any) =>
  row.lng !== null && row.lng !== undefined && row.lng !== '' &&
  row.lat !== null && row.lat !== undefined && row.lat !== ''
const coordText = (row: any) => Number(row.lng).toFixed(6) + ', ' + Number(row.lat).toFixed(6)

// 新增/编辑对话框
const showModal = ref(false)
const editingId = ref<number | null>(null)
const saving = ref(false)
const form = reactive({
  name: '', contact: '', phone: '',
  province: '', city: '', district: '', address: '',
  lng: null as number | null, lat: null as number | null,
  licenseNo: '', businessHours: '',
  isAuthorized: false, status: true,
})

const resetForm = () => {
  Object.assign(form, {
    name: '', contact: '', phone: '',
    province: '', city: '', district: '', address: '',
    lng: null, lat: null, licenseNo: '', businessHours: '',
    isAuthorized: false, status: true,
  })
}

const openCreate = () => {
  editingId.value = null
  resetForm()
  showModal.value = true
}

const openEdit = (row: any) => {
  editingId.value = row.id
  Object.assign(form, {
    name: row.name || '', contact: row.contact || '', phone: row.phone || '',
    province: row.province || '', city: row.city || '', district: row.district || '',
    address: row.address || '',
    lng: hasCoord(row) ? Number(row.lng) : null,
    lat: hasCoord(row) ? Number(row.lat) : null,
    licenseNo: row.license_no || '', businessHours: row.business_hours || '',
    isAuthorized: Number(row.is_authorized) === 1,
    status: Number(row.status) === 1,
  })
  showModal.value = true
}

// 空值统一归一为空字符串，服务端会转成 NULL 入库
const normalizeCoord = (v: number | null) => (v === null || v === undefined || (v as any) === '' ? '' : Number(v))

// 按地址自动获取坐标（调用高德 Web服务 地理编码，返回的即 GCJ-02 坐标）
const geocoding = ref(false)
const geocodeHint = ref('')
const doGeocode = async () => {
  const address = [form.province, form.city, form.district, form.address].filter(Boolean).join('')
  if (!address) {
    toast.add({ title: '请先填写省市区或详细地址', color: 'warning' })
    return
  }
  geocoding.value = true
  geocodeHint.value = ''
  try {
    // 同时传省/市：服务端据此校验高德模糊匹配的结果是否落在同一行政区，防止填入错误坐标
    const res = await $fetch<any>('/api/admin/stores/geocode', {
      query: { address, province: form.province, city: form.city },
    })
    form.lng = res.lng
    form.lat = res.lat
    geocodeHint.value = '已解析：' + res.formattedAddress + (res.exact ? '' : '（精度较粗，建议核对）')
    toast.add({ title: res.exact ? '坐标已自动填入' : '坐标已填入，但地址精度较粗，请核对', color: res.exact ? 'success' : 'warning' })
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '地址解析失败，请手工填写坐标', color: 'error' })
  } finally {
    geocoding.value = false
  }
}

const save = async () => {
  if (!form.name.trim()) { toast.add({ title: '请输入门店名称', color: 'warning' }); return }
  const lng = normalizeCoord(form.lng)
  const lat = normalizeCoord(form.lat)
  if (lng !== '' && (!Number.isFinite(lng as number) || (lng as number) < -180 || (lng as number) > 180)) {
    toast.add({ title: '经度不合法，应在 -180 ~ 180 之间', color: 'warning' }); return
  }
  if (lat !== '' && (!Number.isFinite(lat as number) || (lat as number) < -90 || (lat as number) > 90)) {
    toast.add({ title: '纬度不合法，应在 -90 ~ 90 之间', color: 'warning' }); return
  }
  const body = {
    name: form.name.trim(), contact: form.contact, phone: form.phone,
    province: form.province, city: form.city, district: form.district, address: form.address,
    lng, lat, licenseNo: form.licenseNo, businessHours: form.businessHours,
    isAuthorized: form.isAuthorized ? 1 : 0,
    status: form.status ? 1 : 0,
  }
  saving.value = true
  try {
    if (editingId.value) {
      await $fetch('/api/admin/stores/' + editingId.value, { method: 'PATCH', body })
      toast.add({ title: '门店信息已更新', color: 'success' })
    } else {
      await $fetch('/api/admin/stores', { method: 'POST', body })
      toast.add({ title: '门店已创建', color: 'success' })
    }
    showModal.value = false
    refresh()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '保存失败，请稍后重试', color: 'error' })
  } finally {
    saving.value = false
  }
}

// 启用 / 停用切换（停用后不在公众端展示）
const toggleStatus = async (row: any) => {
  const next = Number(row.status) === 1 ? 0 : 1
  try {
    await $fetch('/api/admin/stores/' + row.id, { method: 'PATCH', body: { status: next } })
    toast.add({ title: next === 1 ? '门店已启用' : '门店已停用', color: 'success' })
    refresh()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '操作失败，请稍后重试', color: 'error' })
  }
}

const doSearch = () => { page.value = 1; refresh() }
const resetSearch = () => {
  filters.keyword = ''
  filters.isAuthorized = undefined
  filters.status = undefined
  page.value = 1
  refresh()
}
</script>

<template>
  <div class="space-y-4">
    <!-- 页面标题区 -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="b-page-title">门店管理</h1>
        <p class="b-page-desc">自建农资店库，用于公众端「附近农资店」检索 · 坐标为 GCJ-02（与高德地图一致）</p>
      </div>
      <UButton color="neutral" variant="solid" icon="i-lucide-plus" @click="openCreate">新增门店</UButton>
    </div>

    <!-- 筛选查询区 -->
    <div class="b-card">
      <div class="b-card-head">
        <span class="b-card-title">筛选查询</span>
      </div>
      <div class="b-form-grid md:grid-cols-2 xl:grid-cols-4">
        <div>
          <label class="b-label">关键词</label>
          <UInput v-model="filters.keyword" placeholder="门店名称 / 地址 / 联系电话" icon="i-lucide-search" @keyup.enter="doSearch" />
        </div>
        <div>
          <label class="b-label">是否授权经销商</label>
          <USelect v-model="filters.isAuthorized" :items="AUTH_OPTIONS" placeholder="全部门店类型" class="w-full" />
        </div>
        <div>
          <label class="b-label">状态</label>
          <USelect v-model="filters.status" :items="STATUS_OPTIONS" placeholder="全部状态" class="w-full" />
        </div>
      </div>
      <div class="b-card-foot">
        <span class="b-card-extra">共 <span class="font-medium b-strong">{{ data?.total || 0 }}</span> 家门店</span>
        <div class="flex items-center gap-2">
          <UButton color="neutral" variant="solid" :loading="pending" @click="doSearch">查询</UButton>
          <UButton variant="outline" color="neutral" @click="resetSearch">重置</UButton>
        </div>
      </div>
    </div>

    <!-- 门店列表 -->
    <div v-if="error" class="b-card b-card-body text-sm text-red-600">门店列表加载失败，请刷新重试</div>
    <div v-else class="b-card b-card-clip">
      <div class="b-card-head">
        <span class="b-card-title">门店列表</span>
        <span class="b-card-extra">未标注坐标的门店不会出现在公众端「附近农资店」结果中</span>
      </div>
      <div class="b-scroll-x">
        <table class="b-table">
          <thead>
            <tr>
              <th>门店名称</th>
              <th>联系人 / 电话</th>
              <th>所在地区</th>
              <th>详细地址</th>
              <th>经纬度</th>
              <th>经营许可证号</th>
              <th>授权状态</th>
              <th>状态</th>
              <th class="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in data?.rows || []" :key="r.id">
              <td class="b-strong font-medium">{{ r.name }}</td>
              <td>
                <span v-if="r.contact || r.phone">{{ r.contact || '-' }} / {{ r.phone || '-' }}</span>
                <span v-else>-</span>
              </td>
              <td>{{ regionText(r) }}</td>
              <td class="max-w-[220px] truncate" :title="r.address || ''">{{ r.address || '-' }}</td>
              <td>
                <span v-if="hasCoord(r)" class="font-code text-[13px] b-strong">{{ coordText(r) }}</span>
                <span v-else class="b-tag b-tag-warning" title="无坐标的门店不会出现在公众端附近搜索里">未标注</span>
              </td>
              <td>{{ r.license_no || '-' }}</td>
              <td>
                <span class="b-tag" :class="Number(r.is_authorized) === 1 ? 'b-tag-success' : 'b-tag-default'">
                  {{ Number(r.is_authorized) === 1 ? '授权经销商' : '普通门店' }}
                </span>
              </td>
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
              <td colspan="9" class="b-empty">
                <div class="b-empty-inner">
                  <UIcon name="i-lucide-store" class="b-empty-icon h-8 w-8" />
                  <span class="text-sm">暂无门店数据，点击右上角「新增门店」创建</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="data?.total" class="b-pager">
        <span class="b-card-extra">共 {{ data?.total || 0 }} 家 · 第 {{ data.page }} / {{ totalPages }} 页</span>
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
              <UIcon :name="editingId ? 'i-lucide-pencil' : 'i-lucide-store'" class="h-4 w-4 text-[var(--b-text-regular)]" />
            </div>
            <div>
              <h3 class="b-modal-title">{{ editingId ? '编辑门店' : '新增门店' }}</h3>
              <p class="b-modal-sub">门店信息用于公众端「附近农资店」展示，请确保地址与坐标准确</p>
            </div>
          </div>
          <div class="b-modal-body">
            <div>
              <label class="b-label-lg">门店名称 <span class="b-required">*</span></label>
              <UInput v-model="form.name" placeholder="如：绿丰农资服务部（城东店）" />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="b-label-lg">联系人</label>
                <UInput v-model="form.contact" placeholder="如：张明" />
              </div>
              <div>
                <label class="b-label-lg">联系电话</label>
                <UInput v-model="form.phone" placeholder="如：13800138000" />
              </div>
            </div>
            <div class="grid grid-cols-3 gap-3">
              <div>
                <label class="b-label-lg">省份</label>
                <UInput v-model="form.province" placeholder="如：江苏省" />
              </div>
              <div>
                <label class="b-label-lg">城市</label>
                <UInput v-model="form.city" placeholder="如：南京市" />
              </div>
              <div>
                <label class="b-label-lg">区县</label>
                <UInput v-model="form.district" placeholder="如：栖霞区" />
              </div>
            </div>
            <div>
              <label class="b-label-lg">详细地址</label>
              <UInput v-model="form.address" placeholder="如：迈皋桥街道和燕路 123 号" />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="b-label-lg">经度</label>
                <UInput v-model.number="form.lng" type="number" step="0.000001" placeholder="如：118.796877" />
              </div>
              <div>
                <label class="b-label-lg">纬度</label>
                <UInput v-model.number="form.lat" type="number" step="0.000001" placeholder="如：32.060255" />
              </div>
            </div>
            <div class="flex items-center gap-2">
              <UButton variant="outline" color="neutral" size="sm" icon="i-lucide-map-pin" :loading="geocoding" @click="doGeocode">
                按地址自动获取坐标
              </UButton>
              <span v-if="geocodeHint" class="truncate text-xs text-[var(--b-text-muted)]">{{ geocodeHint }}</span>
            </div>
            <p class="b-help">可留空，留空则不参与附近门店搜索；坐标须为 GCJ-02（高德）坐标系。点击上方按钮可由地址自动解析，解析后建议核对</p>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="b-label-lg">经营许可证号</label>
                <UInput v-model="form.licenseNo" placeholder="农药经营许可证编号" />
              </div>
              <div>
                <label class="b-label-lg">营业时间</label>
                <UInput v-model="form.businessHours" placeholder="如：08:00-18:00" />
              </div>
            </div>
            <div class="flex items-center gap-2">
              <USwitch v-model="form.isAuthorized" />
              <span class="text-sm text-[var(--b-text-regular)]">授权经销商（公众端将标注「授权经销商」标识）</span>
            </div>
            <div class="flex items-center gap-2">
              <USwitch v-model="form.status" />
              <span class="text-sm text-[var(--b-text-regular)]">启用（停用后不在公众端展示）</span>
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
