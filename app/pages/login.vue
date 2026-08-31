<script setup lang="ts">
// 管理后台登录页（账号密码，PRD 5.1）
definePageMeta({ layout: false })
useHead({ title: '登录' })

const router = useRouter()
const route = useRoute()
const toast = useToast()

// 开发环境才显示演示账号提示
const isDev = import.meta.dev

const { loginWithPassword } = useUser()
const loading = ref(false)
const pwForm = reactive({ username: '', password: '' })
const remember = ref(false)

// 记住登录名（仅客户端）
onMounted(() => {
  const saved = localStorage.getItem('nz315-login-name')
  if (saved) {
    pwForm.username = saved
    remember.value = true
  }
})

const doLogin = async () => {
  if (!pwForm.username.trim()) { toast.add({ title: '请输入账号', color: 'warning' }); return }
  if (!pwForm.password) { toast.add({ title: '请输入密码', color: 'warning' }); return }
  loading.value = true
  try {
    await loginWithPassword(pwForm.username.trim(), pwForm.password)
    if (remember.value) localStorage.setItem('nz315-login-name', pwForm.username.trim())
    else localStorage.removeItem('nz315-login-name')
    toast.add({ title: '登录成功，欢迎回来', color: 'success' })
    const redirect = String(route.query.redirect || '/admin')
    await router.push(redirect)
  } catch (e: unknown) {
    toast.add({ title: e instanceof Error ? e.message : '登录失败，请稍后重试', color: 'error' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-muted/40 px-4">
    <div class="w-full max-w-sm">
      <div class="mb-8 text-center">
        <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-white shadow-lg shadow-primary/30">
          <UIcon name="i-lucide-leaf" class="h-7 w-7" />
        </div>
        <p class="text-sm text-muted">欢迎回来</p>
        <h1 class="mt-1 text-2xl font-bold text-default">农资315 · 追溯码管理平台</h1>
        <p class="mt-2 text-sm text-muted">请使用企业分配的账号登录系统</p>
      </div>

      <div class="rounded-xl border border-border bg-elevated p-6">
        <div class="space-y-1.5">
          <label class="block text-sm font-medium text-default">账号</label>
          <UInput
            v-model="pwForm.username"
            size="lg"
            class="w-full"
            placeholder="请输入企业分配的账号"
            autocomplete="username"
            @keyup.enter="doLogin"
          />
        </div>

        <div class="mt-4 space-y-1.5">
          <label class="block text-sm font-medium text-default">密码</label>
          <UInput
            v-model="pwForm.password"
            type="password"
            size="lg"
            class="w-full"
            placeholder="请输入密码"
            autocomplete="current-password"
            @keyup.enter="doLogin"
          />
        </div>

        <div class="mt-4 flex items-center justify-between text-sm">
          <label class="flex cursor-pointer items-center gap-2 text-muted">
            <UCheckbox v-model="remember" />
            记住我
          </label>
          <button type="button" class="text-primary hover:underline" @click="toast.add({ title: '忘记密码请联系系统管理员重置', color: 'warning' })">
            忘记密码？
          </button>
        </div>

        <UButton color="primary" size="lg" block class="mt-6" :loading="loading" @click="doLogin">
          登 录
        </UButton>

        <div class="mt-5 text-center text-sm text-muted">
          <NuxtLink to="/" class="hover:text-default">返回门户首页</NuxtLink>
        </div>
      </div>

      <div v-if="isDev" class="mt-4 rounded-lg border border-border/60 bg-muted/30 p-3 text-center text-xs text-muted">
        演示账号：admin / admin123（总部） · lvfeng / admin123（厂家） · codeop / admin123（码管理员）
      </div>
    </div>
  </div>
</template>