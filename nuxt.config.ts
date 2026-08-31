export default defineNuxtConfig({
  compatibilityDate: '2026-07-01',
  devtools: { enabled: false },
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],

  // Vite 文件监听忽略：调试残留与截图文件被浏览器锁定会触发 EBUSY
  vite: {
    server: {
      watch: {
        ignored: ['**/docs/.edge-tmp*/**', '**/docs/_tmp-*', '**/.dsh-vision-router/**'],
      },
    },
  },

  // 字体提供器：禁用 google/googleicons（外网不可达环境会超时并导致 dev 崩溃）
  fonts: {
    providers: {
      google: false,
      googleicons: false,
    },
  },

  // 图标使用本地 lucide 集合（离线，避免依赖 google fonts）
  icon: {
    serverBundle: { collections: ['lucide'] },
    clientBundle: { scan: true, sizeLimitKb: 512 },
  },

  runtimeConfig: {
    dbHost: process.env.DB_HOST || '127.0.0.1',
    dbPort: Number(process.env.DB_PORT || 3306),
    dbUser: process.env.DB_USER || 'root',
    dbPassword: process.env.DB_PASSWORD || '',
    dbName: process.env.DB_NAME || 'nz315',
    // 生产环境必须显式配置强随机 SESSION_SECRET，缺失则启动失败（防会话伪造）
    sessionSecret: process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production'
      ? (() => { throw new Error('[FATAL] 生产环境必须设置 SESSION_SECRET 环境变量（建议: openssl rand -base64 48）') })()
      : 'dev-session-secret-change-me'),
    siteName: '农资315',
    // 扫码 URL 前缀（PRD 3.3：https://{域名}/trace?code={32位码}），部署环境可用 NUXT_PUBLIC_TRACE_BASE_URL 覆盖
    public: {
      traceBaseUrl: process.env.NUXT_PUBLIC_TRACE_BASE_URL || 'https://www.nz315.cn/trace?code=',
    },
  },

  app: {
    head: {
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'format-detection', content: 'telephone=no' },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
})