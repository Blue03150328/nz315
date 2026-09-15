// ============================================================
// 农资315 · PM2 进程守护配置
// ------------------------------------------------------------
// 用法（在项目根目录 /var/www/nz315 下执行）：
//   pm2 start deploy/ecosystem.config.cjs
//   pm2 save
//   pm2 startup        # 按提示执行它输出的那条命令，实现开机自启
//
// 常用运维：
//   pm2 status                 查看状态
//   pm2 logs nz315 --lines 100 看日志
//   pm2 restart nz315          重启
//   pm2 reload nz315           平滑重载（fork 模式等同于 restart）
//
// ⚠️ 本项目 package.json 为 "type": "module"，因此本文件必须用 .cjs 后缀，
//    否则 Node 会按 ESM 解析 module.exports 而报错。
//
// ⚠️ Nitro 的 runtimeConfig（数据库凭据、SESSION_SECRET 等）是「构建时」
//    从 .env 读取并内嵌进 .output/ 的，运行期改 .env 不生效。
//    需要在运行期覆盖时，用下面的 env 段注入 NUXT_ 前缀变量。
// ============================================================

module.exports = {
  apps: [
    {
      name: 'nz315',
      script: '.output/server/index.mjs',
      cwd: '/var/www/nz315',

      // 2 核 4G：单实例 fork 模式最稳；将来扩容可改 cluster + instances: 2
      instances: 1,
      exec_mode: 'fork',

      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',        // 启动 30 秒内退出即视为失败，计入 max_restarts
      restart_delay: 3000,      // 崩溃后 3 秒重启，防重启风暴
      max_memory_restart: '800M',
      kill_timeout: 5000,
      wait_ready: false,

      // 只监听回环地址，对外一律走 nginx 反代（避免 3000 端口直接暴露公网）
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: 3000,
        // Nitro 原生变量名，双写以防版本差异
        NITRO_HOST: '127.0.0.1',
        NITRO_PORT: 3000,

        // ↓↓↓ 运行期覆盖项（可选）——留空则用构建时内嵌值
        // NUXT_SESSION_SECRET: '<强随机值，轮换密钥时填，可免于重新构建>',
        // NUXT_DB_PASSWORD:    '<数据库密码>',
        // NUXT_WECHAT_APP_SECRET: '<微信 AppSecret>',

        // 扫码 URL 前缀（生成页二维码内容）
        NUXT_PUBLIC_TRACE_BASE_URL: 'https://www.nz315.cn/trace?code=',
      },

      out_file: '/var/log/nz315/out.log',
      error_file: '/var/log/nz315/error.log',
      merge_logs: true,
      time: true,
    },
  ],
}
