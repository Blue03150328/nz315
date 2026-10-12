// 临时提交脚本（用完即删）：按「一轮修改 = 一次提交」把两个功能 + 文档分 3 次提交
// 铁律：① 全程 GIT_LITERAL_PATHSPECS=1（路径含 [id] 这类 glob 字符）
//       ② 五步法：reset → 显式 add → 断言条数 → commit -F（避免 shell 吞中文引号）→ show 复核
//       ③ 绝不用 -A / .（本机常驻未跟踪项：二维码存放/、文件存放处/上线-2026-10-09-059fd68/）
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const REPO = 'E:/二维码管理'
const env = { ...process.env, GIT_LITERAL_PATHSPECS: '1' }
const g = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env })

const groups = [
  {
    msg: [
      'feat: 新增用户支持创建总部管理员账号',
      '',
      '- users.post.ts：allowedRoles 追加 platform_admin，并加提权闸（非总部管理员创建总部管理员一律 403）；',
      '  总部管理员账号 enterprise_id 置 NULL，不校验所属企业',
      '- users/[id].patch.ts：禁用总部管理员时把「判定 + 写入」放进同一事务并 SELECT ... FOR UPDATE，',
      '  防止两名管理员并发互禁导致后台永久锁死；补 getPool 导入、修正过时注释',
      '- settings/index.vue：新增 userRoleOptions（仅总部管理员可见「总部管理员」选项）；',
      '  「所属企业」条件收紧为「总部管理员 且 角色非总部管理员」；用户列表对总部管理员的他人行开放重置密码 / 禁用',
      '- tests/admin-account.integration.mjs：新增 6 项验收（含并发互禁恰一次成功）',
    ].join('\n'),
    files: [
      'server/api/admin/users.post.ts',
      'server/api/admin/users/[id].patch.ts',
      'app/pages/admin/settings/index.vue',
      'tests/admin-account.integration.mjs',
    ],
  },
  {
    msg: [
      'feat: 码库增加批次导出并补齐生成页防丢失提醒',
      '',
      '- 新增 GET /api/admin/codes/upload-batches/:id/export：仅「生成入库」留档批次可导出，',
      '  支持 txt / urls / csv，游标分页 + 流式响应，中文文件名走 RFC 5987，写审计日志',
      '- codes/index.vue：留档批次行增加导出图标按钮 + 格式选择弹窗',
      '- generator/index.vue：生成结果「既未导出也未入库」时显示防丢失提醒并拦截 beforeunload',
      '- tests/code-batch-export.integration.mjs：新增 9 项接口验收',
    ].join('\n'),
    files: [
      'server/api/admin/codes/upload-batches/[id]/export.get.ts',
      'app/pages/admin/codes/index.vue',
      'app/pages/admin/generator/index.vue',
      'tests/code-batch-export.integration.mjs',
    ],
  },
  {
    msg: [
      'docs: 补记总部管理员入口与码库导出的实施与验证记录',
      '',
      '- .workbuddy/memory/2026-10-10.md：两个功能的实现要点、验证证据与三个真浏览器判据坑',
      '- .workbuddy/memory/MEMORY.md：待办补记，标注「已改、测试全绿、未上线」',
    ].join('\n'),
    files: [
      '.workbuddy/memory/2026-10-10.md',
      '.workbuddy/memory/MEMORY.md',
    ],
  },
]

const log = []
for (let i = 0; i < groups.length; i++) {
  const grp = groups[i]
  log.push('=========== 提交 ' + (i + 1) + '/' + groups.length + ' ===========')
  g('reset') // ① 清索引（mixed，不碰工作区）
  g('add', '--', ...grp.files) // ② 显式 add
  const staged = g('diff', '--cached', '--name-only').trim().split('\n').filter(Boolean) // ③ 断言条数
  log.push('暂存条数=' + staged.length + ' / 预期=' + grp.files.length)
  staged.forEach((s) => log.push('  staged: ' + s))
  if (staged.length !== grp.files.length) {
    log.push('🔴 条数不一致，中止（不提交）')
    writeFileSync(REPO + '/tmp/_commit.txt', log.join('\n'), 'utf8')
    console.log('ABORT')
    process.exit(1)
  }
  const msgFile = REPO + '/tmp/_msg.txt'
  writeFileSync(msgFile, grp.msg + '\n', 'utf8')
  g('commit', '-F', msgFile, '--', ...grp.files) // ④ pathspec 提交（-F 避免 shell 吞中文引号）
  log.push(g('show', '--name-status', '--pretty=oneline', '-s', 'HEAD').trim()) // ⑤ 复核
}
log.push('=========== 提交后状态 ===========')
log.push(g('log', '--oneline', '-6'))
log.push(g('status', '--porcelain=v1'))
writeFileSync(REPO + '/tmp/_commit.txt', log.join('\n'), 'utf8')
console.log('DONE')
