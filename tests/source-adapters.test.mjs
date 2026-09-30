// node --test tests/source-adapters.test.mjs
// 默认**不访问外站**；要跑真接口那一组，加环境变量 NZ315_LIVE_ADAPTERS=1（会真实调用对方接口）。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { register } from 'node:module'

// 项目源码是无扩展名相对导入（由打包器解析），裸 node 需要一个小解析钩子把 `../x` 补成 `../x.ts`。
register('./_ts-loader.mjs', import.meta.url)
const { mapHyny168, hyny168Adapter } = await import('../server/utils/source-adapters/hyny168.ts')
const { mapSdakzw, sdakzwAdapter } = await import('../server/utils/source-adapters/sdakzw.ts')
const { mapShiaj, shiajAdapter } = await import('../server/utils/source-adapters/shiaj.ts')
const { parseSourceDocument } = await import('../server/utils/source-parser.ts')

const CODE = '12308841005260627001000011857410'
const URL_HYNY = 'http://zp.hyny168.cn/ny?c=' + CODE
/** 真接口响应原文（2026-09-28 用真码抓取，逐字未改） */
const live = JSON.parse(fs.readFileSync('tests/fixtures/hyny168-trace.json', 'utf8'))
const shiajTrace = JSON.parse(fs.readFileSync('tests/fixtures/shiaj-trace.json', 'utf8'))
const shiajCertificate = JSON.parse(fs.readFileSync('tests/fixtures/shiaj-certificate.json', 'utf8'))
const SHIAJ_CODE = '11834462061041677232103317831161'
const URL_SHIAJ = `https://h5.shiaj.com/t/64?p=32&c=${SHIAJ_CODE}`

test('shiaj：真接口响应映射为来源声明（产品与证书字段分开）', () => {
  const s = mapShiaj(shiajTrace.ResData, shiajCertificate.ResData, URL_SHIAJ, SHIAJ_CODE)
  assert.ok(s, '应映射成功')
  assert.equal(s.pageCode, SHIAJ_CODE)
  assert.equal(s.productName, '苯醚甲环唑')
  assert.equal(s.commodityName, '40%苯醚甲环唑悬浮剂')
  assert.equal(s.registrationNo, 'PD20183446')
  assert.equal(s.holderName, '上海沪联生物药业（夏邑）股份有限公司')
  assert.equal(s.manufacturer, '安徽嘉惠化工科技有限公司')
  assert.equal(s.formulation, '悬浮剂')
  assert.equal(s.toxicity, '低毒')
  assert.equal(s.content, '40%')
  assert.equal(s.productExpiry, '2028-08-20')
  assert.equal(s.spec, '1级 1袋(500g)')
  assert.deepEqual(s.originals, [{ ingredient: '苯醚甲环唑', regNo: 'PD20111317', company: '利尔化学股份有限公司' }])
  assert.ok(s.productFields.some(field => field.label === '生产许可证' && field.value === '农药生许（皖）0084'))
  assert.ok(s.productFields.some(field => field.label === '产品标准号' && field.value === 'Q/SHHL194-2023'))
})

test('shiaj：门店编号、码格式或来源平台不匹配时不发请求', async () => {
  assert.equal(await shiajAdapter('https://h5.shiaj.com/t/64?p=32&c=123', '123'), null)
  assert.equal(await shiajAdapter('https://h5.shiaj.com/t/not-a-store?c=' + SHIAJ_CODE, SHIAJ_CODE), null)
  assert.equal(await shiajAdapter('https://example.com/t/64?c=' + SHIAJ_CODE, SHIAJ_CODE), null)
})

test('hyny168：真接口原文映射到来源声明（字段与站方 label 一一对应）', () => {
  const s = mapHyny168(live.data, URL_HYNY, CODE)
  assert.ok(s, '应映射成功')
  assert.equal(s.pageCode, CODE)
  assert.equal(s.productName, '24%呋虫胺·唑虫酰胺')
  assert.equal(s.registrationNo, 'PD20230884')
  assert.equal(s.holderName, '山东邹平农药有限公司')
  assert.equal(s.manufacturer, '山东邹平农药有限公司')
  assert.equal(s.formulation, '悬浮剂')
  assert.equal(s.toxicity, '低毒')
  assert.equal(s.content, '24%')
  assert.equal(s.ingredients, '呋虫胺15%  唑虫酰胺9%')
  assert.equal(s.spec, '500克/瓶')
  assert.equal(s.batchNo, 'ZGG403')
  assert.equal(s.produceDate, '2026-07-03')
  assert.equal(s.productExpiry, '2028-07-02')
  assert.equal(s.shelfLife, '2年')
  // 原药：两组成分各自配对，绝不串组、绝不拿成分名补企业
  assert.deepEqual(s.originals, [
    { ingredient: '呋虫胺', regNo: 'PD20182012', company: '江西汇和化工有限公司' },
    { ingredient: '唑虫酰胺', regNo: 'PD20190042', company: '青岛恒宁生物科技有限公司' },
  ])
  // 只作展示的额外字段进 productFields，不污染判定字段
  const labels = s.productFields.map(f => f.label)
  assert.ok(labels.includes('规格码') && labels.includes('质检结果') && labels.includes('生产许可证'))
  // 商品名（对方 goodsName）走 commodityName，**绝不并进 productName**
  assert.equal(s.commodityName, undefined)
})

