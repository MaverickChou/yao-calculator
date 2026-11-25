#!/usr/bin/env node
/**
 * 用真实 Chrome（headless）打开单文件页面，点按键、读 DOM、截图。
 * 不依赖 npm 包：直接用 CDP + Node 24 自带的 WebSocket。
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url)) + '\\..';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PAGE = 'file:///' + encodeURI(join(ROOT, 'docs', 'index.html').replace(/\\/g, '/'));
const PORT = 9333;
const SHOTS = join(ROOT, 'shots');
mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.exceptions = [];
    this.consoleErrors = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        this.exceptions.push(d.exception?.description || d.text);
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    }
    return r.result.value;
  }

  async shot(file, opts = {}) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, ...opts });
    writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }
}

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'yao-chrome-'));
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--window-size=1400,1120',
      PAGE,
    ],
    { stdio: 'ignore' }
  );

  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.url.includes('/docs/index.html'));
    } catch {}
  }
  if (!target) throw new Error('Chrome 没起来 / 找不到页面');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  const cdp = new CDP(ws);

  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Log.enable');
  await sleep(600);

  const results = [];
  const check = (name, got, want) => {
    const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
    results.push({ name, ok, got, want: typeof want === 'function' ? '(fn)' : want });
    console.log(`${ok ? '✓' : '✗'} ${name}  →  ${JSON.stringify(got)}`);
    return ok;
  };

  check('页面标题', await cdp.eval('document.title'), (t) => t.includes('爻'));
  check('引擎已装载', await cdp.eval('typeof __CALC__'), 'object');
  check('按键数量', await cdp.eval('document.querySelectorAll("button.key").length'), (n) => n >= 40);

  await cdp.eval(`window.__click = (label) => {
    const b = [...document.querySelectorAll('button.key')].find((x) => x.textContent.trim() === label);
    if (!b) throw new Error('找不到按键 ' + label);
    b.click();
  }; window.__click('C');`);

  // 1) 12 × 4 =
  await cdp.eval(`__click('1'); __click('2'); __click('×'); __click('4'); __click('=');`);
  check('12 × 4 = 48', await cdp.eval(`document.getElementById('expr').textContent`), '48');
  check('相位进入结果', await cdp.eval(`document.getElementById('phase-pill').textContent`), '结果');

  // 2) DEG + 30 sin =
  await cdp.eval(`document.getElementById('angle-btn').click(); __click('3'); __click('0'); __click('sin');`);
  check('表达式 sin(30)', await cdp.eval(`document.getElementById('expr').textContent`), 'sin(30)');
  await cdp.eval(`__click('=');`);
  check('sin(30°) = 0.5', await cdp.eval(`document.getElementById('expr').textContent`), '0.5');

  // 3) 拒绝非法按键：空白相位按 ×
  await cdp.eval(`__click('C'); __click('×');`);
  check('拒绝 × 后仍是 0', await cdp.eval(`document.getElementById('expr').textContent`), '0');
  check('提示条报错', await cdp.eval(`document.getElementById('hint').className`), (c) => c.includes('err'));

  // 4) 括号自动补齐 + 机器面板
  await cdp.eval(`__click('C'); __click('('); __click('1'); __click('+'); __click('2'); __click('×'); __click('3');`);
  check('括号深度为 1', await cdp.eval(`document.getElementById('m-depth-val').textContent`), '1');
  check('幽灵右括号预览', await cdp.eval(`document.querySelector('#expr .ghost').textContent`), ')');
  await cdp.eval(`__click('=');`);
  check('(1+2×3) = 7', await cdp.eval(`document.getElementById('expr').textContent`), '7');

  // 5) 微积分面板：∫ x² 0..1
  await cdp.eval(`document.getElementById('int-go').click();`);
  await sleep(200);
  const intText = await cdp.eval(`document.getElementById('int-out').textContent`);
  check('定积分面板输出', intText, (t) => t.includes('0.333333333333') && t.includes('已收敛'));

  // 6) 导数面板：sin'(0) = 1
  await cdp.eval(`document.querySelector('[data-tab="der"]').click(); document.getElementById('der-go').click();`);
  await sleep(200);
  const derText = await cdp.eval(`document.getElementById('der-out').textContent`);
  check('导数面板输出', derText, (t) => t.includes('1') && t.includes('收敛'));

  // 7) 历史 + 填入计算器
  check('历史里有记录', await cdp.eval(`document.querySelectorAll('#tape li[data-i]').length`), (n) => n >= 3);

  // 8) 状态机日志
  check('转移日志有内容', await cdp.eval(`document.querySelectorAll('#m-log li').length`), (n) => n >= 1);

  // 9) 相位面板
  check('相位胶囊有 7 个', await cdp.eval(`document.querySelectorAll('.phase-pill').length`), 7);
  const keysNow = await cdp.eval(`document.getElementById('phase-keys').textContent`);
  check('输入相位接受等号', keysNow, (t) => t.includes('=') && t.includes('0-9'));
  await cdp.eval(`document.querySelectorAll('.phase-pill')[0].click();`);
  const keysEmpty = await cdp.eval(`document.getElementById('phase-keys').textContent`);
  check('空白相位不接受运算符', keysEmpty, (t) => !t.includes('+') && t.includes('C'));
  await cdp.eval(`document.querySelectorAll('.phase-pill')[0].click();`);

  // 10) 物理键盘
  const key = async (k, code, vk, text) => {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, text, windowsVirtualKeyCode: vk });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
  };
  await cdp.eval(`__click('C'); document.activeElement.blur();`);
  await key('7', 'Digit7', 55, '7');
  await key('*', 'Digit8', 56, '*');
  await key('8', 'Digit8', 56, '8');
  await key('Enter', 'Enter', 13, '\r');
  check('键盘 7 * 8 Enter = 56', await cdp.eval(`document.getElementById('expr').textContent`), '56');
  await key('Backspace', 'Backspace', 8);
  check('结果相位退格被拒', await cdp.eval(`document.getElementById('expr').textContent`), '56');

  // 11) 历史取回 & 填入计算器
  await cdp.eval(`document.querySelector('#tape li[data-i]').click();`);
  check('点击历史取回结果', await cdp.eval(`document.getElementById('expr').textContent`), '56');
  await cdp.eval(`document.querySelector('[data-tab="int"]').click(); document.getElementById('int-go').click(); document.getElementById('int-fill').click();`);
  check('积分结果填入计算器', await cdp.eval(`document.getElementById('expr').textContent`), (t) => t.startsWith('0.33333'));

  // 12) 页面没有脚本异常
  check('无未捕获异常', cdp.exceptions.length, 0);
  if (cdp.exceptions.length) console.log(cdp.exceptions);
  check('无 console.error', cdp.consoleErrors.length, 0);
  if (cdp.consoleErrors.length) console.log(cdp.consoleErrors);

  // ---- 截图
  await cdp.eval(`window.scrollTo(0,0); document.querySelector('[data-tab="int"]').click(); document.getElementById('int-go').click();`);
  await cdp.eval(`__click('C'); __click('3'); __click('0'); __click('sin'); __click('+'); __click('1'); __click('0'); __click('0'); __click('0'); __click('lg'); __click('×'); __click('2');`);
  await sleep(350);
  await cdp.shot(join(SHOTS, 'desktop.png'));

  // 括号嵌套中的状态机
  await cdp.eval(`__click('C'); __click('('); __click('('); __click('9'); __click('×'); __click('3'); __click('+'); __click('1');`);
  await sleep(250);
  await cdp.shot(join(SHOTS, 'machine.png'));

  // 出结果 + 历史
  await cdp.eval(`__click('=');`);
  await sleep(250);
  await cdp.shot(join(SHOTS, 'result.png'));

  // 手机宽度
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 420, height: 900, deviceScaleFactor: 2, mobile: true,
  });
  await sleep(450);
  await cdp.shot(join(SHOTS, 'mobile.png'));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
  if (failed.length) {
    console.log('失败项：', failed.map((f) => f.name).join('、'));
    process.exitCode = 1;
  }

  ws.close();
  chrome.kill();
  await sleep(300);
}

main().catch((err) => {
  console.error('浏览器检查失败：', err);
  process.exit(1);
});
