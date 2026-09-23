'use strict';
// 农资315 · 每日定时巡检脚本
//
// 用途（PRD 5.9「8 类异常」中**此前完全没有触发路径**的三类）：
//   ① 登记证号不存在（类型 3）—— 建档阻断缺失时的存量清理（对应缺陷 N1 的历史数据侧）
//   ② 登记证已过期（类型 4）—— 扫码触发只能覆盖"有人扫"的场景；巡检才是不依赖扫码的兜底
//   ③ 生产厂家不符（类型 6）—— 产品登记持有人 与 国家登记库 company 不一致
//   ⚠️ **首版不做「产品名称不符」(类型 5)**：P1-5 已证该口径（`normalizeProductName` 只剥 `\d+%`）
//      会误报，一次性灌入大量假预警。等口径定了再加。
//
// 🔴 三条硬约束：
//   1. **本脚本不是造数脚本** ⇒ **刻意不设 `DB_HOST` 本机白名单**（线上服务端 `DB_HOST` 正是
//      `127.0.0.1`，设了白名单就等于永远跑不起来）。它的安全闸是 **「默认 dry-run、必须显式 `--apply`」**，
//      请务必保留这个默认值 —— 造数脚本 `seed-abnormal-demo.mjs` 的取向与本脚本**相反**，别混淆。
//   2. **只读业务表 + 只写 `risk_alert`**：绝不改 `product` / `trace_code`，绝不自动作废任何码。
//      消费者/企业看到的问题由人在后台「风险预警中心」走"已核实合规 / 已确认违规"处理。
//   3. **冷却期**：`triggerAlert` 的合并语义是"已处理的就新建一条" ⇒ 若每天巡检，同一个老问题会
//      **天天新建**、`risk_alert` 随天数线性膨胀。故同一 `product_id + alert_type` 在 N 天（默认 30）
//      内已有记录（**无论处理状态**）就跳过。
//
// 用法：
//   node scripts/inspect-daily.mjs              # dry-run（默认）：只打印将要产生的预警，不写库
//   node scripts/inspect-daily.mjs --apply      # 真正写入 risk_alert
//   node scripts/inspect-daily.mjs --apply --notify   # 同时给企业发站内信（默认不发，见下）
//   node scripts/inspect-daily.mjs --days 60    # 自定义冷却天数（默认 30）
//
// 服务器上的计划任务（宝塔「计划任务」→ Shell 脚本，每天 03:00）：
//   /usr/local/node22/bin/node /www/wwwroot/nz315/scripts/inspect-daily.mjs --apply >> /www/wwwlogs/nz315-inspect.log 2>&1
//   ⚠️ **必须用 `/usr/local/node22/bin/node` 绝对路径**（系统 `node` 是 v20、cynx 在用那套；
//      与 PM2 per-app interpreter 保持同一个解释器最稳）。本脚本**不参与 build**、不需要重启服务。
//
// ⚠️ 为什么不发站内信（默认）：`risk_alert` 的实时触发（扫码）才该即时打扰企业；巡检是"后台可见的记录"，
//    且**首跑会一次性产生一批历史预警** —— 全发站内信等于给企业倒一堆垃圾消息。需要时加 `--notify`。
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 读 .env（简易解析，与 `scripts/db-init.mjs` 同款，无 dotenv 依赖） */
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  const env = {};
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
  return env;
}

const env = loadEnv();
const DB = {
  host: env.DB_HOST || '127.0.0.1',
  port: Number(env.DB_PORT || 3306),
  user: env.DB_USER || 'root',
  password: env.DB_PASSWORD || '', // 从 .env 读取，禁止硬编码
  database: env.DB_NAME || 'nz315',
};

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const NOTIFY = args.includes('--notify');
const argOf = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const COOLDOWN_DAYS = Math.max(0, Number(argOf('--days', 30)) || 30);
const SHOW_LIMIT = Math.max(1, Number(argOf('--limit', 20)) || 20);

/** 异常类型文案（与 `server/utils/risk-alert.ts` 的 ALERT_TYPES 保持一致） */
const ALERT_TYPES = { 3: '登记证号不存在', 4: '登记证已过期', 6: '生产厂家不符' };

/**
 * 企业名称归一化 —— **必须与 `server/utils/regdata.ts` 的 `normalizeOrgName` 保持同步**：
 * 依次去除 股份有限公司 / 有限责任公司 / 有限公司 / 集团 后缀，以及半角与全角空格。
 * 例：'山东绿丰生物科技有限公司' → '山东绿丰生物科技'
 * （`.mjs` 脚本无法 import 项目的 TS 工具，只能内联；**改了一处务必改另一处**。）
 */
