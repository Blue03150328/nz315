<script setup lang="ts">
// 生产采集：追溯码文件上传 → 校验 → 入库（可选绑定批次 → 三要素齐全置"已绑定"）
// Keep-Alive 页面缓存：左侧菜单切换后返回保留页面状态（表单/筛选/页码/预览）；刷新、退出登录自动清空；页内【重置】恢复初始
definePageMeta({ layout: 'admin', middleware: 'backend-guard', keepalive: true })
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

// 页内【重置】：清空码文本/解析结果/导入表单，恢复页面初始状态（Keep-Alive 缓存页互不影响）
const resetPage = () => {
  fileName.value = ''
  pasteText.value = ''
  parseResult.value = null
  Object.assign(importForm, { productId: null, batchId: 0 })
  toast.add({ title: '已重置，页面恢复初始状态', color: 'primary' })
}

const reasonChips = computed(() => {
  const rc = parseResult.value?.reasonCount || {}
  return Object.entries(rc).map(([label, count]) => ({ label, count }))
})
</script>

<template>
  <div class="space-y-4">
    <!-- 页面标题区 -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="b-page-title">生产采集</h1>
        <p class="b-page-desc">上传追溯码文件（TXT/CSV，每行一个 32 位码）→ 校验 → 入库/绑定批次</p>
      </div>
      <UButton variant="outline" color="neutral" icon="i-lucide-rotate-ccw" @click="resetPage">重置</UButton>
    </div>

    <!-- 第一步：上传码文件 -->
    <div class="b-card">
      <div class="b-card-head">
        <span class="b-card-title">1. 上传码文件</span>
        <span class="b-card-extra">支持 TXT / CSV，每行一个 32 位追溯码</span>
      </div>
      <div class="b-card-body space-y-3.5">
        <!-- 文件选择：隐藏的原生 input 由按钮触发 -->
        <div class="flex flex-wrap items-center gap-2">
          <input ref="fileInput" type="file" accept=".txt,.csv" class="hidden" @change="handleFile" />
          <UButton variant="outline" color="neutral" icon="i-lucide-folder-open" @click="fileInput?.click()">选择文件</UButton>
          <span v-if="fileName" class="b-card-extra">已选择：{{ fileName }}</span>
        </div>
        <!-- 码文本：可由文件读入，也可直接粘贴 -->
        <div>
          <label class="b-label">码文本</label>
          <UTextarea
            v-model="pasteText"
            :rows="8"
            placeholder="或在此粘贴码文本（每行一个 32 位追溯码）…"
            class="font-code w-full text-xs"
          />
          <p class="b-help">读取文件后内容会填入此处，可手动增删后再解析</p>
        </div>
        <!-- 校验规则说明 -->
        <div class="b-note">
          <UIcon name="i-lucide-info" class="mt-0.5 h-3.5 w-3.5 flex-none text-[var(--b-text-muted)]" />
          <p class="b-note-text">校验规则：32位数字 · 第1位登记类别(1/2) · 第8位生产类型(1-3) · 第9-11位规格码 · 第2-7位登记证匹配 · 系统查重</p>
        </div>
      </div>
      <div class="b-card-foot">
        <span class="b-card-extra">解析仅做格式与查重校验，不会写入数据库</span>
        <UButton color="neutral" variant="solid" :loading="parsing" @click="doParse">解析校验</UButton>
      </div>
    </div>

    <template v-if="parseResult">
      <!-- 第二步：校验结果统计指标卡 -->
      <div class="grid gap-4 sm:grid-cols-3">
        <div class="b-stat">
          <div class="b-stat-label">总码数</div>
          <div class="b-stat-value">{{ parseResult.total }}</div>
          <div class="b-stat-foot">本次解析读取的码总量</div>
        </div>
        <div class="b-stat">
          <div class="b-stat-label">校验通过</div>
          <div class="b-stat-value">{{ parseResult.validCount }}</div>
          <div class="b-stat-foot"><span class="b-tag b-tag-success">可导入 {{ parseResult.validCount }} 条</span></div>
        </div>
        <div class="b-stat">
          <div class="b-stat-label">校验失败</div>
          <div class="b-stat-value">{{ parseResult.invalidCount }}</div>
          <div class="b-stat-foot"><span class="b-tag b-tag-danger">需修正 {{ parseResult.invalidCount }} 条</span></div>
        </div>
      </div>

      <!-- 校验明细：失败原因分布 + 自动匹配产品 + 预览表格 -->
      <div class="b-card b-card-clip">
        <div class="b-card-head">
          <span class="b-card-title">2. 校验结果</span>
          <span class="b-card-extra">仅预览前 {{ parseResult.preview?.length || 0 }} 条明细</span>
        </div>
        <div v-if="reasonChips.length || parseResult.productGroups?.length" class="b-card-body space-y-3.5">
          <div v-if="reasonChips.length">
            <div class="b-label">失败原因分布</div>
            <div class="flex flex-wrap gap-2">
              <span v-for="c in reasonChips" :key="c.label" class="b-tag b-tag-danger">
                {{ c.label }} × {{ c.count }}
              </span>
            </div>
          </div>
          <div v-if="parseResult.productGroups?.length">
            <div class="b-label">自动匹配产品（按码第 2-7 位登记证号）</div>
            <div class="flex flex-wrap gap-2">
              <span v-for="g in parseResult.productGroups" :key="g.productId" class="b-tag b-tag-info">
                {{ g.productName }}（{{ g.count }} 条）
              </span>
            </div>
          </div>
        </div>
        <!-- 明细预览表格 -->
        <div v-if="parseResult.preview?.length" class="b-scroll-x">
          <table class="b-table">
            <thead>
              <tr>
                <th>追溯码</th>
                <th>状态</th>
                <th>原因 / 匹配</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in parseResult.preview" :key="i">
                <td><span class="font-code b-strong text-[13px]">{{ r.code }}</span></td>
                <td>
                  <span class="b-tag" :class="r.valid ? 'b-tag-success' : 'b-tag-danger'">
                    {{ r.valid ? '通过' : '失败' }}
                  </span>
                </td>
                <td>{{ r.valid ? '已匹配产品' : r.reason }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 第三步：确认入库 -->
      <div class="b-card">
        <div class="b-card-head">
          <span class="b-card-title">3. 确认入库</span>
          <span class="b-card-extra">绑定批次后三要素齐全，码状态自动流转为「已绑定」</span>
        </div>
        <div class="b-form-grid md:grid-cols-2">
          <div>
            <label class="b-label">关联产品 <span class="b-required">*</span></label>
            <USelect
              v-model="importForm.productId"
              :items="(productData?.rows || []).map((p: any) => ({ value: Number(p.id), label: p.name }))"
              placeholder="选择产品"
              class="w-full"
              :content="{ class: 'min-w-72' }"
              :ui="{ itemLabel: { class: 'whitespace-normal break-words' } }"
            />
            <p class="b-help">按码第 2-7 位登记证号自动匹配，可手动调整</p>
          </div>
          <div>
            <label class="b-label">绑定批次</label>
            <USelect
              v-model="importForm.batchId"
              :items="[{ value: 0, label: '不绑定（码状态：已生成）' }, ...(batchData?.rows || []).map((b: any) => ({ value: Number(b.id), label: b.batch_no + '（' + b.produce_date + '）' }))]"
              placeholder="选择批次"
              class="w-full"
              :content="{ class: 'min-w-72' }"
              :ui="{ itemLabel: { class: 'whitespace-normal break-words' } }"
            />
            <p class="b-help">可选；不绑定时码状态为「已生成」</p>
          </div>
        </div>
        <div class="b-card-foot">
          <span class="b-card-extra">本次将写入 <span class="b-strong font-medium">{{ parseResult.validCount }}</span> 条有效码，校验失败的码不会入库</span>
          <UButton color="neutral" variant="solid" :loading="importing" @click="doImport">
            导入 {{ parseResult.validCount }} 条有效码
          </UButton>
        </div>
      </div>
    </template>
  </div>
</template>