test('hyny168：门槛照抄站方自己（exists / status），失败一律返回 null 交给兜底', () => {
  // 真码实测：不存在的码返回 exists:false、各业务字段全 null、HTTP 仍 200
  assert.equal(mapHyny168({ exists: false, productName: null, clientName: null, permitNumber: null }, URL_HYNY, CODE), null)
  // 站方页面只有 exists && status == '1' 才进「正品标识」分支
  assert.equal(mapHyny168({ ...live.data, status: '0' }, URL_HYNY, CODE), null)
  assert.equal(mapHyny168({ exists: true, status: '1' }, URL_HYNY, CODE), null)
  assert.equal(mapHyny168(null, URL_HYNY, CODE), null)
  // 站方关掉批次/生产日期开关时，页面上显示「详见包装」⇒ 我们同步不声明，避免把厂家刻意不展示的批次当已核对内容
  const hidden = mapHyny168({ ...live.data, showBatchNo: false, showProduceTime: false }, URL_HYNY, CODE)
  assert.equal(hidden.batchNo, undefined)
  assert.equal(hidden.produceDate, undefined)
  // 日历非法的日期必须丢弃，绝不臆造
  assert.equal(mapHyny168({ ...live.data, productionDate: '2026-02-31 00:00:00' }, URL_HYNY, CODE).produceDate, undefined)
  assert.equal(mapHyny168({ ...live.data, validityPeriodDate: null }, URL_HYNY, CODE).productExpiry, undefined)
})

test('hyny168：码不合法时直接放弃（不猜、不截），不发任何请求', async () => {
  assert.equal(await hyny168Adapter('http://zp.hyny168.cn/ny?c=123', '123'), null)
  assert.equal(await hyny168Adapter('http://zp.hyny168.cn/ny', 'not-a-code'), null)
})

test('sdakzw：按该站模板绑定映射（字段路径抄自其前端源码，非猜测）', () => {
  // ⚠️ 本用例的入参是**按该站前端源码里的绑定路径构造**的（手头没有 sdakzw 签发的真码，
  //    拿不到真实 result 回放）；接口存在性/匿名可访问/响应信封均另有真码实测（见适配器头注释）。
  const result = {
    nongYao: {
      nongYaoName: '24%呋虫胺·唑虫酰胺', productName: '恒宁胜', dengJiZhengMaster: '山东某农药有限公司',
      dengJiZhengHao: 'PD20230884', dengjiZhengHaoDisplay: '', jiXingName: '悬浮剂', duXing: '低毒',
      chengFen: '呋虫胺15% 唑虫酰胺9%', piWenHao: '农药生许（鲁）0042', biaoZhunHao: 'Q/XXX 001-2024',
      baoZhiQi: '2年', tenantId: '1',
    },
    nongYaoItem: { itemCode: '21800462100136950812284409766080', viewCount: 3 },
    nongYaoQRCodeBatch: {
      produceBatch: 'ZGG403', produceDateTime: '2026-07-03', produceTypeName: '自主生产', producer: '山东某农药有限公司',
      yuanYaoList: [{ name: '呋虫胺', dengJiZhengHao: 'PD20182012', producer: '江西汇和化工有限公司' }],
    },
    nongYaoSpec: { specName: '500克/瓶' },
  }
  const s = mapSdakzw(result, 'http://www.sdakzw.com/nyzs/21800462100136950812284409766080', '21800462100136950812284409766080')
  assert.ok(s, '应映射成功')
  assert.equal(s.pageCode, '21800462100136950812284409766080')
  assert.equal(s.productName, '24%呋虫胺·唑虫酰胺')
  // 该站的「商品名称」正是本平台的 commodityName 语义（只作展示，不参与登记比对）
  assert.equal(s.commodityName, '恒宁胜')
  assert.equal(s.holderName, '山东某农药有限公司')
  assert.equal(s.manufacturer, '山东某农药有限公司')
  assert.equal(s.registrationNo, 'PD20230884')
  assert.equal(s.formulation, '悬浮剂')
  assert.equal(s.ingredients, '呋虫胺15% 唑虫酰胺9%')
  assert.equal(s.spec, '500克/瓶')
  assert.equal(s.batchNo, 'ZGG403')
  assert.equal(s.produceDate, '2026-07-03')
  assert.equal(s.shelfLife, '2年')
  assert.deepEqual(s.originals, [{ ingredient: '呋虫胺', regNo: 'PD20182012', company: '江西汇和化工有限公司' }])
  // 页面上「检验报告：合格」是模板里写死的常量，不是接口数据 ⇒ 绝不当证据采集
  assert.ok(!s.productFields.some(f => /质检|检验/.test(f.label)))
  // 登记证号展示值优先
  assert.equal(mapSdakzw({ ...result, nongYao: { ...result.nongYao, dengjiZhengHaoDisplay: 'PD20230884（展示用）' } }, 'http://www.sdakzw.com/nyzs/x', 'x').registrationNo, 'PD20230884（展示用）')
  // 核心字段全空 ⇒ 视为失败（宁可不展示，也不把空数据当已核对）
  assert.equal(mapSdakzw({ nongYao: {}, nongYaoItem: {}, nongYaoQRCodeBatch: {}, nongYaoSpec: {} }, 'http://www.sdakzw.com/nyzs/x', 'x'), null)
  assert.equal(mapSdakzw(null, 'http://www.sdakzw.com/nyzs/x', 'x'), null)
})

