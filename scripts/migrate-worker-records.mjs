// Only the additional action table; never seeds or rewrites existing business rows.
import fs from 'node:fs'
import { parseEnv } from 'node:util'
import mysql from 'mysql2/promise'
import { migrateWorkerRecordSchema } from './worker-record-schema.mjs'
const env={...(fs.existsSync('.env')?parseEnv(fs.readFileSync('.env','utf8')):{}),...process.env}
for(const key of ['DB_HOST','DB_USER','DB_PASSWORD','DB_NAME'])if(!env[key])throw Error('Missing '+key)
const db=await mysql.createConnection({host:env.DB_HOST,port:Number(env.DB_PORT||3306),user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME})
try {await migrateWorkerRecordSchema(db);console.log('worker_action ready; existing users, grants, codes and queues retained')} finally {await db.end()}
