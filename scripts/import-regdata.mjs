// 农药登记数据源导入脚本：2026农药登记证大全2.xlsx → pesticide_reg 字典表
// 用法：node scripts/import-regdata.mjs [xlsx路径]   （默认读取项目根目录 2026农药登记证大全2.xlsx）
// 前置：先运行 node scripts/db-init.mjs 建表（幂等）；本脚本幂等可重跑（TRUNCATE 后重灌）
'use strict';
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import XLSX from 'xlsx';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 读取 .env（简易解析，与 db-init 同款，避免额外依赖）
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

// ---- 数据清洗函数 ----

// Excel 日期序列号 → 'YYYY-MM-DD'（兼容文本日期与 Date 实例）
function toDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    // Excel 1900 日期系统：序列号 25569 = 1970-01-01
    const d = new Date(Math.round((v - 25569) * 86400000));
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return v.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  return null;
}

// 毒性归一化：'低毒(原药高毒)' → '低毒'；空/'－' → null
function normalizeToxicity(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().split('(')[0].trim();
  if (!s || s === '－' || s === '-') return null;
  return s.slice(0, 30);
}

// 从「有效成分及含量」提取成分名数组：按 ·、；、+ 等分隔段，每段取第一个空白前 token
// 例：'氟虫腈 50克/升' → ['氟虫腈']；'苯醚甲环唑 10%·丙环唑 20%' → ['苯醚甲环唑','丙环唑']
// 注意不把含量单位的 '/' 当分隔符（段分隔符只取间隔号/顿号/分号/加号）
function extractIngredients(raw) {
  if (!raw) return [];
  const s = String(raw).trim();
  if (!s) return [];
  const seen = [];
  const segments = s.split(/[·、；;＋+]/);
  for (let seg of segments) {
    seg = seg.trim();
    if (!seg) continue;
    // 每段形如 '苯醚甲环唑 10%'，取第一个空白 token；无空白则整体（如 '苯醚甲环唑'）
    const tokens = seg.split(/\s+/);
    let name = tokens[0] || '';
    name = name.trim();
    if (!name) continue;
    // 过滤明显非成分名的 token：纯数字/含量单位/长度异常
    if (/^\d+([.,]\d+)?%?$/.test(name)) continue;
    if (/^(克|千克|毫升|升|毫克|微克)\/?/.test(name)) continue;
    if (!seen.includes(name)) seen.push(name);
  }
  return seen;
}

async function main() {
  const env = loadEnv();
  const DB = {
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'nz315',
  };
  // 数据源文件路径（默认项目根目录）
  const fileArg = process.argv[2];
  const xlsxPath = fileArg ? path.resolve(fileArg) : path.join(__dirname, '..', '2026农药登记证大全2.xlsx');
  if (!fs.existsSync(xlsxPath)) {
    console.error('[import] 找不到数据源文件: ' + xlsxPath);
    process.exit(1);
  }
  console.log('[import] 数据源: ' + xlsxPath);

  const conn = await mysql.createConnection(DB);

  // 检查目标表是否存在（需先跑 db-init 建表）
  const [tbl] = await conn.query(
    'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1',
    [DB.database, 'pesticide_reg']
  );
  if (tbl.length === 0) {
    console.error('[import] pesticide_reg 表不存在，请先运行: node scripts/db-init.mjs');
    process.exit(1);
  }

  // 读取 xlsx（Sheet1 为数据表）
  const wb = XLSX.readFile(xlsxPath, { cellDates: false });
  const ws = wb.Sheets['Sheet1'];
  if (!ws) { console.error('[import] Sheet1 不存在'); process.exit(1); }
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const data = rows.slice(1); // 去掉表头

  // 表头核对（防止换了文件格式导致列错位）
  const header = (rows[0] || []).map((h) => String(h ?? '').trim());
  const expect = ['登记证号', '产品名称', '商品名称', '商标', '总含量', '剂型', '毒性', '有效起始日', '有效截止日', '生产厂家', '有效成分及含量', '单混剂', '农药类别', '临时登记证号'];
  const okHeader = expect.every((h, i) => header[i] === h);
  if (!okHeader) {
    console.error('[import] 表头与预期不符: ' + JSON.stringify(header));
    console.error('        预期: ' + JSON.stringify(expect));
    process.exit(1);
  }

  // TRUNCATE 重灌（幂等：本表为只读字典表，可安全清空重建）
  await conn.query('TRUNCATE TABLE pesticide_reg');
  console.log('[import] 已清空 pesticide_reg');

  // 清洗并分批入库
  const BATCH = 500;
  let ok = 0, skipEmpty = 0, originalCnt = 0, multiCnt = 0, mainFail = 0;
  const rowsToInsert = [];

  const col = {
    reg: 0, pname: 1, cname: 2, trademark: 3, content: 4, dosage: 5,
    tox: 6, start: 7, expire: 8, company: 9, ingredients: 10, mixture: 11, category: 12, tempReg: 13,
  };

  for (const r of data) {
    const regNo = String(r[col.reg] ?? '').trim();
    if (!regNo) { skipEmpty++; continue; }
    const productName = String(r[col.pname] ?? '').trim();
    if (!productName) { skipEmpty++; continue; }

    const dosage = String(r[col.dosage] ?? '').trim() || null;
    const isOriginal = dosage ? /原药|母药/.test(dosage) : false;

    // 成分提取：原药/母药与制剂同规则（成分列首 token 即成分名）
    const names = extractIngredients(r[col.ingredients]);
    if (names.length > 1) multiCnt++;
    const ingredientMain = names[0] || null;
    if (isOriginal && !ingredientMain) mainFail++;

    rowsToInsert.push([
      regNo, productName,
      String(r[col.cname] ?? '').trim() || null,
      String(r[col.trademark] ?? '').trim() || null,
      String(r[col.content] ?? '').trim() || null,
      dosage,
      normalizeToxicity(r[col.tox]),
      toDate(r[col.start]), toDate(r[col.expire]),
      String(r[col.company] ?? '').trim() || null,
      String(r[col.ingredients] ?? '').trim() || null,
      ingredientMain,
      names.length ? JSON.stringify(names) : null,
      String(r[col.mixture] ?? '').trim() || null,
      String(r[col.category] ?? '').trim() || null,
      String(r[col.tempReg] ?? '').trim() || null,
    ]);
    if (isOriginal) originalCnt++;
  }

  const SQL = `INSERT INTO pesticide_reg
    (registration_no, product_name, commodity_name, trademark, content, dosage, toxicity,
     start_date, expire_date, company, ingredients, ingredient_main, ingredient_all,
     mixture, category, temp_reg_no)
    VALUES ?`;
  for (let i = 0; i < rowsToInsert.length; i += BATCH) {
    const chunk = rowsToInsert.slice(i, i + BATCH);
    await conn.query(SQL, [chunk]);
    ok += chunk.length;
    if (i % 10000 === 0) console.log('[import] 已写入 ' + ok + ' 条');
  }

  await conn.end();
  console.log('');
  console.log('[import] 完成统计：总条数 ' + ok + '（跳过空行 ' + skipEmpty + '）');
  console.log('[import] 原药/母药池 ' + originalCnt + ' 条（占 ' + (ok ? (originalCnt * 100 / ok).toFixed(1) : 0) + '%）');
  console.log('[import] 多成分（复配）记录 ' + multiCnt + ' 条');
  console.log('[import] 原药/母药缺主成分 ' + mainFail + ' 条（匹配不到时前端提示手动补充）');
}

main().catch((e) => {
  console.error('导入失败:', e.message);
  process.exit(1);
});
