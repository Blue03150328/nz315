// 开发服务器守护入口（scripts/dev-service.mjs）
//
// 用途：专供 Windows 计划任务调用的「常驻守护」进程。
// 计划任务只负责「登录时把它拉起来」，之后**它自己负责把 dev 服务守住**——
// 子进程崩了就重启，绝不因为一次崩溃就退出。
//
// 为什么不依赖计划任务的「失败后重启」或「重复触发」：
//   2026-09-11 实测两个坑——
//   ① RestartOnFailure（失败后重启）只在「计划任务启动不了这个任务」时生效，
//      不会因为任务跑起来之后内部进程退出码非 0 而重启它（实测杀掉 dev 进程后
//      LastTaskResult=0xFFFFFFFF、State=Ready、NextRunTime 为空，服务一直没起来）；
//   ② 给 LogonTrigger 挂 Repetition 时，StopAtDurationEnd=true 且没有 <Duration>
//      元素 → 重复周期长度为零 → 永不重复（导出的任务 XML 可见，NextRunTime 为空）。
// 结论：恢复能力必须做在进程内部，不能外包给任务计划程序。
//
// 退出码约定：
//   0    —— 端口已被占用（说明已有服务在跑，没必要重复启动）
//   1    —— 环境缺件（找不到 Nuxt CLI）等不可恢复错误
//   1    —— dev 服务短时间内反复崩溃，达到阈值后放弃（避免无限重启风暴）
// 只要正常守护，本进程就**一直不退出**，任务实例始终是 Running 状态。

import { spawn } from 'node:child_process'
import { appendFileSync, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = join(SCRIPT_DIR, '..')
const LOG_DIR = join(ROOT, 'logs')
const SERVER_LOG = join(LOG_DIR, 'dev-server.log')
const GUARD_LOG = join(LOG_DIR, 'dev-guard.log')
const PORT = Number(process.env.NZ315_DEV_PORT || 3100)
const HOST = '0.0.0.0'

// 单份日志上限 5MB，超出后轮转为 .1（只保留一代，避免无限堆积）
const MAX_LOG_BYTES = 5 * 1024 * 1024

// 崩溃重启策略：子进程活不过 30 秒算「快速失败」；
// 1 分钟窗口内快速失败达到 5 次就放弃并退出（交给人工/下一次登录启动）。
const RAPID_FAIL_MS = 30 * 1000
const RAPID_WINDOW_MS = 60 * 1000
const MAX_RAPID_FAILS = 5
const BASE_RESTART_DELAY_MS = 3000

/** 追加一行带时间戳的守护日志（写不进去也不影响主流程） */
function guardLog(msg) {
  try {
    appendFileSync(GUARD_LOG, `[${new Date().toISOString()}] ${msg}\n`, 'utf8')
  } catch {
    /* 忽略日志写入失败 */
  }
}

/** 日志超过上限则轮转一代 */
function rotateIfNeeded(file) {
  try {
    if (existsSync(file) && statSync(file).size > MAX_LOG_BYTES) {
      renameSync(file, file + '.1')
    }
  } catch {
    /* 轮转失败不阻塞启动 */
  }
}

/**
 * 清理跨版本残留缓存。
 * 判定逻辑与 dev-start.mjs 同源：缓存目录 mtime 早于「依赖清单/构建配置」→ 过期。
 * 刻意不拿 git 提交时间当参照（改文档提交也会误报，2026-09-11 实测踩过）。
 * 服务化之后没人在旁边看日志，缓存卡死会表现为「端口在监听但全站 502」，所以主动清一次。
 */
function clearStaleCache() {
  const refs = ['package.json', 'package-lock.json', 'nuxt.config.ts']
  let refTime = 0
  let refName = ''
  for (const f of refs) {
    try {
      const m = statSync(join(ROOT, f)).mtimeMs
      if (m > refTime) {
        refTime = m
        refName = f
      }
    } catch {
      /* 文件不存在则跳过 */
    }
  }
  if (!refTime) return

  for (const d of ['.nuxt', join('node_modules', '.cache'), join('node_modules', '.vite')]) {
    const full = join(ROOT, d)
    try {
      if (!existsSync(full)) continue
      if (statSync(full).mtimeMs < refTime) {
        rmSync(full, { recursive: true, force: true })
        guardLog(`已清理跨版本残留缓存 ${d}（早于 ${refName}）`)
      }
    } catch (e) {
      guardLog(`清理 ${d} 失败：${e.message}`)
    }
  }
}

/** 探测端口是否已被占用 */
function isPortBusy(port) {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', (err) => resolve(err.code === 'EADDRINUSE'))
    probe.once('listening', () => probe.close(() => resolve(false)))
    probe.listen(port, HOST)
  })
}

