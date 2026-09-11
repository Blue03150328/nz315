// 开发服务器启动 / 体检脚本（scripts/dev-start.mjs）
//
// 用途：一条命令搞定「启动前的环境体检 + 启动服务」，专治「合并/切分支后服务拉不起来」。
// 用法：
//   node scripts/dev-start.mjs            # 体检 + 自动清过期缓存 + 启动 dev（端口 3100）
//   node scripts/dev-start.mjs --check    # 只体检（只读，不改任何文件、不启动服务）
//   node scripts/dev-start.mjs --clean    # 强制清缓存后启动
//   node scripts/dev-start.mjs --port 3101  # 换端口
//
// 设计原则：
//   1. 只读体检项绝不修改磁盘（--check 模式下连缓存都不删）；
//   2. 缓存判定用「时间戳启发式」：.nuxt / node_modules/.cache 若早于
//      package.json / package-lock.json / nuxt.config.ts / 最近一次提交，
//      说明缓存是旧世界留下的，Vite 依赖优化器会卡在 "scanning dependencies"，
//      此时自动清理；
//   3. .env 只报告「键名是否存在」，绝不打印任何值（防泄露凭据）。

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ---------- 路径与参数 ----------
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = join(SCRIPT_DIR, '..')

const args = process.argv.slice(2)
const CHECK_ONLY = args.includes('--check')
const FORCE_CLEAN = args.includes('--clean')
const portArgIndex = args.indexOf('--port')
const PORT = portArgIndex >= 0 && args[portArgIndex + 1] ? Number(args[portArgIndex + 1]) : 3100

// .env 必须存在的键（只校验键名，不读取值）
// 说明：DB_HOST / DB_PORT 在 nuxt.config.ts 里有代码默认值（127.0.0.1 / 3306），
// 本项目 .env 有意不配 DB_HOST，故列入「可选」而非必填。
const REQUIRED_ENV_KEYS = ['DB_USER', 'DB_PASSWORD', 'DB_NAME', 'SESSION_SECRET']

// 有代码默认值、允许缺失的键（缺失时给出默认值说明）
const OPTIONAL_ENV_KEYS = {
  DB_HOST: '默认 127.0.0.1',
  DB_PORT: '默认 3306',
}

// 需要参与「缓存新鲜度」比较的配置文件名
const CONFIG_FILES = ['package.json', 'package-lock.json', 'nuxt.config.ts', '.env']

// ---------- 输出小工具 ----------
const OK = '  [OK]  '
const WARN = '  [警告]'
const BAD = '  [错误]'

function line() {
  console.log('─'.repeat(58))
}
function title(text) {
  console.log('')
  console.log(text)
}
function ok(msg) {
  console.log(OK + ' ' + msg)
}
function warn(msg) {
  console.log(WARN + ' ' + msg)
}
function bad(msg) {
  console.log(BAD + ' ' + msg)
}
function info(msg) {
  console.log('        ' + msg)
}

/** 文件/目录的修改时间（毫秒），不存在返回 0 */
function mtimeOf(p) {
  try {
    return statSync(p).mtimeMs
  } catch {
    return 0
  }
}

/** 目录占用大小（KB），只统计一层文件与子目录递归，出错返回 -1 */
function dirSizeKB(p) {
  try {
    const r = spawnSync(
      process.platform === 'win32' ? 'powershell' : 'du',
      process.platform === 'win32'
        ? ['-NoProfile', '-Command', `(Get-ChildItem -LiteralPath '${p}' -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum`]
        : ['-sk', p],
      { encoding: 'utf8', timeout: 20000 },
    )
    if (process.platform === 'win32') {
      const bytes = Number(String(r.stdout).trim())
      return Number.isFinite(bytes) ? Math.round(bytes / 1024) : -1
    }
    const kb = Number(String(r.stdout).trim().split(/\s+/)[0])
    return Number.isFinite(kb) ? kb : -1
  } catch {
    return -1
  }
}

/** 探测端口是否已被占用（占用返回占用进程号数组，未占用返回空数组） */
function portOwners(port) {
  const r = spawnSync('netstat', ['-ano'], { encoding: 'utf8', timeout: 15000 })
  if (r.status !== 0 || !r.stdout) return []
  const owners = new Set()
  for (const raw of String(r.stdout).split(/\r?\n/)) {
    const parts = raw.trim().split(/\s+/)
    // 形如：TCP  127.0.0.1:3100  0.0.0.0:0  LISTENING  12345
    if (parts.length < 5) continue
    if (parts[1].endsWith(':' + port) && /LISTEN/i.test(parts[3])) owners.add(parts[4])
  }
  return [...owners]
}

