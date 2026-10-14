// 从只读凭据文件加载正式环境，避免 Compose 插值或数值密码被自动转换。
import fs from 'node:fs'
import {parseEnv} from 'node:util'

const env=parseEnv(fs.readFileSync(process.env.NZ315_ENV_FILE||'/run/secrets/nz315.env','utf8'))
for(const key of ['DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','SESSION_SECRET']){
  if(!env[key])throw Error('缺少正式运行配置：'+key)
}
if(env.SESSION_SECRET.length<32)throw Error('正式会话密钥长度不足')
const keys={DB_HOST:'NUXT_DB_HOST',DB_USER:'NUXT_DB_USER',DB_PASSWORD:'NUXT_DB_PASSWORD',DB_NAME:'NUXT_DB_NAME',SESSION_SECRET:'NUXT_SESSION_SECRET',WECHAT_APP_ID:'NUXT_WECHAT_APP_ID',WECHAT_APP_SECRET:'NUXT_WECHAT_APP_SECRET',AMAP_WEB_KEY:'NUXT_AMAP_WEB_KEY',NUXT_PUBLIC_TRACE_BASE_URL:'NUXT_PUBLIC_TRACE_BASE_URL'}
for(const [source,target] of Object.entries(keys))if(env[source]!==undefined)process.env[target]=JSON.stringify(env[source])
process.env.NUXT_DB_PORT=String(Number(env.DB_PORT||3306))
await import('../.output/server/index.mjs')
