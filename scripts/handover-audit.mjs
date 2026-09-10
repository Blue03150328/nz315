// 交接审计脚本：输出环境/资源/数据库现状清单（只读，不写库）
'use strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// 1) .env 键清单（值只打印长度，不泄露密钥）
console.log('===== .env KEY INVENTORY =====');
const envPath = path.join(root, '.env');
const env = {};
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) {
      env[m[1]] = m[2];
      console.log(m[1].padEnd(32) + (m[2].length ? '已配置(长度 ' + m[2].length + ')' : '空值'));
    } else if (line.trim() && !line.trim().startsWith('#')) {
      console.log('[未识别行] ' + JSON.stringify(line.slice(0, 40)));
    }
  }
}
console.log('env 文件大小: ' + fs.statSync(envPath).size + ' 字节; 键数: ' + Object.keys(env).length);

// 2) 数据库现状
const conn = await mysql.createConnection({
  host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3306),
  user: env.DB_USER || 'root', password: env.DB_PASSWORD || '', database: env.DB_NAME || 'nz315',
});
console.log('\n===== DATABASE =====');
const [[ver]] = await conn.query('SELECT VERSION() AS v, DATABASE() AS d, @@character_set_database AS cs');
console.log('MySQL 版本: ' + ver.v + ' | 库: ' + ver.d + ' | 字符集: ' + ver.cs);
const [tables] = await conn.query(
  "SELECT TABLE_NAME AS t, TABLE_ROWS AS approx, DATA_LENGTH AS dl, INDEX_LENGTH AS il FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME", [ver.d]);
let totalRows = 0, totalBytes = 0;
for (const t of tables) {
  totalRows += Number(t.approx); totalBytes += Number(t.dl) + Number(t.il);
  const [[c]] = await conn.query('SELECT COUNT(*) AS c FROM `' + t.t + '`');
  console.log(String(t.t).padEnd(20) + ' 实际行数=' + String(c.c).padStart(8) + '  近似行数=' + String(t.approx).padStart(8) + '  数据+索引=' + ((Number(t.dl) + Number(t.il)) / 1024 / 1024).toFixed(2) + 'MB');
}
console.log('表数量: ' + tables.length + ' | 近似总行数: ' + totalRows + ' | 总占用: ' + (totalBytes / 1024 / 1024).toFixed(2) + 'MB');
const [grants] = await conn.query('SHOW GRANTS');
console.log('当前连接账号: ' + (env.DB_USER || 'root'));
const [procs] = await conn.query("SELECT ROUTINE_TYPE, ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ?", [ver.d]);
console.log('存储过程/函数数量: ' + procs.length + (procs.length ? ' -> ' + JSON.stringify(procs) : '（本项目零存储过程/函数）'));
const [trigs] = await conn.query("SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?", [ver.d]);
console.log('触发器数量: ' + trigs.length + (trigs.length ? ' -> ' + JSON.stringify(trigs) : '（本项目零触发器）'));
const [views] = await conn.query("SELECT TABLE_NAME FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ?", [ver.d]);
console.log('视图数量: ' + views.length);

// 3) 业务数据现状（演示基线）
console.log('\n===== 业务数据基线 =====');
const q = async (sql) => { const [r] = await conn.query(sql); return r; };
console.log('企业: ' + JSON.stringify(await q('SELECT id, name, status, qualification_expire, renew_expire FROM enterprise')));
console.log('用户: ' + JSON.stringify(await q('SELECT id, enterprise_id, username, role, status FROM `user` ORDER BY id')));
console.log('产品数: ' + JSON.stringify(await q('SELECT COUNT(*) c FROM product')) + ' 规格数: ' + JSON.stringify(await q('SELECT COUNT(*) c FROM product_spec')));
console.log('码状态分布: ' + JSON.stringify(await q('SELECT status, abnormal_flag, COUNT(*) c FROM trace_code GROUP BY status, abnormal_flag')));
console.log('批次: ' + JSON.stringify(await q('SELECT id, product_id, batch_no, produce_date, quality_cert_no, expire_date, qc_result FROM batch')));
console.log('上传批次: ' + JSON.stringify(await q('SELECT id, enterprise_id, file_name, product_id, batch_id, created_at FROM upload_batch ORDER BY id')));
console.log('登记数据源: ' + JSON.stringify(await q('SELECT COUNT(*) c, MIN(expire_date) mn, MAX(expire_date) mx FROM pesticide_reg')));
console.log('扫码日志: ' + JSON.stringify(await q('SELECT COUNT(*) c FROM scan_log')) + ' 操作日志: ' + JSON.stringify(await q('SELECT COUNT(*) c FROM operation_log')) + ' 预警: ' + JSON.stringify(await q('SELECT COUNT(*) c FROM risk_alert')) + ' 消息: ' + JSON.stringify(await q('SELECT COUNT(*) c FROM message')) + ' 消费者: ' + JSON.stringify(await q('SELECT COUNT(*) c FROM consumer')));
await conn.end();
