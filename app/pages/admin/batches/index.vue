<script setup lang="ts">
// 生产批次管理（PRD 5.6：三要素 → 码状态"已绑定"）
// Keep-Alive 页面缓存：左侧菜单切换后返回保留页面状态（表单/筛选/页码/预览）；刷新、退出登录自动清空；页内【重置】恢复初始
definePageMeta({ layout: 'admin', middleware: 'backend-guard', keepalive: true })
useHead({ title: '生产批次' })

const toast = useToast()
// 筛选条件：下拉类默认 undefined（Nuxt UI v4 空值自动显示 placeholder，禁止空字符串 value 选项）
const filters = reactive({ keyword: '', productId: undefined as string | undefined })
const page = ref(1)
const pageSize = 20

const { data: productData } = await useFetch<any>('/api/admin/products', {
  key: 'admin-products-all',
  query: { page: 1, pageSize: 100, status: 1 },
})

const { data, pending, refresh } = await useFetch<any>('/api/admin/batches', {
  key: 'admin-batches',
  query: computed(() => ({
    keyword: filters.keyword || undefined,
    productId: filters.productId || undefined,
    page: page.value, pageSize,
  })),
})

const totalPages = computed(() => Math.max(1, Math.ceil((data.value?.total || 0) / pageSize)))

const STATUS_STYLE: Record<string, string> = {
  '待上传': 'b-tag-default',
  '已上传': 'b-tag-info',
  '部分上传': 'b-tag-warning',
  '已完成': 'b-tag-success',
}

// 效期预警（PRD 5.6）：距有效期 ≤30 天标「临期」（黄），已过有效期标「已过期」（红）
// 判定统一按「当天零点」做整日差，避免服务端渲染与客户端水合因毫秒级时间差产生不一致
const expiryBadge = (expireDate: unknown): { cls: string; label: string } | null => {
  if (!expireDate) return null
  const target = new Date(String(expireDate).slice(0, 10) + 'T00:00:00')
  if (Number.isNaN(target.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((target.getTime() - today.getTime()) / 86400000)
  if (days < 0) return { cls: 'b-tag-danger', label: '已过期' }
  if (days <= 30) return { cls: 'b-tag-warning', label: '临期' }
  return null
}

// 新建/编辑对话框
const showModal = ref(false)
const editingId = ref<number | null>(null)
const saving = ref(false)
const form = reactive({
  productId: null as number | null, batchNo: '', produceDate: '', qualityCertNo: '',
  expireDate: '', qcResult: 1, qcReportNo: '', quantity: 0,
})

const selectedProduct = computed(() => (productData.value?.rows || []).find((p: any) => Number(p.id) === Number(form.productId)))

// 有效期自动计算：生产日期 + 产品保质期（如 "2年"），可覆盖
const autoExpire = () => {
  const p = selectedProduct.value
  if (!p || !form.produceDate || !p.shelf_life) return
  const m = String(p.shelf_life).match(/(\d+)\s*年/)
  if (!m) return
  const d = new Date(form.produceDate + 'T00:00:00')
  d.setFullYear(d.getFullYear() + Number(m[1]))
  form.expireDate = d.toISOString().slice(0, 10)
}

const openCreate = () => {
  editingId.value = null
  Object.assign(form, { productId: null, batchNo: '', produceDate: '', qualityCertNo: '', expireDate: '', qcResult: 1, qcReportNo: '', quantity: 0 })
  showModal.value = true
}
const openEdit = (row: any) => {
  editingId.value = row.id
  Object.assign(form, {
    productId: row.product_id, batchNo: row.batch_no,
    produceDate: row.produce_date ? String(row.produce_date).slice(0, 10) : '',
    qualityCertNo: row.quality_cert_no || '',
    expireDate: row.expire_date ? String(row.expire_date).slice(0, 10) : '',
    qcResult: Number(row.qc_result ?? 1), qcReportNo: row.qc_report_no || '', quantity: Number(row.quantity || 0),
  })
  showModal.value = true
}

const save = async () => {
  if (!form.productId) { toast.add({ title: '请选择关联产品', color: 'warning' }); return }
  if (!form.batchNo.trim()) { toast.add({ title: '请输入生产批次号', color: 'warning' }); return }
  if (!form.produceDate) { toast.add({ title: '请选择生产日期', color: 'warning' }); return }
  if (!form.qualityCertNo.trim()) { toast.add({ title: '请输入质量合格证号', color: 'warning' }); return }
  if (!form.expireDate) { toast.add({ title: '请选择有效期至', color: 'warning' }); return }
  saving.value = true
  try {
    if (editingId.value) {
      await $fetch('/api/admin/batches/' + editingId.value, { method: 'PATCH', body: { ...form } })
      toast.add({ title: '批次已更新', color: 'success' })
    } else {
      await $fetch('/api/admin/batches', { method: 'POST', body: { ...form } })
      toast.add({ title: '批次已创建', color: 'success' })
    }
    showModal.value = false
    refresh()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '保存失败', color: 'error' })
  } finally {
    saving.value = false
  }
}

