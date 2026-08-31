<script setup lang="ts">
// 追溯码生成（PRD 5.5.1：Web 版离线生成工具——生成不入库，导出文件后经生产采集导入）
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '追溯码生成' })

const toast = useToast()
const { isPlatformAdmin } = useUser()

const { data: productData } = await useFetch<any>('/api/admin/products', {
  key: 'admin-products-gen',
  query: { page: 1, pageSize: 100, status: 1 },
})

const form = reactive({
  productId: null as number | null,
  quantity: 100,
  timestampType: 'ms',
  checksum: true,
})
const generating = ref(false)
const result = ref<any>(null)

const selectedProduct = computed(() => (productData.value?.rows || []).find((p: any) => Number(p.id) === Number(form.productId)))

const SEGMENT_COLORS = ['bg-error/15 text-error', 'bg-primary/15 text-primary', 'bg-warning/15 text-warning', 'bg-success/15 text-success', 'bg-sky/15 text-sky']

const doGenerate = async () => {
  if (!form.productId) { toast.add({ title: '请选择产品', color: 'warning' }); return }
  if (form.quantity < 1 || form.quantity > 10000) { toast.add({ title: '生成数量须为 1-10000', color: 'warning' }); return }
  generating.value = true
  try {
    result.value = await $fetch('/api/admin/codes/generate', { method: 'POST', body: { ...form } })
    toast.add({ title: '生成成功：' + result.value.quantity + ' 条' + (result.value.duplicates ? '（跳过重码 ' + result.value.duplicates + ' 条）' : ''), color: 'success' })
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '生成失败', color: 'error' })
  } finally {
    generating.value = false
  }
}

// 导出 TXT（每行一个码）
const exportTxt = () => {
  if (!result.value?.allCodes?.length) return
  const text = result.value.allCodes.join('\n')
  const blob = new Blob(['\uFEFF' + text], { type: 'text/plain;charset=utf-8' })
  download(blob, '追溯码_' + form.quantity + '条.txt')
}

// 导出 CSV（含分段列）
const exportCsv = () => {
  if (!result.value?.allCodes?.length) return
  const lines = ['追溯码,登记类别,登记证后6位,生产类型,规格码,自定义段']
  for (const code of result.value.allCodes) {
    lines.push([code, code.slice(0, 1), code.slice(1, 7), code.slice(7, 8), code.slice(8, 11), code.slice(11, 32)].join(','))
  }
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  download(blob, '追溯码_' + form.quantity + '条.csv')
}

