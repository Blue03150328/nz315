// 独立增量迁移；不初始化演示数据、不改已有码、任务或收据。
import fs from 'node:fs'
import {parseEnv} from 'node:util'
import mysql from 'mysql2/promise'
import {migrateProductionMonitorSchema} from './production-monitor-schema.mjs'
const env=parseEnv(fs.readFileSync('.env','utf8'))
if(process.argv[2]!=='--database='+env.DB_NAME)throw Error('请明确指定本次增量迁移数据库')
const db=await mysql.createConnection({host:env.DB_HOST,port:Number(env.DB_PORT||3306),user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME})
try{await migrateProductionMonitorSchema(db);console.log('生产任务监控增量结构已就绪，原业务资料保留')}finally{await db.end()}
