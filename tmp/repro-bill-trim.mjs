// 复现脚本：验证 UInput type="number" 时 v-model 的值类型，以及前端 totalAmount 校验的崩溃点
// 直接 import Nuxt UI 真实运行时工具（不是自己抄的实现）
const mod = await import('../node_modules/@nuxt/ui/dist/runtime/utils/index.js')
const looseToNumber = mod.looseToNumber
console.log('[1] looseToNumber 来源:', typeof looseToNumber === 'function' ? 'nuxt/ui 运行时真实导出' : '缺失')

// 模拟 UInput(type="number") 的 updateInput：用户在框里敲入的原始字符串
for (const raw of ['14444', '112121212', '0', '', '12.5']) {
  const v = looseToNumber(raw)
  console.log(`    输入 "${raw}" -> ${JSON.stringify(v)}  (${typeof v})`)
}

// 前端 submit 的真实代码路径（BillFormModal.vue L177-L185）
function submit(form) {
  if (!form.productName.trim()) return 'toast: 请填写产品名称'
  const amount = Number(form.totalAmount)
  if (form.totalAmount.trim() === '' || !Number.isFinite(amount) || amount < 0) {
    return 'toast: 请填写有效的总金额'
  }
  return 'POST /api/bill ...'
}

// 场景 A：新建记账，用户手填金额（图2 的真实场景）
const formA = { totalAmount: looseToNumber('112121212'), productName: '133113' }
try {
  console.log('[2] 场景A 新建·手填金额 ->', submit(formA))
} catch (e) {
  console.log('[2] 场景A 新建·手填金额 -> ❌ 未捕获异常:', e.constructor.name + ':', e.message)
  console.log('    => 请求根本没发出，页面无任何 toast，表现 = 「点了保存没反应」')
}

// 场景 B：产品名为空（图1 的真实场景）—— 校验在崩溃点之前，所以能正常提示
const formB = { totalAmount: looseToNumber('14444'), productName: '' }
try {
  console.log('[3] 场景B 产品名空 ->', submit(formB))
} catch (e) {
  console.log('[3] 场景B 产品名空 -> ❌', e.message)
}

// 场景 C：编辑已有账单且不动金额（回填走 String()，是 string）
const formC = { totalAmount: String(500), productName: '旧账' }
try {
  console.log('[4] 场景C 编辑·未改金额 ->', submit(formC))
} catch (e) {
  console.log('[4] 场景C 编辑·未改金额 -> ❌', e.message)
}
