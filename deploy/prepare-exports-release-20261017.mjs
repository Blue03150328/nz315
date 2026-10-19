// 从现役源码叠加两个导出功能，不携带工作区其他功能；私有凭据不进入载荷。
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
const hash = data => createHash('sha256').update(data).digest('hex')
const folder = '.tools/exports-release-20261017'
fs.mkdirSync(folder, { recursive: true })
const files = {}
for (const name of ['server/api/admin/products/export.get.ts', 'server/utils/product-filter.ts', 'server/api/admin/products.get.ts',
  'server/api/admin/specs/export.get.ts', 'server/utils/spec-filter.ts', 'shared/utils/spec-transfer.ts', 'server/api/admin/specs.get.ts',
  'public/templates/spec-import-template.xlsx', 'tests/product-export.test.mjs']) files[name] = fs.readFileSync(name)
// 本轮不上线产品导入：将导出表头常量内联，避免依赖尚未上线的导入模块。
let productExport = fs.readFileSync('shared/utils/product-export.ts', 'utf8')
const importSource = fs.readFileSync('shared/utils/product-import.ts', 'utf8')
const headers = importSource.match(/export const PRODUCT_IMPORT_HEADERS = (\[[^\n]+\])/)?.[1]
if (!headers) throw Error('产品七列表头无法核对')
productExport = productExport.replace("import { PRODUCT_IMPORT_HEADERS } from './product-import'\n", '').replace("import { PRODUCT_IMPORT_HEADERS } from './product-import'\r\n", '')
  .replace('export const PRODUCT_EXPORT_HEADERS = [...PRODUCT_IMPORT_HEADERS]', 'export const PRODUCT_EXPORT_HEADERS = ' + headers)
if (productExport.includes('product-import')) throw Error('导出仍依赖产品导入')
files['shared/utils/product-export.ts'] = Buffer.from(productExport)
files['tests/exports-release.test.mjs'] = Buffer.from(`import {test} from 'node:test';import assert from 'node:assert/strict';import {register} from 'node:module';register('./_ts-loader.mjs',import.meta.url);
const {specExportValues,SPEC_EXPORT_HEADERS}=await import('../shared/utils/spec-transfer.ts');
const {parseSpecification}=await import('../shared/utils/specification.ts');
test('标准规格单列导出数量来自数据库，保持500克×20瓶格式',()=>{assert.deepEqual(SPEC_EXPORT_HEADERS,['规格']);assert.deepEqual(specExportValues({net_content:500,content_unit:'克',pack_unit:'瓶',pack_quantity:20}),['500克×20瓶'])});
test('外部截图两种规格归一且数量不丢失',()=>{assert.equal(parseSpecification('20毫升/瓶x20').name,'20毫升×20瓶');assert.equal(parseSpecification('130克/瓶x40').quantity,40)});
test('单列导出不改动原记录，原结构缺失可按标准旧名称解析',()=>{const r={spec_name:'500毫升/瓶x10',pack_quantity:1};assert.deepEqual(specExportValues(r),['500毫升×1瓶']);assert.equal(r.spec_name,'500毫升/瓶x10')});
`)
const extract = (file, end) => {
  const text = fs.readFileSync(file, 'utf8'), start = text.indexOf('const exporting = ref(false)')
  const finish = text.indexOf(end, start)
  if (start < 0 || finish < 0) throw Error('导出页面函数提取失败')
  return text.slice(start, finish).trim().replaceAll('\r\n', '\n') + '\n'
}
const payload = {
  sourceCommit: '51cd9e3',
  files: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, { sha256: hash(data), data: data.toString('base64') }])),
  expectedSpecificationSha256: hash(Buffer.from(fs.readFileSync('shared/utils/specification.ts', 'utf8').replaceAll('\r\n', '\n'))),
  productFunction: extract('app/pages/admin/products/index.vue', '// ============ 归属厂家'),
  specFunction: extract('app/pages/admin/specs/index.vue', '// 新增/编辑对话框'),
  specNote: '模板仅一列「规格」，标准格式如「500克×20瓶」「20毫升×20瓶」，数量须为1～999999整数。外部「500克/瓶x20」等写法会自动转换为标准格式；规格码按本企业空闲码分配，重复或错误行显示失败原因。',
}
const data = Buffer.from(JSON.stringify(payload)), digest = hash(data)
fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({ digest, files: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, hash(data)])) }, null, 2))
let header = fs.readFileSync('.tools/offline-dm-20261016/server-release.py', 'utf8').split('\ndef publish_download():')[0]
header = header.replace('import datetime', 'import base64\nimport datetime')
  .replace("MODE, COMMIT = sys.argv[1:3]", "MODE = sys.argv[1]\nCOMMIT = 'c79ec31ffc7709673760409e37d117acbe7bf504'\nTAG = 'exports-20261017-" + digest.slice(0, 8) + "'\nPAYLOAD = json.loads(gzip.decompress(base64.b64decode('" + gzipSync(data).toString('base64') + "')).decode('utf-8'))\nPAYLOAD_SHA = '" + digest + "'")
  .replace("KIND = 'offline-tool'", "KIND = 'exports'")
  .replace("pathlib.Path('/var/www/.nz315-' + KIND + '-20261016-' + COMMIT[:8])", "pathlib.Path('/var/www/.nz315-' + TAG)")
  .replace("pathlib.Path('/var/backups/nz315/' + KIND + '-20261016-' + COMMIT[:8])", "pathlib.Path('/var/backups/nz315/' + TAG)")
  .replace("CANDIDATE = 'nz315-' + KIND + '-candidate-' + COMMIT[:8]", "CANDIDATE = 'nz315-' + TAG + '-candidate'")
  .replace("IMAGE = 'nz315-production:offline-tool-121-e5a4181b'", "IMAGE = 'nz315-production:' + TAG")
  .replace("for route in ['/api/admin/products', '/api/admin/specs', '/api/admin/production-lines', '/api/admin/production-tasks', '/api/admin/codes/usage-batches']:", "for route in ['/api/admin/products', '/api/admin/specs', '/api/admin/products/export', '/api/admin/specs/export', '/api/admin/production-lines', '/api/admin/production-tasks', '/api/admin/codes/usage-batches']:")
  .replace("assert get(base + '/_nuxt/builds/latest.json') == state['candidateBuild'], '构建指纹不一致'", "assert get(base + '/_nuxt/builds/latest.json') == state['candidateBuild'], '构建指纹不一致'\n    with urllib.request.urlopen(base + '/templates/spec-import-template.xlsx?v=20261017-standard-times3', timeout=30) as response:\n        assert hashlib.sha256(response.read()).hexdigest() == PAYLOAD['files']['public/templates/spec-import-template.xlsx']['sha256'], '标准规格模板未正确发布'")
fs.writeFileSync(path.join(folder, 'nz315-exports-release.py'), header + '\n' + fs.readFileSync('deploy/release-exports-phases-20261017.py', 'utf8'))
console.log(JSON.stringify({ script: path.resolve(folder, 'nz315-exports-release.py'), tag: 'exports-20261017-' + digest.slice(0, 8), bytes: fs.statSync(path.join(folder, 'nz315-exports-release.py')).size, payloadSha256: digest, files: Object.keys(files).length }))
