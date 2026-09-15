// 独立增量迁移，避免运行 db-init 时重置演示资料。
import fs from 'node:fs';
import mysql from 'mysql2/promise';
import { migrateProductionSchema } from './lib/production-schema.mjs';
const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).flatMap(line => {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  return m ? [[m[1], m[2].replace(/^['"]|['"]$/g, '')]] : [];
}));
const conn = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
try { await migrateProductionSchema(conn); console.log('生产绑定与更正结构迁移完成，历史数据保留'); }
finally { await conn.end(); }
