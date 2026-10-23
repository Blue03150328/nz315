<script setup lang="ts">
// 追溯码生成（PRD 5.5.1：离线生成工具 Web 版——生成不入库，导出文件后经生产采集导入）
// 自定义段配置对齐 PRD 3.2：时间戳段 + 随机数字段 + 校验位段；导出命名对齐 PRD 5.5.1 强制命名规范
// 二维码图片输出对齐合规第一条（QR/DM 码制，供印刷厂赋码）：2026-09-15 起改为「下载官方离线工具、本机生成」，服务端不再渲染 PNG
// Keep-Alive 页面缓存：左侧菜单切换后返回保留页面状态（表单/筛选/页码/预览）；刷新、退出登录自动清空；页内【重置】恢复初始
// 只读账号（viewer）在模板中隐藏全部写操作入口
import {
  MAX_CODES_PER_BATCH,
  GENERATE_QUANTITY_ERROR,
  GENERATE_QUANTITY_RANGE_TEXT,
  LARGE_BATCH_CONFIRM_THRESHOLD,
  estimateCodesSizeMb,
  estimateGenerateMs,
} from '#shared/utils/code-limits'
import { MAX_EXPORT_FILES, planGeneratorExport, generatorExportText, type GeneratorExportFormat } from '#shared/utils/generator-export'
import { TextZip } from '#shared/utils/text-zip'

const { canWrite } = useUser()

definePageMeta({ layout: 'admin', middleware: 'backend-guard', keepalive: true })
useHead({ title: '追溯码生成' })

const toast = useToast()
const runtime = useRuntimeConfig()
const traceBaseUrl = runtime.public?.traceBaseUrl || 'https://www.nz315.cn/trace?code='

// 自定义段配置（码第 12 位后 21 位）已按平台标准固定（PRD 3.2）：时间戳=毫秒级 / 随机=6位随机+2位校验 / 校验=MD5取后2位
// 用户不可选择修改、仅展示——防止客户乱配置导致追溯码结构错乱；服务端生成接口亦不接受配置参数（generate.post.ts 固定）
const FIXED_SEGMENTS = [
  { name: '时间戳段', value: '毫秒级' },
  { name: '随机数字段', value: '6位随机+2位校验' },
  { name: '校验位段', value: 'MD5 取后2位' },
]

const form = reactive({
  productId: null as number | null,
  quantity: 100,
})
const generating = ref(false)
const result = ref<any>(null)
// 本批码仅保存在页面内存；尚未导出时，刷新或关闭页面前提示保存。
const exportedCodeCount = ref(0)
const hasUnsavedResult = computed(() => !!result.value?.allCodes?.length && exportedCodeCount.value < result.value.allCodes.length)
const showExport = ref(false)
const exporting = ref(false)
const exportProgress = ref(0)
const exportFormat = ref<GeneratorExportFormat>('txt')
const exportSettings = reactive({ fileCount: 1, codesPerFile: 100 })
const exportStart = computed(() => exportedCodeCount.value < (result.value?.allCodes?.length || 0) ? exportedCodeCount.value : 0)
const exportAvailable = computed(() => (result.value?.allCodes?.length || 0) - exportStart.value)
const exportPlan = computed(() => {
  try {
    return { ...planGeneratorExport(exportAvailable.value, Number(exportSettings.fileCount), Number(exportSettings.codesPerFile)), error: '' }
  } catch (e) {
    return { total: 0, remaining: exportAvailable.value, error: (e as Error).message }
  }
})
const exportFormatLabel = computed(() => ({ txt: 'TXT', urls: 'urls.txt', csv: 'CSV' })[exportFormat.value])
const onBeforeUnload = (e: BeforeUnloadEvent) => {
  if (!hasUnsavedResult.value) return
  e.preventDefault()
  e.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))

const selectedProduct = ref<any>(null)

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

// 分段预览配色映射（纯样式常量）：统一为 B 端「浅底深字」标签，降低饱和度
const SEGMENT_COLORS = ['b-tag-danger', 'b-tag-info', 'b-tag-warning', 'b-tag-success', 'b-tag-default']

