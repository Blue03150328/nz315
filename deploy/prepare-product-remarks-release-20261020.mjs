// 基于已上线界面版叠加备注列，保留全部现役源码及应用回滚能力。
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const baseline = 'c33eb76a61cb9466a4f713e190478be171b82822'
const names = ['server/api/admin/products/export.get.ts', 'server/utils/product-import-input.ts', 'shared/utils/product-export.ts', 'tests/product-export.test.mjs', 'tests/product-import.test.mjs', 'tests/product-export.integration.mjs']
const files = Object.fromEntries(names.map(name => {
  const data = fs.readFileSync(name, 'utf8').replaceAll('\r\n', '\n')
  const before = execFileSync('git', ['show', baseline + ':' + name], { encoding: 'utf8' }).replaceAll('\r\n', '\n')
  return [name, { data: Buffer.from(data).toString('base64'), sha256: hash(data), beforeSha256: hash(before) }]
}))
const raw = Buffer.from(JSON.stringify({ files })), digest = hash(raw)
let script = fs.readFileSync('.tools/ui-overlay-release-20261019/release-admin-ui-overlay-20261019.py', 'utf8').replaceAll('\r\n', '\n')
script = script.replace(/^""".*?"""/, '"""产品导出备注列：保留现役覆盖，完整备份，零DDL，仅应用回滚。"""')
  .replace(/PAYLOAD_SHA = '[a-f0-9]+'/g, `PAYLOAD_SHA = '${digest}'`)
  .replace(/PAYLOAD_RAW = gzip\.decompress\(base64\.b64decode\('[^']+'\)\)/, `PAYLOAD_RAW = gzip.decompress(base64.b64decode('${gzipSync(raw).toString('base64')}'))`)
  .replaceAll("KIND = 'admin-ui'", "KIND = 'product-remarks'")
  .replaceAll("IMAGE = 'nz315-production:admin-ui-20261019-'", "IMAGE = 'nz315-production:product-remarks-20261020-'")
  .replaceAll("'-20261019-'", "'-20261020-'")
  .replace(/UI_FILES = set\(\[[^\n]+\]\)/, `UI_FILES = set(${JSON.stringify(names.filter(n => !n.startsWith('tests/')))})`)
  .replace("assert base['commit'] == EXPECTED_PREVIOUS, '现役版本已变，请重新核对'", "assert base['commit'] == EXPECTED_PREVIOUS and base['image'] == 'nz315-production:admin-ui-20261019-1355bd4e', '现役版本已变，请重新核对'\n    assert base.get('sourceOverlay', {}).get('payloadSha256') == '1355bd4eb12f0134d02ff62dacc91924c02c469b69adff939d0dfba69287a808', '现役界面覆盖层变化'")
const start = script.indexOf('    shutil.copytree(str(previous),str(DEST)'), end = script.indexOf("    state['templateSha256']", start)
if (start < 0 || end < 0) throw Error('发布阶段锚点缺失')
script = script.slice(0, start) + `    def ignore_source(folder, entries):
        ignored = {'node_modules', '.nuxt', '.output', '.git', '.env', '.docker-deploy.env', '.docker-release.json'}
        if pathlib.Path(folder) == previous:
            ignored |= {'backup', 'logs'}
        return [name for name in entries if name in ignored or name.startswith('.env.')]
    shutil.copytree(str(previous), str(DEST), ignore=ignore_source)
    for name, item in PAYLOAD['files'].items():
        assert name in ${JSON.stringify(names)}
        target = DEST / name
        assert hashlib.sha256(normalized(target)).hexdigest() == item['beforeSha256'], '现役基础文件变化：' + name
        data = base64.b64decode(item['data'])
        assert hashlib.sha256(data).hexdigest() == item['sha256']
        target.write_bytes(data)
    state['payloadSha256'] = PAYLOAD_SHA
    old, new = runtime_files(previous), runtime_files(DEST)
    assert set(old) == set(new), '禁止增删现役运行文件'
    changed = {name for name in new if normalized(old[name]) != normalized(new[name])}
    assert changed == UI_FILES, ('源码差异超出备注列范围', sorted(changed))
    state['uiFiles'] = {name: sha(new[name]) for name in sorted(changed)}
` + script.slice(end)
script = script.replaceAll("'uiOnlyRuntimeDiff':True", "'remarksOnlyRuntimeDiff':True")
  .replaceAll('UI_FILES', 'RUNTIME_FILES').replaceAll('uiFiles', 'overlayFiles')
  .replaceAll("'kind':'admin-ui-20261019'", "'kind':'product-remarks-20261020'")
  .replaceAll('ui-build-only-placeholder-20261019', 'remarks-build-only-placeholder-20261020')
const folder = '.tools/product-remarks-release-20261020'
fs.mkdirSync(folder, { recursive: true })
fs.writeFileSync(folder + '/release.py', script)
fs.writeFileSync(folder + '/manifest.json', JSON.stringify({ digest, tag: 'product-remarks-20261020-' + digest.slice(0, 8), files: Object.fromEntries(Object.entries(files).map(([name, f]) => [name, { beforeSha256: f.beforeSha256, sha256: f.sha256 }])) }, null, 2))
console.log(JSON.stringify({ folder, digest, scriptBytes: Buffer.byteLength(script) }))
