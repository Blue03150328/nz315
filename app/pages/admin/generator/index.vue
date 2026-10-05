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

const { canWrite } = useUser()

definePageMeta({ layout: 'admin', middleware: 'backend-guard', keepalive: true })
useHead({ title: '追溯码生成' })

const toast = useToast()
const runtime = useRuntimeConfig()
const traceBaseUrl = runtime.public?.traceBaseUrl || 'https://www.nz315.cn/trace?code='

const { data: productData } = await useFetch<any>('/api/admin/products', {
  key: 'admin-products-gen',
  query: { page: 1, pageSize: 100, status: 1 },
})

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
// 入库留档（方案 A 2026-09-04）：生成码可先入库为「已生成/未绑定」——提前印码的企业入档管理，
// 生产时在码库管理按该上传批次【修正】绑定生产批次；stocked 防止同一批结果重复入库
const stocking = ref(false)
const stocked = ref(false)

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

// 分段预览配色映射（纯样式常量）：统一为 B 端「浅底深字」标签，降低饱和度
const SEGMENT_COLORS = ['b-tag-danger', 'b-tag-info', 'b-tag-warning', 'b-tag-success', 'b-tag-default']

// 页内【重置】：清空生成表单与全部结果/预览，恢复页面初始状态（Keep-Alive 缓存页互不影响）
const resetPage = () => {
  Object.assign(form, { productId: null, quantity: 100 })
  showBigConfirm.value = false
  result.value = null
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
    stocked.value = false // 新一批码，重置入库留档状态
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

// ========== 入库留档（状态：已生成/未绑定；方案 A 2026-09-04） ==========
// 生产采集导入是「绑定入库」；这里是「留档入库」：码进码库但未绑生产批次，
// 之后在码库管理（该上传批次行【修正】→ 新建批次绑定）完成生产绑定
const doStockIn = async () => {
  if (!result.value?.allCodes?.length) { toast.add({ title: '请先生成追溯码', color: 'warning' }); return }
  stocking.value = true
  try {
    const res = await $fetch('/api/admin/codes/stock-in', {
      method: 'POST',
      body: { codes: result.value.allCodes, productId: result.value.product.id },
    })
    const skip = Number(res.skippedInvalid || 0) + Number(res.skippedDup || 0)
    toast.add({
      title: res.imported > 0
        ? '已入库 ' + res.imported + ' 条，文件内重复 ' + res.duplicateFile + ' 条、库内已有 ' + res.duplicateDatabase + ' 条、校验拒绝 ' + res.skippedInvalid + ' 条'
        : res.message,
      color: skip > 0 ? 'warning' : 'success',
    })
    stocked.value = res.imported > 0 || res.skippedInvalid === 0
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '入库失败', color: 'error' })
  } finally {
    stocking.value = false
  }
}

// ========== 二维码图片输出：官方离线工具（合规第一条：QR/DM 码制，供印刷厂赋码） ==========
// 2026-09-15 改造：原「服务端渲染 PNG + zip 打包下载」整体下线，改为下载官方离线工具在本机生成——
// 万张级批量不再受服务器与网络限制，印刷厂/生产车间可离线自行出图；码内容口径与平台一致（完整扫码 URL）。
// 2026-09-19 升级 v1.2.0：工具改为「导入本平台生成的码文件 → 只出图」的纯生图定位——
//   此前工具自己也能造码（内置数据快照 + 不同算法，无 MD5 校验位），导致与平台生成的码对不上、还要再录入一遍；
//   现在码统一由平台产出（可入库留档、可被生产采集绑定），工具只负责渲染成图。
//   工具仍保留「离线应急生成」但不推荐；导入出图不依赖工具内置数据，故厂商无需再为数据更新重发工具包。
// 工具发布件放 public/tools/；版本号/size/SHA256 在此维护并展示，便于客户核对拿到的是否为官方发布件
const OFFLINE_TOOL = {
  name: '农药追溯码生图工具',
  version: 'v1.2.0（便携版）',
  platform: 'Windows 10/11',
  size: '90.63 MB',
  fileName: '农药追溯码生成工具-v1.2.0-便携版.exe',
  url: '/tools/nz315-qr-tool-v1.2.0.exe',
  // 发布件校验值：客户下载后可用 `certutil -hashfile 文件名 SHA256` 核对，确认拿到的是官方发布件、未被替换
  sha256: '04373ae1dc21752636f1b68945edb2dca8cff19c8b005b2ace1070cbc0a72fe8',
}
const toolDownloading = ref(false)

