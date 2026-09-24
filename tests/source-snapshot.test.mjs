// node --test tests/source-snapshot.test.mjs；不访问外站、不修改业务数据库。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
const load = async p => {
  const code = stripTypeScriptTypes(fs.readFileSync(p, 'utf8'))
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
}
const { parseSourceDocument, actualDate } = await load('server/utils/source-parser.ts')
const { compareSource } = await load('server/utils/source-compare.ts')
const { isPublicAddress, fetchSourceDocument } = await load('server/utils/source-fetch.ts')
const code = '21800462100136950812284409766080'
const url = 'http://ddspp.cn/u/?q=' + code
const sample = parseSourceDocument(fs.readFileSync('tests/fixtures/ddspp.html', 'utf8'), url, code)
test('真实页面：两组原药准确配对、日期说明与保质期分开、全部成分保留', () => {
  assert.equal(sample.pageCode, code)
  assert.equal(sample.registrationNo, 'WP20180046')
  assert.deepEqual(sample.originals, [
    { ingredient: '残杀威', regNo: 'WPN1-94', company: '湖南海利化工股份有限公司' },
    { ingredient: '高效氯氰菊酯', regNo: 'PD20101070', company: '印度联合磷化物有限公司' },
  ])
  assert.equal(sample.produceDate, undefined)
  assert.equal(sample.productionNote, '见瓶盖或瓶体，袋装请见喷码')
  assert.equal(sample.shelfLife, '2年')
  assert.equal(sample.ingredients, '高效氯氰菊酯4% 残杀威6%')
  assert.equal(sample.holderName, '洛阳派仕克农业科技有限公司')
  assert.equal(sample.manufacturer, '河南科辉实业有限公司')
})
const row = (k,v) => `<tr><td>${k}</td><td>${v}</td></tr>`
test('原药缺企业时不拿下一组企业补位', () => {
  const source = parseSourceDocument(row('原药名称','甲')+row('原药证件号','PD001')+row('原药名称','乙')+row('原药厂家名称','乙企业')+row('原药证件号','PD002'), url, code)
  assert.equal(source.originals.length, 2)
  assert.equal(source.originals[0].company, '')
  assert.equal(source.originals[1].company, '乙企业')
})
test('生产日期只来自该字段且校验日历，不以保质期/到期日/核准日补齐', () => {
  assert.equal(actualDate('2026年9月24日'), '2026-09-24')
  assert.equal(actualDate('2026-02-31'), undefined)
  assert.equal(actualDate('2年'), undefined)
  const source = parseSourceDocument(row('保质期','2年')+row('有效期至','2028-09-24')+row('核准日期','2026-09-24'), url, code)
  assert.equal(source.produceDate, undefined)
  assert.equal(source.productExpiry,'2028-09-24')
})
test('含量变化不能被名称归一掩盖，完整原药证号未收录应为资料不足', () => {
  const items = compareSource({ ...sample, content: '20%' }, { registration_no: 'WP20180046', product_name:'高氯·残杀威',content:'10%',ingredients:'高效氯氰菊酯 4%、残杀威 6%' }, [])
  assert.equal(items.find(i => i.label === '总有效成分含量').status, 'mismatch')
  assert.equal(items.find(i => i.label === '全部有效成分及含量').status, 'match')
  assert.equal(items.find(i => i.label === '原药1证号').status, 'insufficient')
})
test('普通公网可用，内网/回环/元数据/映射IPv6/基准测试地址拒绝', async () => {
  for (const ip of ['127.0.0.1','10.2.3.4','192.168.0.1','169.254.169.254','172.31.0.1','100.64.0.1','198.18.73.71','::1','fc00::1','::ffff:127.0.0.1']) assert.equal(isPublicAddress(ip),false,ip)
  assert.equal(isPublicAddress('47.105.56.37'),true)
  assert.equal(isPublicAddress('2606:4700:4700::1111'),true)
  await assert.rejects(fetchSourceDocument('http://127.0.0.1'),/公网/)
  await assert.rejects(fetchSourceDocument('file:///etc/passwd'),/不受支持/)
  await assert.rejects(fetchSourceDocument('http://user:pass@example.com'),/不受支持/)
})
test('别名与脚本键兜底：精确标签优先，页面看不到的脚本数据也能取到', () => {
  // ① 同义词别名：「商品名称」不在精确标签表内，靠同义词表兜底
  assert.equal(parseSourceDocument(row('商品名称','甲维盐'), url, code).productName, '甲维盐')
  // ② 脚本键：数据只在 JS 里（sourceText 会剥掉 script 内容，故可见文本层必然取不到）
  const script = parseSourceDocument('<script>var d={"goodsName":"乙维盐","specName":"100ml","losedate":"2029-01-01"}</script>', url, code)
  assert.equal(script.productName, '乙维盐')
  assert.equal(script.spec, '100ml')
  assert.equal(script.productExpiry, '2029-01-01')
  // ③ 精确标签必须优先于同义词与脚本值（兜底层不得覆盖精确层）
  assert.equal(parseSourceDocument(row('产品名称','页面值') + '<script>d={"goodsName":"脚本值"}</script>', url, code).productName, '页面值')
  // ④ 规格：后台外部核验页需单独展示该字段
  assert.equal(parseSourceDocument(row('规格','500g/瓶'), url, code).spec, '500g/瓶')
})
test('手工粘贴的纯文本必须按行解析：换行不得被压平', () => {
  // 后台核验页的失败提示原文承诺「标签与值之间用冒号、Tab 或换行分隔」。
  // 2026-09-24 合并解析器时 sourceText 把 \r?\n 一律压成空格 ⇒ 纯文本整段并成一行、
  // 登记证号与持有人全部取不到（实测 HTTP 命中该回归）。此用例为护栏。
  const pasted = [
    '农药名称：0.5%溴敌隆母液',
    '农药登记证号：PD20001183',
    '登记证持有人：河南远见农业科技有限公司',
    '剂型：母液',
  ].join('\n')
  const s = parseSourceDocument(pasted, url, code)
  assert.equal(s.productName, '0.5%溴敌隆母液')
  assert.equal(s.registrationNo, 'PD20001183')
  assert.equal(s.holderName, '河南远见农业科技有限公司')
  assert.equal(s.formulation, '母液')
  // 含标签的输入仍按 HTML 处理（源码层换行属噪声，行结构由块级标签产生）——两侧都要成立
  const h = parseSourceDocument('<div>产品名称：甲维盐</div><div>规格：100ml</div>', url, code)
  assert.equal(h.productName, '甲维盐')
  assert.equal(h.spec, '100ml')
})
test('纯文本支持「标签与值分行」与双空格分隔（HTML 侧口径不动）', () => {
  // 合并前后台核验页的失败提示原文承诺「标签与值之间用冒号、Tab 或换行分隔」，
  // 故纯文本必须支持「标签一行、值一行」；含标签的输入走另一条路（见下），口径与公众端快照一致。
  const split = ['农药名称', '0.5%溴敌隆母液', '农药登记证号', 'PD20001183', '登记证持有人', '河南远见农业科技有限公司'].join('\n')
  const s = parseSourceDocument(split, url, code)
  assert.equal(s.productName, '0.5%溴敌隆母液')
  assert.equal(s.registrationNo, 'PD20001183')
  assert.equal(s.holderName, '河南远见农业科技有限公司')
  // 双空格分隔
  assert.equal(parseSourceDocument('产品名称  甲维盐', url, code).productName, '甲维盐')
  // 下一行本身是标签 ⇒ 不给值，避免串行；但该标签自己继续向下取值
  const next = parseSourceDocument(['产品名称', '规格', '500ml'].join('\n'), url, code)
  assert.equal(next.productName, undefined)
  assert.equal(next.spec, '500ml')
  // 边界（刻意保留，待裁定）：含标签的 HTML 不启用「分行」兜底 ⇒ 块级逐行渲染的页面仍取不到字段；
  // 若要对 HTML 也启用，会同时改变公众端 /api/trace 外页快照的填充口径，需另行决定。
  assert.equal(parseSourceDocument('<div>产品名称</div><div>甲维盐</div>', url, code).productName, undefined)
})
