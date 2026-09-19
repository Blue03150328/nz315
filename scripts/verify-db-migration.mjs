// 数据库迁移安全性校验：证明「补列/补索引」没有顺手写进任何业务数据
//
// 背景（2026-09-19）：`scripts/db-init.mjs` 的 main() 会无条件执行 seed()，
//   在真实/生产库上裸跑会插入演示企业、4 条演示追溯码（进 trace_code 核心表）、演示产品/批次
//   与 admin123 演示账号。故补出 `--migrate-only` 参数，并用本脚本给出「零写入」的客观证据。
//
// 用法（三明治：取基线 → 跑迁移 → 比对）：
//   node scripts/verify-db-migration.mjs dump      # ① 迁移前：记基线（写入 logs/mig-baseline.json）
//   node scripts/db-init.mjs --migrate-only        # ② 执行迁移（务必带 --migrate-only）
//   node scripts/verify-db-migration.mjs compare   # ③ 迁移后：逐表比对，不一致则 exit 1
//
// 比对维度：全部表行数 · 关键表 MAX(id)（自增位是否被推进）· 企业名单 · 账号（含 session_epoch）· 追溯码前 30 条
// 连接参数从项目根目录 .env 读取（DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME）
'use strict';
import mysql from 'mysql2/promise';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BASELINE = path.join(ROOT, 'logs', 'mig-baseline.json');

const mode = process.argv[2];
if (mode !== 'dump' && mode !== 'compare') {
  console.error('用法：node scripts/verify-db-migration.mjs dump|compare');
  process.exit(2);
}

// 读取 .env（简易解析，无 dotenv 依赖）
const env = {};
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
const DB = {
  host: env.DB_HOST || '127.0.0.1',
  port: Number(env.DB_PORT || 3306),
  user: env.DB_USER || 'root',
  password: env.DB_PASSWORD || '',
  database: env.DB_NAME || 'nz315',
};

/** 采集当前库快照 */
async function snapshot() {
  const conn = await mysql.createConnection(DB);
  const [tables] = await conn.query(
    'SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
    [DB.database],
  );
  const counts = {};
  for (const { t } of tables) {
    const [r] = await conn.query('SELECT COUNT(*) AS c FROM `' + t + '`');
    counts[t] = r[0].c;
  }
  const [ents] = await conn.query('SELECT id, name FROM enterprise ORDER BY id');
  const [usrs] = await conn.query('SELECT id, username, role, status, session_epoch FROM `user` ORDER BY id');
  const [codes] = await conn.query('SELECT id, code, status, abnormal_flag FROM trace_code ORDER BY id LIMIT 30');
  const [maxIds] = await conn.query(`SELECT
    (SELECT IFNULL(MAX(id),0) FROM enterprise) AS ent,
    (SELECT IFNULL(MAX(id),0) FROM \`user\`) AS usr,
    (SELECT IFNULL(MAX(id),0) FROM trace_code) AS code,
    (SELECT IFNULL(MAX(id),0) FROM upload_batch) AS ub,
    (SELECT IFNULL(MAX(id),0) FROM product) AS prod,
    (SELECT IFNULL(MAX(id),0) FROM product_spec) AS spec,
    (SELECT IFNULL(MAX(id),0) FROM batch) AS batch,
    (SELECT IFNULL(MAX(id),0) FROM product_original) AS orig`);
  await conn.end();
  return { counts, ents, usrs, codes, maxIds: maxIds[0], tableCount: tables.length };
}

const snap = await snapshot();

if (mode === 'dump') {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, JSON.stringify(snap, null, 1), 'utf8');
  console.log('[verify] 基线已写入 ' + path.relative(ROOT, BASELINE));
  console.log('[verify] 表数=' + snap.tableCount + ' · 企业=' + snap.ents.length
    + ' · 账号=' + snap.usrs.length + ' · 追溯码=' + snap.counts.trace_code);
  console.log('[verify] 下一步：node scripts/db-init.mjs --migrate-only');
  process.exit(0);
}

// compare
if (!fs.existsSync(BASELINE)) {
  console.error('[verify] 找不到基线 ' + BASELINE + '，请先执行 dump');
  process.exit(2);
}
const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
let bad = 0;
const fail = (msg) => { bad++; console.log('FAIL  ' + msg); };
const ok = (msg) => console.log('OK    ' + msg);

console.log('--- 1) 逐表行数（迁移不应改变任何表的行数）---');
for (const t of Object.keys(base.counts)) {
  const a = base.counts[t];
  const b = snap.counts[t];
  if (a === b) ok(t.padEnd(18) + a);
  else fail(t.padEnd(18) + a + ' -> ' + (b === undefined ? '(表不存在)' : b));
}
const extra = Object.keys(snap.counts).filter((t) => !(t in base.counts));
if (extra.length) fail('出现了基线中不存在的新表: ' + extra.join(', '));

console.log('--- 2) MAX(id) 自增位（被推进说明有 INSERT）---');
for (const k of Object.keys(base.maxIds)) {
  if (base.maxIds[k] === snap.maxIds[k]) ok(k + ': ' + base.maxIds[k]);
  else fail(k + ': ' + base.maxIds[k] + ' -> ' + snap.maxIds[k]);
}

console.log('--- 3) 明细快照 ---');
const rows = [
  ['企业名单', base.ents, snap.ents],
  ['账号（含 session_epoch）', base.usrs, snap.usrs],
  ['追溯码前 30 条', base.codes, snap.codes],
];
for (const [name, a, b] of rows) {
  if (JSON.stringify(a) === JSON.stringify(b)) ok(name);
  else fail(name + '\n        基线=' + JSON.stringify(a) + '\n        现在=' + JSON.stringify(b));
}

console.log('=== 结论：' + (bad === 0
  ? 'PASS —— 业务数据零变化（迁移安全）'
  : 'FAIL —— ' + bad + ' 处不一致，立刻停手排查，不要继续部署') + ' ===');
process.exit(bad === 0 ? 0 : 1);