// 页内【重置】：清空生成表单与全部结果/预览，恢复页面初始状态（Keep-Alive 缓存页互不影响）
const resetPage = () => {
  if (generating.value || exporting.value) return
  Object.assign(form, { productId: null, quantity: 100 })
  selectedProduct.value = null
  showBigConfirm.value = false
  result.value = null
  exportedCodeCount.value = 0
  showExport.value = false
  toast.add({ title: '已重置，页面恢复初始状态', color: 'primary' })
}

// 大数量二次确认（>20 万条）：阈值与体积/耗时估算统一由 shared/utils/code-limits.ts 定义
// 目的：50 万条一次生成时，页面要把全部码值留在内存中（导出 urls.txt 约 31MB、CSV 约 80MB），
// 先在确认框里把体积与耗时讲清楚，避免误操作、避免低配机直接卡死
const showBigConfirm = ref(false)
const pendingQuantity = ref(0)
const bigConfirmText = computed(() => {
  const q = pendingQuantity.value
  return {
    quantity: q.toLocaleString(),
    elapsed: (estimateGenerateMs(q) / 1000).toFixed(1),
    txt: estimateCodesSizeMb(q, 'txt'),
    urls: estimateCodesSizeMb(q, 'urls'),
    csv: estimateCodesSizeMb(q, 'csv'),
  }
})

const doGenerate = () => {
  if (generating.value || exporting.value) return
  if (!form.productId) { toast.add({ title: '请选择产品', color: 'warning' }); return }
  // 区间校验文案与接口 400 文案同源（GENERATE_QUANTITY_ERROR），避免前后端提示不一致
  if (!Number.isInteger(Number(form.quantity)) || form.quantity < 1 || form.quantity > MAX_CODES_PER_BATCH) {
    toast.add({ title: GENERATE_QUANTITY_ERROR, color: 'warning' }); return
  }
  if (form.quantity > LARGE_BATCH_CONFIRM_THRESHOLD) {
    pendingQuantity.value = Number(form.quantity)
    showBigConfirm.value = true
    return
  }
  runGenerate()
}

