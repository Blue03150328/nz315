<script setup lang="ts">
// 生产采集：追溯码文件上传 → 校验 → 入库（可选绑定批次 → 三要素齐全置"已绑定"）
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '生产采集' })

const toast = useToast()
const fileInput = ref<HTMLInputElement | null>(null)
const fileName = ref('')
const pasteText = ref('')
const parsing = ref(false)

// 解析结果
const parseResult = ref<any>(null)
const importing = ref(false)

// 导入表单
// 导入表单：batchId=0 为「不绑定批次」哨兵值（reka-ui 禁止空字符串 value，0 在提交时转 undefined）
const importForm = reactive({ productId: null as number | null, batchId: 0 as number })

const { data: productData } = await useFetch<any>('/api/admin/products', {
  key: 'admin-products-coll',
  query: { page: 1, pageSize: 100, status: 1 },
})
const { data: batchData } = await useFetch<any>('/api/admin/batches', {
  key: 'admin-batches-coll',
  query: computed(() => ({ productId: importForm.productId || undefined, page: 1, pageSize: 100 })),
})

// 解析后按产品自动选中匹配数最多的
const autoSelectProduct = () => {
  const groups = parseResult.value?.productGroups || []
  if (groups.length) {
    importForm.productId = Number(groups[0].productId)
  }
}

const readFileContent = async (file: File): Promise<string> => {
  // 支持 UTF-8/GBK 常见编码：先试 UTF-8，乱码则用 TextDecoder gbk（浏览器支持有限，先按 UTF-8）
  return await file.text()
}

const handleFile = async (ev: Event) => {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  fileName.value = file.name
  pasteText.value = await readFileContent(file)
  input.value = ''
  toast.add({ title: '已读取 ' + file.name + '（' + file.size + ' 字节），点击「解析校验」', color: 'primary' })
}

const doParse = async () => {
  const content = pasteText.value.trim()
  if (!content) { toast.add({ title: '请先上传码文件或粘贴码文本', color: 'warning' }); return }
  parsing.value = true
  try {
    parseResult.value = await $fetch('/api/admin/codes/parse', {
      method: 'POST',
      body: { content, fileName: fileName.value },
    })
    importForm.productId = null
    importForm.batchId = 0
    autoSelectProduct()
    toast.add({ title: '解析完成：有效 ' + parseResult.value.validCount + ' / 无效 ' + parseResult.value.invalidCount, color: 'success' })
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '解析失败', color: 'error' })
  } finally {
    parsing.value = false
  }
}

const doImport = async () => {
  if (!parseResult.value || parseResult.value.validCount === 0) {
    toast.add({ title: '没有可导入的有效码', color: 'warning' }); return
  }
  if (!importForm.productId) { toast.add({ title: '请选择关联产品', color: 'warning' }); return }
  const validCodes = (parseResult.value.results || []).filter((r: any) => r.valid).map((r: any) => r.code)
  importing.value = true
  try {
    const res = await $fetch('/api/admin/codes/import', {
      method: 'POST',
      body: { codes: validCodes, productId: importForm.productId, batchId: importForm.batchId || undefined },
    })
    toast.add({ title: '导入成功 ' + res.imported + ' 条（状态：' + res.status + '）', color: 'success' })
    parseResult.value = null
    pasteText.value = ''
    fileName.value = ''
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '导入失败', color: 'error' })
  } finally {
    importing.value = false
  }
}

const reasonChips = computed(() => {
  const rc = parseResult.value?.reasonCount || {}
  return Object.entries(rc).map(([label, count]) => ({ label, count }))
})
</script>

