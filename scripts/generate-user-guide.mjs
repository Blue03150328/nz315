import { chromium } from 'file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, 'docs', '厂家后台使用说明');
const sourceDir = 'C:/Users/ADMINI~1/AppData/Local/Temp';
await fs.mkdir(outDir, { recursive: true });
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

const items = [
  ['01-数据概览', 'codex-clipboard-b77617d4-e205-4fe6-b01a-ab7d5c412ff2.png', '数据概览：先看企业整体情况', '登录后查看累计追溯码、扫码量、异常和预警；需要进入具体业务时点击左侧菜单。', [
    ['点击“产品管理”进入产品维护', 420, 150, 82, 162], ['点击“追溯码生成”进入批量生码', 460, 235, 82, 250], ['点击“码库管理”查看已生成或已上传的码', 470, 320, 82, 339]
  ]],
  ['02-产品管理', 'codex-clipboard-5c09e162-ad35-46ee-a290-075edf62a5e8.png', '产品管理：新增产品和维护已有产品', '生成追溯码前必须先有产品。产品名称、登记证号、产品类别和规格会参与追溯码生成。', [
    ['新增产品：第一次维护产品时点击这里', 1050, 70, 1355, 56], ['查询：按产品名称、商标或登记证号查找', 930, 150, 1310, 246], ['编辑：修改产品资料，核心信息请核对后再改', 790, 390, 1320, 408]
  ]],
  ['03-规格管理', 'codex-clipboard-45755c60-f08e-4d33-ac55-8e8b19a89a5f.png', '规格管理：先新增或批量导入规格', '规格码对应追溯码第9—11位。产品使用过的规格码不要随意修改或删除。', [
    ['新增规格：逐条添加规格名称、含量和包装单位', 920, 70, 1240, 55], ['批量导入：按模板一次导入多条规格', 1030, 125, 1350, 55], ['编辑或删除：仅处理尚未被产品引用的规格', 910, 420, 1320, 395]
  ]],
  ['04-追溯码生成', 'codex-clipboard-86a2e689-2c42-413d-a4b0-fded76630d40.png', '追溯码生成：选择产品、填写数量、生成文件', '这是厂家最常用的生码页面。生成结果不会自动写入码库，先下载文件，再到追溯码上传或生产采集导入。', [
    ['第一步：选择已经维护好的产品', 900, 130, 550, 190], ['第二步：填写生成数量，范围为1—50万条/次', 885, 245, 335, 278], ['第三步：点击“生成追溯码”', 900, 515, 758, 560], ['生成后在结果区导出 urls.txt、TXT 或 CSV', 1030, 660, 1040, 610], ['需要制作二维码图片时下载离线工具', 1030, 930, 1325, 1015]
  ]],
  ['05-追溯码上传', 'codex-clipboard-f9b4070e-e183-4e2f-90bd-8bb0b6843f22.png', '追溯码上传：导入生码文件并先解析校验', '把追溯码生成下载的 TXT、urls.txt 或 CSV 导入这里。解析校验只检查格式和重复，不会立即写入数据库。', [
    ['点击“选择文件”上传 TXT 或 CSV', 900, 145, 340, 166], ['也可以把码文本粘贴到这里', 1010, 300, 820, 300], ['点击“解析校验”查看格式、重复和产品匹配结果', 900, 490, 1350, 508]
  ]],
  ['06-码库管理', 'codex-clipboard-ae6dd86c-bdee-4140-9209-932185583ade.png', '码库管理：查询批次、查看明细和处理状态', '上传成功后，每个文件形成一个上传批次。厂家可在这里查批次、看明细、冻结、修正或删除。', [
    ['先按文件名、产品、生产批号或时间查询', 900, 140, 1310, 246], ['详情：查看该批次包含哪些追溯码', 865, 365, 1038, 401], ['冻结：暂停该批次的码继续使用', 865, 430, 1100, 401], ['新建批次并绑定：生产完成后绑定三要素', 850, 495, 1160, 401], ['修正或删除：核对后谨慎操作', 900, 560, 1280, 401]
  ]],
  ['07-生产批次管理', 'codex-clipboard-c4c698e7-79b3-4153-ae8b-7a54ef88e90e.png', '生产批次管理：生产采集时自动建档', '生产采集导入码时填写生产日期、批号、质量合格证号三要素，系统自动生成批次档案并把码标记为已绑定。', [
    ['按批号、产品名或合格证号查询批次', 920, 145, 380, 190], ['也可按产品筛选', 965, 225, 700, 190], ['没有批次时回到追溯码上传或生产采集填写三要素', 760, 410, 810, 420]
  ]],
  ['08-扫码统计', 'codex-clipboard-1e831971-ec80-4966-a7c2-0ca667e9ad3e.png', '扫码统计：查看产品扫码和明细记录', '用于查看消费者扫码次数、时间、产品和追溯码明细；追溯码被扫码不会自动核销。', [
    ['输入追溯码、产品名、省份和日期后查询', 860, 700, 470, 755], ['点击“查询”执行筛选', 950, 790, 1255, 815], ['上一页或下一页查看明细', 970, 1760, 1260, 1768]
  ]],
  ['09-系统设置', 'codex-clipboard-da5957fe-3cc4-4100-8912-4b7a7d34702e.png', '系统设置：核对企业资料并保存', '扫码页面展示的企业名称、联系人和许可证号来自这里。资料变更后点击保存企业信息。', [
    ['核对企业名称、统一社会信用代码和联系人', 900, 220, 580, 320], ['填写或核对资质到期日期', 1030, 430, 920, 455], ['点击“保存企业信息”使修改生效', 930, 545, 1320, 535]
  ]]
];