// 真正调用生成接口（大数量场景由确认弹窗确认后调用）
const runGenerate = async () => {
  showBigConfirm.value = false
  generating.value = true
  try {
    result.value = await $fetch('/api/admin/codes/generate', { method: 'POST', body: { ...form } })
    exportedCodeCount.value = 0
    showExport.value = false
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
const urlFilePrefix = (quantity: number) => {
  const p = result.value?.product
  if (!p) return 'trace'
  const date = new Date()
  const d = String(date.getFullYear()) + String(date.getMonth() + 1).padStart(2, '0') + String(date.getDate()).padStart(2, '0')
  const safeName = String(p.name || '').replace(/[\\/:*?"<>|]/g, '_')
  return p.registrationNo + '_' + safeName + '_' + quantity + '_' + d
}

const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  try { a.click() } finally {
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
}

const openExport = (format: GeneratorExportFormat) => {
  if (!result.value?.allCodes?.length || generating.value || exporting.value) return
  exportFormat.value = format
  Object.assign(exportSettings, { fileCount: 1, codesPerFile: exportAvailable.value })
  showExport.value = true
}

// 所有格式共用连续切分；只有下载触发成功后才推进已导出范围。
const confirmExport = async () => {
  if (exporting.value || generating.value || !result.value?.allCodes?.length) return
  if (exportPlan.value.error) { toast.add({ title: exportPlan.value.error, color: 'warning' }); return }
  const { fileCount, codesPerFile } = exportSettings
  const count = Number(fileCount), perFile = Number(codesPerFile)
  const start = exportStart.value
  const batch = result.value
  const prefix = defaultFilePrefix()
  const format = exportFormat.value
  const context = { traceBaseUrl, product: batch.product, companyName: batch.companyName, generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }) }
  exporting.value = true
  exportProgress.value = 0
  try {
    // 先让界面显示加载状态；大批次每完成十份让出主线程。
    await new Promise(resolve => setTimeout(resolve, 0))
    const zip = count > 1 ? new TextZip() : null
    for (let index = 0; index < count; index++) {
      const from = start + index * perFile, to = from + perFile
      const text = generatorExportText(batch.allCodes.slice(from, to), format, context)
      const part = count > 1 || start > 0 || perFile < batch.allCodes.length ? `_第${String(index + 1).padStart(3, '0')}份_${from + 1}-${to}_${perFile}条` : ''
      const name = format === 'urls' ? urlFilePrefix(perFile) + part + '_urls.txt' : prefix + part + '.' + format
      if (zip) zip.add(name, text)
      else download(new Blob([text], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8' }), name)
      exportProgress.value = index + 1
      if (zip && (index + 1) % 10 === 0) await new Promise(resolve => setTimeout(resolve, 0))
    }
    if (zip) download(zip.toBlob(), `${prefix}_${count}份_每份${perFile}条_${start + 1}-${start + count * perFile}.zip`)
    exportedCodeCount.value = Math.max(exportedCodeCount.value, start + count * perFile)
    showExport.value = false
    toast.add({ title: `已发起下载：${count} 个文件，每文件 ${perFile} 条，共 ${count * perFile} 条`, color: 'success' })
  } catch (e) {
    toast.add({ title: (e as Error).message || '导出失败，请重试', color: 'error' })
  } finally {
    exporting.value = false
  }
}

// ========== 二维码图片输出：官方离线工具（合规第一条：QR/DM 码制，供印刷厂赋码） ==========
// 2026-09-15 改造：原「服务端渲染 PNG + zip 打包下载」整体下线，改为下载官方离线工具在本机生成——
// 万张级批量不再受服务器与网络限制，印刷厂/生产车间可离线自行出图；码内容口径与平台一致（完整扫码 URL）。
// 2026-09-19 升级 v1.2.0：工具改为「导入本平台生成的码文件 → 只出图」的纯生图定位——
//   此前工具自己也能造码（内置数据快照 + 不同算法，无 MD5 校验位），导致与平台生成的码对不上、还要再录入一遍；
//   现在码统一由平台产出（生产采集后入库绑定），工具只负责渲染成图。
//   工具仍保留「离线应急生成」但不推荐；导入出图不依赖工具内置数据，故厂商无需再为数据更新重发工具包。
// 工具发布件放 public/tools/；版本号/size/SHA256 在此维护并展示，便于客户核对拿到的是否为官方发布件
const OFFLINE_TOOL = {
  name: '农药追溯码生图工具',
  version: 'v1.2.1（便携版）',
  platform: 'Windows 10/11',
  size: '90.63 MB',
  fileName: '农药追溯码生成工具-v1.2.1-便携版.exe',
  url: '/tools/nz315-qr-tool-v1.2.1.exe',
  // 发布件校验值：客户下载后可用 `certutil -hashfile 文件名 SHA256` 核对，确认拿到的是官方发布件、未被替换
  sha256: 'e5a4181bcbc5ea24c391516ba92526b27c3fd9349873e938d33123d1dd6f4d61',
}
// external 显式绕过 SPA 路由，浏览器直接接收附件并显示进度，避免完整90MB Blob等待。
</script>
<template>
  <div class="space-y-4">
    <!-- 页面标题区 -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="b-page-title">追溯码生成</h1>
      </div>
      <UButton variant="outline" color="neutral" icon="i-lucide-rotate-ccw" :disabled="generating || exporting" @click="resetPage">重置</UButton>
    </div>

    <div class="grid gap-4 xl:grid-cols-2">
      <!-- 生成设置 -->
      <div class="b-card">
        <div class="b-card-head">
          <span class="b-card-title">生成设置</span>
          <span class="b-card-extra">32 位追溯码</span>
        </div>
        <div class="b-form-grid">
          <div>
            <label class="b-label">产品<span class="b-required">*</span></label>
            <ProductPicker
              v-model="form.productId"
              :disabled="generating"
              @selected="selectedProduct = $event"
            />
            <p v-if="selectedProduct" class="b-help">
              规格：{{ selectedProduct.spec_name || '规格未填写' }} · 规格码：{{ selectedProduct.spec_code || '未配置' }}
            </p>
            <div v-if="headPreview" class="mt-2 flex flex-wrap items-center gap-1 rounded bg-[var(--b-fill)] px-3 py-2 font-code text-xs">
              <span class="b-tag b-tag-danger">{{ headPreview.cat }}</span>
              <span class="text-[var(--b-text-muted)]">+</span>
              <span class="b-tag b-tag-info">{{ headPreview.regLast6 }}</span>
              <span class="text-[var(--b-text-muted)]">+</span>
              <span class="b-tag b-tag-warning">{{ headPreview.produceType }}</span>
              <span class="text-[var(--b-text-muted)]">+</span>
              <span class="b-tag b-tag-success">{{ headPreview.specCode }}</span>
              <span class="ml-2 text-[var(--b-text-muted)]">= 11 位强制结构</span>
            </div>
            <p v-else class="b-help">选择产品后显示码头</p>
          </div>

          <div>
            <label class="b-label">生成数量 <span class="b-required">*</span></label>
            <UInput v-model.number="form.quantity" type="number" min="1" :max="MAX_CODES_PER_BATCH"  class="w-full" />
            <p class="b-help">{{ GENERATE_QUANTITY_RANGE_TEXT }}</p>
          </div>
        </div>

        <!-- 自定义段配置（PRD 3.2）——参数按平台标准固定，仅展示不可修改（防客户乱配置导致追溯码出错） -->
        <div class="border-t border-[var(--b-divider)]">
          <div class="b-card-head">
            <span class="b-card-title">编码参数</span>
            <span class="b-card-extra">平台标准 · 固定</span>
          </div>
          <div class="grid gap-3 px-4 pb-3.5 sm:grid-cols-3">
            <div v-for="seg in FIXED_SEGMENTS" :key="seg.name">
              <label class="b-label">{{ seg.name }}</label>
              <div class="flex h-9 items-center gap-1.5 rounded border border-[var(--b-border)] bg-[var(--b-fill)] px-2.5 text-[13px] font-medium text-[var(--b-text-title)]">
                <UIcon name="i-lucide-lock" class="h-3.5 w-3.5 shrink-0 text-[var(--b-text-muted)]" />
                <span>{{ seg.value }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="b-card-foot">
          <span class="b-card-extra">生成后请导出，生产采集后入库</span>
          <UButton v-if="canWrite" color="neutral" variant="solid" icon="i-lucide-wand-2" :loading="generating" :disabled="exporting" @click="doGenerate">
            生成追溯码
          </UButton>
        </div>
      </div>

      <!-- 码示例预览 -->
      <div class="b-card">
        <div class="b-card-head">
          <span class="b-card-title">码结构预览</span>
          <span class="b-card-extra">码头 / 时间 / 随机 / 校验</span>
        </div>
        <div v-if="result?.preview?.length" class="b-card-body space-y-2.5">
          <div v-for="(p, i) in result.preview" :key="i" class="rounded border border-[var(--b-divider)] p-3">
            <div class="flex flex-wrap font-code text-xs">
              <span v-for="(s, si) in p.segments" :key="si" class="b-tag mr-1 mb-1" :class="SEGMENT_COLORS[si % 5]">
                {{ s.value }}
              </span>
            </div>
            <div class="mt-1.5 flex flex-wrap gap-1.5">
              <span v-for="(s, si) in p.segments" :key="si" class="b-tag text-[11px]" :class="SEGMENT_COLORS[si % 5]">
                {{ s.label }}
              </span>
            </div>
          </div>
        </div>
        <div v-else class="b-empty">
          <div class="b-empty-inner">
            <UIcon name="i-lucide-inbox" class="b-empty-icon h-8 w-8" />
            <span class="text-sm">生成后显示预览</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 生成结果 -->
    <div v-if="result" class="b-card b-card-clip">
      <div class="b-card-head">
        <span class="b-card-title">生成结果</span>
        <span class="b-card-extra">{{ result.product.name }} · {{ result.product.specName || '规格未填写' }} · 共 {{ result.quantity }} 条</span>
      </div>

      <!-- 防丢失提醒（2026-10-10）：码只存在于本页内存，刷新/关闭即永久丢失 -->
      <div v-if="hasUnsavedResult" class="b-note mx-4 mt-3">
        <UIcon name="i-lucide-triangle-alert" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
        <p class="b-note-text">
          本批码<strong>{{ exportedCodeCount ? '尚未全部导出' : '尚未导出' }}</strong>：已导出 {{ exportedCodeCount.toLocaleString() }} 条，剩余 {{ (result.allCodes.length - exportedCodeCount).toLocaleString() }} 条。码只存在于当前页面，刷新或关闭页面后<strong>无法恢复</strong>。请先导出剩余码并确认下载文件已保存，再离开本页。
        </p>
      </div>

      <!-- 生成统计（对齐离线工具：总数/唯一/重码/耗时） -->
      <div class="b-card-body grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div class="b-stat">
          <div class="b-stat-label">生成总数</div>
          <div class="b-stat-value">{{ result.quantity.toLocaleString() }}</div>
        </div>
        <div class="b-stat">
          <div class="b-stat-label">唯一数</div>
          <div class="b-stat-value">{{ (result.quantity - result.duplicates).toLocaleString() }}</div>
        </div>
        <div class="b-stat">
          <div class="b-stat-label">跳过重码</div>
          <div class="b-stat-value" :class="result.duplicates ? 'text-amber-600' : ''">{{ result.duplicates.toLocaleString() }}</div>
        </div>
        <div class="b-stat">
          <div class="b-stat-label">生成耗时</div>
          <div class="b-stat-value">{{ (result.elapsedMs / 1000).toFixed(2) }}s</div>
        </div>
      </div>

      <div class="b-scroll-x max-h-72 overflow-y-auto border-t border-[var(--b-divider)]">
        <table class="b-table">
          <thead class="sticky top-0 z-10">
            <tr>
              <th class="w-12">#</th>
              <th>追溯码（前 10 条示例）</th>
              <th>结构</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(p, i) in result.preview" :key="i">
              <td class="text-[var(--b-text-muted)]">{{ i + 1 }}</td>
              <td><span class="font-code text-[13px] b-strong">{{ p.code }}</span></td>
              <td class="text-[var(--b-text-muted)]">
                {{ p.segments[0].value }} | {{ p.segments[1].value }} | {{ p.segments[2].value }} | {{ p.segments[3].value }} | {{ p.segments[4].value }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="b-card-foot">
        <span class="b-card-extra">导出格式：纯码 / 扫码网址 / CSV</span>
        <div class="flex flex-wrap items-center gap-2">
          <UButton variant="outline" color="neutral" icon="i-lucide-file-text" :disabled="generating || exporting" @click="openExport('txt')">导出 TXT</UButton>
          <UButton variant="outline" color="neutral" icon="i-lucide-link" :disabled="generating || exporting" @click="openExport('urls')">导出 urls.txt</UButton>
          <UButton color="neutral" variant="solid" icon="i-lucide-file-spreadsheet" :disabled="generating || exporting" @click="openExport('csv')">导出 CSV</UButton>
        </div>
      </div>
    </div>

    <UModal v-model:open="showExport" :dismissible="!exporting" :title="'导出 ' + exportFormatLabel" description="设置文件数量和每个文件的追溯码数量">
      <template #content>
        <div class="b-modal">
          <div class="b-modal-head"><h3 class="b-modal-title">导出 {{ exportFormatLabel }}</h3></div>
          <div class="b-modal-body space-y-4">
            <p class="text-sm">当前可导出 {{ exportAvailable.toLocaleString() }} 条，从本批第 {{ (exportStart + 1).toLocaleString() }} 条开始。</p>
            <p v-if="exportedCodeCount && !hasUnsavedResult" class="b-help">本批已全部导出，再次导出将从第 1 条开始。</p>
            <div class="grid gap-4 sm:grid-cols-2">
              <div><label for="export-file-count" class="b-label">文件数量</label><UInput id="export-file-count" v-model.number="exportSettings.fileCount" type="number" min="1" :max="MAX_EXPORT_FILES" step="1" :disabled="exporting" class="w-full" /><p class="b-help">最多 {{ MAX_EXPORT_FILES }} 个文件</p></div>
              <div><label for="export-codes-per-file" class="b-label">每个文件的追溯码数量</label><UInput id="export-codes-per-file" v-model.number="exportSettings.codesPerFile" type="number" min="1" :max="exportAvailable" step="1" :disabled="exporting" class="w-full" /></div>
            </div>
            <p v-if="exportPlan.error" role="alert" class="text-sm text-red-600">{{ exportPlan.error }}</p>
            <div v-else class="b-note"><p class="b-note-text">本次导出 <strong>{{ exportSettings.fileCount }} 个文件 × {{ exportSettings.codesPerFile }} 条 = {{ exportPlan.total.toLocaleString() }} 条</strong>。<template v-if="exportPlan.remaining">导出后剩余 {{ exportPlan.remaining.toLocaleString() }} 条，下次从剩余码继续导出。</template><template v-else>本次导出全部可用码。</template></p></div>
            <p class="b-help">多个文件会打包为一个 ZIP，解压后每个文件包含指定数量的追溯码，各文件按顺序编号、互不重复。仅导出码文本；二维码图片可通过下方离线工具生成。</p>
            <p v-if="exporting" role="status" class="b-help">正在准备文件：{{ exportProgress }} / {{ exportSettings.fileCount }}</p>
          </div>
          <div class="b-modal-foot">
            <UButton variant="outline" color="neutral" :disabled="exporting" @click="showExport = false">取消</UButton>
            <UButton color="neutral" :loading="exporting" :disabled="!!exportPlan.error || generating" @click="confirmExport">{{ exportSettings.fileCount > 1 ? '打包下载 ZIP' : '下载文件' }}</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- 二维码图片输出：官方离线工具（合规第一条：QR/DM 码制） -->
    <div class="b-card">
      <div class="b-card-head">
        <span class="b-card-title">二维码图片输出</span>
        <span class="b-card-extra">QR / DataMatrix · PNG</span>
      </div>
      <div class="b-card-body space-y-3">
        <div class="flex flex-wrap items-center gap-2 text-sm text-[var(--b-text-regular)]"><span>导出码文件</span><UIcon name="i-lucide-chevron-right" class="h-4 w-4 text-muted" /><span>导入离线工具</span><UIcon name="i-lucide-chevron-right" class="h-4 w-4 text-muted" /><span>导出图片</span></div>
        <AdminHelp title="使用说明与文件校验">
        <div class="b-note">
          <UIcon name="i-lucide-info" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--b-text-muted)]" />
          <p class="b-note-text">二维码图片改由官方<strong>离线工具</strong>在本机生成，不再经过服务器：万张级批量不受网络与服务器限制，印刷厂、生产车间均可离线自行出图。<strong>码值统一由本平台生成</strong>（生产采集后入库绑定），工具只负责把码渲染成 PNG —— 两边不会再出现规格码或码结构对不上的情况。码内容为完整扫码地址（<span class="font-code">{{ traceBaseUrl }}32位码</span>）。</p>
        </div>
        <ol class="space-y-1.5 text-[13px] leading-6 text-[var(--b-text-muted)]">
          <li>① 在上方「生成结果」区点【导出 urls.txt】，可设置文件数量和每个文件的码数（如 20 个文件，每文件 400 条，需先生成至少 8000 条）。多文件 ZIP 请先解压，再导入码文件；TXT 和 CSV 同样支持。</li>
          <li>② 下载并双击运行离线工具（便携版，免安装、无需联网）。</li>
          <li>③ 在工具「第 1 步」把码文件拖进去 —— <strong>可一次拖入多个文件自动合并去重</strong>；本平台单次最多可生成 50 万条，导出文件可直接拖入，无需分批多次生成。</li>
          <li>④ 在工具「第 2 步」设置码制（QR / DataMatrix）、模块大小（<strong>DataMatrix 建议 ≥4 像素/格</strong>）、静区白边（<strong>务必 ≥2</strong>），选好输出文件夹后导出 PNG。</li>
          <li>⑤ 印刷前务必用微信扫一扫验证前几张图，确认能打开本平台追溯查询页且产品信息正确。</li>
        </ol>
        <div class="b-note">
          <UIcon name="i-lucide-shield-alert" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--b-text-muted)]" />
          <p class="b-note-text">
            工具未做数字签名，首次运行若 Windows 提示「已保护你的电脑 / 未知发布者」，点【更多信息】→【仍要运行】即可。<br>
            发布件校验值 SHA256：<span class="font-code break-all">{{ OFFLINE_TOOL.sha256 }}</span><br>
            下载后可用 <span class="font-code">certutil -hashfile 文件名 SHA256</span> 核对，确认拿到的是官方发布件。
          </p>
        </div>
        </AdminHelp>
      </div>
      <div class="b-card-foot">
        <span class="b-card-extra">
          {{ OFFLINE_TOOL.name }} {{ OFFLINE_TOOL.version }} · {{ OFFLINE_TOOL.platform }} · {{ OFFLINE_TOOL.size }}
        </span>
        <UButton
          color="neutral"
          variant="solid"
          icon="i-lucide-download"
          :href="OFFLINE_TOOL.url"
          :download="OFFLINE_TOOL.fileName"
          external
          target="_blank"
        >
          下载离线工具
        </UButton>

      </div>
    </div>

    <div v-if="canWrite" class="b-card">
      <div class="b-card-head"><h2 class="b-card-title">追溯码离线上传</h2><UButton to="/admin/collection" color="neutral" variant="outline" icon="i-lucide-file-up">进入上传</UButton></div>
    </div>

    <!-- 大数量生成二次确认（阈值 20 万条，见 shared/utils/code-limits.ts）：
         50 万条一次生成时，全部码值会留在当前页面内存中（导出 urls.txt 约 31MB、CSV 约 80MB），
         确认框先把返回体积、导出体积与耗时讲清楚，避免误操作、避免低配机卡死 -->
    <UModal v-model:open="showBigConfirm">
      <template #content>
        <div class="b-modal">
          <div class="b-modal-head">
            <div class="b-modal-icon">
              <UIcon name="i-lucide-triangle-alert" class="h-4 w-4 text-amber-600" />
            </div>
            <div>
              <h3 class="b-modal-title">确认生成大数量追溯码</h3>
              <p class="b-modal-sub">本次共 {{ bigConfirmText.quantity }} 条</p>
            </div>
          </div>
          <div class="b-modal-body">
            <div class="b-note">
              <UIcon name="i-lucide-info" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--b-text-muted)]" />
              <p class="b-note-text">
                服务端生成预计约 {{ bigConfirmText.elapsed }} 秒，生成的码值会一次性返回给当前页面。<br>
                导出文件体积约为：TXT {{ bigConfirmText.txt }} MB · urls.txt {{ bigConfirmText.urls }} MB · CSV {{ bigConfirmText.csv }} MB。<br>
                条数越大页面内存占用越高，建议生成后<strong>尽快导出并刷新页面</strong>，不要长时间停留在大批量结果页。
              </p>
            </div>
          </div>
          <div class="b-modal-foot">
            <UButton variant="outline" color="neutral" @click="showBigConfirm = false">取消</UButton>
            <UButton color="neutral" variant="solid" :loading="generating" @click="runGenerate">确认生成</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