<template>
  <div class="space-y-5">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold text-default">生产采集</h1>
        <p class="mt-1 text-sm text-muted">上传追溯码文件（TXT/CSV，每行一个 32 位码）→ 校验 → 入库/绑定批次</p>
      </div>
    </div>

    <!-- 上传区 -->
    <div class="rounded-xl border border-border bg-elevated p-5 shadow-sm">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold text-default">1. 上传码文件</h2>
        <div class="flex gap-2">
          <input ref="fileInput" type="file" accept=".txt,.csv" class="hidden" @change="handleFile" />
          <UButton variant="outline" color="neutral" icon="i-lucide-folder-open" @click="fileInput?.click()">选择文件</UButton>
        </div>
      </div>
      <p v-if="fileName" class="mt-2 text-xs text-muted">已选择：{{ fileName }}</p>
      <div class="mt-3">
        <UTextarea
          v-model="pasteText"
          :rows="8"
          placeholder="或在此粘贴码文本（每行一个 32 位追溯码）…"
          class="font-code text-xs"
        />
      </div>
      <div class="mt-3 flex items-center gap-2">
        <UButton color="primary" icon="i-lucide-scan-search" :loading="parsing" @click="doParse">
          解析校验
        </UButton>
        <span class="text-xs text-muted">校验规则：32位数字 · 第1位登记类别(1/2) · 第8位生产类型(1-3) · 第9-11位规格码 · 第2-7位登记证匹配 · 系统查重</span>
      </div>
    </div>

    <!-- 解析结果 -->
    <div v-if="parseResult" class="rounded-xl border border-border bg-elevated p-5 shadow-sm">
      <h2 class="text-sm font-semibold text-default">2. 校验结果</h2>
      <div class="mt-4 grid grid-cols-3 gap-3">
        <div class="rounded-lg border border-border/60 p-3 text-center">
          <div class="text-2xl font-bold text-default">{{ parseResult.total }}</div>
          <div class="mt-1 text-xs text-muted">总码数</div>
        </div>
        <div class="rounded-lg border border-success/30 bg-success/5 p-3 text-center">
          <div class="text-2xl font-bold text-success">{{ parseResult.validCount }}</div>
          <div class="mt-1 text-xs text-muted">校验通过</div>
        </div>
        <div class="rounded-lg border border-error/30 bg-error/5 p-3 text-center">
          <div class="text-2xl font-bold text-error">{{ parseResult.invalidCount }}</div>
          <div class="mt-1 text-xs text-muted">校验失败</div>
        </div>
      </div>

      <div v-if="reasonChips.length" class="mt-4 flex flex-wrap gap-2">
        <span v-for="c in reasonChips" :key="c.label" class="rounded-full bg-error/10 px-3 py-1 text-xs text-error">
          {{ c.label }} × {{ c.count }}
        </span>
      </div>

      <div v-if="parseResult.productGroups?.length" class="mt-3 rounded-lg bg-primary/5 p-3 text-xs text-primary">
        自动匹配产品：
        <span v-for="g in parseResult.productGroups" :key="g.productId" class="mr-3">{{ g.productName }}（{{ g.count }} 条）</span>
      </div>

      <!-- 预览 -->
      <div v-if="parseResult.preview?.length" class="mt-4 overflow-x-auto rounded-lg border border-border/60">
        <table class="w-full text-left text-xs">
          <thead>
            <tr class="border-b border-border/60 bg-muted/30 text-muted">
              <th class="px-3 py-2 font-medium">追溯码</th>
              <th class="px-3 py-2 font-medium">状态</th>
              <th class="px-3 py-2 font-medium">原因/匹配</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in parseResult.preview" :key="i" class="border-b border-border/40">
              <td class="px-3 py-2 font-code">{{ r.code }}</td>
              <td class="px-3 py-2">
                <span class="rounded-full px-2 py-0.5 font-medium" :class="r.valid ? 'bg-success/10 text-success' : 'bg-error/10 text-error'">
                  {{ r.valid ? '通过' : '失败' }}
                </span>
              </td>
              <td class="px-3 py-2 text-muted">{{ r.valid ? '已匹配产品' : r.reason }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 导入 -->
      <div class="mt-5 rounded-lg border border-border/60 bg-muted/20 p-4">
        <div class="text-sm font-medium text-default">3. 确认入库</div>
        <div class="mt-3 grid gap-3 md:grid-cols-2">
          <div class="space-y-1.5">
            <label class="block text-sm text-muted">关联产品（按码第2-7位自动匹配，可调整）</label>
            <USelect
              v-model="importForm.productId"
              :items="(productData?.rows || []).map((p: any) => ({ value: Number(p.id), label: p.name }))"
              placeholder="选择产品"
              class="w-full"
              :content="{ class: 'min-w-72' }"
              :ui="{ itemLabel: { class: 'whitespace-normal break-words' } }"
            />
          </div>
          <div class="space-y-1.5">
            <label class="block text-sm text-muted">绑定批次（可选；绑定后三要素齐全 → 码状态"已绑定"）</label>
            <USelect
              v-model="importForm.batchId"
              :items="[{ value: 0, label: '不绑定（码状态：已生成）' }, ...(batchData?.rows || []).map((b: any) => ({ value: Number(b.id), label: b.batch_no + '（' + b.produce_date + '）' }))]"
              placeholder="选择批次"
              class="w-full"
              :content="{ class: 'min-w-72' }"
              :ui="{ itemLabel: { class: 'whitespace-normal break-words' } }"
            />
          </div>
        </div>
        <div class="mt-4 flex gap-2">
          <UButton color="primary" icon="i-lucide-download" :loading="importing" @click="doImport">
            导入 {{ parseResult.validCount }} 条有效码
          </UButton>
        </div>
      </div>
    </div>
  </div>
</template>
