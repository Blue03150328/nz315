// 追溯码生成核心逻辑端到端测试（Node 24 原生 TS 运行；不依赖 dev 服务器）
// 覆盖：36 种自定义段配置组合 × 结构/校验位/批量统计 + QR/DM 图片渲染 + zip 打包
import { generateOne, generateBatch, checksumValue, segments, DEFAULT_CONFIG, TIMESTAMP_TYPES, RANDOM_TYPES, CHECKSUM_TYPES } from '../server/utils/code-generator.ts'
import { renderCodePng } from '../server/utils/qr-image.ts'
import archiver from 'archiver'
import { mkdir, writeFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let pass = 0
let fail = 0
function ok(cond, name) {
  if (cond) { pass++ } else { fail++; console.error('✗ 失败:', name) }
}

const ctx = { regCategory: 1, regLast6: '040767', produceType: 1, specCode: '001', existingSet: new Set(['12301011001000000000000000000001']) }

// ---------- 1. 36 种配置组合：结构 + 校验位重算 ----------
let combos = 0
for (const ts of TIMESTAMP_TYPES) {
  for (const rd of RANDOM_TYPES) {
    for (const ck of CHECKSUM_TYPES) {
      combos++
      const cfg = { timestampType: ts, randomType: rd, checksumType: ck }
      const code = generateOne(ctx, 100 + combos, cfg)
      ok(/^\d{32}$/.test(code), '32位纯数字 [' + JSON.stringify(cfg) + '] -> ' + code)
      ok(code.startsWith('10407671001'), '码头 11 位正确 [' + JSON.stringify(cfg) + ']')
      if (ck !== 'none') {
        ok(code.slice(30, 32) === checksumValue(code.slice(0, 30), ck), '校验位可重算 [' + JSON.stringify(cfg) + ']')
      }
      // 分段
      const seg = segments(code)
      ok(seg.length === 5 && seg[3].value === '001', '分段解析 [时间戳=' + ts + ']')
    }
  }
}
console.log('配置组合测试:', combos, '种')

// ---------- 2. 校验位算法确定性 ----------
ok(checksumValue('123456789012345678901234567890', 'md5') === checksumValue('123456789012345678901234567890', 'md5'), 'MD5 校验位确定性')
ok(checksumValue('123456789012345678901234567890', 'crc16') === checksumValue('123456789012345678901234567890', 'crc16'), 'CRC16 校验位确定性')
ok(/^\d{2}$/.test(checksumValue('123456789012345678901234567890', 'crc16')), 'CRC16 结果 2 位数字')

// ---------- 3. 批量生成（含重码检测 + 统计） ----------
const batch = generateBatch(ctx, 500, { timestampType: 'ms', randomType: 'none', checksumType: 'md5' })
ok(batch.codes.length === 500, '批量 500 条数量正确')
ok(new Set(batch.codes).size === 500, '批量无重复')
ok(batch.duplicates >= 0 && batch.elapsedMs >= 0, '统计字段齐全 (duplicates=' + batch.duplicates + ', elapsed=' + batch.elapsedMs + 'ms)')
// 系统内重码被跳过
const batch2 = generateBatch(ctx, 3, { timestampType: 'ymd', randomType: 'rand8', checksumType: 'crc16' })
ok(batch2.codes.length === 3 && batch2.codes.every(c => c !== '12301011001000000000000000000001'), '系统内重码不进入结果')

// ---------- 4. 随机段：rand8 唯一性采样 ----------
const rnd = generateBatch(ctx, 200, { timestampType: 'none', randomType: 'rand8', checksumType: 'none' })
ok(new Set(rnd.codes).size === 200, 'rand8 无碰撞（200 条采样）')

// ---------- 5. QR / DM 图片渲染 ----------
const pngQr = await renderCodePng('https://www.nz315.cn/trace?code=' + batch.codes[0], { type: 'QR', moduleSize: 4, quietZone: 2 })
ok(pngQr.length > 100 && pngQr.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'QR PNG 有效 (' + pngQr.length + 'B)')
const pngDm = await renderCodePng('https://www.nz315.cn/trace?code=' + batch.codes[0], { type: 'DM', moduleSize: 4, quietZone: 2 })
ok(pngDm.length > 100 && pngDm.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'DM PNG 有效 (' + pngDm.length + 'B)')

// ---------- 6. zip 打包（模拟下载 API 流程） ----------
const dir = join(tmpdir(), 'nz315-test-' + Date.now())
await mkdir(dir, { recursive: true })
for (let i = 1; i <= 5; i++) await writeFile(join(dir, 'bar_' + String(i).padStart(4, '0') + '.png'), pngQr)
const zipPath = join(tmpdir(), 'nz315-test-' + Date.now() + '.zip')
const archive = archiver('zip', { zlib: { level: 9 } })
const out = await import('node:fs').then(m => m.createWriteStream(zipPath))
archive.pipe(out)
archive.directory(dir, false)
archive.finalize()
await new Promise((resolve, reject) => { out.on('close', resolve); out.on('error', reject) })
const zipBuf = await import('node:fs/promises').then(m => m.readFile(zipPath))
ok(zipBuf.subarray(0, 2).toString() === 'PK', 'zip 文件头正确 (' + zipBuf.length + 'B)')
const zipFiles = await readdir(dir)
ok(zipFiles.length === 5, '临时目录 5 张 PNG')
await rm(dir, { recursive: true, force: true })
await rm(zipPath, { force: true })

console.log('\n==== 测试结果: 通过 ' + pass + ' / 失败 ' + fail + ' ====')
if (fail > 0) process.exit(1)