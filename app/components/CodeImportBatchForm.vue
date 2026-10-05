<script setup lang="ts">
import type { CodeImportForm } from '#shared/types/import-report'
const form = defineModel<CodeImportForm>({ required: true })
defineProps<{ products: { id: number; name: string }[]; validCount: number; importing: boolean; canWrite: boolean }>()
const emit = defineEmits<{ submit: [] }>()
</script>
<template>
      <!-- 第三步：确认入库 -->
      <div class="b-card">
        <div class="b-card-head">
          <span class="b-card-title">3. 确认入库</span>
          <span class="b-card-extra">填写批次三要素：批号不存在自动建档，已存在自动归并（支持分次补采）</span>
        </div>
        <div class="b-form-grid md:grid-cols-2 xl:grid-cols-3">
          <div>
            <label class="b-label">关联产品 <span class="b-required">*</span></label>
            <USelect
              v-model="form.productId"
              :items="products.map((p: any) => ({ value: Number(p.id), label: p.name }))"
              placeholder="选择产品"
              class="w-full"
              :content="{ class: 'min-w-72' }"
              :ui="{ itemLabel: { class: 'whitespace-normal break-words' } }"
            />
            <p class="b-help">按码第 2-7 位登记证号自动匹配，可手动调整</p>
          </div>
          <div>
            <label class="b-label">生产批次号 <span class="b-required">*</span></label>
            <UInput v-model="form.batchNo" placeholder="与产品标签喷码一致" />
            <p class="b-help">批号已存在时自动绑定该批（分次补采归并）</p>
          </div>
          <div>
            <label class="b-label">生产日期 <span class="b-required">*</span></label>
            <UInput v-model="form.produceDate" type="date" />
            <p class="b-help">请确认与产品标签喷码日期一致</p>
          </div>
          <div>
            <label class="b-label">质量合格证号 <span class="b-required">*</span></label>
            <UInput v-model="form.qualityCertNo" placeholder="该批次质量合格证编号" />
          </div>
          <div>
            <label class="b-label">质检报告号</label>
            <UInput v-model="form.qcReportNo" placeholder="选填，合格时建议填写" />
          </div>
          <div>
            <label class="b-label">有效期至</label>
            <UInput v-model="form.expireDate" type="date" />
            <p class="b-help">选填；留空可稍后在「生产批次」页补填</p>
          </div>
        </div>
        <div class="b-note">
          <UIcon name="i-lucide-info" class="mt-0.5 h-3.5 w-3.5 flex-none text-[var(--b-text-muted)]" />
          <p class="b-note-text">导入即绑定：批号不存在将自动创建批次（质检默认合格）；扫码页将展示生产日期、生产批号与质检信息（1049 号公告第五条），码状态自动流转为「已绑定」</p>
        </div>
        <div class="b-card-foot">
          <span class="b-card-extra">预计可写入 <span class="b-strong font-medium">{{ validCount }}</span> 条有效码，校验失败的码不会入库</span>
          <UButton v-if="canWrite" color="neutral" variant="solid" :loading="importing" @click="emit('submit')">
            {{ validCount ? '确认入库并保存报告' : '保存全部失败报告' }}
          </UButton>
        </div>
      </div>

</template>