// ---------- 体检项 ----------
const problems = []   // 阻塞启动的问题
const warnings = []   // 不阻塞但需注意

line()
console.log('  农资315 追溯码管理平台 · 开发服务器启动体检')
line()
info('项目目录：' + ROOT)
info('目标端口：' + PORT)
info('运行模式：' + (CHECK_ONLY ? '只体检（只读）' : FORCE_CLEAN ? '强制清缓存后启动' : '体检后启动'))

// 1. Node 版本
title('① 运行环境')
const nodeVersion = process.versions.node
const nodeMajor = Number(nodeVersion.split('.')[0])
if (nodeMajor >= 20) {
  ok(`Node.js v${nodeVersion}（满足 Nuxt 4 要求 >= 20）`)
} else {
  bad(`Node.js v${nodeVersion} 过低，Nuxt 4 需要 >= 20`)
  problems.push('Node.js 版本过低，请升级到 20 及以上')
}

// 2. npm 可用性
const npmProbe = spawnSync('npm', ['--version'], { encoding: 'utf8', shell: true, timeout: 30000 })
if (npmProbe.status === 0) {
  ok('npm ' + String(npmProbe.stdout).trim() + ' 可用')
} else {
  bad('npm 不可用，无法执行 npm run dev')
  info('可改用：直接调用项目内 Nuxt CLI —— node node_modules/nuxt/bin/nuxt.mjs dev --host 0.0.0.0 --port ' + PORT)
  problems.push('npm 命令不可用')
}

// 3. 端口占用
title('② 端口占用')
const owners = portOwners(PORT)
if (owners.length === 0) {
  ok(`端口 ${PORT} 空闲`)
} else {
  warn(`端口 ${PORT} 已被占用（PID：${owners.join(', ')}）`)
  info('若占用者就是本项目上一个 dev 实例，可直接在上面访问，或先结束该进程再启动')
  warnings.push(`端口 ${PORT} 被占用，新实例可能启动失败或自动改用其他端口`)
}
// 3000 端口提示（农码查残留实例常占）
const owners3000 = portOwners(3000)
if (owners3000.length > 0) {
  info(`提示：端口 3000 被 PID ${owners3000.join(', ')} 占用（农码查残留实例），本项目固定用 ${PORT}，无需处理`)
}

// 4. 依赖完整性
title('③ 依赖完整性')
let depsOk = true
if (!existsSync(join(ROOT, 'node_modules'))) {
  bad('未找到 node_modules，依赖尚未安装')
  info('请先执行：npm install')
  problems.push('依赖未安装（缺 node_modules）')
  depsOk = false
} else {
  let pkg
  try {
    pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  } catch (e) {
    bad('package.json 解析失败：' + e.message)
    problems.push('package.json 无法解析')
    depsOk = false
  }
  if (pkg) {
    const names = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) })
    const missing = names.filter((n) => !existsSync(join(ROOT, 'node_modules', n, 'package.json')))
    if (missing.length === 0) {
      ok(`全部 ${names.length} 个直接依赖已安装`)
    } else {
      bad(`缺失 ${missing.length} 个依赖：${missing.join(', ')}`)
      info('请执行：npm install')
      problems.push('依赖缺失：' + missing.join(', '))
      depsOk = false
    }
  }
}

// 5. .env 配置（只查键名，不打印值）
title('④ 环境配置 .env')
const envPath = join(ROOT, '.env')
if (!existsSync(envPath)) {
  bad('.env 不存在，数据库连接与会话密钥缺失，服务无法正常工作')
  info('请参照 README / docs/DEPLOYMENT.md 创建 .env')
  problems.push('.env 缺失')
} else {
  ok('.env 存在')
  const raw = readFileSync(envPath, 'utf8')
  const keys = new Set()
  for (const rawLine of raw.split(/\r?\n/)) {
    const t = rawLine.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq > 0) keys.add(t.slice(0, eq).trim())
  }
  const missKeys = REQUIRED_ENV_KEYS.filter((k) => !keys.has(k))
  if (missKeys.length === 0) {
    ok(`必需的 ${REQUIRED_ENV_KEYS.length} 个键齐全`)
  } else {
    warn('缺少键：' + missKeys.join(', ') + '（不打印任何值）')
    warnings.push('缺少 .env 键：' + missKeys.join(', '))
  }
  // 可选键：缺失不影响启动，仅提示其默认值来源
  const missOpt = Object.keys(OPTIONAL_ENV_KEYS).filter((k) => !keys.has(k))
  if (missOpt.length > 0) {
    info('可选键未配（走代码默认值）：' + missOpt.map((k) => `${k}（${OPTIONAL_ENV_KEYS[k]}）`).join('、'))
  }
}

