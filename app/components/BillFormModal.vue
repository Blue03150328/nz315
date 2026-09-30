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
// 扫码预填：调用方把 `initial` 传进来即自动带入产品名/类别/追溯码，用户只需补金额；
// 数量、单价、作物等补充信息保存后仍可继续完善。
import { BILL_CATEGORIES, BILL_CHANNELS, BILL_CROPS, BILL_LIMITS, BILL_UNITS } from '#shared/utils/bill-category'

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
  storeName?: string | null
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
const isEdit = computed(() => !!props.initial?.id)

/** 四个「下拉 + 自定义」字段共用的哨兵值：选中它就展开输入框，由用户自己写 */
const PRESET_CUSTOM = '__custom__'

/** 下拉框统一样式。用原生 `select` 而非组件库下拉 —— 它自带箭头、在手机上唤起系统选择器，
 *  且与改造前的购买渠道下拉完全同款（用户要求"全部做成箭头下拉框"，视觉必须一致） */
const SELECT_CLASS =
  'mt-1 block h-10 w-full rounded-lg border border-border bg-elevated px-3 text-sm text-default outline-none focus:border-primary'

/** 「下拉选中项 + 自定义输入」拆成两半存：
 *  `preset` 为空串 = 不填；`preset === PRESET_CUSTOM` = 取 `custom` 的值；否则取预设项本身。 */
type PickKey = 'unit' | 'crop' | 'category' | 'channel'
const picker = reactive<Record<PickKey, { preset: string; custom: string }>>({
  unit: { preset: '', custom: '' },
  crop: { preset: '', custom: '' },
  category: { preset: '', custom: '' },
  channel: { preset: '', custom: '' },
})

/** 把已存值拆成「下拉选中项 + 自定义输入」两半：命中预设项就选中它，否则落到「自定义」并回填输入框。
 *  🔴 这条是编辑态的数据安全线：老账里「单位=毫升」不在预设清单内，若不回填，用户一进编辑就
 *  看到空下拉 —— 一保存就把原值抹成空（PATCH 语义下 unit 出现过即会被覆盖）。 */
const fillPicker = (key: PickKey, value: unknown, options: readonly string[]) => {
  const v = String(value ?? '').trim()
  if (!v) {
    picker[key].preset = ''
    picker[key].custom = ''
  } else if (options.includes(v)) {
    picker[key].preset = v
    picker[key].custom = ''
  } else {
    picker[key].preset = PRESET_CUSTOM
    picker[key].custom = v
  }
}

/** 取最终提交值：选的是「自定义」就取输入框内容，否则取下拉选中项 */
const pickValue = (key: PickKey) => {
  const p = picker[key]
  return (p.preset === PRESET_CUSTOM ? p.custom : p.preset).trim()
}

/** 四个自定义输入框的组件实例（用普通对象存即可，不需要响应式） */
const customEls: Record<PickKey, any> = { unit: null, crop: null, category: null, channel: null }

/** 下拉切到「自定义…」时，把焦点主动送进刚出现的输入框。
 *  🔴 这不是锦上添花 —— 用户实测反馈过「选了自定义却不能自己输入」，但对照实验证明逻辑本身是通的：
 *  真到了手机上，输入框虽然渲染了，却落在弹窗滚动区里不显眼的位置，用户以为没得填就走了。
 *  主动聚焦会顺势把它滚进可视区（手机还会直接弹出键盘），把「能填」变成「一眼就能填」。
 *  只在**用户手动切换下拉**时触发；回填老账（编辑态）不打扰，否则一开弹窗页面就被滚走。 */
