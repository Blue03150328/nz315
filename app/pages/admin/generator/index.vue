<script setup lang="ts">
// 追溯码生成（PRD 5.5.1：离线生成工具 Web 版——生成不入库，导出文件后经生产采集导入）
// 自定义段配置对齐 PRD 3.2：时间戳段 + 随机数字段 + 校验位段；导出命名对齐 PRD 5.5.1 强制命名规范
// 二维码图片输出对齐合规第一条（QR/DM 码制，供印刷厂赋码）
// Keep-Alive 页面缓存：左侧菜单切换后返回保留页面状态（表单/筛选/页码/预览）；刷新、退出登录自动清空；页内【重置】恢复初始
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

const doGenerate = async () => {
  if (!form.productId) { toast.add({ title: '请选择产品', color: 'warning' }); return }
  if (form.quantity < 1 || form.quantity > 10000) { toast.add({ title: '生成数量须为 1-10000', color: 'warning' }); return }
  imgResult.value = null // 新一批码，清空图片输出结果
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
  <div class="space-y-4">
    <!-- 页面标题区 -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="b-page-title">追溯码生成</h1>
        <p class="b-page-desc">按 1049 号公告结构批量生成 32 位追溯码（生成不入库，导出后经生产采集导入；二维码图片供印刷厂赋码）</p>
      </div>
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
            <UInput v-model.number="form.quantity" type="number" min="1" max="10000" />
            <p class="b-help">1-10000 条/次</p>
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
          <UButton color="neutral" variant="solid" icon="i-lucide-wand-2" :loading="generating" @click="doGenerate">
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
        <span class="b-card-extra">TXT 命名遵循 PRD 5.5.1 强制规范（企业ID_产品名_规格_日期）；urls.txt 每行为完整扫码地址，可直接用于二维码印刷</span>
        <div class="flex flex-wrap items-center gap-2">
          <UButton variant="outline" color="neutral" icon="i-lucide-file-text" @click="exportTxt">导出 TXT</UButton>
          <UButton variant="outline" color="neutral" icon="i-lucide-link" @click="exportUrls">导出 urls.txt</UButton>
          <UButton color="neutral" variant="solid" icon="i-lucide-file-spreadsheet" @click="exportCsv">导出 CSV</UButton>
        </div>
      </div>
    </div>

    <!-- 二维码图片输出（合规第一条：QR/DM 码制） -->
    <div v-if="result" class="b-card">
      <div class="b-card-head">
        <span class="b-card-title">二维码图片输出</span>
        <span class="b-card-extra">按 1049 号公告第一条生成 QR / DataMatrix 码 PNG，zip 打包供印刷厂赋码</span>
      </div>
      <div class="b-form-grid md:grid-cols-2 xl:grid-cols-3">
        <div>
          <label class="b-label">码制</label>
          <USelect v-model="imgForm.codeType" class="w-full" :items="[
            { value: 'QR', label: 'QR 码（推荐）' },
            { value: 'DM', label: 'DataMatrix 码' },
          ]" />
        </div>
        <div>
          <label class="b-label">模块大小（像素）</label>
          <UInput v-model.number="imgForm.moduleSize" type="number" min="1" max="20" />
        </div>
        <div>
          <label class="b-label">静区白边（模块）</label>
          <UInput v-model.number="imgForm.quietZone" type="number" min="0" max="20" />
        </div>
        <div>
          <label class="b-label">数量（留空 = 全部）</label>
          <UInput v-model.number="imgForm.count" type="number" min="1" placeholder="全部" />
        </div>
        <div>
          <label class="b-label">文件名前缀</label>
          <UInput v-model="imgForm.prefix" placeholder="默认：登记证号_产品名_数量_日期" />
        </div>
        <div>
          <label class="b-label">起始序号</label>
          <UInput v-model.number="imgForm.startIndex" type="number" min="1" />
        </div>
      </div>
      <div class="px-4 pb-3.5">
        <div class="b-note">
          <UIcon name="i-lucide-info" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--b-text-muted)]" />
          <p class="b-note-text">模块大小印刷推荐 3-6；静区白边印刷必须 ≥2（保证识读率）；文件名示例：{前缀}_0001.png</p>
        </div>
      </div>
      <div class="b-card-foot">
        <span class="b-card-extra">图片生成不影响已生成的码，可重复调整参数后再生成</span>
        <UButton color="neutral" variant="solid" icon="i-lucide-qr-code" :loading="imgGenerating" @click="doGenImages">
          生成二维码图片
        </UButton>
      </div>

      <!-- 图片生成结果 -->
      <div v-if="imgResult" class="border-t border-[var(--b-divider)] p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div class="b-card-title">{{ imgResult.type === 'DM' ? 'DataMatrix' : 'QR' }} 码生成完成</div>
            <p class="b-card-extra">成功 {{ imgResult.done }} 张<span v-if="imgResult.failed">，失败 {{ imgResult.failed }} 张</span> · 耗时 {{ (imgResult.elapsedMs / 1000).toFixed(1) }}s</p>
          </div>
          <UButton color="neutral" variant="solid" size="sm" icon="i-lucide-download" @click="downloadZip">下载 ZIP</UButton>
        </div>
        <div class="mt-3 flex flex-wrap gap-3">
          <div v-for="(b64, i) in imgResult.previews" :key="i" class="text-center">
            <img :src="'data:image/png;base64,' + b64" class="h-24 w-24 rounded border border-[var(--b-border)] bg-white object-contain p-1" :alt="'预览' + (i + 1)" />
            <div class="mt-1 text-xs text-[var(--b-text-muted)]">{{ i === 0 ? imgResult.exampleName : '...' }}</div>
          </div>
        </div>
        <p class="b-help mt-3">zip 内按 {前缀}_{序号}.png 命名（示例：{{ imgResult.exampleName }}），下载凭证一次性有效</p>
      </div>
      <div v-else class="b-empty border-t border-[var(--b-divider)]">
        <div class="b-empty-inner">
          <UIcon name="i-lucide-image" class="b-empty-icon h-8 w-8" />
          <span class="text-sm">生成后可预览前 3 张并打包下载全部 PNG</span>
        </div>
      </div>
    </div>
  </div>
</template>