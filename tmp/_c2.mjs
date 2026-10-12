// 临时脚本（用完即删）：提交 .gitattributes 的 export-ignore 补充并推送
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const REPO = 'E:/二维码管理'
const env = { ...process.env, GIT_LITERAL_PATHSPECS: '1' }
const g = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env })
const log = []
const FILES = ['.gitattributes']
const MSG = [
  'chore: 上线包剔除历史交付件与临时件',
  '',
  '- .gitattributes 追加 export-ignore：文件存放处/、tmp/、根目录 *.tar.gz / *.zip',
  '- 只影响 git archive 产物（仓库照旧跟踪这些文件），与 60 号「旧包不入包」口径对齐',
  '- 实测：加前包体 8.2MB / 319 文件，加后约 1MB',
].join('\n')

g('reset')
g('add', '--', ...FILES)
const staged = g('diff', '--cached', '--name-only').trim().split('\n').filter(Boolean)
log.push('暂存=' + JSON.stringify(staged))
if (staged.length !== FILES.length) { log.push('🔴 条数不符，中止'); writeFileSync(REPO + '/tmp/_c2.txt', log.join('\n'), 'utf8'); process.exit(1) }
writeFileSync(REPO + '/tmp/_msg2.txt', MSG + '\n', 'utf8')
g('commit', '-F', REPO + '/tmp/_msg2.txt', '--', ...FILES)
log.push('提交=' + g('rev-parse', 'HEAD').trim())
log.push('名称状态:\n' + g('show', '--name-status', '--pretty=oneline', '-s', '--format=%h %s', 'HEAD'))
log.push('文件清单:\n' + g('log', '--name-status', '--oneline', '-1').trim())

let pushOut = ''
try { pushOut = g('push', 'origin', 'SMXT') } catch (e) { pushOut = 'PUSH 异常: ' + (e.stdout || '') + (e.stderr || '') }
log.push('push 输出=' + pushOut)
log.push('远端真值=' + g('ls-remote', 'origin', 'refs/heads/SMXT').trim())
log.push('本地 HEAD=' + g('rev-parse', 'HEAD').trim())
writeFileSync(REPO + '/tmp/_c2.txt', log.join('\n'), 'utf8')
console.log('DONE')
