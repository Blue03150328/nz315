// 基于现役源码叠加本次导出功能，保留历史覆盖层；载荷全部取自已推送的提交。
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'

const commit = execFileSync('git', ['rev-parse', process.argv[2] || 'HEAD'], { encoding: 'utf8' }).trim()
if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('发布提交无效')
const hash = value => createHash('sha256').update(value).digest('hex')
const read = (ref, name) => execFileSync('git', ['show', ref + ':' + name], { encoding: 'utf8' }).replaceAll('\r\n', '\n')
const runtimeFiles = ['app/pages/admin/generator/index.vue', 'shared/utils/generator-export.ts', 'shared/utils/text-zip.ts']
const names = [...runtimeFiles, 'tests/generator-export.test.mjs', 'tests/generator-export.integration.mjs']
const files = Object.fromEntries(names.map(name => {
  const data = read(commit, name)
  return [name, { data: Buffer.from(data).toString('base64'), sha256: hash(data), beforeSha256: name === runtimeFiles[0] ? 'da68541f237ed14e71541ec03f8b192d78fd8598044c406cd0ab6528826f9ab0' : null }]
}))
const raw = Buffer.from(JSON.stringify({ files })), digest = hash(raw)
let script = fs.readFileSync('.tools/product-remarks-release-20261020/release.py', 'utf8').replaceAll('\r\n', '\n')
function change(before, after) {
  if (!script.includes(before)) throw Error('发布脚本锚点缺失：' + before.slice(0, 90))
  script = script.replace(before, after)
}
change("COMMIT = '935d9330f6d445f2316e3023b9f97cfce563928c'", `COMMIT = '${commit}'`)
script = script.replace(/^""".*?"""/, '"""追溯码分文件导出：现役覆盖保留，完整备份，零DDL，仅应用回滚。"""')
script = script.replace(/PAYLOAD_SHA = '[a-f0-9]+'/, `PAYLOAD_SHA = '${digest}'`)
script = script.replace(/PAYLOAD_RAW = gzip\.decompress\(base64\.b64decode\('[^']+'\)\)/, `PAYLOAD_RAW = gzip.decompress(base64.b64decode('${gzipSync(raw).toString('base64')}'))`)
change("KIND = 'product-remarks'", "KIND = 'generator-split'")
script = script.replaceAll("'-20261020-'", "'-20261023-'").replaceAll('nz315-production:product-remarks-20261020-', 'nz315-production:generator-split-20261023-')
script = script.replace(/RUNTIME_FILES = set\(\[[^\n]+\]\)/, `RUNTIME_FILES = set(${JSON.stringify(runtimeFiles)})`)
change("base['image'] == 'nz315-production:admin-ui-20261019-1355bd4e'", "base['image'] == 'nz315-production:product-remarks-20261020-b26c271e'")
change("== '1355bd4eb12f0134d02ff62dacc91924c02c469b69adff939d0dfba69287a808'", "== 'b26c271ec28fb6d1c45d02dbbb12d4c44a943d073dbedfa871f4c7c1eafe4715'")
change("    stable()\n    SAFE.mkdir", "    stable()\n    assert get('https://api.github.com/repos/Blue03150328/nz315/commits/master')['sha'] == COMMIT, '远程master变化'\n    SAFE.mkdir")
change("    save()\n    def ignore_source", "    run(['tar', '--exclude=node_modules', '--exclude=.git', '--exclude=backup', '--exclude=logs', '-czf', str(SAFE / 'previous-application.tar.gz'), '-C', str(previous), '.'])\n    run(['tar', '-tzf', str(SAFE / 'previous-application.tar.gz')], stdout=subprocess.DEVNULL)\n    state['applicationBackupSha256'] = sha(SAFE / 'previous-application.tar.gz')\n    save()\n    def ignore_source")
const start = script.indexOf("    for name, item in PAYLOAD['files'].items():"), end = script.indexOf("    state['templateSha256']", start)
if (start < 0 || end < 0) throw Error('载荷范围锚点缺失')
script = script.slice(0, start) + `    for name, item in PAYLOAD['files'].items():
        assert name in ${JSON.stringify(names)}
        target = DEST / name
        if item['beforeSha256'] is None:
            assert not target.exists(), '新增文件已存在：' + name
        else:
            assert hashlib.sha256(normalized(target)).hexdigest() == item['beforeSha256'], '现役基础文件变化：' + name
        data = base64.b64decode(item['data'])
        assert hashlib.sha256(data).hexdigest() == item['sha256']
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    state['payloadSha256'] = PAYLOAD_SHA
    old, new = runtime_files(previous), runtime_files(DEST)
    assert set(new) - set(old) == {'shared/utils/generator-export.ts', 'shared/utils/text-zip.ts'}, '新增运行文件超出范围'
    assert not (set(old) - set(new)), '禁止删除运行文件'
    changed = {name for name in new if name not in old or normalized(old[name]) != normalized(new[name])}
    assert changed == RUNTIME_FILES, ('源码差异超出本次导出范围', sorted(changed))
    state['overlayFiles'] = {name: sha(new[name]) for name in sorted(changed)}
` + script.slice(end)
change("    assert '入库留档' not in compiled", "    for label in ['文件数量', '每个文件的追溯码数量', '打包下载 ZIP', '尚未全部导出', 'export-file-count']:\n        assert label in compiled, '分文件导出标识缺失：' + label\n    assert '入库留档' not in compiled")
change("    assert all(sha(DEST / name) == digest for name,digest in state['overlayFiles'].items()), '候选源码变化'", "    assert all(sha(DEST / name) == digest for name,digest in state['overlayFiles'].items()), '候选源码变化'\n    assert get('https://api.github.com/repos/Blue03150328/nz315/commits/master')['sha'] == COMMIT, '远程master变化，停止切换'")
script = script.replaceAll('remarks-build-only-placeholder-20261020', 'generator-split-build-only-placeholder-20261023').replaceAll("'remarksOnlyRuntimeDiff':True", "'generatorSplitOnlyRuntimeDiff':True")
change("'kind':'product-remarks-20261020','baseCommit':COMMIT", "'kind':'generator-split-20261023','baseCommit':state['previous']['commit'],'masterSourceCommit':COMMIT")
change("'githubMasterChanged':False", "'githubMasterChanged':True")
const folder = '.tools/generator-split-release-20261023'
fs.mkdirSync(folder, { recursive: true })
fs.writeFileSync(folder + '/release.py', script)
const scriptSha = hash(script)
const remote = '/tmp/nz315-generator-split-20261023-' + digest.slice(0, 8) + '.py'
const transfer = `python3 -c 'import base64,gzip,pathlib,hashlib; d=gzip.decompress(base64.b64decode("${gzipSync(script).toString('base64')}")); assert hashlib.sha256(d).hexdigest()=="${scriptSha}"; p=pathlib.Path("${remote}"); assert not p.exists() or p.read_bytes()==d; p.write_bytes(d); compile(d,str(p),"exec"); print("UPLOAD_VERIFIED",len(d),hashlib.sha256(d).hexdigest())'`
fs.writeFileSync(folder + '/transfer.txt', transfer)
fs.writeFileSync(folder + '/manifest.json', JSON.stringify({ commit, digest, scriptSha, remote, files: Object.fromEntries(Object.entries(files).map(([name, item]) => [name, { beforeSha256: item.beforeSha256, sha256: item.sha256 }])) }, null, 2))
console.log(JSON.stringify({ folder, digest, scriptSha, scriptBytes: Buffer.byteLength(script), transferBytes: Buffer.byteLength(transfer) }))
