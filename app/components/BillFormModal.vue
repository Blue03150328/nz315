<script setup lang="ts">
// 记账表单弹窗 —— 新建 / 编辑 / 扫码预填 三用（2026-09-23，见 docs/handover/29 号）
//
// 🔴 三向联动规则（对应需求「自己填写单价、数量以及调整总金额」）：
//   - 改**数量**或**单价** → 自动算出总额（前提：用户没手工改过总额）
//   - 用户**手工改总额** → 标记 `totalLocked`，此后不再自动覆盖，并给出「按 单价×数量 重算」的还原入口
//   - **允许总额 ≠ 数量×单价**（抹零、折扣、只记得总价都属正常；服务端也采信前端总额）
//   不做"最后一个编辑的字段锁定"，是因为那样用户改完总额再改单价会得到反直觉的结果；
//   显式锁定 + 显式还原入口，行为可预测。
//
// 扫码预填：调用方把 `initial` 传进来即自动带入产品名/类别/追溯码，用户只需补数量单价（也可全跳过）。
import { BILL_CATEGORIES, BILL_CHANNELS, BILL_CROPS, BILL_UNITS } from '#shared/utils/bill-category'

/** 记账记录形状（仅供本组件内的 props 声明使用，不做跨文件导出：
 *  `<script setup>` 里的 ES 导出有编译约束，而这里没有第二个使用者） */
interface BillFormRecord {
  id?: number
  billDate?: string
  productName?: string
  dosage?: string | null
  category?: string | null
  crop?: string | null
  quantity?: number | null
  unit?: string | null
  unitPrice?: number | null
  totalAmount?: number | null
  channel?: string | null
  remark?: string | null
  /** 来源追溯码：仅新建时提交（编辑不改来源） */
  code?: string | null
}

const props = defineProps<{
  open: boolean
  /** 预填/编辑数据；带 `id` 即为编辑模式 */
  initial?: BillFormRecord | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: []
}>()

const toast = useToast()
const busy = ref(false)
/** 总额是否被用户手工改过（true 时不再自动联动） */
const totalLocked = ref(false)
const channelPreset = ref('')
const customChannel = ref('')
const isEdit = computed(() => !!props.initial?.id)

/** 本地当天（YYYY-MM-DD）。不用 toISOString —— 那是 UTC，北京时间凌晨会差一天 */
const localToday = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

const form = reactive({
  billDate: '',
  productName: '',
  dosage: '',
  category: '',
  crop: '',
  quantity: '',
  unit: '',
  unitPrice: '',
  totalAmount: '',
  channel: '',
  remark: '',
})

/** 数量×单价 → 总额（任一为空则不动） */
const recalc = () => {
  const q = form.quantity === '' ? null : Number(form.quantity)
  const p = form.unitPrice === '' ? null : Number(form.unitPrice)
  if (q === null || p === null || !Number.isFinite(q) || !Number.isFinite(p)) return
  form.totalAmount = String(Math.round(q * p * 100) / 100)
}

watch([() => form.quantity, () => form.unitPrice], () => {
  if (!totalLocked.value) recalc()
})

/** 还原：解除锁定并按 单价×数量 重算 */
const resetTotal = () => {
  totalLocked.value = false
  recalc()
}

// 每次打开时回填/重置（用 initial 快照，避免残留上一次的编辑）
watch(() => props.open, (v) => {
  if (!v) return
  const it = props.initial || {}
  const s = (v2: any) => (v2 === null || v2 === undefined ? '' : String(v2))
  form.billDate = it.billDate || localToday()
  form.productName = it.productName || ''
  form.dosage = it.dosage || ''
  form.category = it.category || ''
  form.crop = it.crop || ''
  form.quantity = s(it.quantity)
  form.unit = it.unit || ''
  form.unitPrice = s(it.unitPrice)
  form.totalAmount = s(it.totalAmount)
  form.channel = it.channel || ''
  channelPreset.value = BILL_CHANNELS.includes(form.channel as any) ? form.channel : (form.channel ? '__custom__' : '')
  customChannel.value = channelPreset.value === '__custom__' ? form.channel : ''
  form.remark = it.remark || ''
  totalLocked.value = false
  busy.value = false
})

