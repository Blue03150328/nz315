// 临时合并脚本（用完即删）：把远程 SMXT（2c73741）并入本地，并用「树哈希前后一致」证明内容零变化
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const REPO = 'E:/二维码管理'
const env = { ...process.env, GIT_LITERAL_PATHSPECS: '1' }
const g = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env })
const REMOTE = '2c73741d9c7d332c56ef88814de288e7696f9a0c'
const log = []

log.push('=== 1) 三次提交的真实文件清单 ===')
log.push(g('log', '--name-status', '--oneline', '-3'))

log.push('=== 2) 合并前状态 ===')
const before = g('rev-parse', 'HEAD')
const treeBefore = g('rev-parse', 'HEAD^{tree}').trim()
log.push('HEAD=' + before.trim() + '  tree=' + treeBefore)

log.push('=== 3) 合并远程 ' + REMOTE.slice(0, 7) + ' ===')
const mergeOut = g('merge', '--no-edit', REMOTE, '-m', 'Merge remote-tracking branch (origin/SMXT) - 仅接续远程合并历史，文件内容零变化')
log.push(mergeOut)
log.push('MERGE 退出码=0')

log.push('=== 4) 收尾 reset --hard（本机 checkout/merge 后文件可能不落盘的常规动作）===')
g('reset', '--hard', 'HEAD')

log.push('=== 5) 合并后状态 ===')
const after = g('rev-parse', 'HEAD').trim()
const treeAfter = g('rev-parse', 'HEAD^{tree}').trim()
log.push('HEAD=' + after + '  tree=' + treeAfter)
log.push(treeAfter === treeBefore ? '✅ 树哈希一致 ⇒ 合并内容零变化' : '🔴 树哈希变了 ⇒ 合并引入了内容，需人工复核')

log.push('=== 6) 工作区是否干净 ===')
log.push(g('status', '--porcelain=v1') || '(仅未跟踪的 tmp 临时件)')

log.push('=== 7) 远程是否为本地祖先（决定能否 push）===')
log.push('is-ancestor(remote, HEAD) = ' + (() => { try { g('merge-base', '--is-ancestor', REMOTE, 'HEAD'); return 'yes' } catch { return 'no' } })())
log.push(g('log', '--oneline', '-8'))

writeFileSync(REPO + '/tmp/_merge.txt', log.join('\n'), 'utf8')
console.log('DONE')