/** 睡眠 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// ---------- 主流程 ----------
mkdirSync(LOG_DIR, { recursive: true })
rotateIfNeeded(SERVER_LOG)
rotateIfNeeded(GUARD_LOG)

clearStaleCache()

const NUXT_BIN = join(ROOT, 'node_modules', 'nuxt', 'bin', 'nuxt.mjs')
if (!existsSync(NUXT_BIN)) {
  guardLog(`未找到 ${NUXT_BIN}，请先安装依赖（npm install）`)
  process.exit(1)
}

// 启动前先看端口：已有人服务就不再重复启动（常见于手动跑过一次 dev）
if (await isPortBusy(PORT)) {
  guardLog(`端口 ${PORT} 已被占用，判定服务已在运行，本次不启动（退出码 0）`)
  process.exit(0)
}

const out = createWriteStream(SERVER_LOG, { flags: 'a' })

/** 跑一次 dev 服务，返回 { code, uptimeMs } */
function runDevOnce() {
  return new Promise((resolve) => {
    out.write(`\n${'='.repeat(60)}\n[${new Date().toISOString()}] 启动 dev 服务（端口 ${PORT}）\n${'='.repeat(60)}\n`)
    const startedAt = Date.now()

    // 用 process.execPath 启动，天然是本机 node 的绝对路径，
    // 不依赖 PATH（本机 node 不在持久化 PATH 中，2026-09-11 实测）
    const child = spawn(process.execPath, [NUXT_BIN, 'dev', '--host', HOST, '--port', String(PORT)], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    child.stdout.on('data', (b) => out.write(b))
    child.stderr.on('data', (b) => out.write(b))

    // 任务被停止（任务计划程序终止进程）时连带结束子进程，避免孤儿占着端口
    const forward = (sig) => {
      try {
        child.kill(sig)
      } catch {
        /* 子进程可能已退出 */
      }
    }
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => forward(sig))

    child.on('exit', (code, signal) => {
      resolve({ code, signal, uptimeMs: Date.now() - startedAt })
    })
  })
}

// ---------- 守护循环：崩了就重启，直到达到阈值或无法恢复 ----------
let rapidFails = 0
let windowStart = Date.now()
let consecutiveFails = 0

for (;;) {
  const { code, signal, uptimeMs } = await runDevOnce()
  const summary = `dev 服务退出：code=${code} signal=${signal} 存活=${(uptimeMs / 1000).toFixed(1)}s`
  out.write(`[${new Date().toISOString()}] ${summary}\n`)
  guardLog(summary)

  // 判定是否「快速失败」
  const rapid = uptimeMs < RAPID_FAIL_MS
  if (rapid) {
    const now = Date.now()
    if (now - windowStart > RAPID_WINDOW_MS) {
      windowStart = now
      rapidFails = 0
    }
    rapidFails += 1
    consecutiveFails += 1
    if (rapidFails >= MAX_RAPID_FAILS) {
      const giveUp = `dev 服务在 ${RAPID_WINDOW_MS / 1000}s 内快速失败 ${rapidFails} 次，放弃重启以免形成风暴；` +
        `请查看 ${SERVER_LOG} 定位原因后重新启动服务`
      guardLog(giveUp)
      out.write(`[${new Date().toISOString()}] ${giveUp}\n`)
      out.end(() => process.exit(1))
      break
    }
  } else {
    // 正常服务过一段时间才退出（例如手动停止），重置计数
    rapidFails = 0
    consecutiveFails = 0
    windowStart = Date.now()
  }

  // 退避：连续失败越多等越久，最多 30 秒
  const delay = Math.min(BASE_RESTART_DELAY_MS * 2 ** Math.max(0, consecutiveFails - 1), 30000)
  guardLog(`${delay / 1000}s 后重启 dev 服务（连续快速失败 ${rapidFails} 次）`)
  await sleep(delay)

  // 重启前再确认端口没被别人占住
  if (await isPortBusy(PORT)) {
    guardLog(`端口 ${PORT} 仍被占用，等待下一轮重试`)
    await sleep(5000)
  }
}
