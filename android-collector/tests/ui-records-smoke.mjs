import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// 仅在明确授权的测试设备上造任务；不卸载、不清数据，不对生产设备自动执行。
if (process.env.NZ315_UI_TEST_DEVICE !== '1' || !process.env.ANDROID_SERIAL) {
  throw new Error('请指定测试设备ANDROID_SERIAL，并设置NZ315_UI_TEST_DEVICE=1');
}
const adb = process.env.ADB_PATH || 'adb';
const serial = process.env.ANDROID_SERIAL;
const output = process.env.NZ315_UI_OUTPUT || 'ui-test-output';
const apk = process.env.NZ315_UI_APK;
fs.mkdirSync(output, { recursive: true });
const command = (...args) => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8' });
const originalAutoRotation = command('shell', 'settings', 'get', 'system', 'accelerometer_rotation').trim();
const originalRotation = command('shell', 'settings', 'get', 'system', 'user_rotation').trim();
process.on('exit', () => {
  command('shell', 'settings', 'put', 'system', 'accelerometer_rotation', originalAutoRotation);
  command('shell', 'settings', 'put', 'system', 'user_rotation', originalRotation);
});
command('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0');
command('shell', 'settings', 'put', 'system', 'user_rotation', '0');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
function assert(ok, message) { if (!ok) throw new Error(message); checks.push(message); }
function bounds(node) {
  const match = node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  return match ? match.slice(1).map(Number) : null;
}
async function state() {
  try { command('shell', 'uiautomator', 'dump', '/sdcard/nz315-ui.xml'); }
  catch (error) { if (!error.stdout?.includes('UI hierchary dumped')) throw error; }
  return command('shell', 'cat', '/sdcard/nz315-ui.xml');
}
function nodes(xml) { return xml.match(/<node\b[^>]*>/g) || []; }
function byId(xml, name) { return nodes(xml).find(node => node.includes(`resource-id="cn.nz315.collector:id/${name}"`)); }
async function click(label, id = false) {
  for (let step = 0; step < 12; step++) {
    const xml = await state();
    const node = id ? byId(xml, label) : nodes(xml).find(node => node.includes(`text="${label}"`) && node.includes('enabled="true"'));
    const rect = bounds(node);
    if (rect && rect[3] > rect[1]) {
      command('shell', 'input', 'tap', String((rect[0] + rect[2]) >> 1), String((rect[1] + rect[3]) >> 1));
      await sleep(350); return;
    }
    // 前半段向下查找，后半段回到上方，兼容采集页自动显示最近结果。
    const viewport = bounds(nodes(xml).find(item => item.includes('class="android.widget.ScrollView"')));
    if (viewport) {
      const x = String((viewport[0] + viewport[2]) >> 1);
      const bottom = String(viewport[3] - 35);
      const top = String(viewport[1] + 35);
      command('shell', 'input', 'swipe', x, step < 6 ? bottom : top, x, step < 6 ? top : bottom, '180');
    }
  }
  throw new Error(`未找到控件：${label}`);
}
async function barcode(value) {
  command('shell', 'am', 'broadcast', '-a', 'android.intent.ACTION_DECODE_DATA', '--es', 'barcode_string', `'${value}'`);
  await sleep(450);
}
function screenshot(name) {
  fs.writeFileSync(path.join(output, `${name}.png`), execFileSync(adb, ['-s', serial, 'exec-out', 'screencap', '-p']));
}
function result(xml, title, value) {
  const status = byId(xml, 'scan_result_status');
  const code = byId(xml, 'scan_result_value');
  return status?.includes(title) && code?.includes(value);
}

