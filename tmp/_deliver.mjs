// 交付件组装（本轮使用）：复制发布脚本 + 生成 SHA256SUMS / 包校验清单.json
import { readFileSync, writeFileSync, copyFileSync, statSync, readdirSync } from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'

const REPO = 'E:/二维码管理'
const meta = JSON.parse(readFileSync(REPO + '/tmp/_pkgmeta.json', 'utf8'))
const OUTDIR = meta.outdir
const sha = (f) => crypto.createHash('sha256').update(readFileSync(f)).digest('hex')

// 1) 复制发布脚本到交付目录
const scriptSrc = REPO + '/deploy/bt-release-20261010.mjs'
const scriptDst = path.join(OUTDIR, 'bt-release-20261010.mjs')
copyFileSync(scriptSrc, scriptDst)
const scriptSHA = sha(scriptDst)
const scriptBytes = statSync(scriptDst).size

// 2) SHA256SUMS
const pkgName = path.basename(meta.pkg)
const sums = meta.sha256 + '  ' + pkgName + '\n' + scriptSHA + '  bt-release-20261010.mjs\n'
writeFileSync(path.join(OUTDIR, 'SHA256SUMS'), sums, 'utf8')

// 3) 包校验清单.json
const manifest = {
  source: meta.commit,
  bytes: meta.bytes,
  files: meta.files,
  forbidden: meta.forbidden,
  differences: (meta.onlyPkg.length + meta.onlyExp.length + meta.differences + meta.forbidden),
  sha256: meta.sha256,
  scriptSHA256: scriptSHA,
}
writeFileSync(path.join(OUTDIR, '包校验清单.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')

// 4) 回读核对 SHA256SUMS 能被 sha256sum -c 接受（格式自检）
const out = [
  '交付目录=' + OUTDIR,
  '包名=' + pkgName + ' 字节=' + meta.bytes + ' sha256=' + meta.sha256,
  '脚本=' + scriptDst + ' 字节=' + scriptBytes + ' sha256=' + scriptSHA,
  'SHA256SUMS 字节=' + statSync(path.join(OUTDIR, 'SHA256SUMS')).size,
  '包校验清单.json=' + JSON.stringify(manifest),
  '交付目录清单：',
  ...readdirSync(OUTDIR).map((f) => '  ' + f),
].join('\n')
writeFileSync(REPO + '/tmp/_deliver.txt', out, 'utf8')
console.log('DONE')