const submit = async () => {
  if (!form.productName.trim()) {
    toast.add({ title: '请填写产品名称', color: 'warning' })
    return
  }
  if (!form.billDate) {
    toast.add({ title: '请选择记账日期', color: 'warning' })
    return
  }
  busy.value = true
  try {
    const payload: Record<string, any> = {
      billDate: form.billDate,
      productName: form.productName.trim(),
      dosage: form.dosage.trim(),
      category: form.category,
      crop: form.crop.trim(),
      quantity: form.quantity === '' ? null : Number(form.quantity),
      unit: form.unit.trim(),
      unitPrice: form.unitPrice === '' ? null : Number(form.unitPrice),
      totalAmount: form.totalAmount === '' ? 0 : Number(form.totalAmount),
      channel: (channelPreset.value === '__custom__' ? customChannel.value : channelPreset.value).trim(),
      remark: form.remark.trim(),
    }
    // 追溯码只在**新建**时提交：编辑不该改掉这条账的来源
    if (!isEdit.value && props.initial?.code) payload.code = props.initial.code

    if (isEdit.value) {
      await $fetch('/api/bill/' + props.initial!.id, { method: 'PATCH', body: payload })
    } else {
      await $fetch('/api/bill', { method: 'POST', body: payload })
    }
    toast.add({ title: isEdit.value ? '修改已保存' : '已记入账本', color: 'success' })
    emit('update:open', false)
    emit('saved')
  } catch (e: any) {
    // 服务端的中文 statusMessage 直接透出（如"记账过于频繁""记账日期不合法"），比笼统报错有用
    toast.add({ title: e?.data?.statusMessage || '保存失败，请稍后再试', color: 'error' })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UModal v-model:open="props.open" @update:open="emit('update:open', $event)">
    <template #content>
      <!-- 头部固定 / 表单区滚动 / 底部按钮吸底 —— 表单字段多，整体滚动会把「保存」推出屏幕，
           而「扫码后顺手记一笔」正是本功能的核心场景，保存按钮必须始终可见（真浏览器实测发现） -->
      <div class="flex max-h-[85vh] flex-col">
        <div class="shrink-0 border-b border-border px-5 py-4">
          <h3 class="text-base font-semibold text-default">{{ isEdit ? '编辑记账' : '记一笔' }}</h3>
          <p class="mt-1 text-xs text-muted">
            {{ isEdit ? '修改后立即生效' : '只填产品名称也能存下来，数量单价可以以后再补' }}
          </p>
        </div>

        <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <!-- 总额是记账的第一信息，浅绿色卡片让用户先完成最重要的一步。 -->
          <div class="rounded-2xl border border-success/30 bg-success/5 p-4">
            <div class="flex items-center justify-between">
              <label class="text-sm font-semibold text-default">总金额（元）</label>
              <button v-if="totalLocked" type="button" class="text-xs text-primary" @click="resetTotal">按数量×单价重算</button>
            </div>
            <UInput
              v-model="form.totalAmount"
              type="number"
              inputmode="decimal"
              step="0.01"
              min="0"
              class="mt-2 w-full"
              :ui="{ base: 'text-2xl font-bold text-error' }"
              placeholder="先填这笔花了多少钱"
              @update:model-value="totalLocked = true"
            />
            <p class="mt-1 text-xs text-muted">不知道总金额也可以先保存，数量和单价可稍后补充。</p>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-xs text-muted">记账日期</label>
              <UInput v-model="form.billDate" type="date" class="w-full" />
            </div>
            <div>
              <label class="text-xs text-muted">剂型</label>
              <UInput v-model="form.dosage" class="w-full" placeholder="扫码自动带入，如悬浮剂" />
            </div>
          </div>

          <!-- 产品名称 -->
          <div>
            <label class="text-xs text-muted">产品名称 <span class="text-error">*</span></label>
            <UInput
              v-model="form.productName"
              class="w-full"
              :maxlength="255"
              placeholder="例如：25%多·酮可湿性粉剂"
            />
          </div>

          <details :open="isEdit">
            <summary class="cursor-pointer text-sm font-medium text-primary">补充信息（选填）</summary>
            <div class="mt-3 space-y-3 rounded-xl border border-border bg-muted/20 p-3">
          <!-- 数量 + 单位 -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-xs text-muted">数量</label>
              <UInput
                v-model="form.quantity"
                type="number"
                inputmode="decimal"
                step="0.001"
                min="0"
                class="w-full"
                placeholder="选填"
              />
            </div>
            <div>
              <label class="text-xs text-muted">单位</label>
              <UInput v-model="form.unit" class="w-full" :maxlength="10" placeholder="瓶 / 袋 / 千克…" />
            </div>
          </div>
          <!-- 单位快捷填入（用户裁定单位可自由输入，这里只是省打字） -->
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="u in BILL_UNITS"
              :key="u"
              type="button"
              class="rounded-full border px-2.5 py-0.5 text-xs transition-colors"
              :class="form.unit === u ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted hover:text-default'"
              @click="form.unit = u"
            >
              {{ u }}
            </button>
          </div>

          <!-- 单价 -->
          <div>
            <label class="text-xs text-muted">单价（元）</label>
            <UInput
              v-model="form.unitPrice"
              type="number"
              inputmode="decimal"
              step="0.01"
              min="0"
              class="w-full"
              placeholder="选填"
            />
          </div>

          <!-- 渠道 + 备注 -->
          <div>
            <label class="text-xs text-muted">购买渠道</label>
            <select v-model="channelPreset" class="mt-1 block h-10 w-full rounded-lg border border-border bg-elevated px-3 text-sm text-default outline-none focus:border-primary">
              <option value="">请选择（选填）</option>
              <option v-for="channel in BILL_CHANNELS" :key="channel" :value="channel">{{ channel }}</option>
              <option value="__custom__">自定义</option>
            </select>
            <UInput v-if="channelPreset === '__custom__'" v-model="customChannel" class="mt-2 w-full" :maxlength="50" placeholder="填写购买渠道" />
          </div>

          <div>
            <label class="text-xs text-muted">用途</label>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <button v-for="item in BILL_CATEGORIES" :key="item" type="button" class="rounded-full border px-2.5 py-1 text-xs" :class="form.category === item ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted'" @click="form.category = item">{{ item }}</button>
            </div>
          </div>

          <div>
            <label class="text-xs text-muted">作物</label>
            <UInput v-model="form.crop" class="w-full" :maxlength="50" placeholder="也可以直接填写其他作物" />
            <div class="mt-2 flex flex-wrap gap-1.5">
              <button v-for="crop in BILL_CROPS" :key="crop" type="button" class="rounded-full border border-border px-2.5 py-1 text-xs text-muted" @click="form.crop = crop">{{ crop }}</button>
            </div>
          </div>

          <div>
            <label class="text-xs text-muted">备注</label>
            <UTextarea v-model="form.remark" :rows="2" class="w-full" :maxlength="500" placeholder="选填" />
          </div>
            </div>
          </details>
        </div>

        <div class="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3.5">
          <UButton variant="outline" color="neutral" @click="emit('update:open', false)">取消</UButton>
          <UButton color="primary" :loading="busy" @click="submit">保存</UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
