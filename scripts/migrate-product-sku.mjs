// 独立迁移，仅更新产品唯一索引及派生商标列；不运行 seed 或其它迁移。
import fs from 'node:fs'
import { parseEnv } from 'node:util'
import mysql from 'mysql2/promise'
import { migrateProductSkuSchema } from './product-sku-schema.mjs'
const env = { ...parseEnv(fs.readFileSync('.env', 'utf8')), ...process.env }
if (process.argv[2] !== '--database=' + env.DB_NAME) throw Error('请明确指定本次增量迁移数据库')
const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME })
try { await migrateProductSkuSchema(db); console.log('产品 SKU 唯一索引已就绪，原业务资料保留') } finally { await db.end() }
