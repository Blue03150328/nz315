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
//   pm2 reload nz315           平滑重载（fork 模式等同于 restart）
//
// 🔴 本机与别人的正式站 www.cynx.cn **共用同一个 PM2 daemon**：
//    只能 reload nz315，**绝不** pm2 kill / pm2 delete all（会把 cynx 一起干掉）
//
// ⚠️ 本项目 package.json 为 "type": "module"，因此本文件必须用 .cjs 后缀，
//    否则 Node 会按 ESM 解析 module.exports 而报错。
//
// ⚠️ Nitro 的 runtimeConfig（数据库凭据、SESSION_SECRET 等）是「构建时」
//    从 .env 读取并内嵌进 .output/ 的，运行期改 .env 不生效。
//    需要在运行期覆盖时，用下面的 env 段注入 NUXT_ 前缀变量。
//
// 🔴🔴 服务器专用端口与解释器（2026-09-19 入库，此前只存在于服务器本地那份）
//    · 端口必须是 **3100** —— 3000 是 cynx 的，抢过去别人的正式站当场挂；
//    · 解释器必须是 **/usr/local/node22/bin/node** —— 这台机器的 PM2 God Daemon
//      挂在系统 Node v20 上（那是给 cynx 的），而 nz315 需要 Node ≥ 22。
//    历史教训：本文件曾长期是**未修正的原始版**（PORT 3000、无 interpreter），
//    于是"上传新代码包覆盖解包"每次都会把服务器上手工改好的那份盖掉，12 号与 17 号
//    部署文档都不得不专门写一步把它换回来。2026-09-19 直接把修正版入库，这个雷从此不存在：
//    解包后 `grep -nE "PORT|interpreter"` 应当直接看到 3100 与 node22。
// ============================================================

module.exports = {
  apps: [
    {
      name: 'nz315',
      script: '.output/server/index.mjs',
      cwd: '/var/www/nz315',

      // 服务器专用解释器：Node 22（系统默认那个 v20 是 cynx 用的，别动）
      interpreter: '/usr/local/node22/bin/node',

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

      // 只监听回环地址，对外一律走 nginx 反代（避免端口直接暴露公网）
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: 3100,
        // Nitro 原生变量名，双写以防版本差异
        NITRO_HOST: '127.0.0.1',
        NITRO_PORT: 3100,

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