const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="space-y-5">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold text-default">追溯码生成</h1>
        <p class="mt-1 text-sm text-muted">按 1049 号公告结构批量生成 32 位追溯码（生成不入库，导出后经生产采集导入）</p>
      </div>
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      <!-- 生成配置 -->
      <div class="rounded-xl border border-border bg-elevated p-5 shadow-sm">
        <h2 class="text-sm font-semibold text-default">生成配置</h2>
        <div class="mt-4 space-y-4">
          <div class="space-y-1.5">
            <label class="block text-sm font-medium text-default">产品（码第 1-11 位来源）<span class="text-error">*</span></label>
            <USelect
              v-model="form.productId"
              :options="(productData?.rows || []).map((p: any) => ({ value: Number(p.id), label: p.name + '（' + p.registration_no + '）' }))"
              placeholder="选择产品"
            />
            <p v-if="selectedProduct" class="text-xs text-muted">
              码结构：{{ selectedProduct.reg_category === 2 ? 'WP' : 'PD' }} + 登记证后6位({{ String(selectedProduct.registration_no).slice(-6) }}) + 生产类型({{ selectedProduct.produce_type }}) + 规格码({{ selectedProduct.spec_code || '未配置' }})
            </p>
          </div>
          <div class="space-y-1.5">
            <label class="block text-sm font-medium text-default">生成数量 <span class="text-error">*</span></label>
            <UInput v-model.number="form.quantity" type="number" min="1" max="10000" />
            <p class="text-xs text-muted">1-10000 条/次</p>
          </div>
          <div class="space-y-1.5">
            <label class="block text-sm font-medium text-default">时间戳段（自定义段第 12 位后）</label>
            <USelect v-model="form.timestampType" :options="[
              { value: 'ms', label: '毫秒级时间戳' },
              { value: 'sec', label: '秒级时间戳' },
              { value: 'ymd', label: '年月日（YYYYMMDD）' },
              { value: 'none', label: '不使用' },
            ]" />
          </div>
          <div class="flex items-center gap-2">
            <USwitch v-model="form.checksum" />
            <div>
              <div class="text-sm font-medium text-default">校验位（MD5 取后 2 位）</div>
              <div class="text-xs text-muted">生成时自动附加，扫码校验可防篡改码</div>
            </div>
          </div>
          <UButton color="primary" size="lg" block icon="i-lucide-wand-2" :loading="generating" @click="doGenerate">
            生成追溯码
          </UButton>
        </div>
      </div>

      <!-- 码示例预览 -->
      <div class="rounded-xl border border-border bg-elevated p-5 shadow-sm">
        <h2 class="text-sm font-semibold text-default">码结构预览</h2>
        <p class="mt-1 text-xs text-muted">第 1-11 位为 1049 号公告强制结构，第 12 位后为自定义段</p>
        <div v-if="result?.preview?.length" class="mt-4 space-y-3">
          <div v-for="(p, i) in result.preview" :key="i" class="rounded-lg border border-border/60 p-3">
            <div class="flex flex-wrap font-code text-xs">
              <span v-for="(s, si) in p.segments" :key="si" class="rounded px-1 py-0.5 mr-1" :class="SEGMENT_COLORS[si % 5]">
                {{ s.value }}
              </span>
            </div>
            <div class="mt-1.5 flex gap-2 text-[10px] text-muted">
              <span v-for="(s, si) in p.segments" :key="si" class="flex items-center gap-0.5">
                <span class="h-2 w-2 rounded-full" :class="SEGMENT_COLORS[si % 5]" />{{ s.label }}
              </span>
            </div>
          </div>
        </div>
        <div v-else class="mt-4 rounded-lg bg-muted/40 p-8 text-center text-sm text-muted">
          配置产品后点击「生成追溯码」预览码结构
        </div>
      </div>
    </div>

    <!-- 生成结果 -->
    <div v-if="result" class="rounded-xl border border-border bg-elevated p-5 shadow-sm">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-sm font-semibold text-default">生成结果</h2>
          <p class="mt-1 text-xs text-muted">
            {{ result.product.name }} · 共 {{ result.quantity }} 条
            <span v-if="result.duplicates">（自动跳过重码 {{ result.duplicates }} 条）</span> · 时间戳段：{{ result.timestampType }} · 校验位：{{ result.checksum ? '开启' : '关闭' }}
          </p>
        </div>
        <div class="flex gap-2">
          <UButton variant="outline" color="neutral" icon="i-lucide-file-text" @click="exportTxt">导出 TXT</UButton>
          <UButton color="primary" icon="i-lucide-file-spreadsheet" @click="exportCsv">导出 CSV</UButton>
        </div>
      </div>
      <div class="mt-4 max-h-72 overflow-y-auto rounded-lg border border-border/60">
        <table class="w-full text-left text-xs">
          <thead class="sticky top-0 bg-muted/60">
            <tr class="text-muted">
              <th class="px-3 py-2 font-medium">#</th>
              <th class="px-3 py-2 font-medium">追溯码（前 10 条示例）</th>
              <th class="px-3 py-2 font-medium">结构</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(p, i) in result.preview" :key="i" class="border-b border-border/40">
              <td class="px-3 py-2 text-muted">{{ i + 1 }}</td>
              <td class="px-3 py-2 font-code">{{ p.code }}</td>
              <td class="px-3 py-2 text-muted">
                {{ p.segments[0].value }} | {{ p.segments[1].value }} | {{ p.segments[2].value }} | {{ p.segments[3].value }} | {{ p.segments[4].value }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="mt-3 text-xs text-muted">生成的码未入库，导出文件后到「生产采集」上传导入即可正式启用</p>
    </div>
  </div>
</template>