function normalizeOrgName(name) {
  return String(name || '')
    .replace(/股份有限公司/g, '')
    .replace(/有限责任公司/g, '')
    .replace(/有限公司/g, '')
    .replace(/集团/g, '')
    .replace(/[ 　]/g, '')
    .trim();
}

const pad = (n) => String(n).padStart(2, '0');
const stamp = () => {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' '
    + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
};

/** 收集本轮要落的三类问题 */
async function collect(conn) {
  const findings = [];

  // ① 登记证号不存在：产品填了证号，但国家登记库里查不到
  const [noReg] = await conn.query(
    `SELECT p.id, p.name, p.registration_no, p.holder_name, p.enterprise_id
       FROM product p
       LEFT JOIN pesticide_reg r ON r.registration_no = p.registration_no
      WHERE p.registration_no IS NOT NULL AND p.registration_no <> ''
        AND r.registration_no IS NULL`)
  for (const p of noReg) {
    findings.push({
      alertType: 3, productId: Number(p.id), enterpriseId: Number(p.enterprise_id) || null,
      title: '登记证号不存在',
      detail: '产品「' + (p.name || '') + '」填写的登记证号 ' + p.registration_no + ' 在国家农药登记资料库中查不到',
      evidence: {
        source: 'daily-inspection', productId: Number(p.id), productName: p.name || null,
        registrationNo: p.registration_no || null, holderName: p.holder_name || null,
        // 巡检用的是登记库**快照**（静态导入表）⇒ 也可能是"登记库该更新了"，不一定是企业造假
        note: '登记资料库为导入快照，也可能是资料库未及时更新，请人工核对（不等于产品造假）',
      },
    });
  }

  // ② 登记证已过期（按项目既有 UTC 口径比对，与 trace.get.ts / product-guard.ts 一致）
  const today = new Date().toISOString().slice(0, 10);
  const [expired] = await conn.query(
    `SELECT p.id, p.name, p.registration_no, p.holder_name, p.registration_expire, p.enterprise_id
       FROM product p
      WHERE p.registration_expire IS NOT NULL AND p.registration_expire < ?`, [today])
  for (const p of expired) {
    findings.push({
      alertType: 4, productId: Number(p.id), enterpriseId: Number(p.enterprise_id) || null,
      title: '登记证已过期',
      detail: '产品「' + (p.name || '') + '」的登记证（' + (p.registration_no || '') + '）已于 '
        + String(p.registration_expire).slice(0, 10) + ' 到期，应暂停绑定生产批次',
      evidence: {
        source: 'daily-inspection', productId: Number(p.id), productName: p.name || null,
        registrationNo: p.registration_no || null,
        expireDate: String(p.registration_expire).slice(0, 10),
      },
    });
  }

  // ③ 生产厂家不符：产品的登记持有人 与 登记库 company 归一化后仍不一致
  //    （归一化在 JS 侧做 —— SQL 侧无法复用 normalizeOrgName 的规则，写了就会漂移）
  const [holders] = await conn.query(
    `SELECT p.id, p.name, p.registration_no, p.holder_name, p.enterprise_id, r.company AS reg_company
       FROM product p
       JOIN pesticide_reg r ON r.registration_no = p.registration_no
      WHERE p.holder_name IS NOT NULL AND p.holder_name <> ''
        AND r.company IS NOT NULL AND r.company <> ''`)
  for (const p of holders) {
    if (normalizeOrgName(p.holder_name) === normalizeOrgName(p.reg_company)) continue
    findings.push({
      alertType: 6, productId: Number(p.id), enterpriseId: Number(p.enterprise_id) || null,
      title: '生产厂家不符',
      detail: '产品「' + (p.name || '') + '」的登记证持有人「' + p.holder_name
        + '」与国家登记库记载的「' + p.reg_company + '」不一致',
      evidence: {
        source: 'daily-inspection', productId: Number(p.id), productName: p.name || null,
        registrationNo: p.registration_no || null,
        holderName: p.holder_name || null, registryCompany: p.reg_company || null,
      },
    });
  }

  return findings;
}

/** 冷却期内是否已有同产品同类预警（**无论处理状态**，见文件头约束 3） */
async function inCooldown(conn, productId, alertType) {
  const [rows] = await conn.query(
    `SELECT id, trigger_time FROM risk_alert
      WHERE product_id = ? AND alert_type = ? AND trigger_time >= DATE_SUB(NOW(), INTERVAL ? DAY)
      LIMIT 1`, [productId, alertType, COOLDOWN_DAYS])
  return rows.length > 0
}

