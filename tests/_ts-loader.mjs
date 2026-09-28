// 测试用 ESM 解析钩子：项目源码的导入不带扩展名（交给打包器解析），
// 裸 node 跑测试时需要把它补成 `.ts`，否则 ERR_MODULE_NOT_FOUND。
// 用法：register('./_ts-loader.mjs', import.meta.url)
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[a-z0-9]+$/i.test(specifier) && context.parentURL) {
    const url = new URL(specifier + '.ts', context.parentURL)
    // 🔴 不要在这里指定 format：一旦写死 'module'，node 会当成普通 JS 加载、
    //    跳过 TypeScript 类型剥离，`.ts` 里的 `as const` 立刻变成 SyntaxError。
    if (fs.existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true }
  }
  return next(specifier, context)
}
