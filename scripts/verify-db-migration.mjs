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
// 比对维度：全部表行数 · 关键表 MAX(id)（自增位是否被推进）· 企业名单 · 账号（id/username/role/status）· 追溯码前 30 条
//   · `session_epoch` **只留证不判定**（它随登出/改密正常变化，纳入比对会产生假 FAIL）
// 连接参数从项目根目录 .env 读取（DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME）
//
// 2026-09-19 修正（部署前实测暴露，两条都会让生产库部署当场卡住）：
//   ① 原 `snapshot()` 硬查 `user.session_epoch` —— 而该列正是本次要补的新列，**补列前它不存在**，
//      于是三明治的第一步 `dump` 在真实库上必然以 ER_BAD_FIELD_ERROR 崩掉。现改为先探测列存在性，
//      缺失时按 0 记录（与 ALTER 的 DEFAULT 0 对齐）。
//   ② 原比对把 `session_epoch` 一起纳入；部署窗口里任何人登出一次，值就变 → 报假 FAIL，
//      反而盖掉真正的红字。现拆为「账号核心字段严格比对」+「session_epoch 留证打印」。
//   另：基线带 `scriptVersion`，结构一变即拒绝比对，避免拿过期基线当证据。
//   ③ 行数比对区分「业务主数据」与「活跃日志表」：scan_log / operation_log 是纯追加日志，
//      线上真实消费者扫码、管理员登录都会让它们增长——那是活的业务，不是迁移污染。
//      故对这两张放宽为「只增不减」，其余表仍严格相等（seed 若误跑必被业务表命中）。
//
// 2026-09-23 修正（④ 预期新建表白名单）：
//   原逻辑「出现基线中不存在的新表 ⇒ 一律 FAIL」是给 09-19 那次「只补列、不建表」的迁移写的判据。
//   而 ycdb 整线上线的迁移**第一件事就是新建 `external_verification` 表** ⇒ 该判据必然命中，
//   产出假 FAIL（退出码 1），差点被当成数据污染而回滚（真实踩到）。
//   现改为：白名单（EXPECTED_NEW_TABLES）内的新表**不算污染**，但必须 ① 真的建出来了
//   ② **行数为 0**（迁移路径只有 CREATE/ALTER，没有任何 INSERT —— 这条同时补上了原脚本的盲区：
//   逐表行数循环只遍历「基线里已有的表」，新表的行数原来根本没人看）。
//   白名单**之外**的新表仍然 FAIL。
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

// 快照结构版本：基线里的结构一变（字段增删），旧基线就不能再拿来当证据（脚本会拒绝比对）
const SCRIPT_VERSION = 2;

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
  // ⚠️ user.session_epoch 是 2026-09-19 才新增的列：真实/生产库在「补列之前」**没有这一列**，
  //    而三明治用法要求「补列前先 dump 基线」——基线阶段若硬查这一列，会以
  //    ER_BAD_FIELD_ERROR（Unknown column 'session_epoch' in 'field list'）直接崩掉，
  //    部署第一步就卡死。故先探测列是否存在，缺失时按 0 记录（与 ALTER 的 DEFAULT 0 对齐，
  //    这样「迁移前基线」与「迁移后快照」在账号维度上仍可逐字段比对）。
  const [epochCol] = await conn.query(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [DB.database, 'user', 'session_epoch'],
  );
  const hasSessionEpoch = epochCol.length > 0;
  const [usrRows] = await conn.query(
    'SELECT id, username, role, status, '
    + (hasSessionEpoch ? 'session_epoch' : 'CAST(0 AS SIGNED) AS session_epoch')
    + ' FROM `user` ORDER BY id',
  );
  // ⚠️ session_epoch **不参与严格比对**：它随「登出 / 改密 / 重置密码」正常变化，
  //    部署窗口里只要有人登出一次就会变——那是预期行为，不是数据污染。
  //    若把它纳入比对，会产出「假 FAIL」并诱导人忽略真正的红字。故账号只比 id/username/role/status，
  //    session_epoch 仅作留证打印（本列存在与否见 hasSessionEpoch）。
  const usrs = usrRows.map((u) => ({ id: u.id, username: u.username, role: u.role, status: u.status }));
  const epochNonZero = usrRows
    .filter((u) => Number(u.session_epoch) !== 0)
    .map((u) => u.username + '=' + u.session_epoch);
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
  return {
    scriptVersion: SCRIPT_VERSION,
    counts, ents, usrs, codes, maxIds: maxIds[0], tableCount: tables.length, hasSessionEpoch, epochNonZero,
  };
}

const snap = await snapshot();

if (mode === 'dump') {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, JSON.stringify(snap, null, 1), 'utf8');
  console.log('[verify] 基线已写入 ' + path.relative(ROOT, BASELINE));
  console.log('[verify] 表数=' + snap.tableCount + ' · 企业=' + snap.ents.length
    + ' · 账号=' + snap.usrs.length + ' · 追溯码=' + snap.counts.trace_code);
  console.log('[verify] user.session_epoch 列：'
    + (snap.hasSessionEpoch ? '已存在（本次迁移无需补列）' : '不存在（迁移前，按 0 记入基线）'));
  console.log('[verify] 下一步：node scripts/db-init.mjs --migrate-only');
  process.exit(0);
}

// compare
if (!fs.existsSync(BASELINE)) {
  console.error('[verify] 找不到基线 ' + BASELINE + '，请先执行 dump');
  process.exit(2);
}
const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
if (base.scriptVersion !== SCRIPT_VERSION) {
  console.error('[verify] 基线结构版本不符（基线=' + (base.scriptVersion ?? '无')
    + '，当前=' + SCRIPT_VERSION + '）：这份基线是旧版脚本写的，不能再当证据。');
  console.error('[verify] 请重新执行：node scripts/verify-db-migration.mjs dump');
  process.exit(2);
}
let bad = 0;
const fail = (msg) => { bad++; console.log('FAIL  ' + msg); };
const ok = (msg) => console.log('OK    ' + msg);

