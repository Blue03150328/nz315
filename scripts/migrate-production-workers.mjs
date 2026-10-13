import fs from 'node:fs'
import { parseEnv } from 'node:util'
import mysql from 'mysql2/promise'
import { migrateWorkerSchema } from './worker-schema.mjs'
const env={...parseEnv(fs.readFileSync('.env','utf8')),...process.env}
const db=await mysql.createConnection({host:env.DB_HOST||'127.0.0.1',port:Number(env.DB_PORT||3306),user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME})
try{await migrateWorkerSchema(db);console.log('Worker schema migrated; existing business data preserved')}finally{await db.end()}