test('sdakzw：码不合法时直接放弃（不猜、不截），不发任何请求', async () => {
  assert.equal(await sdakzwAdapter('http://www.sdakzw.com/nyzs/abc', 'abc'), null)
  assert.equal(await sdakzwAdapter('http://www.sdakzw.com/', 'x'), null)
})

test('两站是纯前端空壳：通用解析抓下来的 HTML 里一个业务字段都取不到（适配器存在的理由）', () => {
  // 🔴 这两条是**真抓的 HTML**（tests/fixtures/shell-*.html）。若哪天它们变成服务端渲染带数据，
  //    本用例会失败 —— 那是提醒：可以评估撤掉适配器，改走通用解析。
  const hyny = parseSourceDocument(fs.readFileSync('tests/fixtures/shell-hyny168.html', 'utf8'), URL_HYNY, CODE)
  assert.equal(hyny.productName, undefined)
  assert.equal(hyny.registrationNo, undefined)
  assert.equal(hyny.holderName, undefined)
  assert.equal(hyny.pageCode, undefined)
  assert.equal(hyny.originals.length, 0)
  const sdakzw = parseSourceDocument(fs.readFileSync('tests/fixtures/shell-sdakzw.html', 'utf8'), 'http://www.sdakzw.com/nyzs/21800462100136950812284409766080', '21800462100136950812284409766080')
  assert.equal(sdakzw.productName, undefined)
  assert.equal(sdakzw.registrationNo, undefined)
  assert.equal(sdakzw.holderName, undefined)
  assert.equal(sdakzw.pageCode, undefined)
  assert.equal(sdakzw.originals.length, 0)
})

// 真接口回归：默认跳过（每次调用都会在对方系统里留下一条扫码记录）。
// 手动跑：NZ315_LIVE_ADAPTERS=1 node --test tests/source-adapters.test.mjs
test('真接口：hyny168 端到端（需 NZ315_LIVE_ADAPTERS=1）', { skip: process.env.NZ315_LIVE_ADAPTERS !== '1' }, async () => {
  const adapted = await hyny168Adapter(URL_HYNY, CODE)
  assert.ok(adapted, '真接口应返回结果')
  assert.equal(adapted.source.productName, '24%呋虫胺·唑虫酰胺')
  assert.equal(adapted.source.registrationNo, 'PD20230884')
  assert.equal(adapted.source.originals.length, 2)
  assert.ok(adapted.document.includes('"exists":true'))
})

test('真接口：shiaj 端到端（需 NZ315_LIVE_ADAPTERS=1）', { skip: process.env.NZ315_LIVE_ADAPTERS !== '1' }, async () => {
  const adapted = await shiajAdapter(URL_SHIAJ, SHIAJ_CODE)
  assert.ok(adapted && 'source' in adapted, '真接口应返回结果')
  assert.equal(adapted.source.productName, '苯醚甲环唑')
  assert.equal(adapted.source.registrationNo, 'PD20183446')
  assert.equal(adapted.source.originals.length, 1)
})

// 第三态：对方明确答复「查无此码」——必须与「页面读不出内容」分开，否则消费者会拿着错误指引进沟里。
// 用一个结构合法但绝不会存在的 32 位码（类别 2 + 后六位 180046，与 ddspp 的真码同族）。
const MISSING = '21800462100136950812284409766089'
test('真接口：hyny168 查无此码 ⇒ notFound 第三态（需 NZ315_LIVE_ADAPTERS=1）', { skip: process.env.NZ315_LIVE_ADAPTERS !== '1' }, async () => {
  assert.deepEqual(await hyny168Adapter('http://zp.hyny168.cn/ny?c=' + MISSING, MISSING), { notFound: true })
})
test('真接口：sdakzw 查无此码 ⇒ notFound 第三态（需 NZ315_LIVE_ADAPTERS=1）', { skip: process.env.NZ315_LIVE_ADAPTERS !== '1' }, async () => {
  assert.deepEqual(await sdakzwAdapter('http://www.sdakzw.com/nyzs/' + MISSING, MISSING), { notFound: true })
})