if (apk) {
  // 记录升级前的任务卡片文字，用覆盖安装后的任务页逐条核对。
  command('shell', 'am', 'force-stop', 'cn.nz315.collector');
  command('shell', 'am', 'start', '-n', 'cn.nz315.collector/.MainActivity');
  await sleep(400);
  const before = await state();
  const summaries = nodes(before).map(node => node.match(/text="([^"]*)"/)?.[1]).filter(value => value?.includes('件') && value.includes('箱') && value.includes('待关联'));
  const installed = command('install', '-r', apk);
  if (!installed.includes('Success')) throw new Error('覆盖安装失败');
  command('shell', 'am', 'start', '-n', 'cn.nz315.collector/.MainActivity');
  await sleep(450);
  const after = await state();
  assert(summaries.length > 0 && summaries.every(value => after.includes(value)), '覆盖升级保留原任务数量与箱关系摘要');
  assert(command('shell', 'dumpsys', 'package', 'cn.nz315.collector').includes('versionName=1.1.0'), '安装的是正式1.1.0版本');
}
command('shell', 'am', 'force-stop', 'cn.nz315.collector');
command('shell', 'am', 'start', '-n', 'cn.nz315.collector/.MainActivity');
await sleep(400);
let xml = await state();
assert(byId(xml, 'nav_tasks') && byId(xml, 'nav_records') && !xml.includes('nav_capture'), '底部只有任务与记录两个主页面');
screenshot('任务页');
await click('＋ 新建采集任务');
await click('外部码');
await click('保存任务资料');
const suffix = Date.now();
const box1 = `UI-BOX-${suffix}-1`;
const box2 = `UI-BOX-${suffix}-2`;
const code1 = `https://manufacturer.example/trace?id=${suffix}01`;
const code2 = `https://manufacturer.example/trace?id=${suffix}02`;
await barcode(box1);
xml = await state();
assert(result(xml, '已录入 · 箱码', box1), '箱码保存后在输入下方显示成功与原文');
await barcode(code1);
xml = await state();
const inputRect = bounds(byId(xml, 'scan_input'));
const feedbackRect = bounds(byId(xml, 'scan_result_status'));
assert(inputRect && feedbackRect && feedbackRect[1] >= inputRect[3] && feedbackRect[3] > feedbackRect[1], '本次结果在输入框下方且处于可视区域');
assert(result(xml, '已录入 · 产品码', code1) && xml.includes('本箱已录入 1 条'), '成功码即时进入本箱已录入列表');
screenshot('录入成功');
await barcode(code1);
xml = await state();
assert(result(xml, '重复码 · 未新增', code1) && xml.includes('本箱 1 件'), '重复扫码显示未新增且数量保持1条');
screenshot('重复未新增');
await barcode(' ');
xml = await state();
assert(result(xml, '未录入 · 请核对', '') && xml.includes('本箱 1 件'), '无效内容不会显示已保存或增加数量');
await click('采集箱码');
await barcode(`WRONG-BOX-${suffix}`);
xml = await state();
assert(result(xml, '未录入 · 请核对', `WRONG-BOX-${suffix}`) && xml.includes('本箱 1 件'), '已有箱时误扫新箱显示失败且不覆盖箱码');
await click('采集产品码');
await click('scan_input', true);
command('shell', 'input', 'text', `MANUAL-${suffix}`);
command('shell', 'input', 'keyevent', '66');
await sleep(350);
xml = await state();
assert(result(xml, '已录入 · 产品码', `MANUAL-${suffix}`) && xml.includes('本箱 2 件'), '手工输入回车同样即时显示并只录入一次');
await click('nav_tasks', true);
await barcode(`SHOULD-NOT-SAVE-${suffix}`);
await click('nav_records', true);
xml = await state();
assert(xml.includes('本箱 2 件') && !xml.includes(`SHOULD-NOT-SAVE-${suffix}`), '任务设置页不接收扫码，返回记录页保持数量');
await click('完成本箱／本组');
await click('确认');
await click('下一箱／下一组');
await click('采集产品码');
await barcode(code2);
xml = await state();
assert(result(xml, '已录入 · 产品码', code2) && xml.includes('待关联箱码') && xml.includes('本箱已录入 1 条'), '先产品后箱显示已保存与待关联，列表仅含当前箱');
await click('采集箱码');
await barcode(box2);
command('shell', 'am', 'force-stop', 'cn.nz315.collector');
command('shell', 'am', 'start', '-n', 'cn.nz315.collector/.MainActivity');
await sleep(350);
await click('nav_records', true);
xml = await state();
assert(xml.includes('总计 3 件 / 2 箱') && result(xml, '已录入 · 产品码', code2), '重启后从数据库恢复数量、箱关系与最近已录入码');
await click('查看全部箱与产品记录');
xml = await state();
assert(xml.includes('全部采集记录') && xml.includes(code1) && xml.includes(code2), '记录页可查询本任务各箱完整历史');
screenshot('全部记录');
command('shell', 'settings', 'put', 'system', 'user_rotation', '1');
await sleep(900);
xml = await state();
assert(xml.includes('全部采集记录') && !xml.includes('手工补录或键盘扫码内容'), '旋转后仍停留在历史查询，不会自动开始扫码');
command('shell', 'settings', 'put', 'system', 'user_rotation', '0');
await sleep(700);
await click('返回扫码录入');
xml = await state();
assert(xml.includes('总计 3 件 / 2 箱') && xml.includes('本箱已录入 1 条'), '返回录入页重新显示当前箱记录');
fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: checks.length, checks }, null, 2));
console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
