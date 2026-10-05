<script setup lang="ts">
import type { CodeImportForm } from '#shared/types/code-import'
// 生产采集：追溯码文件上传 → 校验 → 填写批次三要素入库（服务端自动创建/匹配批次 → 码置"已绑定"）
// 2026-09-04 流程改造（用户决策 B）：批次三要素为必填，批次自动建档，生产批次页不再承担新建入口
// Keep-Alive 页面缓存：左侧菜单切换后返回保留页面状态（表单/筛选/页码/预览）；刷新、退出登录自动清空；页内【重置】恢复初始
// 只读账号（viewer）在模板中隐藏全部写操作入口
const { canWrite } = useUser()

definePageMeta({ layout: 'admin', middleware: 'backend-guard', keepalive: true })
useHead({ title: '生产采集' })

const toast = useToast()
const fileName = ref('')
const pasteText = ref('')
const { parsing, importing, parseResult, lastResult, parse, submit, reset } = useCodeImport()

// 导入表单：批次三要素（生产日期/批号/质量合格证号）必填，导入时服务端自动创建或匹配批次
const createImportForm = (): CodeImportForm => ({
  productId: null,
  batchNo: '',          // 生产批次号（与标签喷码一致）
  produceDate: '',      // 生产日期
  qualityCertNo: '',    // 质量合格证号
  qcReportNo: '',       // 质检报告号（选填）
  expireDate: '',       // 有效期至（选填，留空可在生产批次页补填）
})
const importForm = ref(createImportForm())

const { data: productData } = await useFetch<any>('/api/admin/products', {
  key: 'admin-products-coll',
  query: { page: 1, pageSize: 100, status: 1 },
})

// 解析后按产品自动选中匹配数最多的
const autoSelectProduct = () => {
  const groups = parseResult.value?.productGroups || []
  if (groups.length) {
    importForm.value.productId = Number(groups[0].productId)
  }
}

// 更换关联产品后按同一规则重验原文件，预览数量与实际提交保持一致。
watch(() => importForm.value.productId, async (productId) => {
  if (!productId || !parseResult.value) return
  try { await parse(pasteText.value, fileName.value, productId) }
  catch (e: any) { reset(); toast.add({ title: e?.data?.statusMessage || '重新校验失败，请重新解析', color: 'error' }) }
})

const handleFile = async (ev: Event) => {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  fileName.value = file.name
  pasteText.value = await file.text()
  input.value = ''
  toast.add({ title: '已读取 ' + file.name + '（' + file.size + ' 字节），点击「解析校验」', color: 'primary' })
}

const doParse = async () => {
  const content = pasteText.value.trim()
  if (!content) { toast.add({ title: '请先上传码文件或粘贴码文本', color: 'warning' }); return }
  try {
    await parse(pasteText.value, fileName.value)
    // 解析新文件后清空上一轮批次三要素，避免误带入新批次
    importForm.value = createImportForm()
    autoSelectProduct()
    toast.add({ title: '解析完成：有效 ' + parseResult.value.validCount + ' / 无效 ' + parseResult.value.invalidCount, color: 'success' })
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '解析失败', color: 'error' })
  }
}

const doImport = async () => {
  if (importing.value || parsing.value || !parseResult.value) return
  if (!parseResult.value.validCount) { toast.add({ title: '没有可入库的有效码，请检查校验结果', color: 'warning' }); return }
  if (!importForm.value.productId) { toast.add({ title: '请选择关联产品', color: 'warning' }); return }
  if (!importForm.value.batchNo.trim()) { toast.add({ title: '请输入生产批次号（与标签喷码一致）', color: 'warning' }); return }
  if (!importForm.value.produceDate) { toast.add({ title: '请选择生产日期（与标签喷码一致）', color: 'warning' }); return }
  if (!importForm.value.qualityCertNo.trim()) { toast.add({ title: '请输入质量合格证号', color: 'warning' }); return }
  try {
    const res = await submit({ content: pasteText.value, productId: importForm.value.productId,
      batchNo: importForm.value.batchNo.trim(), produceDate: importForm.value.produceDate,
      qualityCertNo: importForm.value.qualityCertNo.trim(), qcReportNo: importForm.value.qcReportNo.trim() || undefined,
      expireDate: importForm.value.expireDate || undefined, fileName: fileName.value || undefined })
    if (!res) return
    if (!res.ok) { toast.add({ title: res.error || '导入未完成，请核对本次结果', color: 'error' }); return }
    toast.add({ title: '实际入库 ' + res.imported + ' 条，重复 ' + res.skippedDup + ' 条，校验拒绝 ' + res.skippedInvalid + ' 条', color: res.skippedDup + res.skippedInvalid ? 'warning' : 'success' })
    reset()
    pasteText.value = ''; fileName.value = ''
    importForm.value = createImportForm()
  } catch (e: any) { toast.add({ title: e?.data?.statusMessage || '导入请求未完成，可使用相同内容重试', color: 'error' }) }
}

// 页内【重置】：清空码文本/解析结果/导入表单，恢复页面初始状态（Keep-Alive 缓存页互不影响）
const resetPage = () => {
  fileName.value = ''
  pasteText.value = ''
  reset()
  importForm.value = createImportForm()
  toast.add({ title: '已重置，页面恢复初始状态', color: 'primary' })
}

</script>

<template>
  <div class="space-y-4">
    <ImportResultCard v-if="lastResult" :result="lastResult" />
    <!-- 页面标题区 -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="b-page-title">生产采集</h1>
        <p class="b-page-desc">上传码文件或扫码链接清单（TXT/CSV）→ 校验 → 填写批次三要素导入（自动建档/匹配，码置「已绑定」）</p>
      </div>
      <UButton variant="outline" color="neutral" icon="i-lucide-rotate-ccw" @click="resetPage">重置</UButton>
    </div>

    <CodeImportInput v-model="pasteText" :file-name="fileName" :parsing="parsing" :can-write="canWrite" @file="handleFile" @parse="doParse" />
    <template v-if="parseResult">
      <CodeImportPreview :result="parseResult" />
      <CodeImportBatchForm v-model="importForm" :products="productData?.rows || []" :valid-count="parseResult.validCount" :importing="importing" :parsing="parsing" :can-write="canWrite" @submit="doImport" />
    </template>
  </div>
</template>