const annotated = [];
for (const [id, source, title, note, arrows] of items) {
  const src = path.join(sourceDir, source);
  const buf = await fs.readFile(src);
  const original = `${id}-原图.png`;
  const svgName = `${id}-箭头说明.svg`;
  await fs.writeFile(path.join(outDir, original), buf);
  const dims = source.includes('1e831') ? [1440, 1908] : source.includes('45755') ? [1440, 1352] : source.includes('86a2') ? [1440, 1065] : [1440, 1000];
  const labels = arrows.map(([label, fx, fy, tx, ty], index) => {
    const boxW = Math.min(450, Math.max(260, label.length * 18 + 60));
    const boxX = Math.max(12, Math.min(dims[0] - boxW - 12, fx));
    const boxY = Math.max(12, Math.min(dims[1] - 58, fy));
    return `<g><rect x="${boxX}" y="${boxY}" width="${boxW}" height="54" rx="10" fill="#fff7ed" fill-opacity=".97" stroke="#dc2626" stroke-width="3"/><circle cx="${boxX + 24}" cy="${boxY + 27}" r="15" fill="#dc2626"/><text x="${boxX + 24}" y="${boxY + 34}" text-anchor="middle" font-size="18" font-weight="700" fill="#fff">${index + 1}</text><text x="${boxX + 48}" y="${boxY + 34}" font-size="20" font-family="Microsoft YaHei, sans-serif" font-weight="700" fill="#991b1b">${esc(label)}</text><line x1="${boxX + boxW / 2}" y1="${boxY + 54}" x2="${tx}" y2="${ty}" stroke="#dc2626" stroke-width="5" marker-end="url(#arrow)"/></g>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${dims[0]}" height="${dims[1]}" viewBox="0 0 ${dims[0]} ${dims[1]}"><defs><marker id="arrow" markerWidth="14" markerHeight="14" refX="11" refY="5" orient="auto"><path d="M0,0 L11,5 L0,10 z" fill="#dc2626"/></marker></defs><image href="data:image/png;base64,${buf.toString('base64')}" width="${dims[0]}" height="${dims[1]}"/>${labels}</svg>`;
  await fs.writeFile(path.join(outDir, svgName), svg, 'utf8');
  annotated.push({ id, title, note, svgName });
}

const sectionHtml = annotated.map((item) => `<section class="page"><h2>${esc(item.title)}</h2><p>${esc(item.note)}</p><div class="image-wrap"><img src="${encodeURI(item.svgName)}" alt="${esc(item.title)}" /></div></section>`).join('');
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>农资315厂家后台使用说明</title><style>@page{size:A4;margin:12mm}*{box-sizing:border-box}body{font-family:"Microsoft YaHei",Arial,sans-serif;color:#17211b;line-height:1.7;margin:0}h1{text-align:center;color:#174b36;margin:0 0 8px}h2{color:#174b36;border-left:6px solid #2f7d56;padding-left:12px;margin:18px 0 8px}h3{color:#285b45;margin:14px 0 4px}p,li{font-size:14px}.cover{text-align:center;padding:30px 0 20px;border-bottom:1px solid #d7e4dc}.cover p{margin:4px 0;color:#5d6b63}.notice{background:#fff7ed;border:1px solid #fed7aa;padding:10px 14px;border-radius:8px;margin:14px 0}.flow{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 18px}.flow b{background:#e9f4ed;border:1px solid #b9d8c3;border-radius:6px;padding:8px 12px}.page{page-break-before:always}.page h2{margin-top:0}.image-wrap{border:1px solid #d8e1db;border-radius:8px;padding:5px;background:#fafcfb}.image-wrap img{display:block;width:100%;height:auto}.tip{background:#f0f7f2;border-left:4px solid #2f7d56;padding:8px 12px;margin:10px 0}.small{color:#66756c;font-size:12px}</style></head><body><div class="cover"><h1>农资315追溯码管理平台</h1><h2 style="border:0;text-align:center;margin:0">厂家后台使用说明</h2><p>适用对象：农药生产企业管理员、码管理员</p><p class="small">依据厂家提供的后台截图编写｜箭头编号对应页面上的实际按钮</p></div><div class="notice"><b>厂家主要操作顺序：</b>①新增产品和规格 → ②生成追溯码 → ③下载码文件或二维码图片 → ④追溯码上传解析校验 → ⑤码库管理查看批次 → ⑥生产时填写三要素并绑定批次 → ⑦扫码统计查看效果。</div><h2>一、开始使用前</h2><ul><li>使用企业分配的账号登录后台，页面按钮会根据账号权限显示。</li><li>首次使用先维护“产品管理”和“规格管理”，再生成追溯码。</li><li>生成追溯码后，需要把文件导入“追溯码上传/生产采集”，才能在码库中管理。</li><li>生产日期、生产批号、质量合格证号三项齐全后，系统自动建立生产批次并把码变为“已绑定”。</li></ul><h2>二、页面和按钮说明</h2>${sectionHtml}<section class="page"><h2>三、厂家具体操作流程</h2><h3>1. 新增产品</h3><ol><li>点击左侧“产品管理”。</li><li>点击右上角“新增产品”。</li><li>填写产品名称、登记证号、产品类别、有效期和规格等信息。</li><li>保存后回到列表，确认产品状态为“启用”。</li></ol><h3>2. 生成追溯码</h3><ol><li>点击左侧“追溯码生成”。</li><li>在“产品”下拉框中选择已经维护的产品。</li><li>在“生成数量”输入需要的数量。</li><li>点击“生成追溯码”，等待结果生成。</li><li>在结果区导出 TXT、urls.txt 或 CSV；需要制作二维码图片时下载离线工具。</li></ol><h3>3. 上传并校验追溯码</h3><ol><li>点击左侧“追溯码上传”。</li><li>点击“选择文件”，选择刚才导出的 TXT、urls.txt 或 CSV。</li><li>点击“解析校验”，确认格式正确、没有重复码、产品匹配无误。</li><li>按页面后续提示完成入库；完成后到“码库管理”查看上传批次。</li></ol><h3>4. 管理已经生成的码</h3><ol><li>进入“码库管理”，先按文件名、产品、生产批号或时间查询。</li><li>点击“详情”查看批次明细。</li><li>需要暂停使用时点击“冻结”。</li><li>生产完成后点击“新建批次并绑定”，补充生产日期、生产批号和质量合格证号。</li><li>“修正”和“删除”会影响码库记录，操作前请先核对批次和数量。</li></ol><h3>5. 状态说明</h3><ul><li><b>已生成：</b>码已经生成并可查询，但还没有生产批次信息。</li><li><b>已绑定：</b>生产三要素已经补齐，码与生产批次关联。</li><li><b>已冻结：</b>暂停使用，适合处理待核查或异常批次。</li><li><b>已作废：</b>终态，作废后不能恢复。</li></ul><div class="tip">如果厂家只负责日常生产和码管理，通常只需要使用“产品管理、规格管理、追溯码生成、追溯码上传、码库管理、扫码统计”这几个菜单。</div><h2>四、常见问题</h2><h3>看不到“新增产品”或“生成追溯码”怎么办？</h3><p>当前账号可能没有写入权限，请联系企业管理员调整账号权限。</p><h3>生成数量填0或超过上限怎么办？</h3><p>系统会提示数量不合法；请填写1—50万之间的整数，超过20万条会先出现确认提示。</p><h3>上传后为什么码库里没有记录？</h3><p>请确认“解析校验”通过，并按页面提示完成入库；只解析不等于已经入库。</p><h3>生产批次页面为什么是空的？</h3><p>生产批次在生产采集时填写三要素后自动建立；只生成码、未填写生产信息时不会自动生成批次档案。</p><h3>作废和冻结有什么区别？</h3><p>冻结是暂停使用；作废是终态，不能恢复。</p><p class="small">如遇到登录、权限、导入校验或数据异常，请保留页面提示文字和操作时间，联系平台管理员。</p></section></body></html>`;
const htmlPath = path.join(outDir, '农资315-厂家后台使用说明.html');
await fs.writeFile(htmlPath, html, 'utf8');
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await page.goto(`file:///${htmlPath.replaceAll('\\', '/')}`, { waitUntil: 'load' });
await page.pdf({ path: path.join(outDir, '农资315-厂家后台使用说明.pdf'), format: 'A4', printBackground: true, margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' } });
await browser.close();
console.log(`已生成：${htmlPath}`);
