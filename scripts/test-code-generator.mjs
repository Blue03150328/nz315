// 追溯码生成核心逻辑端到端测试（Node 原生 TS 运行；不依赖 dev 服务器）
// 覆盖：36 种自定义段配置组合 × 结构/校验位/批量统计
// 注：图片渲染与 zip 打包用例已于 2026-09-15 随服务端生成链路下线移除
import { generateOne, generateBatch, checksumValue, segments, DEFAULT_CONFIG, TIMESTAMP_TYPES, RANDOM_TYPES, CHECKSUM_TYPES } from '../server/utils/code-generator.ts'

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

// ---------- 5. 图片渲染与 zip 打包：已随服务端生成下线移除（2026-09-15） ----------
// 原「QR/DM PNG 渲染 + archiver zip 打包」用例，测的是 server/utils/qr-image.ts 与下载 API。
// 该链路已整体下线（二维码图片改由官方离线工具在本机生成），故用例一并删除，不再断言。
// 本脚本此后只覆盖「码生成引擎」本身：结构 / 校验位 / 批量统计。

console.log('\n==== 测试结果: 通过 ' + pass + ' / 失败 ' + fail + ' ====')
if (fail > 0) process.exit(1)