const onPresetChange = (key: PickKey) => {
  if (picker[key].preset !== PRESET_CUSTOM) return
  nextTick(() => {
    const root = customEls[key] && (customEls[key].$el || customEls[key])
    const input = root && (root.tagName === 'INPUT' ? root : (root.querySelector ? root.querySelector('input') : null))
    if (input && typeof input.focus === 'function') input.focus()
  })
}

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
  storeName: '',
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
  form.storeName = it.storeName || ''
  form.remark = it.remark || ''
  // 四个下拉各自拆「预设 / 自定义」——非预设的历史值一律落回自定义输入框，绝不静默丢失
  fillPicker('unit', form.unit, BILL_UNITS)
  fillPicker('crop', form.crop, BILL_CROPS)
  fillPicker('category', form.category, BILL_CATEGORIES)
  fillPicker('channel', form.channel, BILL_CHANNELS)
  totalLocked.value = false
  busy.value = false
})

const submit = async () => {
  if (!form.productName.trim()) {
    toast.add({ title: '请填写产品名称', color: 'warning' })
    return
  }
  const amount = Number(form.totalAmount)
  if (form.totalAmount.trim() === '' || !Number.isFinite(amount) || amount < 0) {
    toast.add({ title: '请填写有效的总金额', color: 'warning' })
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
      category: pickValue('category'),
      crop: pickValue('crop'),
      quantity: form.quantity === '' ? null : Number(form.quantity),
      unit: pickValue('unit'),
      unitPrice: form.unitPrice === '' ? null : Number(form.unitPrice),
      totalAmount: amount,
      channel: pickValue('channel'),
      storeName: pickValue('channel') === '农资店' ? form.storeName.trim() : '',
      remark: form.remark.trim(),
    }
    // 追溯码只在**新建**时提交：编辑不该改掉这条账的来源
    if (!isEdit.value && props.initial?.code) payload.code = props.initial.code

    if (isEdit.value) {
      await $fetch('/api/bill/' + props.initial!.id, { method: 'PATCH', body: payload })
    } else {
      await $fetch('/api/bill', { method: 'POST', body: payload })
    }
    const missing = [
      form.quantity === '' ? '数量' : '',
      form.unitPrice === '' ? '单价' : '',
      !pickValue('crop') ? '作物' : '',
      !pickValue('channel') ? '购买渠道' : '',
    ].filter(Boolean)
    toast.add({
      title: isEdit.value ? '修改已保存' : '已记入账本',
      description: missing.length ? '还可补充：' + missing.join('、') : undefined,
      color: 'success',
    })
    emit('update:open', false)
    emit('saved')
  } catch (e: any) {
    if (!isEdit.value && (e?.statusCode === 409 || e?.data?.statusCode === 409) && import.meta.client) {
      const ok = window.confirm('发现相同日期、产品和金额的记账，可能是重复提交。仍要保存吗？')
      if (ok) {
        try {
          const payload: Record<string, any> = {
            billDate: form.billDate, productName: form.productName.trim(), dosage: form.dosage.trim(),
            category: pickValue('category'), crop: pickValue('crop'), quantity: form.quantity === '' ? null : Number(form.quantity),
            unit: pickValue('unit'), unitPrice: form.unitPrice === '' ? null : Number(form.unitPrice), totalAmount: amount,
            channel: pickValue('channel'), storeName: pickValue('channel') === '农资店' ? form.storeName.trim() : '', remark: form.remark.trim(), confirmDuplicate: true,
          }
          if (props.initial?.code) payload.code = props.initial.code
          await $fetch('/api/bill', { method: 'POST', body: payload })
          toast.add({ title: '已记入账本', color: 'success' })
          emit('update:open', false); emit('saved')
        } catch (retry: any) { toast.add({ title: retry?.data?.statusMessage || '保存失败，请稍后再试', color: 'error' }) }
        finally { busy.value = false }
      } else { busy.value = false }
      return
    }
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
            {{ isEdit ? '修改后立即生效' : '总金额必填，数量、单价等信息可以以后再补' }}
          </p>
        </div>

        <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <!-- 总额是记账的第一信息，浅绿色卡片让用户先完成最重要的一步。 -->
          <div class="rounded-2xl border border-success/30 bg-success/5 p-4">
            <div class="flex items-center justify-between">
            <label class="text-sm font-semibold text-default">总金额（元） <span class="text-error">*</span></label>
              <button v-if="totalLocked" type="button" class="text-xs text-primary" @click="resetTotal">按数量×单价重算</button>
            </div>
            <UInput
              v-model="form.totalAmount"
              type="number"
              inputmode="decimal"
              step="0.01"
              min="0"
              class="mt-2 w-full"
              :ui="{ base: 'text-2xl font-bold text-default' }"
              placeholder="先填这笔花了多少钱"
              @update:model-value="totalLocked = true"
            />
            <p class="mt-1 text-xs text-muted">总金额必填；数量、单价、作物等信息可以稍后补充。</p>
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
          <!-- 数量 + 单位（单位原有的一排快捷芯片已收进下拉，「自定义…」仍可自由输入） -->
          <div class="grid grid-cols-2 items-start gap-3">
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
              <select v-model="picker.unit.preset" :class="SELECT_CLASS" @change="onPresetChange('unit')">
                <option value="">不填</option>
                <option v-for="u in BILL_UNITS" :key="u" :value="u">{{ u }}</option>
                <option :value="PRESET_CUSTOM">自定义…</option>
              </select>
              <UInput
                v-if="picker.unit.preset === PRESET_CUSTOM"
                :ref="(el: any) => (customEls.unit = el)"
                v-model="picker.unit.custom"
                class="mt-2 w-full"
                :maxlength="BILL_LIMITS.unitMax"
                placeholder="填写单位，如 毫升"
              />
            </div>
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

          <div>
            <label class="text-xs text-muted">购买渠道</label>
            <select v-model="picker.channel.preset" :class="SELECT_CLASS" @change="onPresetChange('channel')">
              <option value="">请选择（选填）</option>
              <option v-for="channel in BILL_CHANNELS" :key="channel" :value="channel">{{ channel }}</option>
              <option :value="PRESET_CUSTOM">自定义…</option>
            </select>
            <UInput
              v-if="picker.channel.preset === PRESET_CUSTOM"
              :ref="(el: any) => (customEls.channel = el)"
              v-model="picker.channel.custom"
              class="mt-2 w-full"
              :maxlength="BILL_LIMITS.channelMax"
              placeholder="填写购买渠道，如 乡镇代购点"
            />
            <UInput
              v-if="pickValue('channel') === '农资店'"
              v-model="form.storeName"
              class="mt-2 w-full"
              maxlength="100"
              placeholder="具体门店（选填，如 XX 农资店）"
            />
          </div>

          <div>
            <label class="text-xs text-muted">用途</label>
            <select v-model="picker.category.preset" :class="SELECT_CLASS" @change="onPresetChange('category')">
              <option value="">不填（统计记为「其他支出」）</option>
              <option v-for="item in BILL_CATEGORIES" :key="item" :value="item">{{ item }}</option>
              <option :value="PRESET_CUSTOM">自定义…</option>
            </select>
            <UInput
              v-if="picker.category.preset === PRESET_CUSTOM"
              :ref="(el: any) => (customEls.category = el)"
              v-model="picker.category.custom"
              class="mt-2 w-full"
              :maxlength="20"
              placeholder="填写用途，如 生长调节剂"
            />
            <p v-if="picker.category.preset === PRESET_CUSTOM" class="mt-1 text-xs text-muted">
              统计时会按关键词自动归类，无法归类的一律记为「其他支出」。
            </p>
          </div>

          <div>
            <label class="text-xs text-muted">作物</label>
            <select v-model="picker.crop.preset" :class="SELECT_CLASS" @change="onPresetChange('crop')">
              <option value="">不填</option>
              <option v-for="crop in BILL_CROPS" :key="crop" :value="crop">{{ crop }}</option>
              <option :value="PRESET_CUSTOM">自定义…</option>
            </select>
            <UInput
              v-if="picker.crop.preset === PRESET_CUSTOM"
              :ref="(el: any) => (customEls.crop = el)"
              v-model="picker.crop.custom"
              class="mt-2 w-full"
              :maxlength="BILL_LIMITS.cropMax"
              placeholder="填写其他作物"
            />
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
