import { mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const NODE = 'C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-3/node.exe'
const NPM = 'C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-3/node_modules/npm/bin/npm-cli.js'
const dir = 'C:/Users/Administrator/.workbuddy/binaries/node/workspace'

mkdirSync(dir, { recursive: true })
const target = dir + '/node_modules/playwright-core'
if (existsSync(target)) {
  console.log('[skip] playwright-core 已存在:', target)
} else {
  console.log('[run] 安装 playwright-core ...')
  const out = execFileSync(NODE, [NPM, 'install', 'playwright-core', '--no-audit', '--no-fund'], {
    cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  })
  console.log(out)
}
console.log('[done]', existsSync(target) ? 'OK -> ' + target : 'FAILED')
