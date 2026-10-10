import fs from 'node:fs'
import { parseEnv } from 'node:util'
import mysql from 'mysql2/promise'
import { migrateDeviceSchema } from './device-schema.mjs'
const env = { ...parseEnv(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')), ...process.env }
const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME })
try { await migrateDeviceSchema(db); console.log('设备登记结构已就绪，未更改历史生产记录') } finally { await db.end() }
