// 临时打包核查脚本（用完即删）：先打到 tmp/ 探一遍内容，再决定最终交付形态
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs'
import zlib from 'node:zlib'
import crypto from 'node:crypto'

const REPO = 'E:/二维码管理'
const g = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
const log = []

const COMMIT = g('rev-parse', 'HEAD').trim()
log.push('COMMIT=' + COMMIT)

// 期望清单（去掉 export-ignore）
const ignorePrefixes = ['.workbuddy/', 'docs/handover/', 'android-collector/']
const all = g('-c', 'core.quotePath=false', 'ls-tree', '-r', '--name-only', COMMIT).trim().split('\n').filter(Boolean)
const expected = all.filter((p) => !ignorePrefixes.some((x) => p.startsWith(x)))
log.push('HEAD 跟踪文件总数=' + all.length + '；剔除 export-ignore 后期望=' + expected.length)
log.push('被 export-ignore 剔除=' + (all.length - expected.length))

// 关注项
const watch = (pre) => all.filter((p) => p.startsWith(pre))
log.push('--- 关注：文件存放处/ 跟踪数=' + watch('文件存放处/').length)
watch('文件存放处/').forEach((p) => log.push('   ' + p))
log.push('--- 关注：tmp/ 跟踪数=' + watch('tmp/').length)
log.push('--- 关注：根目录 tar.gz/zip 跟踪数=' + all.filter((p) => !p.includes('/') && /\.(tar\.gz|zip)$/.test(p)).length)
all.filter((p) => !p.includes('/') && /\.(tar\.gz|zip)$/.test(p)).forEach((p) => log.push('   ' + p))

// 打探针包
const out = REPO + '/tmp/_arch.tar.gz'
mkdirSync(REPO + '/tmp', { recursive: true })
g('archive', '--format=tar.gz', '-o', out, COMMIT)
log.push('探针包字节=' + statSync(out).size)

// 解析 tar
const tar = zlib.gunzipSync(readFileSync(out))
const entries = []
for (let off = 0; off + 512 <= tar.length;) {
  const b = tar.subarray(off, off + 512)
  if (b.every((x) => x === 0)) break
  const name = b.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
  const size = parseInt(b.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim() || '0', 8)
  entries.push({ name, type: String.fromCharCode(b[156]), size })
  off += 512 + Math.ceil(size / 512) * 512
}
const files = entries.filter((e) => e.type === '0' || e.type === '\0').map((e) => e.name)
log.push('包内文件条目=' + files.length + '；tar 总条目(含目录)=' + entries.length)

const setPkg = new Set(files)
const setExp = new Set(expected)
const onlyPkg = [...setPkg].filter((p) => !setExp.has(p))
const onlyExp = [...setExp].filter((p) => !setPkg.has(p))
log.push('只在包里=' + onlyPkg.length + (onlyPkg.length ? ' → ' + JSON.stringify(onlyPkg.slice(0, 20)) : ''))
log.push('只在期望里=' + onlyExp.length + (onlyExp.length ? ' → ' + JSON.stringify(onlyExp.slice(0, 20)) : ''))

// 禁止项
const banned = files.filter((p) => p === '.env' || p.startsWith('node_modules/') || p.startsWith('.output/') || p.startsWith('.nuxt/'))
log.push('禁止项命中=' + banned.length + (banned.length ? ' → ' + JSON.stringify(banned) : ''))

// 本轮关键文件在不在
const keys = [
  'server/api/admin/codes/upload-batches/[id]/export.get.ts',
  'app/pages/admin/codes/index.vue',
  'app/pages/admin/generator/index.vue',
  'app/pages/admin/settings/index.vue',
  'server/api/admin/users.post.ts',
  'server/api/admin/users/[id].patch.ts',
]
log.push('--- 本轮关键文件 ---')
for (const k of keys) {
  const e = entries.find((x) => x.name === k)
  log.push((e ? '✅ ' : '🔴 ') + k + (e ? '  包内字节=' + e.size : '  缺失！'))
}
log.push('SHA256=' + crypto.createHash('sha256').update(readFileSync(out)).digest('hex'))

writeFileSync(REPO + '/tmp/_arch.txt', log.join('\n'), 'utf8')
console.log('DONE')
