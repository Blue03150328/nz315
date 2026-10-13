// 专用上线增量：不运行演示初始化，不删除字段，不改变已有生产资料。
import fs from 'node:fs'
import { parseEnv } from 'node:util'
import mysql from 'mysql2/promise'
import { migrateUsageBatchSchema } from './usage-batch-schema.mjs'
import { migrateExternalCollectionSchema } from './external-collection-schema.mjs'
import { backfillWorkerExternal } from './backfill-worker-external.mjs'
import { backfillWorkerCodeUsage } from './worker-code-usage.mjs'
const env = parseEnv(fs.readFileSync('.env', 'utf8'))
if (process.argv[2] !== '--database=' + env.DB_NAME) throw Error('请明确指定本次增量迁移数据库')
const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME })
try {
  await migrateUsageBatchSchema(db)
  await migrateExternalCollectionSchema(db)
  const [pack] = await db.query("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='product_spec' AND COLUMN_NAME='pack_quantity'")
  if (!pack.length) await db.query('ALTER TABLE product_spec ADD COLUMN pack_quantity INT UNSIGNED NOT NULL DEFAULT 1')
  await backfillWorkerExternal(db)
  await backfillWorkerCodeUsage(db)
  console.log('新增码库及外码结构、接通历史工人采集；原生产资料与收据保留')
} finally { await db.end() }
