<script setup lang="ts">
// 公众端扫码反馈入口（PRD 8 类异常-7：扫码页信息有误 → 提交反馈）
//
// 2026-09-23 新增（缺陷清单 N2）。此前入口的 `v-if` 门设在 `resultType === 'mismatch'` 上，
// 而 `trace.get.ts` **从不产出该值** ⇒ 按钮永不出现；就算出现，点了也只弹「信息反馈功能建设中，敬请期待」。
//
// 抽成独立组件的原因：**正品页（TraceResult）与异常页（TraceAlert）都要有入口**，
// 各写一套弹窗 + 提交逻辑必然漂移。
//   - 异常页：除「已作废」外都可反馈（作废码是终态，不必收集）
//   - 正品页：也要有 —— 消费者要发现「信息与包装标签不符」，**必须先在页面上看到产品信息**，
//     而产品信息只在正品页展示 ⇒ 只放异常页 = 把最该反馈的人挡在外面
//
// 反馈去向：`POST /api/feedback` → 落 `risk_alert(alert_type=7)`，后台在「风险预警中心」处理（零 DDL）。
const props = defineProps<{
  code: string
  resultType: string
  /** 按钮文案（默认「信息有误，点此反馈」） */
  label?: string
  variant?: 'solid' | 'outline' | 'soft' | 'subtle' | 'ghost' | 'link'
  color?: 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'
  size?: 'xs' | 'sm' | 'md' | 'lg'
  icon?: string
  /** 是否撑满一行（异常页两列并排时不撑满；正品页文字入口不需要） */
  block?: boolean
}>()

const open = ref(false)
const content = ref('')
const contact = ref('')
const busy = ref(false)
const toast = useToast()

// 与服务端同一口径：10–500 字（前端先挡一道，避免用户白填一次才被拒）
const trimmedLen = computed(() => content.value.trim().length)
const canSubmit = computed(() => trimmedLen.value >= 10 && trimmedLen.value <= 500)

const submit = async () => {
  busy.value = true
  try {
    await $fetch('/api/feedback', {
      method: 'POST',
      body: {
        code: props.code,
        content: content.value.trim(),
        contact: contact.value.trim(),
        resultType: props.resultType,
      },
    })
    open.value = false
    content.value = ''
    contact.value = ''
    toast.add({ title: '已收到反馈，我们会尽快核实', color: 'success' })
  } catch (e: any) {
    // 服务端 429/400 的中文 statusMessage 直接透出，比笼统的"提交失败"更有用
    toast.add({ title: e?.data?.statusMessage || '提交失败，请稍后再试', color: 'error' })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div :class="block ? 'w-full' : 'inline-block'">
    <UButton
      :variant="variant || 'outline'"
      :color="color || 'neutral'"
      :size="size || 'sm'"
      :icon="icon"
      :block="block"
      @click="open = true"
    >
      {{ label || '信息有误，点此反馈' }}
    </UButton>

    <UModal v-model:open="open">
      <template #content>
        <div class="p-5">
          <h3 class="text-base font-semibold text-default">提交反馈</h3>
          <p class="mt-1 text-xs text-muted">
            如果你发现页面信息与包装标签不一致，请描述具体差异（例如：标签上的生产日期与页面显示不同）。
            我们会转交生产企业核实。
          </p>

          <div class="mt-4 space-y-3">
            <div>
              <label class="text-xs text-muted">反馈内容（10–500 字）</label>
              <UTextarea
                v-model="content"
                :rows="4"
                class="w-full"
                :maxlength="500"
                placeholder="请描述你看到的不一致之处…"
              />
              <p class="mt-1 text-right text-xs text-muted">{{ content.length }} / 500</p>
            </div>
            <div>
              <label class="text-xs text-muted">联系方式（选填）</label>
              <UInput
                v-model="contact"
                class="w-full"
                :maxlength="64"
                placeholder="手机号 / 微信，方便企业联系你核实"
              />
            </div>
          </div>

          <div class="mt-5 flex justify-end gap-2">
            <UButton variant="outline" color="neutral" @click="open = false">取消</UButton>
            <UButton color="primary" :disabled="!canSubmit" :loading="busy" @click="submit">提交</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
