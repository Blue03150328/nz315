<script setup lang="ts">
// 追溯码生成（PRD 5.5.1：离线生成工具 Web 版——生成不入库，导出文件后经生产采集导入）
// 自定义段配置对齐 PRD 3.2：时间戳段 + 随机数字段 + 校验位段；导出命名对齐 PRD 5.5.1 强制命名规范
// 二维码图片输出对齐合规第一条（QR/DM 码制，供印刷厂赋码）
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '追溯码生成' })

const toast = useToast()
const runtime = useRuntimeConfig()
const traceBaseUrl = runtime.public?.traceBaseUrl || 'https://www.nz315.cn/trace?code='

const { data: productData } = await useFetch<any>('/api/admin/products', {
  key: 'admin-products-gen',
  query: { page: 1, pageSize: 100, status: 1 },
})

const form = reactive({
  productId: null as number | null,
  quantity: 100,
  timestampType: 'ms',   // 时间戳段（PRD 3.2）
  randomType: 'none',    // 随机数字段
  checksumType: 'md5',   // 校验位段
})
const generating = ref(false)
const result = ref<any>(null)

const selectedProduct = computed(() => (productData.value?.rows || []).find((p: any) => Number(p.id) === Number(form.productId)))

// 码第 1-11 位实时预览（1049 强制结构）
const headPreview = computed(() => {
  const p = selectedProduct.value
  if (!p) return null
  const cat = Number(p.reg_category) === 2 ? '2' : '1'
  const regLast6 = String(p.registration_no || '').replace(/\D/g, '').slice(-6).padStart(6, '0')
  return {
    cat, regLast6, produceType: String(p.produce_type || '1'), specCode: String(p.spec_code || ''),
    head: cat + regLast6 + String(p.produce_type || '1') + String(p.spec_code || ''),
  }
})

const SEGMENT_COLORS = ['bg-error/15 text-error', 'bg-primary/15 text-primary', 'bg-warning/15 text-warning', 'bg-success/15 text-success', 'bg-sky/15 text-sky']