const removeBatch = async (row: any) => {
  try {
    await $fetch('/api/admin/batches/' + row.id, { method: 'DELETE' })
    toast.add({ title: '批次已删除', color: 'success' })
    refresh()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '删除失败', color: 'error' })
  }
}

const doSearch = () => { page.value = 1; refresh() }
const resetSearch = () => { filters.keyword = ''; filters.productId = undefined; page.value = 1; refresh() }
</script>

<template>
  <div class="space-y-4">
    <!-- 页面标题区 -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="b-page-title">生产批次管理</h1>
        <p class="b-page-desc">批号三要素（生产日期/批号/质量合格证号）齐全后，关联码自动置为"已绑定"</p>
      </div>
      <UButton color="neutral" variant="solid" icon="i-lucide-plus" @click="openCreate">新建批号</UButton>
    </div>

    <!-- 筛选查询区 -->
    <div class="b-card">
      <div class="b-card-head">
        <span class="b-card-title">筛选查询</span>
      </div>
      <div class="b-form-grid md:grid-cols-2 xl:grid-cols-4">
        <div>
          <label class="b-label">批号 / 产品名 / 合格证号</label>
          <UInput v-model="filters.keyword" placeholder="批号 / 产品名 / 合格证号" icon="i-lucide-search" @keyup.enter="doSearch" />
        </div>
        <div>
          <label class="b-label">关联产品</label>
          <USelect
            v-model="filters.productId"
            :items="(productData?.rows || []).map((p: any) => ({ value: String(p.id), label: p.name }))"
            placeholder="全部产品"
            class="w-full"
            :content="{ class: 'min-w-72' }"
            :ui="{ itemLabel: { class: 'whitespace-normal break-words' } }"
          />
        </div>
      </div>
      <div class="b-card-foot">
        <span class="b-card-extra">共 <span class="font-medium b-strong">{{ data?.total || 0 }}</span> 条批次</span>
        <div class="flex items-center gap-2">
          <UButton color="neutral" variant="solid" :loading="pending" @click="doSearch">查询</UButton>
          <UButton variant="outline" color="neutral" @click="resetSearch">重置</UButton>
        </div>
      </div>
    </div>

    <!-- 批号列表 -->
    <div class="b-card b-card-clip">
      <div class="b-card-head">
        <span class="b-card-title">批号列表</span>
        <span class="b-card-extra">每页 {{ pageSize }} 条 · 共 {{ data?.total || 0 }} 条</span>
      </div>
      <div class="b-scroll-x">
        <table class="b-table">
          <thead>
            <tr>
              <th>生产批次号</th>
              <th>产品</th>
              <th>生产日期</th>
              <th>有效期至</th>
              <th>质量合格证号</th>
              <th>质检</th>
              <th>数量/码数</th>
              <th>状态</th>
              <th class="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in data?.rows || []" :key="r.id">
              <td class="b-strong font-medium">{{ r.batch_no }}</td>
              <td>{{ r.product_name || '-' }}</td>
              <td>{{ r.produce_date ? String(r.produce_date).slice(0, 10) : '-' }}</td>
              <!-- 有效期至：已过期标红、30 天内临期标黄（PRD 5.6 效期预警） -->
              <td>
                <template v-if="r.expire_date">
                  {{ String(r.expire_date).slice(0, 10) }}
                  <span v-if="expiryBadge(r.expire_date)" class="b-tag ml-1.5" :class="expiryBadge(r.expire_date)?.cls">{{ expiryBadge(r.expire_date)?.label }}</span>
                </template>
                <template v-else>-</template>
              </td>
              <td class="font-code">{{ r.quality_cert_no || '-' }}</td>
              <td>
                <span class="b-tag" :class="Number(r.qc_result) === 1 ? 'b-tag-success' : 'b-tag-danger'">
                  {{ Number(r.qc_result) === 1 ? '合格' : '不合格' }}
                </span>
              </td>
              <td>{{ r.quantity }} / {{ r.code_count }}</td>
              <td>
                <span class="b-tag" :class="STATUS_STYLE[r.batchStatus] || 'b-tag-default'">
                  {{ r.batchStatus }}
                </span>
              </td>
              <td>
                <div class="b-actions">
                  <UButton variant="link" color="neutral" size="xs" @click="openEdit(r)">编辑</UButton>
                  <span class="b-sep" />
                  <UButton variant="link" color="error" size="xs" @click="removeBatch(r)">删除</UButton>
                </div>
              </td>
            </tr>
            <tr v-if="!pending && !data?.rows?.length">
              <td colspan="9" class="b-empty">
                <div class="b-empty-inner">
                  <UIcon name="i-lucide-inbox" class="b-empty-icon h-8 w-8" />
                  <span class="text-sm">暂无数据，点击右上角「新建批号」创建</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <!-- 分页条 -->
      <div v-if="data?.total" class="b-pager">
        <span class="b-card-extra">共 {{ data?.total || 0 }} 条 · 第 {{ data.page }} / {{ totalPages }} 页</span>
        <div class="flex items-center gap-2">
          <UButton variant="outline" color="neutral" size="sm" :disabled="page <= 1" @click="page--; refresh()">上一页</UButton>
          <UButton variant="outline" color="neutral" size="sm" :disabled="page >= totalPages" @click="page++; refresh()">下一页</UButton>
        </div>
      </div>
    </div>

    <!-- 新建/编辑对话框（Nuxt UI v4：v-model:open 绑定 open 状态，内容必须放 #content 插槽） -->
    <UModal v-model:open="showModal">
      <template #content>
      <div class="b-modal">
        <!-- 弹窗头部：图标 + 标题 + 一句话说明 -->
        <div class="b-modal-head">
          <div class="b-modal-icon">
            <UIcon :name="editingId ? 'i-lucide-pencil' : 'i-lucide-plus'" class="h-4 w-4 text-[var(--b-text-regular)]" />
          </div>
          <div>
            <h3 class="b-modal-title">{{ editingId ? '编辑批次' : '新建批号' }}</h3>
            <p class="b-modal-sub">三要素（生产日期 / 批号 / 质量合格证号）齐全后，关联码自动置为"已绑定"</p>
          </div>
        </div>
        <div class="b-modal-body">
          <div>
            <label class="b-label-lg">关联产品 <span class="b-required">*</span></label>
            <USelect
              v-model="form.productId"
              :items="(productData?.rows || []).map((p: any) => ({ value: Number(p.id), label: p.name + '（' + (p.spec_name || '') + '）' }))"
              placeholder="从已启用产品中选择"
              class="w-full"
              :content="{ class: 'min-w-72' }"
              :ui="{ itemLabel: { class: 'whitespace-normal break-words' } }"
            />
          </div>
          <div>
            <label class="b-label-lg">生产批次号 <span class="b-required">*</span></label>
            <UInput v-model="form.batchNo" placeholder="与产品标签喷码一致" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="b-label-lg">生产日期 <span class="b-required">*</span></label>
              <UInput v-model="form.produceDate" type="date" @change="autoExpire" />
              <p class="b-help">请确认与产品标签喷码日期一致</p>
            </div>
            <div>
              <label class="b-label-lg">有效期至 <span class="b-required">*</span></label>
              <UInput v-model="form.expireDate" type="date" />
              <p class="b-help">选择日期后按产品保质期自动计算，可覆盖调整</p>
            </div>
          </div>
          <div>
            <label class="b-label-lg">质量合格证号 <span class="b-required">*</span></label>
            <UInput v-model="form.qualityCertNo" placeholder="该批次产品质量合格证编号" />
          </div>
          <div class="grid grid-cols-3 gap-3">
            <div>
              <label class="b-label-lg">质量检验结果 <span class="b-required">*</span></label>
              <USelect v-model="form.qcResult" :items="[{ value: 1, label: '合格' }, { value: 0, label: '不合格' }]" class="w-full" />
            </div>
            <div>
              <label class="b-label-lg">质检报告号</label>
              <UInput v-model="form.qcReportNo" placeholder="合格时建议填写" />
            </div>
            <div>
              <label class="b-label-lg">生产数量 <span class="b-required">*</span></label>
              <UInput v-model.number="form.quantity" type="number" placeholder="0" />
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