// 6. 缓存新鲜度（合并后启动卡死的头号嫌疑）
title('⑤ 缓存新鲜度（启动卡死排查）')
const CACHE_DIRS = ['.nuxt', join('node_modules', '.cache'), join('node_modules', '.vite')]
const present = CACHE_DIRS.filter((d) => existsSync(join(ROOT, d)))
if (present.length === 0) {
  ok('无缓存残留（首次启动会稍慢，属正常）')
} else {
  // 参照时间 = 配置文件与最近一次提交里最新的那个
  let refTime = 0
  let refName = ''
  for (const f of CONFIG_FILES) {
    const m = mtimeOf(join(ROOT, f))
    if (m > refTime) {
      refTime = m
      refName = f
    }
  }
  const gitLog = spawnSync('git', ['log', '-1', '--format=%ct'], { cwd: ROOT, encoding: 'utf8', timeout: 15000 })
  if (gitLog.status === 0 && String(gitLog.stdout).trim()) {
    const gitTime = Number(String(gitLog.stdout).trim()) * 1000
    if (gitTime > refTime) {
      refTime = gitTime
      refName = '最近一次 git 提交'
    }
  }

  const stale = []
  for (const d of present) {
    const m = mtimeOf(join(ROOT, d))
    if (refTime > 0 && m > 0 && m < refTime) stale.push(d)
  }

  for (const d of present) {
    const kb = dirSizeKB(join(ROOT, d))
    info(`${d}　存在${kb >= 0 ? `（约 ${(kb / 1024).toFixed(1)} MB）` : ''}`)
  }

  if (stale.length > 0) {
    warn(`以下缓存早于「${refName}」，属跨版本残留：${stale.join('、')}`)
    info('这正是「合并/切分支后卡在 scanning dependencies 或 500」的典型原因')
    if (!CHECK_ONLY || FORCE_CLEAN) {
      for (const d of stale) {
        try {
          rmSync(join(ROOT, d), { recursive: true, force: true })
          ok('已清理：' + d)
        } catch (e) {
          bad('清理失败：' + d + '（' + e.message + '）')
          info('请先结束占用该目录的 node 进程（服务可能正在运行），再重试')
          problems.push('缓存目录被占用，无法清理：' + d)
        }
      }
    } else {
      info('如需清理请执行：node scripts/dev-start.mjs --clean')
      warnings.push('存在过期缓存：' + stale.join('、'))
    }
  } else {
    ok('缓存新鲜度正常（不早于最近配置变更）')
  }
}

// ---------- 结论 ----------
line()
if (problems.length > 0) {
  console.log('  结论：存在阻塞问题，先处理后启动')
  line()
  problems.forEach((p, i) => console.log(`    ${i + 1}. ${p}`))
  process.exit(1)
}
if (warnings.length > 0) {
  console.log('  结论：可以启动，但有提醒项')
  line()
  warnings.forEach((w, i) => console.log(`    ${i + 1}. ${w}`))
} else {
  console.log('  结论：环境正常')
  line()
}

if (CHECK_ONLY) {
  console.log('')
  info('（--check 只体检模式，未启动服务、未修改任何文件）')
  process.exit(0)
}

// ---------- 启动服务 ----------
if (owners.length > 0) {
  console.log('')
  warn(`端口 ${PORT} 已被占用，服务可能无法绑定。如需强制启动，请先结束后台进程。`)
}

console.log('')
line()
console.log(`  正在启动开发服务器：http://localhost:${PORT}`)
console.log('  按 Ctrl + C 停止服务')
line()
console.log('')

const child = spawn('npm', ['run', 'dev', '--', '--host', '0.0.0.0', '--port', String(PORT)], {
  cwd: ROOT,
  shell: true,
  stdio: 'inherit',
})

child.on('exit', (code) => {
  console.log('')
  info(`开发服务器已退出（退出码 ${code ?? 0}）`)
})

// 透传中断信号，保证 Ctrl + C 能真正结束子进程
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try {
      child.kill(sig)
    } catch {
      /* 忽略：子进程可能已退出 */
    }
  })
}
