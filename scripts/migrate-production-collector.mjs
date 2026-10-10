// 专用增量迁移，禁止运行演示数据及旧码归档。
import fs from 'node:fs'
import { parseEnv } from 'node:util'
import mysql from 'mysql2/promise'
import { collectionDDL } from './collection-schema.mjs'
const env = { ...parseEnv(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')), ...process.env }
const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME })
try { for (const ddl of collectionDDL) await db.query(ddl); console.log('设备采集会话及幂等收据结构已就绪，未写业务数据') }
finally { await db.end() }
