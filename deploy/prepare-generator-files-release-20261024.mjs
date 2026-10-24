// 在上一轮受控发布器上收窄为两个运行文件，保留现役全部父覆盖。
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'

const previousCommit = 'c687c068d9657cd3300c9d2761a272257f42e49b'
const previousPayload = '8cff78c854cdb56e26e8cb64c1a7734022ffe15e54d5352ec9de6a250f12d347'
const commit = execFileSync('git', ['rev-parse', process.argv[2] || 'HEAD'], { encoding: 'utf8' }).trim()
if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('发布提交无效')
const hash = value => createHash('sha256').update(value).digest('hex')
const read = (ref, name) => execFileSync('git', ['show', ref + ':' + name], { encoding: 'utf8' }).replaceAll('\r\n', '\n')
const runtimeFiles = ['app/pages/admin/generator/index.vue', 'shared/utils/generator-export.ts']
const names = [...runtimeFiles, 'tests/generator-export.test.mjs', 'tests/generator-export.integration.mjs']
const files = Object.fromEntries(names.map(name => {
  const data = read(commit, name)
  return [name, { data: Buffer.from(data).toString('base64'), sha256: hash(data), beforeSha256: hash(read(previousCommit, name)) }]
}))
const raw = Buffer.from(JSON.stringify({ files })), digest = hash(raw)
let script = fs.readFileSync('.tools/generator-split-release-20261023/release.py', 'utf8').replaceAll('\r\n', '\n')
function change(before, after) {
  if (!script.includes(before)) throw Error('发布脚本锚点缺失：' + before.slice(0, 90))
  script = script.replace(before, after)
}
change(`COMMIT = '${previousCommit}'`, `COMMIT = '${commit}'`)
script = script.replace(/^""".*?"""/, '"""生成前分文件设置：仅两个运行文件，现役覆盖保留，完整备份，零DDL，仅应用回滚。"""')
script = script.replace(/PAYLOAD_SHA = '[a-f0-9]+'/, `PAYLOAD_SHA = '${digest}'`)
script = script.replace(/PAYLOAD_RAW = gzip\.decompress\(base64\.b64decode\('[^']+'\)\)/, `PAYLOAD_RAW = gzip.decompress(base64.b64decode('${gzipSync(raw).toString('base64')}'))`)
change("KIND = 'generator-split'", "KIND = 'generator-files'")
script = script.replaceAll("'-20261023-'", "'-20261024-'").replaceAll('nz315-production:generator-split-20261023-', 'nz315-production:generator-files-20261024-')
script = script.replace(/RUNTIME_FILES = set\(\[[^\n]+\]\)/, `RUNTIME_FILES = set(${JSON.stringify(runtimeFiles)})`)
change("EXPECTED_PREVIOUS = '935d9330f6d445f2316e3023b9f97cfce563928c'", `EXPECTED_PREVIOUS = '${previousCommit}'`)
change("base['image'] == 'nz315-production:product-remarks-20261020-b26c271e'", "base['image'] == 'nz315-production:generator-split-20261023-8cff78c8'")
change("== 'b26c271ec28fb6d1c45d02dbbb12d4c44a943d073dbedfa871f4c7c1eafe4715'", `== '${previousPayload}'`)
script = script.replace(/        assert name in \[[^\n]+\]/, `        assert name in ${JSON.stringify(names)}`)
change("    assert set(new) - set(old) == {'shared/utils/generator-export.ts', 'shared/utils/text-zip.ts'}, '新增运行文件超出范围'", "    assert not (set(new) - set(old)), '禁止新增运行文件'")
change("    for label in ['文件数量', '每个文件的追溯码数量', '打包下载 ZIP', '尚未全部导出', 'export-file-count']:", "    for label in ['生成文件数量', '每个文件的追溯码数量', 'generate-file-count', 'generate-codes-per-file', '导出时按此设置下载']:")
change("    assert '入库留档' not in compiled", "    assert 'export-file-count' not in compiled and 'export-codes-per-file' not in compiled, '旧导出设置弹窗仍存在'\n    assert '入库留档' not in compiled")
script = script.replaceAll('generator-split-build-only-placeholder-20261023', 'generator-files-build-only-placeholder-20261024').replaceAll("'generatorSplitOnlyRuntimeDiff':True", "'generatorFilesOnlyRuntimeDiff':True")
change("'kind':'generator-split-20261023'", "'kind':'generator-files-20261024'")
const folder = '.tools/generator-files-release-20261024'
fs.mkdirSync(folder, { recursive: true })
fs.writeFileSync(folder + '/release.py', script)
const scriptSha = hash(script)
const remote = '/tmp/nz315-generator-files-20261024-' + digest.slice(0, 8) + '.py'
fs.writeFileSync(folder + '/' + remote.split('/').at(-1), script)
fs.writeFileSync(folder + '/manifest.json', JSON.stringify({ commit, digest, scriptSha, remote, previousCommit, previousPayload, files: Object.fromEntries(Object.entries(files).map(([name, item]) => [name, { beforeSha256: item.beforeSha256, sha256: item.sha256 }])) }, null, 2))
console.log(JSON.stringify({ folder, remote, digest, scriptSha, scriptBytes: Buffer.byteLength(script) }))
