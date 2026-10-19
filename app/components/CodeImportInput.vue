<script setup lang="ts">
const content = defineModel<string>({ required: true })
defineProps<{ fileName: string; parsing: boolean; canWrite: boolean }>()
const emit = defineEmits<{ file: [event: Event]; parse: [] }>()
const fileInput = ref<HTMLInputElement | null>(null)
</script>
<template>
    <!-- 第一步：上传码文件 -->
    <div class="b-card">
      <div class="b-card-head">
        <span class="b-card-title">1. 上传码文件</span>
        <span class="b-card-extra">TXT / CSV / 扫码链接</span>
      </div>
      <div class="b-card-body space-y-3.5">
        <!-- 文件选择：隐藏的原生 input 由按钮触发 -->
        <div class="flex flex-wrap items-center gap-2">
          <input ref="fileInput" type="file" accept=".txt,.csv" class="hidden" @change="emit('file', $event)" />
          <UButton v-if="canWrite" variant="outline" color="neutral" icon="i-lucide-folder-open" @click="fileInput?.click()">选择文件</UButton>
          <span v-if="fileName" class="b-card-extra">已选择：{{ fileName }}</span>
        </div>
        <!-- 码文本：可由文件读入，也可直接粘贴 -->
        <div>
          <label class="b-label">码文本</label>
          <UTextarea
            v-model="content"
            :rows="8"
            placeholder="或在此粘贴码文本 / 扫码链接（每行一条，自动提取 32 位码）…"
            class="font-code w-full text-xs"
          />

        </div>
        <!-- 校验规则说明 -->
        <AdminHelp title="文件格式与校验规则">
        <div class="b-note">
          <UIcon name="i-lucide-info" class="mt-0.5 h-3.5 w-3.5 flex-none text-[var(--b-text-muted)]" />
          <p class="b-note-text">自动识别格式：纯 32 位码 · 扫码链接（取 code 参数）· CSV 清单行（跳过表头）。校验规则：32位数字 · 第1位登记类别(1/2) · 第8位生产类型(1-3) · 第9-11位规格码 · 第2-7位登记证匹配 · 系统查重</p>
        </div>
        </AdminHelp>
      </div>
      <div class="b-card-foot">
        <span class="b-card-extra">校验不入库</span>
        <UButton v-if="canWrite" color="neutral" variant="solid" :loading="parsing" @click="emit('parse')">解析校验</UButton>
      </div>
    </div>


</template>
