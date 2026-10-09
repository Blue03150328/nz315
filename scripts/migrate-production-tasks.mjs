// 仅安装及增补生产任务结构，不调用历史迁移或演示数据脚本。
import fs from 'node:fs'
import { parseEnv } from 'node:util'
import mysql from 'mysql2/promise'
import { productionDDL, migrateProductionSchema } from './production-schema.mjs'
const env = { ...parseEnv(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')), ...process.env }
const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME })
try {
  for (const ddl of productionDDL) await db.query(ddl)
  await migrateProductionSchema(db)
  console.log('生产任务结构已就绪，未写入业务数据')
} finally { await db.end() }
