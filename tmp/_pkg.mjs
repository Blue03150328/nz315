// 打包脚本（本轮使用）：从固定提交打上线包并做逐字节自验
// 交付目录 = 文件存放处/上线-2026-10-10-<sha8>/（该目录已被 export-ignore，不会被打进包）
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, statSync, rmSync, existsSync } from 'node:fs'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import path from 'node:path'

const REPO = 'E:/二维码管理'
const COMMIT = '9584fde69fb22b9e3b079d996e1c5680f0d00c05'
const SHA8 = COMMIT.slice(0, 7)
const OUTDIR = path.join(REPO, '文件存放处', '上线-2026-10-10-' + SHA8)
const PKG = path.join(OUTDIR, 'nz315-' + SHA8 + '-source.tar.gz')

const gh = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
const gb = (...a) => execFileSync('git', a, { cwd: REPO, maxBuffer: 256 * 1024 * 1024 }) // Buffer
const log = []
const say = (s) => { log.push(s); console.log(s) }

mkdirSync(OUTDIR, { recursive: true })
if (existsSync(PKG)) rmSync(PKG, { force: true })

// 1) 打包：显式关闭 CRLF 转换，使包内文本 == git blob（便于逐字节核对）
try { gb('-c', 'core.autocrlf=false', 'archive', '--format=tar.gz', '-o', PKG, COMMIT) }
catch (e) { say('打包失败：' + e.message); process.exit(1) }
const bytes = statSync(PKG).size
const pkgBuf = readFileSync(PKG)
const sha256 = crypto.createHash('sha256').update(pkgBuf).digest('hex')
say('包路径=' + PKG)
say('字节=' + bytes)
say('SHA256=' + sha256)

// 2) 解析 tar
const tar = zlib.gunzipSync(pkgBuf)
const entries = []
for (let off = 0; off + 512 <= tar.length;) {
  const b = tar.subarray(off, off + 512)
  if (b.every((x) => x === 0)) break
  const name = b.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
  const size = parseInt(b.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim() || '0', 8)
  const body = tar.subarray(off + 512, off + 512 + size)
  entries.push({ name, type: String.fromCharCode(b[156]), size, body })
  off += 512 + Math.ceil(size / 512) * 512
}
const fileEntries = entries.filter((e) => e.type === '0' || e.type === '\0')
say('包内文件条目=' + fileEntries.length + '；tar 总条目=' + entries.length)

// 3) 期望清单（剔除 export-ignore）
const ignore = ['.workbuddy/', 'docs/handover/', 'android-collector/']
const all = gh('-c', 'core.quotePath=false', 'ls-tree', '-r', '--name-only', COMMIT).trim().split('\n').filter(Boolean)
// 根目录 *.tar.gz / *.zip 与 文件存放处/ tmp/ 也被 export-ignore 掉了，需从期望里剔除
const isIgnored = (p) =>
  ignore.some((x) => p.startsWith(x)) ||
  p.startsWith('文件存放处/') || p.startsWith('tmp/') ||
  (!p.includes('/') && /\.(tar\.gz|zip)$/.test(p))
const expected = all.filter((p) => !isIgnored(p))
say('git 跟踪=' + all.length + '；期望（剔除 export-ignore）=' + expected.length + '；剔除=' + (all.length - expected.length))

const setPkg = new Set(fileEntries.map((e) => e.name))
const setExp = new Set(expected)
const onlyPkg = [...setPkg].filter((p) => !setExp.has(p))
const onlyExp = [...setExp].filter((p) => !setPkg.has(p))
say('只在包里=' + onlyPkg.length + (onlyPkg.length ? ' → ' + JSON.stringify(onlyPkg) : ''))
say('只在期望里=' + onlyExp.length + (onlyExp.length ? ' → ' + JSON.stringify(onlyExp) : ''))

// 4) 禁止项
const banned = fileEntries.filter((e) => e.name === '.env' || e.name.startsWith('node_modules/') || e.name.startsWith('.output/') || e.name.startsWith('.nuxt/')).map((e) => e.name)
say('禁止项=' + banned.length + (banned.length ? ' → ' + JSON.stringify(banned) : ''))

// 5) 逐字节与 git blob 比对（文本/二进制都用 raw，因已关 CRLF 转换）
let diffContent = 0
const diffList = []
const fingerprints = {}
for (const e of fileEntries) {
  const blob = gb('cat-file', 'blob', COMMIT + ':' + e.name)
  fingerprints[e.name] = crypto.createHash('sha256').update(e.body).digest('hex')
  if (!blob.equals(e.body)) { diffContent++; if (diffList.length < 20) diffList.push(e.name) }
}
say('逐字节与 git blob 不一致=' + diffContent + (diffList.length ? ' → ' + JSON.stringify(diffList) : ''))

// 6) 关键文件点名
const keys = [
  'server/api/admin/codes/upload-batches/[id]/export.get.ts',
  'app/pages/admin/codes/index.vue',
  'app/pages/admin/generator/index.vue',
  'app/pages/admin/settings/index.vue',
  'server/api/admin/users.post.ts',
  'server/api/admin/users/[id].patch.ts',
  'tests/admin-account.integration.mjs',
  'tests/code-batch-export.integration.mjs',
  '.gitattributes',
]
say('--- 关键文件 ---')
for (const k of keys) {
  const e = fileEntries.find((x) => x.name === k)
  say((e ? '✅ ' : '🔴 ') + k + (e ? ' 字节=' + e.size : ' 缺失！'))
}

// 7) 落 源码文件指纹.json
writeFileSync(path.join(OUTDIR, '源码文件指纹.json'), JSON.stringify({ source: COMMIT, files: fingerprints }, null, 2), 'utf8')

// 8) 落中间结果供后续写清单
writeFileSync(REPO + '/tmp/_pkgmeta.json', JSON.stringify({ commit: COMMIT, sha8: SHA8, outdir: OUTDIR, pkg: PKG, bytes, sha256, files: fileEntries.length, differences: diffContent, forbidden: banned.length, onlyPkg, onlyExp }, null, 2), 'utf8')

say('差异合计=' + (onlyPkg.length + onlyExp.length + diffContent + banned.length) + '（期望 0）')
writeFileSync(REPO + '/tmp/_pkg.txt', log.join('\n'), 'utf8')
console.log('DONE')
