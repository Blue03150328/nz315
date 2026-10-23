import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import XLSX from 'xlsx'
import { planGeneratorExport, generatorExportText, MAX_EXPORT_FILES } from '../shared/utils/generator-export.ts'
import { TextZip } from '../shared/utils/text-zip.ts'

const context = { traceBaseUrl: 'https://example.invalid/trace?code=', product: { name: '测试"药,甲', registrationNo: 'PD20991234', specCode: '001' }, companyName: '测试公司', generatedAt: '2026/10/23 10:00:00' }
const codes = Array.from({ length: 8000 }, (_, index) => '11234561001' + String(index).padStart(21, '0'))
const bundledPython = path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe')
const python = process.env.NZ315_TEST_PYTHON || (existsSync(bundledPython) ? bundledPython : 'python3')

test('20份×400条恰好8000条；部分导出和后续剩余数量明确', () => {
  assert.deepEqual(planGeneratorExport(8000, 20, 400), { fileCount: 20, codesPerFile: 400, total: 8000, remaining: 0 })
  assert.equal(planGeneratorExport(10000, 20, 400).remaining, 2000)
  assert.equal(planGeneratorExport(2000, 5, 400).remaining, 0)
  assert.equal(planGeneratorExport(1, 1, 1).total, 1)
})

test('拒绝超量、空值、零、负数、小数、无穷和过多文件，不生成尾部空文件', () => {
  assert.throws(() => planGeneratorExport(7999, 20, 400), /当前可导出 7,999 条/)
  for (const value of [0, -1, 0.5, NaN, Infinity, MAX_EXPORT_FILES + 1]) assert.throws(() => planGeneratorExport(8000, value, 1))
  for (const value of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => planGeneratorExport(8000, 1, value))
})

test('三格式保留原码、网址、BOM与CSV完整表头，每份CSV恰好400条数据', () => {
  const chunk = codes.slice(0, 400)
  assert.equal(generatorExportText(chunk, 'txt', context), '\uFEFF' + chunk.join('\n'))
  assert.equal(generatorExportText(chunk, 'urls', context), '\uFEFF' + chunk.map(code => context.traceBaseUrl + code).join('\n'))
  const csv = generatorExportText(chunk, 'csv', context)
  assert.equal(csv.charCodeAt(0), 0xfeff)
  const rows = XLSX.utils.sheet_to_json(XLSX.read(csv.slice(1), { type: 'string', raw: true }).Sheets.Sheet1, { header: 1 })
  assert.equal(rows.length, 401)
  assert.equal(rows[0][0], 'sn')
  assert.equal(rows[0].length, 11)
  assert.equal(rows[1][1], context.product.name)
  assert.equal(rows[1][5], '001')
  assert.deepEqual(rows.slice(1).map(row => row[0]), chunk)
})

test('独立Python ZIP读取器验证三格式20份、中文文件名、CRC、每份400条及全批无重无漏', async () => {
  for (const format of ['txt', 'urls', 'csv']) {
    const zip = new TextZip()
    for (let index = 0; index < 20; index++) {
      zip.add(`测试药_第${String(index + 1).padStart(3, '0')}份.${format === 'csv' ? 'csv' : 'txt'}`, generatorExportText(codes.slice(index * 400, (index + 1) * 400), format, context))
    }
    const script = `import sys, io, zipfile, csv, json
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
assert z.testzip() is None
assert len(z.infolist()) == 20
result=[]
for info in z.infolist():
 assert info.flag_bits & 0x800
 assert info.filename.startswith('测试药_第')
 raw=z.read(info)
 assert raw.startswith(bytes([239,187,191]))
 text=raw.decode('utf-8-sig')
 rows=list(csv.reader(io.StringIO(text)))[1:] if info.filename.endswith('.csv') else [[s] for s in text.splitlines()]
 assert len(rows)==400
 result.extend(r[0].split('code=')[-1] for r in rows)
assert len(set(result))==8000
assert result==['11234561001'+str(i).zfill(21) for i in range(8000)]
print('通过')`
    const check = spawnSync(python, ['-c', script], { input: Buffer.from(await zip.toBlob().arrayBuffer()), encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } })
    assert.equal(check.status, 0, check.stderr || check.error?.message)
  }
})

test('空ZIP不允许下载', () => assert.throws(() => new TextZip().toBlob(), /没有可导出/))
