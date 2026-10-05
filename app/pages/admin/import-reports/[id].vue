<script setup lang="ts">
import type { ImportReport } from '#shared/types/import-report'
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '导入结果报告' })
const route = useRoute()
const id = computed(() => String(route.params.id))
const page = ref(1)
watch(id, () => { page.value = 1 })
const { data: report, error, refresh } = await useFetch<ImportReport>(() => '/api/admin/import-reports/' + id.value)
const { data: details, error: detailError, refresh: refreshDetails } = await useFetch<any>(() => '/api/admin/import-reports/' + id.value + '/rejections', { query: computed(() => ({ page: page.value })) })
const downloading = ref(false)
const toast = useToast()
const download = async () => {
  downloading.value = true
  try {
    const response = await fetch('/api/admin/import-reports/' + id.value + '/download')
    if (!response.ok) throw new Error('失败明细下载失败，请重试')
    const url = URL.createObjectURL(await response.blob())
    const a = document.createElement('a')
    a.href = url; a.download = '导入失败明细-' + id.value + '.csv'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (error) { toast.add({ title: error instanceof Error ? error.message : '下载失败', color: 'error' }) }
  finally { downloading.value = false }
}
</script>
<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between"><h1 class="b-page-title">导入结果报告</h1><UButton to="/admin/import-reports" variant="outline">返回报告列表</UButton></div>
    <div v-if="error" class="b-card b-card-body">报告加载失败或无权访问。<UButton @click="refresh()">重试</UButton></div>
    <template v-else-if="report">
      <p class="b-page-desc">{{ report.enterpriseName }} · {{ report.operatorName }} · {{ report.createdAt }} · 报告版本 {{ report.version }}</p>
      <p class="b-help">报告保留当时的处理结果；码库显示当前数据，后续修正不会改变本报告。</p>
      <div v-if="report.state === 'pending'" class="b-card b-card-body">结果尚未提交，请稍后刷新；原提交页面可使用相同请求重试。<UButton @click="refresh()">刷新</UButton></div>
      <ImportResultCard v-else :result="report" />
      <div class="b-card">
        <div class="b-card-head"><span class="b-card-title">重复及校验拒绝明细</span><UButton v-if="details?.total" :loading="downloading" @click="download">下载全部失败明细</UButton></div>
        <p class="b-help px-4 py-2">行号对应原始文件；校验通过但因批次冲突等未写入的码见上方说明。过长的非法输入只保存前255个字符。</p>
        <div v-if="detailError" class="b-card-body">明细加载失败。<UButton @click="refreshDetails()">重试</UButton></div>
        <div v-else class="b-scroll-x"><table class="b-table"><thead><tr><th>原始行号</th><th>码值或输入片段</th><th>原因</th></tr></thead><tbody><tr v-for="row in details?.rows" :key="row.lineNumber"><td>{{ row.lineNumber }}</td><td class="font-code break-all">{{ row.code }}</td><td>{{ row.reason }}</td></tr><tr v-if="!details?.rows?.length"><td colspan="3" class="b-empty">没有重复或校验拒绝明细。</td></tr></tbody></table></div>
        <div class="b-pager"><span>共 {{ details?.total || 0 }} 条</span><div class="flex gap-2"><UButton :disabled="page <= 1" @click="page--">上一页</UButton><UButton :disabled="page * 20 >= (details?.total || 0)" @click="page++">下一页</UButton></div></div>
      </div>
    </template>
  </div>
</template>
