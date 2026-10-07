<script setup lang="ts">
// 公众端扫码结果页「一键举报」入口 + 弹窗（2026-09-23 新增）
//
// 场景：消费者扫码得到**异常结果**（非本平台签发 / 查无此码 / 已作废 / 已冻结 / 登记证过期 /
// 产品过有效期 / 重复查询）时，页面上要有一条明确的举报通道 —— 原来一条都没有：
// 消费者发现可疑产品，页面上只能看到一句「请勿购买使用」，然后就没有任何下一步。
//
// 本组件刻意只做两件事：
//   ① 把**主管部门的受理渠道**摆到用户面前（12316 全国农业系统公益服务统一热线
//      + 当地农业农村局官网 / 微信公众号）；
//   ② 把本次扫码的追溯码备好，举报时不用手打。
//
// 🔴 刻意**不落库、不调接口**：举报的受理方是农业农村部门，本平台收下也无权处理，
//    与其造一个没有处理流程的工单，不如把用户直接送到主管渠道。
//    另外，本项目每加一个「公众可写接口」都要配套防刷与运营流程（N2 的教训：`feedback.post.ts`
//    是本项目第一个匿名写接口，限流必须放在入参校验之后）。将来若确要做平台内举报工单，
//    应复用 `feedback.post.ts` 那套限流与存储，而不是另起一套。
const props = defineProps<{
  /** 本次扫码的 32 位追溯码（供用户向受理方提供，便于定位） */
  code?: string
  /** 按钮文案（默认「一键举报」） */
  label?: string
  variant?: 'solid' | 'outline' | 'soft' | 'subtle' | 'ghost' | 'link'
  color?: 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'
  size?: 'xs' | 'sm' | 'md' | 'lg'
  icon?: string
  /** 是否撑满一行 */
  block?: boolean
}>()

const open = ref(false)
const toast = useToast()

/** 举报热线（农业农村部全国农业系统公益服务统一热线） */
const HOTLINE = '12316'

const copyCode = async () => {
  if (!props.code) return
  try {
    await navigator.clipboard.writeText(props.code)
    toast.add({ title: '追溯码已复制，举报时一并提供便于定位', color: 'success' })
  } catch {
    toast.add({ title: '复制失败，请手动长按选择复制', color: 'warning' })
  }
}
</script>

<template>
  <div :class="block ? 'w-full' : 'inline-block'">
    <UButton
      :variant="variant || 'solid'"
      :color="color || 'error'"
      :size="size || 'lg'"
      :icon="icon || 'i-lucide-megaphone'"
      :block="block"
      @click="open = true"
    >
      {{ label || '一键举报' }}
    </UButton>

    <UModal v-model:open="open">
      <template #content>
        <div class="p-5">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-megaphone" class="h-5 w-5 text-error" />
            <h3 class="text-base font-semibold text-default">举报投诉渠道</h3>
          </div>
          <p class="mt-2 text-xs leading-relaxed text-muted">
            如你怀疑买到假冒伪劣农药，或发现追溯信息与包装标签不符，请通过以下官方渠道举报。
            本平台不直接受理举报，但已把主管渠道与本次扫码信息给你备好。
          </p>

          <div class="mt-4 rounded-xl border border-error/30 bg-error/5 p-4 text-center">
            <div class="text-xs text-muted">全国农业系统公益服务统一热线</div>
            <a
              href="tel:12316"
              class="mt-1 block font-code text-[38px] font-extrabold leading-none tracking-wider text-error no-underline"
            >
              {{ HOTLINE }}
            </a>
            <p class="mt-2 text-xs text-muted">手机上点击号码即可直接拨打</p>
          </div>

          <p class="mt-3 rounded-lg bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-default">
            此外，您还可以通过当地农业农村局的官方网站或微信公众号提交举报信息。
          </p>

          <div v-if="code" class="mt-4 rounded-lg border border-border p-3">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs text-muted">本次查询的追溯码（举报时一并提供，便于定位）</span>
              <UButton variant="ghost" color="neutral" size="xs" icon="i-lucide-copy" @click="copyCode">
                复制
              </UButton>
            </div>
            <div class="mt-1 font-code text-xs break-all text-default">{{ code }}</div>
          </div>

          <div class="mt-5 flex justify-end">
            <UButton variant="outline" color="neutral" @click="open = false">关闭</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
