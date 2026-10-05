<script setup lang="ts">
const props = defineProps<{ form: Record<string, any>; count: number; current?: Record<string, any> | null; clearsExpiry?: boolean }>()
const changes = computed(() => [
  { label: '生产日期', key: 'produceDate', old: 'produce_date' },
  { label: '有效期至', key: 'expireDate', old: 'expire_date' },
  { label: '质检结果', key: 'qcResult', old: 'qc_result' },
  { label: '合格证号', key: 'qualityCertNo', old: 'quality_cert_no' },
].filter(f => (props.clearsExpiry && f.key === 'expireDate') || (props.form[f.key] !== undefined && props.form[f.key] !== null && props.form[f.key] !== '' && props.form[f.key] !== 'keep')).map(f => ({
  label: f.label,
  before: props.current?.[f.old] ?? '保持各码原值',
  after: f.key === 'qcResult' ? (Number(props.form[f.key]) === 1 ? '合格' : '不合格') : (props.form[f.key] || '清空'),
})))
</script>

<template>
  <div class="b-note block">
    <p class="b-note-text">本次影响 {{ count }} 条选定追溯码，范围外的码保持原值。{{ clearsExpiry ? '有效期留空表示清空。' : '未填写字段保持原值。' }}绑定批次时先带入目标批次信息，再应用下列修正。</p>
    <ul v-if="changes.length" class="mt-2 space-y-1 text-sm">
      <li v-for="change in changes" :key="change.label">{{ change.label }}：{{ change.before }} → {{ change.after }}</li>
    </ul>
  </div>
</template>