/** 离线工具下载：走 fetch → Blob → 临时 a 标签。
 *  不用 <a href download> 直链——SPA 客户端路由会拦截无路由路径（同 specs/index.vue 模板下载的踩坑记录） */
const downloadOfflineTool = async () => {
  toolDownloading.value = true
  try {
    const blob: any = await $fetch(OFFLINE_TOOL.url, { responseType: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = OFFLINE_TOOL.fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast.add({ title: '离线工具下载已开始', color: 'success' })
  } catch {
    toast.add({ title: '离线工具下载失败，请稍后重试', color: 'error' })
  } finally {
    toolDownloading.value = false
  }
}
</script>
<template>
  <div class="space-y-4">
    <!-- 页面标题区 -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="b-page-title">追溯码生成</h1>
        <p class="b-page-desc">按 1049 号公告结构批量生成 32 位追溯码（生成不入库，导出后经生产采集导入；二维码图片由官方离线工具导入 urls.txt 在本机生成）</p>
      </div>
      <UButton variant="outline" color="neutral" icon="i-lucide-rotate-ccw" @click="resetPage">重置</UButton>
    </div>

    <div class="grid gap-4 xl:grid-cols-2">
      <!-- 生成配置 -->
      <div class="b-card">
        <div class="b-card-head">
          <span class="b-card-title">生成配置</span>
          <span class="b-card-extra">码第 1-11 位由所选产品自动带出</span>
        </div>
        <div class="b-form-grid">
          <div>
            <label class="b-label">产品（码第 1-11 位来源）<span class="b-required">*</span></label>
            <USelect
              v-model="form.productId"
              :items="(productData?.rows || []).map((p: any) => ({ value: Number(p.id), label: p.name + '（' + p.registration_no + '）' }))"
              placeholder="选择产品"
              class="w-full"
              :content="{ class: 'min-w-72' }"
              :ui="{ itemLabel: { class: 'whitespace-normal break-words' } }"
            />
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
            <p v-else class="b-help">选择产品后自动带出码结构（登记类别 | 登记证后6位 | 生产类型 | 规格码）</p>
          </div>

          <div>
            <label class="b-label">生成数量 <span class="b-required">*</span></label>
            <UInput v-model.number="form.quantity" type="number" min="1" :max="MAX_CODES_PER_BATCH" />
            <p class="b-help">{{ GENERATE_QUANTITY_RANGE_TEXT }}；超过 20 万条会先弹确认框（提示文件体积与耗时）</p>
          </div>
        </div>

        <!-- 自定义段配置（PRD 3.2）——参数按平台标准固定，仅展示不可修改（防客户乱配置导致追溯码出错） -->
        <div class="border-t border-[var(--b-divider)]">
          <div class="b-card-head">
            <span class="b-card-title">自定义段配置（码第 12 位后，共 21 位）</span>
            <span class="b-card-extra">第 1-11 位为 1049 公告强制结构；以下参数平台已固定，仅展示不可修改</span>
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
          <div class="px-4 pb-4">
            <div class="b-note">
              <UIcon name="i-lucide-info" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--b-text-muted)]" />
              <p class="b-note-text">标准结构固定：毫秒时间戳 13 位 + 随机 6 位，共 19 位内容 + 末 2 位 MD5 校验位；32 位码保持纯数字，校验位按同规则可重算比对</p>
            </div>
          </div>
        </div>

        <div class="b-card-foot">
          <span class="b-card-extra">生成结果不入库，导出文件后经「生产采集」导入</span>
          <UButton v-if="canWrite" color="neutral" variant="solid" icon="i-lucide-wand-2" :loading="generating" @click="doGenerate">
            生成追溯码
          </UButton>
        </div>
      </div>

      <!-- 码示例预览 -->
      <div class="b-card">
        <div class="b-card-head">
          <span class="b-card-title">码结构预览</span>
          <span class="b-card-extra">第 12 位后为自定义段（时间戳/随机/校验）</span>
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
            <span class="text-sm">配置产品后点击「生成追溯码」预览码结构</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 生成结果 -->
    <div v-if="result" class="b-card b-card-clip">
      <div class="b-card-head">
        <span class="b-card-title">生成结果</span>
        <span class="b-card-extra">{{ result.product.name }} · 共 {{ result.quantity }} 条</span>
      </div>

      <!-- 生成统计（对齐离线工具：总数/唯一/重码/耗时） -->
      <div class="b-card-body grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div class="b-stat">
          <div class="b-stat-label">生成总数</div>
          <div class="b-stat-value">{{ result.quantity.toLocaleString() }}</div>
          <div class="b-stat-foot">本次配置生成的追溯码总量</div>
        </div>
        <div class="b-stat">
          <div class="b-stat-label">唯一数</div>
          <div class="b-stat-value">{{ (result.quantity - result.duplicates).toLocaleString() }}</div>
          <div class="b-stat-foot">去重后可用于印刷赋码的码量</div>
        </div>
        <div class="b-stat">
          <div class="b-stat-label">跳过重码</div>
          <div class="b-stat-value" :class="result.duplicates ? 'text-amber-600' : ''">{{ result.duplicates.toLocaleString() }}</div>
          <div class="b-stat-foot">与库内已有码冲突而跳过</div>
        </div>
        <div class="b-stat">
          <div class="b-stat-label">生成耗时</div>
          <div class="b-stat-value">{{ (result.elapsedMs / 1000).toFixed(2) }}s</div>
          <div class="b-stat-foot">服务端生成与查重总耗时</div>
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
        <span class="b-card-extra">TXT 命名遵循 PRD 5.5.1 强制规范（企业ID_产品名_规格_日期）；urls.txt 每行为完整扫码地址，是离线二维码工具的输入文件（见下方「二维码图片输出」）。码文件可先「入库留档」——入库为「已生成（未绑定）」，生产时到码库管理绑定批次</span>
        <div class="flex flex-wrap items-center gap-2">
          <UButton variant="outline" color="neutral" icon="i-lucide-file-text" @click="exportTxt">导出 TXT</UButton>
          <UButton variant="outline" color="neutral" icon="i-lucide-link" @click="exportUrls">导出 urls.txt（离线工具输入）</UButton>
          <UButton color="neutral" variant="solid" icon="i-lucide-file-spreadsheet" @click="exportCsv">导出 CSV</UButton>
          <span class="b-sep" />
          <UButton v-if="canWrite"
            color="neutral"
            :variant="stocked ? 'soft' : 'solid'"
            icon="i-lucide-archive"
            :loading="stocking"
            :disabled="stocked"
            @click="doStockIn"
          >
            {{ stocked ? '已入库 ' + result.quantity + ' 条（未绑定）' : '入库留档（状态：已生成）' }}
          </UButton>
        </div>
      </div>
    </div>

    <!-- 二维码图片输出：官方离线工具（合规第一条：QR/DM 码制） -->
    <div class="b-card">
      <div class="b-card-head">
        <span class="b-card-title">二维码图片输出（离线工具）</span>
        <span class="b-card-extra">按 1049 号公告第一条生成 QR / DataMatrix 码 PNG，供印刷厂赋码</span>
      </div>
      <div class="b-card-body space-y-3">
        <div class="b-note">
          <UIcon name="i-lucide-info" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--b-text-muted)]" />
          <p class="b-note-text">二维码图片改由官方<strong>离线工具</strong>在本机生成，不再经过服务器：万张级批量不受网络与服务器限制，印刷厂、生产车间均可离线自行出图。<strong>码值统一由本平台生成</strong>（可入库留档、可被生产采集绑定），工具只负责把码渲染成 PNG —— 两边不会再出现规格码或码结构对不上的情况。码内容为完整扫码地址（<span class="font-code">{{ traceBaseUrl }}32位码</span>）。</p>
        </div>
        <ol class="space-y-1.5 text-[13px] leading-6 text-[var(--b-text-muted)]">
          <li>① 在上方「生成结果」区点【导出 urls.txt】，得到每行一个完整扫码地址的码文件（也可用【导出 TXT】或 sn 清单 CSV，工具三种都能识别）。</li>
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
      </div>
      <div class="b-card-foot">
        <span class="b-card-extra">
          {{ OFFLINE_TOOL.name }} {{ OFFLINE_TOOL.version }} · {{ OFFLINE_TOOL.platform }} · {{ OFFLINE_TOOL.size }}
        </span>
        <UButton
          color="neutral"
          variant="solid"
          icon="i-lucide-download"
          :loading="toolDownloading"
          @click="downloadOfflineTool"
        >
          下载离线工具
        </UButton>
      </div>
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
