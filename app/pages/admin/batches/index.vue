<script setup lang="ts">
// 生产批次管理（PRD 5.6：三要素 → 码状态"已绑定"）
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
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
  '待上传': 'bg-muted text-muted',
  '已上传': 'bg-sky/10 text-sky',
  '部分上传': 'bg-warning/10 text-warning',
  '已完成': 'bg-success/10 text-success',
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
  <div class="space-y-5">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold text-default">生产批次管理</h1>
        <p class="mt-1 text-sm text-muted">批号三要素（生产日期/批号/质量合格证号）齐全后，关联码自动置为"已绑定"</p>
      </div>
      <UButton color="primary" icon="i-lucide-plus" @click="openCreate">新建批号</UButton>
    </div>

    <!-- 筛选 -->
    <div class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
      <div class="grid gap-3 md:grid-cols-3">
        <UInput v-model="filters.keyword" placeholder="批号 / 产品名 / 合格证号" icon="i-lucide-search" @keyup.enter="doSearch" />
        <USelect
          v-model="filters.productId"
          :items="(productData?.rows || []).map((p: any) => ({ value: String(p.id), label: p.name }))"
          placeholder="全部产品"
          class="w-full"
          :content="{ class: 'min-w-72' }"
          :ui="{ itemLabel: { class: 'whitespace-normal break-words' } }"
        />
      </div>
      <div class="mt-3 flex gap-2">
        <UButton color="primary" icon="i-lucide-search" :loading="pending" @click="doSearch">查询</UButton>
        <UButton variant="outline" color="neutral" icon="i-lucide-rotate-ccw" @click="resetSearch">重置</UButton>
      </div>
    </div>

    <!-- 列表 -->
    <div class="overflow-hidden rounded-xl border border-border bg-elevated shadow-sm">
      <div class="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <span class="text-sm font-semibold text-default">批号列表</span>
        <span class="text-xs text-muted">共 {{ data?.total || 0 }} 条</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-border/60 bg-muted/30 text-xs text-muted">
              <th class="px-4 py-3 font-medium">生产批次号</th>
              <th class="px-4 py-3 font-medium">产品</th>
              <th class="px-4 py-3 font-medium">生产日期</th>
              <th class="px-4 py-3 font-medium">有效期至</th>
              <th class="px-4 py-3 font-medium">质量合格证号</th>
              <th class="px-4 py-3 font-medium">质检</th>
              <th class="px-4 py-3 font-medium">数量/码数</th>
              <th class="px-4 py-3 font-medium">状态</th>
              <th class="px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in data?.rows || []" :key="r.id" class="border-b border-border/40 transition-colors hover:bg-muted/30">
              <td class="px-4 py-3 font-medium text-default">{{ r.batch_no }}</td>
              <td class="px-4 py-3 text-muted">{{ r.product_name || '-' }}</td>
              <td class="px-4 py-3 text-muted">{{ r.produce_date ? String(r.produce_date).slice(0, 10) : '-' }}</td>
              <td class="px-4 py-3 text-muted">{{ r.expire_date ? String(r.expire_date).slice(0, 10) : '-' }}</td>
              <td class="px-4 py-3 font-code text-muted">{{ r.quality_cert_no || '-' }}</td>
              <td class="px-4 py-3">
                <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="Number(r.qc_result) === 1 ? 'bg-success/10 text-success' : 'bg-error/10 text-error'">
                  {{ Number(r.qc_result) === 1 ? '合格' : '不合格' }}
                </span>
              </td>
              <td class="px-4 py-3 text-muted">{{ r.quantity }} / {{ r.code_count }}</td>
              <td class="px-4 py-3">
                <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="STATUS_STYLE[r.batchStatus] || 'bg-muted text-muted'">
                  {{ r.batchStatus }}
                </span>
              </td>
              <td class="px-4 py-3">
                <div class="flex gap-1.5">
                  <UButton variant="ghost" color="neutral" size="xs" icon="i-lucide-pencil" @click="openEdit(r)">编辑</UButton>
                  <UButton variant="ghost" color="error" size="xs" icon="i-lucide-trash-2" @click="removeBatch(r)">删除</UButton>
                </div>
              </td>
            </tr>
            <tr v-if="!pending && !data?.rows?.length">
              <td colspan="9" class="px-4 py-10 text-center text-sm text-muted">暂无数据，点击右上角「新建批号」创建</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="data?.total" class="flex items-center justify-between border-t border-border/60 px-4 py-3">
        <span class="text-xs text-muted">第 {{ data.page }} / {{ totalPages }} 页</span>
        <div class="flex gap-2">
          <UButton variant="outline" color="neutral" size="sm" :disabled="page <= 1" @click="page--; refresh()">上一页</UButton>
          <UButton variant="outline" color="neutral" size="sm" :disabled="page >= totalPages" @click="page++; refresh()">下一页</UButton>
        </div>
      </div>
    </div>

    <!-- 新建/编辑对话框（Nuxt UI v4：v-model:open 绑定 open 状态，内容必须放 #content 插槽） -->
    <UModal v-model:open="showModal">
      <template #content>
      <div class="max-h-[80vh] overflow-y-auto p-5">
        <h3 class="text-base font-semibold text-default">{{ editingId ? '编辑批次' : '新建批号' }}</h3>
        <div class="mt-4 space-y-4">
          <div class="space-y-1.5">
            <label class="block text-sm font-medium text-default">关联产品 <span class="text-error">*</span></label>
            <USelect
              v-model="form.productId"
              :items="(productData?.rows || []).map((p: any) => ({ value: Number(p.id), label: p.name + '（' + (p.spec_name || '') + '）' }))"
              placeholder="从已启用产品中选择"
              class="w-full"
              :content="{ class: 'min-w-72' }"
              :ui="{ itemLabel: { class: 'whitespace-normal break-words' } }"
            />
          </div>
          <div class="space-y-1.5">
            <label class="block text-sm font-medium text-default">生产批次号 <span class="text-error">*</span></label>
            <UInput v-model="form.batchNo" placeholder="与产品标签喷码一致" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <label class="block text-sm font-medium text-default">生产日期 <span class="text-error">*</span></label>
              <UInput v-model="form.produceDate" type="date" @change="autoExpire" />
              <p class="text-xs text-warning">请确认与产品标签喷码日期一致</p>
            </div>
            <div class="space-y-1.5">
              <label class="block text-sm font-medium text-default">有效期至 <span class="text-error">*</span></label>
              <UInput v-model="form.expireDate" type="date" />
              <p class="text-xs text-muted">选择日期后按产品保质期自动计算，可覆盖调整</p>
            </div>
          </div>
          <div class="space-y-1.5">
            <label class="block text-sm font-medium text-default">质量合格证号 <span class="text-error">*</span></label>
            <UInput v-model="form.qualityCertNo" placeholder="该批次产品质量合格证编号" />
          </div>
          <div class="grid grid-cols-3 gap-3">
            <div class="space-y-1.5">
              <label class="block text-sm font-medium text-default">质量检验结果 <span class="text-error">*</span></label>
              <USelect v-model="form.qcResult" :items="[{ value: 1, label: '合格' }, { value: 0, label: '不合格' }]" />
            </div>
            <div class="space-y-1.5">
              <label class="block text-sm font-medium text-default">质检报告号</label>
              <UInput v-model="form.qcReportNo" placeholder="合格时建议填写" />
            </div>
            <div class="space-y-1.5">
              <label class="block text-sm font-medium text-default">生产数量 <span class="text-error">*</span></label>
              <UInput v-model.number="form.quantity" type="number" placeholder="0" />
            </div>
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <UButton variant="outline" color="neutral" @click="showModal = false">取消</UButton>
          <UButton color="primary" :loading="saving" @click="save">保存</UButton>
        </div>
      </div>
      </template>
    </UModal>
  </div>
</template>
