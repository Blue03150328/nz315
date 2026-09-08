<script setup lang="ts">
// 登记产品选择器：从农药登记数据源（pesticide_reg，97k 条）搜索选择产品
// 服务端按生产类型过滤：持有人生产=仅本厂登记产品；委托加工/委托分装=全部（含过期过滤）
// 交互：常态显示「已选产品摘要 + 更换/清除」；点击更换进入搜索态（防抖远程搜索 + 结果列表）
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps<{
  produceType: number          // 生产类型（1持有人生产/2委托加工/3委托分装），决定服务端过滤
  enterpriseId: number | null  // 归属企业（厂家账号固定本企业；总部不传）
  company?: string | null     // 归属厂家名（总部按登记数据源厂家精确过滤；服务端 company 优先于 enterpriseId）
  disabled?: boolean           // 编辑回显阶段锁定搜索（切换产品需显式操作）
}>()
const selected = defineModel<any>('selected', { default: null })
const emit = defineEmits<{ (e: 'select', row: any): void; (e: 'clear'): void }>()

const keyword = ref('')        // 搜索关键词（登记证号/产品名/厂家）
const results = ref<any[]>([]) // 候选结果
const total = ref(0)
const loading = ref(false)
const searching = ref(false)   // 是否处于搜索态（false=显示已选摘要）
const errMsg = ref('')
const emptyReason = ref('')    // noEnterprise=总部未选企业 / noOwn=本厂无匹配 / 其他=无结果
const inputEl = ref<any>(null)
let timer: any = null

async function fetchResults() {
  if (!props.company && !props.enterpriseId && props.produceType === 1) {
    // 持有人生产必须知道归属厂家（总部）/企业（厂家账号）才能过滤
    results.value = []; total.value = 0; emptyReason.value = 'noEnterprise'; return
  }
  loading.value = true; errMsg.value = ''; emptyReason.value = ''
  try {
    const data = await $fetch<any>('/api/admin/regdata', {
      query: {
        keyword: keyword.value.trim() || undefined,
        produceType: props.produceType,
        company: props.company || undefined,
        enterpriseId: props.enterpriseId || undefined,
        page: 1, pageSize: 30,
      },
    })
    results.value = data?.rows || []
    total.value = data?.total || 0
    emptyReason.value = data?.emptyReason || ''
  } catch (e: any) {
    errMsg.value = e?.data?.statusMessage || '登记数据搜索失败'
  } finally {
    loading.value = false
  }
}

// 关键词防抖搜索
function onKeywordInput() {
  clearTimeout(timer)
  timer = setTimeout(() => { fetchResults() }, 300)
}

// 选中候选行
function pick(row: any) {
  selected.value = row
  searching.value = false
  keyword.value = ''
  results.value = []
  emit('select', row)
}

// 从「已选摘要」进入搜索态（更换产品）
function startChange() {
  if (props.disabled) return
  searching.value = true
  results.value = []
  keyword.value = ''
  fetchResults()
  setTimeout(() => inputEl.value?.$el?.querySelector('input')?.focus?.() || inputEl.value?.focus?.(), 60)
}

// 清除已选（回到未选搜索态）
function clearSelected() {
  selected.value = null
  searching.value = true
  keyword.value = ''
  results.value = []
  emit('clear')
  fetchResults()
}

// 关闭面板/复位
function cancelSearch() {
  searching.value = false
  keyword.value = ''
  results.value = []
}

// 生产类型/企业变化：搜索结果需按新过滤重新加载；若面板开启则刷新
watch(() => props.produceType, () => { if (searching.value) { results.value = []; fetchResults() } })
watch(() => props.enterpriseId, () => { if (searching.value) { results.value = []; fetchResults() } })
watch(() => props.company, () => { if (searching.value) { results.value = []; fetchResults() } })

// 弹窗打开且未选产品：自动加载默认候选（持有人生产=本厂登记产品直出列表；委托加工=最新登记）
onMounted(() => {
  if (!selected.value) {
    searching.value = true
    fetchResults()
  }
})

onBeforeUnmount(() => { clearTimeout(timer) })

