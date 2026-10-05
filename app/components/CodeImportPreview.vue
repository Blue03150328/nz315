<script setup lang="ts">
import type { CodeImportPreview } from '#shared/types/code-import'
const props = defineProps<{ result: CodeImportPreview }>()
const reasonChips = computed(() => Object.entries(props.result.reasonCount || {}).map(([label, count]) => ({ label, count })))
</script>
<template><div class="space-y-4">
      <!-- 第二步：校验结果统计指标卡 -->
      <div class="grid gap-4 sm:grid-cols-3">
        <div class="b-stat">
          <div class="b-stat-label">总码数</div>
          <div class="b-stat-value">{{ result.total }}</div>
          <div class="b-stat-foot">本次解析读取的码总量</div>
        </div>
        <div class="b-stat">
          <div class="b-stat-label">校验通过</div>
          <div class="b-stat-value">{{ result.validCount }}</div>
          <div class="b-stat-foot"><span class="b-tag b-tag-success">可导入 {{ result.validCount }} 条</span></div>
        </div>
        <div class="b-stat">
          <div class="b-stat-label">校验失败</div>
          <div class="b-stat-value">{{ result.invalidCount }}</div>
          <div class="b-stat-foot"><span class="b-tag b-tag-danger">需修正 {{ result.invalidCount }} 条</span></div>
        </div>
      </div>

      <!-- 校验明细：失败原因分布 + 自动匹配产品 + 预览表格 -->
      <div class="b-card b-card-clip">
        <div class="b-card-head">
          <span class="b-card-title">2. 校验结果</span>
          <span class="b-card-extra">仅预览前 {{ result.preview?.length || 0 }} 条明细</span>
        </div>
        <div v-if="reasonChips.length || result.productGroups?.length" class="b-card-body space-y-3.5">
          <div v-if="reasonChips.length">
            <div class="b-label">失败原因分布</div>
            <div class="flex flex-wrap gap-2">
              <span v-for="c in reasonChips" :key="c.label" class="b-tag b-tag-danger">
                {{ c.label }} × {{ c.count }}
              </span>
            </div>
          </div>
          <div v-if="result.productGroups?.length">
            <div class="b-label">自动匹配产品（按码第 2-7 位登记证号）</div>
            <div class="flex flex-wrap gap-2">
              <span v-for="g in result.productGroups" :key="g.productId" class="b-tag b-tag-info">
                {{ g.productName }}（{{ g.count }} 条）
              </span>
            </div>
          </div>
        </div>
        <!-- 明细预览表格 -->
        <div v-if="result.preview?.length" class="b-scroll-x">
          <table class="b-table">
            <thead>
              <tr>
                <th>原始行号</th><th>追溯码</th>
                <th>状态</th>
                <th>原因 / 匹配</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in result.preview" :key="r.lineNumber"><td>{{ r.lineNumber }}</td>
                <td><span class="font-code b-strong text-[13px]">{{ r.code }}</span></td>
                <td>
                  <span class="b-tag" :class="r.valid ? 'b-tag-success' : 'b-tag-danger'">
                    {{ r.valid ? '通过' : '失败' }}
                  </span>
                </td>
                <td>{{ r.valid ? '已匹配产品' : r.reason }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>


</div></template>
