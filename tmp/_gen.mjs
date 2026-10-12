// 生成 deploy/bt-release-20261010.mjs：以 08 版为基座做受控替换，每条断言命中次数
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const REPO = 'E:/二维码管理'
const SRC = REPO + '/deploy/bt-release-20261008.mjs'
const OUT = REPO + '/deploy/bt-release-20261010.mjs'
const NEW_HASH = 'd0b28bbd32a628afbd69e2ff26b8c913e815f95eba180c3496a61fb2d93e3c1a'
const OLD_HASH = '5c44d9c19ceef9277443ed4e4c0856890ae617ac791aae83f1cd7c512a45c840'
const SHA = '9584fde'
const tag = []
let s = readFileSync(SRC, 'utf8')

const rules = [
  ['20261008', '20261010', 5],       // STAGE / OLD / FAILED / SAFE 路径 + 用法字符串
  ['3d16746', SHA, 9],               // STAGE/OLD/FAILED/SAFE 路径 + 包名 + source-diff + 部署标记 + verify + rollback
  [OLD_HASH, NEW_HASH, 1],           // PACKAGE_HASH
]
for (const [from, to, expect] of rules) {
  const n = s.split(from).length - 1
  tag.push(from + ' → ' + to + '：命中 ' + n + ' 次（期望 ' + expect + '）' + (n === expect ? ' ✅' : ' 🔴'))
  if (n !== expect) { writeFileSync(REPO + '/tmp/_gen.txt', tag.join('\n') + '\n🔴 命中次数不符，未写盘', 'utf8'); console.log('ABORT'); process.exit(1) }
  s = s.split(from).join(to)
}

// 残留旧指纹自检
for (const bad of ['20261008', '3d16746', OLD_HASH]) {
  if (s.includes(bad)) { tag.push('🔴 残留旧指纹：' + bad); writeFileSync(REPO + '/tmp/_gen.txt', tag.join('\n'), 'utf8'); process.exit(1) }
}
tag.push('残留旧指纹检查：通过')

// 新值在场自检
for (const good of ['20261010', SHA, NEW_HASH]) {
  if (!s.includes(good)) { tag.push('🔴 缺少新值：' + good); writeFileSync(REPO + '/tmp/_gen.txt', tag.join('\n'), 'utf8'); process.exit(1) }
}
tag.push('新值在场检查：通过')

if (existsSync(OUT)) tag.push('⚠️ 覆盖已存在文件 ' + OUT)
writeFileSync(OUT, s, 'utf8')
tag.push('已写入 ' + OUT + '，字节=' + Buffer.byteLength(s, 'utf8'))
writeFileSync(REPO + '/tmp/_gen.txt', tag.join('\n'), 'utf8')
console.log('DONE')