// 候选行展示文本
const rowTitle = (r: any) => r.product_name || '（无产品名）'
const rowSub = (r: any) => [r.company, r.dosage, r.content, r.toxicity].filter(Boolean).join(' · ')
</script>

<template>
  <div>
    <!-- 已选摘要态 -->
    <div v-if="selected && !searching" class="rounded border border-[var(--b-border)] bg-[var(--b-fill)]/60 px-3 py-2">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-code text-[13px] font-medium text-[var(--b-text-title)]">{{ selected.registration_no }}</span>
            <span class="b-tag b-tag-success">已选</span>
          </div>
          <div class="mt-1 text-sm text-[var(--b-text-regular)]">{{ rowTitle(selected) }}</div>
          <div class="mt-0.5 truncate text-xs text-[var(--b-text-muted)]">{{ rowSub(selected) }}</div>
        </div>
        <div class="flex flex-none items-center gap-2">
          <UButton variant="outline" color="neutral" size="xs" :disabled="disabled" @click="startChange">更换</UButton>
          <UButton variant="link" color="neutral" size="xs" :disabled="disabled" @click="clearSelected">清除</UButton>
        </div>
      </div>
    </div>

    <!-- 搜索态（未选/更换中） -->
    <div v-else>
      <div class="flex items-center gap-2">
        <UInput
          ref="inputEl"
          v-model="keyword"
          icon="i-lucide-search"
          :placeholder="produceType === 1 ? '输入登记证号 / 产品名称 / 厂家搜索本厂产品' : '输入登记证号 / 产品名称 / 厂家搜索（共 9.7 万条登记）'"
          class="w-full"
          :loading="loading"
          @input="onKeywordInput"
          @keydown.enter="fetchResults"
        />
        <UButton v-if="selected" variant="link" color="neutral" size="sm" @click="cancelSearch">返回</UButton>
      </div>

      <!-- 结果列表 -->
      <div v-if="errMsg" class="mt-2 rounded border border-[var(--b-border)] bg-[var(--b-fill)]/60 px-3 py-2 text-sm text-red-600">{{ errMsg }}</div>
      <div v-else-if="emptyReason === 'noOwn'" class="mt-2 rounded border border-[var(--b-border)] bg-[var(--b-fill)]/60 px-3 py-2 text-sm text-[var(--b-text-regular)]">
        未找到与本企业名称一致的登记记录——请确认「企业信息」中的企业名称与登记证持有人名称一致，或改用「委托加工」生产类型选择其他厂家产品
      </div>
      <div v-else-if="!loading && !results.length" class="mt-2 rounded border border-[var(--b-border)] bg-[var(--b-fill)]/60 px-3 py-2 text-sm text-[var(--b-text-muted)]">
        {{ keyword ? '未找到匹配的登记记录，请调整关键词' : (produceType === 1 ? '本厂暂无登记产品' : '请输入关键词搜索登记产品（登记证号/产品名/厂家）') }}
      </div>
      <div v-else class="mt-2 max-h-60 divide-y divide-[var(--b-divider)] overflow-y-auto rounded border border-[var(--b-border)] bg-white">
        <button
          v-for="r in results"
          :key="r.registration_no"
          type="button"
          class="block w-full px-3 py-2 text-left transition-colors hover:bg-[var(--b-fill)]/70"
          @click="pick(r)"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="font-code text-[13px] font-medium text-[var(--b-text-title)]">{{ r.registration_no }}</span>
            <span class="text-xs text-[var(--b-text-muted)]">有效期至 {{ r.expire_date ? String(r.expire_date).slice(0, 10) : '-' }}</span>
          </div>
          <div class="mt-0.5 text-sm text-[var(--b-text-regular)]">{{ rowTitle(r) }}</div>
          <div class="mt-0.5 truncate text-xs text-[var(--b-text-muted)]">{{ rowSub(r) }}</div>
        </button>
        <div v-if="total > results.length" class="px-3 py-2 text-center text-xs text-[var(--b-text-muted)]">
          共 {{ total }} 条匹配，输入更精确的关键词可缩小范围
        </div>
      </div>
    </div>
  </div>
</template>