/** 写库：复刻 `server/utils/risk-alert.ts` 的 triggerAlert 合并语义（同企业+同产品+同类未处理 ⇒ 累计） */
async function writeAlert(conn, f) {
  const evidence = JSON.stringify(f.evidence)
  const [exist] = await conn.query(
    `SELECT id, repeat_count FROM risk_alert
      WHERE enterprise_id <=> ? AND code_id IS NULL AND product_id <=> ?
        AND external_verification_id IS NULL AND alert_type = ? AND handle_status = 0
      LIMIT 1`, [f.enterpriseId, f.productId, f.alertType])

  if (exist.length) {
    await conn.query('UPDATE risk_alert SET repeat_count = repeat_count + 1, evidence = ? WHERE id = ?',
      [evidence, exist[0].id])
    return { action: 'merged', id: exist[0].id }
  }
  const [r] = await conn.query(
    `INSERT INTO risk_alert (enterprise_id, alert_type, code_id, product_id, external_verification_id, evidence, trigger_time, repeat_count)
     VALUES (?, ?, NULL, ?, NULL, ?, NOW(), 1)`, [f.enterpriseId, f.alertType, f.productId, evidence])
  return { action: 'inserted', id: r.insertId }
}

/** 站内信（仅 `--notify` 时调用；与 triggerAlert 的文案保持一致） */
async function notifyEnterprise(conn, f) {
  if (!f.enterpriseId) return
  await conn.query(
    `INSERT INTO message (enterprise_id, user_id, type, title, content, link, is_read)
     VALUES (?, NULL, 'risk', ?, ?, '/admin/alerts', 0)`,
    [f.enterpriseId, '风险预警：' + ALERT_TYPES[f.alertType], '请前往风险预警中心核实处理'])
}

async function main() {
  const t0 = Date.now();
  console.log('══════════════════════════════════════════════════════════');
  console.log(' 农资315 · 每日巡检  ' + stamp());
  console.log(' 模式：' + (APPLY ? '【APPLY 写库】' : '【DRY-RUN 只读】') + '  冷却期：' + COOLDOWN_DAYS + ' 天'
    + (NOTIFY && APPLY ? '  站内信：开' : '  站内信：关'));
  console.log(' 数据库：' + DB.host + ':' + DB.port + '/' + DB.database);
  console.log('══════════════════════════════════════════════════════════');

  const conn = await mysql.createConnection({ ...DB, dateStrings: true });
  try {
    const findings = await collect(conn);
    const byType = { 3: [], 4: [], 6: [] };
    for (const f of findings) byType[f.alertType].push(f);

    for (const t of [3, 4, 6]) {
      console.log('\n' + (t === 3 ? '①' : t === 4 ? '②' : '③') + ' 类型 ' + t + '「' + ALERT_TYPES[t] + '」：命中 '
        + byType[t].length + ' 条');
      for (const f of byType[t].slice(0, SHOW_LIMIT)) {
        console.log('    - 产品 #' + f.productId + '（企业 ' + (f.enterpriseId || '—') + '）' + f.detail);
      }
      if (byType[t].length > SHOW_LIMIT) console.log('    … 其余 ' + (byType[t].length - SHOW_LIMIT) + ' 条略');
    }

    // 过冷却期过滤
    let skipped = 0;
    const todo = [];
    for (const f of findings) {
      if (await inCooldown(conn, f.productId, f.alertType)) { skipped++; continue }
      todo.push(f)
    }

    console.log('\n──── 汇总 ────');
    console.log('命中 ' + findings.length + ' 条；冷却期内跳过 ' + skipped + ' 条；待写入 ' + todo.length + ' 条');

    if (!APPLY) {
      console.log('【DRY-RUN】未写任何数据。确认无误后加 `--apply` 执行。');
    } else if (todo.length === 0) {
      console.log('【APPLY】无待写入项，数据库未变更。');
    } else {
      let ins = 0, mrg = 0;
      for (const f of todo) {
        const r = await writeAlert(conn, f)
        if (r.action === 'inserted') ins++; else mrg++
        if (NOTIFY) await notifyEnterprise(conn, f)
        console.log('  [写入] 类型 ' + f.alertType + ' 产品 #' + f.productId + ' → risk_alert.id=' + r.id + '（' + r.action + '）')
      }
      console.log('【APPLY】写入完成：新建 ' + ins + ' 条，累计（合并）' + mrg + ' 条。');
    }
  } finally {
    await conn.end()
  }

  console.log('\n耗时 ' + (Date.now() - t0) + 'ms');
}

main().catch((e) => {
  console.error('[巡检失败] ' + (e && e.message ? e.message : e));
  process.exit(1);
});