// 活跃日志表：线上随时可能有真实业务在写（消费者扫码写 scan_log、管理员登录写 operation_log、
// 后台「外部二维码核验」写 external_verification），部署窗口期（几分钟）内它们**正常增长不是污染证据**。
// 判据放宽为「只增不减」（**减少仍判 FAIL**——那可能意味着数据被删），且增长不计入 FAIL。
// ⚠️ 2026-09-23 把 external_verification 也加进来：它天生是追加型，上线后每次核验都写一行；
//    若不列进来，日后「已上线状态再重跑一次三明治」会把正常业务写入报成迁移污染（假 FAIL）。
// ⚠️ 只有这三张是纯追加型；业务主数据表一律严格相等——seed 若被误跑，
//    enterprise / trace_code / product / batch / upload_batch / product_spec 必被命中，逃不掉。
const ACTIVE_TABLES = ['scan_log', 'operation_log', 'external_verification'];
const grew = [];

// 本次迁移**预期要新建**的表（白名单）：出现在这里的新表不算污染，但必须存在且为空表。
// 每次带来「新建表」的上线，都要把新表名加进来；不在名单里的新表仍然判 FAIL。
const EXPECTED_NEW_TABLES = ['external_verification'];

console.log('--- 1) 逐表行数（业务主数据必须严格相等；活跃日志表允许只增不减）---');
for (const t of Object.keys(base.counts)) {
  const a = base.counts[t];
  const b = snap.counts[t];
  const active = ACTIVE_TABLES.includes(t);
  if (a === b) ok(t.padEnd(18) + a);
  else if (active && b > a) {
    grew.push(t + ' +' + (b - a));
    console.log('注意  ' + t.padEnd(18) + a + ' -> ' + b + '（活跃表，允许正常增长，不计入 FAIL）');
  } else fail(t.padEnd(18) + a + ' -> ' + (b === undefined ? '(表不存在)' : b));
}
if (grew.length) console.log('      ↑ 窗口期内的真实业务写入：' + grew.join('、') + '（与本次迁移无关）');
const extra = Object.keys(snap.counts).filter((t) => !(t in base.counts));
const expectedNew = extra.filter((t) => EXPECTED_NEW_TABLES.includes(t));
const unexpectedNew = extra.filter((t) => !EXPECTED_NEW_TABLES.includes(t));
if (unexpectedNew.length) fail('出现了基线中不存在、且不在预期白名单里的新表: ' + unexpectedNew.join(', '));
for (const t of expectedNew) {
  const c = snap.counts[t];
  // 新表必须空：迁移路径只有 CREATE TABLE / ALTER TABLE，没有任何 INSERT。
  // 原脚本的逐表行数循环只遍历「基线里已有的表」⇒ 新表行数是个盲区，这里补上。
  if (c === 0) ok('新表 ' + t.padEnd(22) + '0（本次迁移预期新建，空表属正常）');
  else fail('新表 ' + t + ' 里有 ' + c + ' 行 —— 迁移路径不该往新表写数据，立刻停手排查');
}
for (const t of EXPECTED_NEW_TABLES) {
  if (!(t in snap.counts)) fail('预期新建的表 ' + t + ' 没有出现 —— 第 4.2 步的迁移没把它建出来，请回看那步输出');
}

console.log('--- 2) MAX(id) 自增位（被推进说明有 INSERT）---');
for (const k of Object.keys(base.maxIds)) {
  if (base.maxIds[k] === snap.maxIds[k]) ok(k + ': ' + base.maxIds[k]);
  else fail(k + ': ' + base.maxIds[k] + ' -> ' + snap.maxIds[k]);
}

console.log('--- 3) 本次迁移的列变化（仅留证，不参与判定）---');
console.log('      user.session_epoch：' + (base.hasSessionEpoch ? '迁移前已存在' : '迁移前不存在')
  + ' → ' + (snap.hasSessionEpoch ? '现在存在' : '现在仍不存在'));
if (!base.hasSessionEpoch && !snap.hasSessionEpoch) {
  fail('user.session_epoch 仍不存在 —— 迁移没补上列，会话吊销会静默失效（不报错、只是没生效），请立刻停手排查');
}

console.log('--- 4) 明细快照 ---');
const rows = [
  ['企业名单', base.ents, snap.ents],
  ['账号（id/username/role/status）', base.usrs, snap.usrs],
  ['追溯码前 30 条', base.codes, snap.codes],
];
for (const [name, a, b] of rows) {
  if (JSON.stringify(a) === JSON.stringify(b)) ok(name);
  else fail(name + '\n        基线=' + JSON.stringify(a) + '\n        现在=' + JSON.stringify(b));
}

// session_epoch 留证（不参与判定）：登出/改密会让它变化，属正常
console.log('--- 5) session_epoch 留证（不参与判定；登出/改密会让它变化，属正常）---');
console.log('      基线非零账号：' + (base.epochNonZero?.length ? base.epochNonZero.join(', ') : '无（全为 0）'));
console.log('      现在非零账号：' + (snap.epochNonZero?.length ? snap.epochNonZero.join(', ') : '无（全为 0）'));

console.log('=== 结论：' + (bad === 0
  ? 'PASS —— 业务数据零变化（迁移安全）'
  : 'FAIL —— ' + bad + ' 处不一致，立刻停手排查，不要继续部署') + ' ===');
process.exit(bad === 0 ? 0 : 1);