const doGenerate = async () => {
  if (!form.productId) { toast.add({ title: '请选择产品', color: 'warning' }); return }
  if (form.quantity < 1 || form.quantity > 10000) { toast.add({ title: '生成数量须为 1-10000', color: 'warning' }); return }
  qrResult.value = null // 新一批码，清空图片输出结果
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

// ========== 导出（PRD 5.5.1 P1：强制命名"企业ID_产品名_规格_日期"） ==========
// 默认文件前缀：企业ID_产品名_规格_YYYYMMDD
const defaultFilePrefix = () => {
  const p = result.value?.product
  if (!p) return '追溯码'
  const date = new Date()
  const d = String(date.getFullYear()) + String(date.getMonth() + 1).padStart(2, '0') + String(date.getDate()).padStart(2, '0')
  const safeName = String(p.name || '').replace(/[\\/:*?"<>|]/g, '_')
  const safeSpec = String(p.specName || '').replace(/[\\/:*?"<>|]/g, '_')
  return p.enterpriseId + '_' + safeName + '_' + safeSpec + '_' + d
}
// urls.txt 前缀（与离线工具一致：登记证号_产品名_数量_日期）
const urlFilePrefix = () => {
  const p = result.value?.product
  if (!p) return 'trace'
  const date = new Date()
  const d = String(date.getFullYear()) + String(date.getMonth() + 1).padStart(2, '0') + String(date.getDate()).padStart(2, '0')
  const safeName = String(p.name || '').replace(/[\\/:*?"<>|]/g, '_')
  return p.registrationNo + '_' + safeName + '_' + (result.value.quantity || 0) + '_' + d
}

const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

// 导出 TXT：每行一个 32 位码（PRD 5.5.1 文件命名规范）
const exportTxt = () => {
  if (!result.value?.allCodes?.length) return
  const text = result.value.allCodes.join('\n')
  const blob = new Blob(['\uFEFF' + text], { type: 'text/plain;charset=utf-8' })
  download(blob, defaultFilePrefix() + '.txt')
}

// 导出 urls.txt：每行完整扫码 URL（二维码内容，PRD 3.3：https://{域名}/trace?code={码}）
const exportUrls = () => {
  if (!result.value?.allCodes?.length) return
  const text = result.value.allCodes.map((c: string) => traceBaseUrl + c).join('\n')
  const blob = new Blob(['\uFEFF' + text], { type: 'text/plain;charset=utf-8' })
  download(blob, urlFilePrefix() + '_urls.txt')
}

// 导出 CSV：sn 清单（对齐离线工具：sn,农药名称,登记证号,生产企业,生产类型,规格码,生成时间,绑定状态）+ 分段列
const exportCsv = () => {
  if (!result.value?.allCodes?.length) return
  const p = result.value.product
  const genTime = new Date().toLocaleString('zh-CN', { hour12: false })
  const produceTypeMap: Record<string, string> = { '1': '持有人生产', '2': '委托加工', '3': '委托分装' }
  const lines = ['sn,农药名称,登记证号,生产企业,生产类型,规格码,生成时间,绑定状态,登记类别,登记证后6位,自定义段']
  for (const code of result.value.allCodes) {
    const seg = [code.slice(0, 1), code.slice(1, 7), code.slice(7, 8), code.slice(8, 11), code.slice(11, 32)]
    lines.push([
      code,
      '"' + String(p.name || '') + '"',
      '"' + String(p.registrationNo || '') + '"',
      '"' + (result.value.companyName || '') + '"',
      '"' + (produceTypeMap[seg[2]] || seg[2]) + '"',
      '"' + String(p.specCode || '') + '"',
      '"' + genTime + '"',
      '未绑定',
      seg[0], seg[1], seg[4],
    ].join(','))
  }
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  download(blob, defaultFilePrefix() + '.csv')
}

// ========== 二维码图片输出（合规第一条：QR/DM 码制，供印刷厂赋码） ==========
const imgForm = reactive({
  codeType: 'QR' as 'QR' | 'DM',
  moduleSize: 4,
  quietZone: 2,
  count: null as number | null, // 留空 = 全部
  prefix: '',
  startIndex: 1,
})
const imgGenerating = ref(false)
const imgResult = ref<any>(null)

const doGenImages = async () => {
  if (!result.value?.allCodes?.length) { toast.add({ title: '请先生成追溯码', color: 'warning' }); return }
  imgGenerating.value = true
  imgResult.value = null
  try {
    imgResult.value = await $fetch('/api/admin/codes/qrcode', {
      method: 'POST',
      body: {
        codes: result.value.allCodes,
        type: imgForm.codeType,
        moduleSize: imgForm.moduleSize,
        quietZone: imgForm.quietZone,
        count: imgForm.count,
        prefix: imgForm.prefix || urlFilePrefix(),
        startIndex: imgForm.startIndex,
      },
    })
    toast.add({ title: '图片生成完成：' + imgResult.value.done + ' 张' + (imgResult.value.failed ? '（失败 ' + imgResult.value.failed + ' 张）' : ''), color: 'success' })
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '图片生成失败', color: 'error' })
  } finally {
    imgGenerating.value = false
  }
}

const downloadZip = () => {
  if (!imgResult.value?.token) return
  const a = document.createElement('a')
  a.href = '/api/admin/codes/qrcode-download?token=' + encodeURIComponent(imgResult.value.token)
  a.download = 'trace-qrcodes.zip'
  a.click()
}
</script>
<template>
  <div class="space-y-5">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold text-default">追溯码生成</h1>
        <p class="mt-1 text-sm text-muted">按 1049 号公告结构批量生成 32 位追溯码（生成不入库，导出后经生产采集导入；二维码图片供印刷厂赋码）</p>
      </div>
    </div>

    <div class="grid gap-6 xl:grid-cols-2">
      <!-- 生成配置 -->
      <div class="rounded-xl border border-border bg-elevated p-5 shadow-sm">
        <h2 class="text-sm font-semibold text-default">生成配置</h2>
        <div class="mt-4 space-y-4">
          <div class="space-y-1.5">
            <label class="block text-sm font-medium text-default">产品（码第 1-11 位来源）<span class="text-error">*</span></label>
            <USelect
              v-model="form.productId"
              :items="(productData?.rows || []).map((p: any) => ({ value: Number(p.id), label: p.name + '（' + p.registration_no + '）' }))"
              placeholder="选择产品"
            />
            <div v-if="headPreview" class="flex flex-wrap items-center gap-1 rounded-lg bg-muted/40 px-3 py-2 font-code text-xs">
              <span class="rounded bg-error/15 px-1 py-0.5 text-error">{{ headPreview.cat }}</span>
              <span class="text-muted">+</span>
              <span class="rounded bg-primary/15 px-1 py-0.5 text-primary">{{ headPreview.regLast6 }}</span>
              <span class="text-muted">+</span>
              <span class="rounded bg-warning/15 px-1 py-0.5 text-warning">{{ headPreview.produceType }}</span>
              <span class="text-muted">+</span>
              <span class="rounded bg-success/15 px-1 py-0.5 text-success">{{ headPreview.specCode }}</span>
              <span class="ml-2 text-muted">= 11 位强制结构</span>
            </div>
            <p v-else class="text-xs text-muted">选择产品后自动带出码结构（登记类别 | 登记证后6位 | 生产类型 | 规格码）</p>
          </div>

          <div class="space-y-1.5">
            <label class="block text-sm font-medium text-default">生成数量 <span class="text-error">*</span></label>
            <UInput v-model.number="form.quantity" type="number" min="1" max="10000" />
            <p class="text-xs text-muted">1-10000 条/次</p>
          </div>

          <!-- 自定义段配置（PRD 3.2） -->
          <div class="rounded-lg border border-border/60 p-3">
            <div class="mb-3 flex items-center justify-between">
              <span class="text-xs font-semibold text-default">自定义段配置（码第 12 位后，共 21 位）</span>
              <span class="text-[10px] text-muted">第 1-11 位为 1049 公告强制结构，不可配置</span>
            </div>
            <div class="space-y-3">
              <div class="grid gap-3 sm:grid-cols-3">
                <div class="space-y-1">
                  <label class="block text-xs font-medium text-muted">时间戳段</label>
                  <USelect v-model="form.timestampType" size="sm" :items="[
                    { value: 'ms', label: '毫秒级' },
                    { value: 'sec', label: '秒级' },
                    { value: 'ymd', label: '年月日' },
                    { value: 'none', label: '不使用' },
                  ]" />
                </div>
                <div class="space-y-1">
                  <label class="block text-xs font-medium text-muted">随机数字段</label>
                  <USelect v-model="form.randomType" size="sm" :items="[
                    { value: 'none', label: '不使用' },
                    { value: 'rand8', label: '8位随机数字' },
                    { value: 'rand6c2', label: '6位随机+2位校验' },
                  ]" />
                </div>
                <div class="space-y-1">
                  <label class="block text-xs font-medium text-muted">校验位段</label>
                  <USelect v-model="form.checksumType" size="sm" :items="[
                    { value: 'md5', label: 'MD5 取后2位' },
                    { value: 'crc16', label: 'CRC16 取后2位' },
                    { value: 'none', label: '不使用' },
                  ]" />
                </div>
              </div>
              <p class="text-[10px] leading-relaxed text-muted">
                时间戳 + 随机段 + 流水号填充至 19 位（开启校验位时），末 2 位为校验位；32 位码保持纯数字，校验位按同规则可重算比对
              </p>
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
        <p class="mt-1 text-xs text-muted">第 1-11 位为 1049 号公告强制结构，第 12 位后为自定义段（时间戳/随机/校验）</p>
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
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-sm font-semibold text-default">生成结果</h2>
          <p class="mt-1 text-xs text-muted">{{ result.product.name }} · 共 {{ result.quantity }} 条</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <UButton variant="outline" color="neutral" icon="i-lucide-file-text" @click="exportTxt">导出 TXT</UButton>
          <UButton variant="outline" color="neutral" icon="i-lucide-link" @click="exportUrls">导出 urls.txt</UButton>
          <UButton color="primary" icon="i-lucide-file-spreadsheet" @click="exportCsv">导出 CSV</UButton>
        </div>
      </div>

      <!-- 生成统计（对齐离线工具：总数/唯一/重码/耗时） -->
      <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div class="rounded-lg border border-border/60 bg-muted/30 p-3 text-center">
          <div class="text-lg font-bold text-default">{{ result.quantity.toLocaleString() }}</div>
          <div class="mt-0.5 text-xs text-muted">生成总数</div>
        </div>
        <div class="rounded-lg border border-border/60 bg-muted/30 p-3 text-center">
          <div class="text-lg font-bold text-default">{{ (result.quantity - result.duplicates).toLocaleString() }}</div>
          <div class="mt-0.5 text-xs text-muted">唯一数</div>
        </div>
        <div class="rounded-lg border border-border/60 bg-muted/30 p-3 text-center">
          <div class="text-lg font-bold" :class="result.duplicates ? 'text-warning' : 'text-default'">{{ result.duplicates.toLocaleString() }}</div>
          <div class="mt-0.5 text-xs text-muted">跳过重码</div>
        </div>
        <div class="rounded-lg border border-border/60 bg-muted/30 p-3 text-center">
          <div class="text-lg font-bold text-default">{{ (result.elapsedMs / 1000).toFixed(2) }}s</div>
          <div class="mt-0.5 text-xs text-muted">生成耗时</div>
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
      <p class="mt-3 text-xs text-muted">TXT 命名遵循 PRD 5.5.1 强制规范（企业ID_产品名_规格_日期）；urls.txt 每行为完整扫码地址，可直接用于二维码印刷</p>
    </div>

    <!-- 二维码图片输出（合规第一条：QR/DM 码制） -->
    <div v-if="result" class="rounded-xl border border-border bg-elevated p-5 shadow-sm">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-sm font-semibold text-default">二维码图片输出</h2>
          <p class="mt-1 text-xs text-muted">按 1049 号公告第一条生成 QR / DataMatrix 码 PNG，zip 打包供印刷厂赋码</p>
        </div>
      </div>
      <div class="mt-4 grid gap-4 lg:grid-cols-2">
        <div class="space-y-3">
          <div class="grid gap-3 sm:grid-cols-3">
            <div class="space-y-1">
              <label class="block text-xs font-medium text-muted">码制</label>
              <USelect v-model="imgForm.codeType" size="sm" :items="[
                { value: 'QR', label: 'QR 码（推荐）' },
                { value: 'DM', label: 'DataMatrix 码' },
              ]" />
            </div>
            <div class="space-y-1">
              <label class="block text-xs font-medium text-muted">模块大小（像素）</label>
              <UInput v-model.number="imgForm.moduleSize" type="number" min="1" max="20" size="sm" />
            </div>
            <div class="space-y-1">
              <label class="block text-xs font-medium text-muted">静区白边（模块）</label>
              <UInput v-model.number="imgForm.quietZone" type="number" min="0" max="20" size="sm" />
            </div>
          </div>
          <div class="grid gap-3 sm:grid-cols-3">
            <div class="space-y-1">
              <label class="block text-xs font-medium text-muted">数量（留空 = 全部）</label>
              <UInput v-model.number="imgForm.count" type="number" min="1" size="sm" placeholder="全部" />
            </div>
            <div class="space-y-1">
              <label class="block text-xs font-medium text-muted">文件名前缀</label>
              <UInput v-model="imgForm.prefix" size="sm" placeholder="默认：登记证号_产品名_数量_日期" />
            </div>
            <div class="space-y-1">
              <label class="block text-xs font-medium text-muted">起始序号</label>
              <UInput v-model.number="imgForm.startIndex" type="number" min="1" size="sm" />
            </div>
          </div>
          <p class="text-[10px] leading-relaxed text-muted">
            模块大小印刷推荐 3-6；静区白边印刷必须 ≥2（保证识读率）；文件名示例：{前缀}_0001.png
          </p>
          <UButton color="neutral" size="md" icon="i-lucide-qr-code" :loading="imgGenerating" @click="doGenImages">
            生成二维码图片
          </UButton>
        </div>

        <!-- 图片生成结果 -->
        <div v-if="imgResult" class="rounded-lg border border-border/60 p-4">
          <div class="flex items-center justify-between">
            <div class="text-sm font-semibold text-default">
              {{ imgResult.type === 'DM' ? 'DataMatrix' : 'QR' }} 码生成完成
              <span class="ml-2 text-xs font-normal text-muted">成功 {{ imgResult.done }} 张<span v-if="imgResult.failed">，失败 {{ imgResult.failed }} 张</span> · 耗时 {{ (imgResult.elapsedMs / 1000).toFixed(1) }}s</span>
            </div>
            <UButton color="primary" size="sm" icon="i-lucide-download" @click="downloadZip">下载 ZIP</UButton>
          </div>
          <div class="mt-3 flex gap-3">
            <div v-for="(b64, i) in imgResult.previews" :key="i" class="text-center">
              <img :src="'data:image/png;base64,' + b64" class="h-24 w-24 rounded border border-border/60 bg-white object-contain p-1" :alt="'预览' + (i + 1)" />
              <div class="mt-1 text-[10px] text-muted">{{ i === 0 ? imgResult.exampleName : '...' }}</div>
            </div>
          </div>
          <p class="mt-3 text-[10px] text-muted">zip 内按 {前缀}_{序号}.png 命名（示例：{{ imgResult.exampleName }}），下载凭证一次性有效</p>
        </div>
        <div v-else class="flex items-center justify-center rounded-lg border border-dashed border-border/60 p-8 text-sm text-muted">
          生成后可预览前 3 张并打包下载全部 PNG
        </div>
      </div>
    </div>
  </div>
</template>
