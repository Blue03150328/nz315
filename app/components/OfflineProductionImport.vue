<script setup lang="ts">
const content=ref(''),fileName=ref(''),busy=ref(false),preview=ref<any>(null),result=ref<any>(null),error=ref('')
async function read(event:Event){const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;preview.value=null;result.value=null;error.value='';if(file.size>20*1024*1024){error.value='文件超过20MB';return}content.value=await file.text();fileName.value=file.name}
async function submit(check:boolean){busy.value=true;error.value='';try{const data=await $fetch<any>('/api/admin/production-records/import',{method:'POST',body:{content:content.value,fileName:fileName.value,preview:check}});if(check)preview.value=data;else {result.value=data;preview.value=null}}catch(e:any){error.value=e?.data?.statusMessage||'导入尚未确认，可用原文件重试；已收到的事件不会重复绑定'}finally{busy.value=false}}
</script>
<template>
 <div class="b-card"><div class="b-card-head"><h2 class="b-card-title">扫描仪生产记录</h2><span class="b-card-extra">TXT</span></div><div class="b-card-body space-y-3">
  <input type="file" accept=".txt,text/plain" :disabled="busy" aria-label="选择离线生产记录TXT" class="block w-full max-w-full text-sm text-[var(--b-text-regular)] file:mr-3 file:rounded file:border file:border-[var(--b-border)] file:bg-white file:px-3 file:py-2 file:text-sm" @change="read"><p v-if="fileName" class="b-help">{{ fileName }}</p>
  <UButton :disabled="!content||busy" :loading="busy" variant="outline" @click="submit(true)">预览校验</UButton>
  <div v-if="preview" class="space-y-2"><p>员工：{{ preview.workers.join('、') }}；{{ preview.sessions }} 个工人会话，{{ preview.records }} 条记录。</p><UButton :loading="busy" @click="submit(false)">确认导入并绑定</UButton></div>
  <p v-if="result">文件已处理：有效生产收据 {{ result.saved }}，重复 {{ result.duplicates }}，异常 {{ result.exceptions }}。再次导入仍返回原收据，不增加生产数量。</p>
  <p v-if="error" class="text-error">{{ error }}</p>
 <AdminHelp><p>上传扫描仪导出的完整生产记录，恢复任务、生产资料、员工、设备及异常记录。已入库的码按原任务绑定，重复导入不会重复生产。</p></AdminHelp>
 </div></div>
</template>
