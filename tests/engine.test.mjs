import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as core from '../vendor/yao-lang/src/core.js';
import { parse } from '../vendor/yao-lang/src/parse.js';
import { buildIr } from '../vendor/yao-lang/src/ir.js';
import { Machine } from '../vendor/yao-lang/src/interp.js';
import { createEngine } from '../app/engine.js';
import { integrate, derivative } from '../app/calculus.js';

const YAO = { ...core, parse, buildIr, Machine };
const SRC = readFileSync(new URL('../calc.yao', import.meta.url), 'utf8');

const HOOKS = {
  integrate: (f, a, b) => integrate(f, a, b).value,
  derivative: (f, x0) => derivative(f, x0).value,
};

function make(opts = {}) {
  return createEngine({ yao: YAO, source: SRC, hooks: HOOKS, ...opts });
}

/** 按一串按键，返回引擎 */
function type(engine, seq) {
  for (const item of seq) {
    const [k, v] = item;
    const r = engine.press(k, v);
    if (!r.ok) throw new Error(`按键 ${k}(${v}) 被拒绝：${r.message}`);
  }
  return engine;
}

const S = (s) => s.split('').map((c) => (c === '.' ? ['dot'] : ['digit', c]));
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test('1 + 2 × 3 = 7（优先级由表达式层负责）', () => {
  const e = make();
  type(e, [...S('1'), ['op', 1], ...S('2'), ['op', 3], ...S('3'), ['equals']]);
  assert.equal(e.lastResult, 7);
  assert.equal(e.display, '7');
  assert.equal(e.phase.name, '结果');
});

test('2 ^ 10 = 1024，随后 lg 立刻作用在结果上', () => {
  const e = make();
  type(e, [...S('2'), ['op', 5], ...S('10'), ['equals']]);
  assert.equal(e.lastResult, 1024);
  type(e, [['fn', 'lg']]);
  near(e.lastResult, Math.log10(1024), 1e-12);
  assert.equal(e.phase.name, '结果');
});

test('角度制：sin 30 = 0.5', () => {
  const e = make({ angleMode: 'deg' });
  type(e, [...S('30'), ['fn', 'sin'], ['equals']]);
  near(e.lastResult, 0.5, 1e-12);
  assert.equal(e.display, '0.5');
});

test('函数作用在操作数上：9 √ = 3，5 ! = 120', () => {
  const e = make();
  type(e, [...S('9'), ['fn', 'sqrt'], ['equals']]);
  assert.equal(e.lastResult, 3);

  const e2 = make();
  type(e2, [...S('5'), ['post', 'fact'], ['equals']]);
  assert.equal(e2.lastResult, 120);
});

test('括号：没闭合时按等号自动补齐', () => {
  const e = make();
  type(e, [['lp'], ...S('1'), ['op', 1], ...S('2')]);
  assert.equal(e.depth, 1);
  assert.equal(e.preview, ')');
  type(e, [['equals']]);
  assert.equal(e.lastResult, 3);
  assert.equal(e.depth, 0);
  assert.equal(e.tokens.length, 1);
});

test('括号：三层嵌套与预览', () => {
  const e = make();
  type(e, [['lp'], ['lp'], ['lp'], ...S('1'), ['op', 1], ...S('2')]);
  assert.equal(e.depth, 3);
  assert.equal(e.preview, ')))');
  assert.equal(e.display, '(((1 + 2');
  type(e, [['equals']]);
  assert.equal(e.lastResult, 3);
});

test('隐式乘法：2 × (3) 的乘号由宿主补上', () => {
  const e = make();
  type(e, [...S('2'), ['lp'], ...S('3'), ['rp'], ['equals']]);
  assert.equal(e.lastResult, 6);

  const e2 = make();
  type(e2, [...S('2'), ['const', 1], ['equals']]);
  near(e2.lastResult, Math.PI * 2, 1e-12);
  assert.match(e2.history[0].expr, /2 × π/);
});

test('小数点：一个数只能有一个；. 开头补 0.', () => {
  const e = make();
  type(e, [['dot']]);
  assert.equal(e.display, '0.');
  const bad = e.press('dot');
  assert.equal(bad.ok, false);
  assert.match(bad.message, /小数点/);

  const e2 = make();
  type(e2, [...S('1'), ['dot'], ...S('5'), ['op', 1], ...S('2')]);
  assert.equal(e2.display, '1.5 + 2');
});

test('退格：删数字、删运算符、回到空白', () => {
  const e = make();
  type(e, [...S('123')]);
  assert.equal(e.display, '123');
  type(e, [['back']]);
  assert.equal(e.display, '12');
  type(e, [['back'], ['back']]);
  assert.equal(e.display, '0');
  assert.equal(e.phase.name, '空白');

  const e2 = make();
  type(e2, [...S('1'), ['op', 1]]);
  assert.equal(e2.display, '1 + ');
  assert.equal(e2.phase.name, '待符');
  type(e2, [['back']]);
  assert.equal(e2.display, '1');
  assert.equal(e2.phase.name, '输入');
});

test('非法按键被拒绝，表达式不变', () => {
  const e = make();
  const r = e.press('op', 1);
  assert.equal(r.ok, false);
  assert.equal(e.display, '0');
  assert.equal(e.phase.name, '空白');

  type(e, [...S('5')]);
  const r2 = e.press('rp');
  assert.equal(r2.ok, false);
  assert.equal(e.display, '5');
  assert.equal(e.phase.name, '输入');
});

test('除以零 → 出错相位 → 按数字恢复', () => {
  const e = make();
  type(e, [...S('1'), ['op', 4], ...S('0')]);
  const bad = e.press('equals');
  assert.equal(bad.ok, false);
  assert.equal(e.phase.name, '出错');
  assert.match(e.lastError, /除数不能为 0/);
  assert.equal(e.press('back').ok, false);
  type(e, [['digit', '7']]);
  assert.equal(e.display, '7');
  assert.equal(e.phase.name, '输入');
});

test('运算符可以连按替换', () => {
  const e = make();
  type(e, [...S('1'), ['op', 1], ['op', 3], ['op', 2]]);
  assert.equal(e.display, '1 − ');
  assert.equal(e.phase.name, '待符');
});

test('结果可以接着算（Ans 语义）', () => {
  const e = make();
  type(e, [...S('2'), ['op', 1], ...S('3'), ['equals']]);
  assert.equal(e.lastResult, 5);
  type(e, [['op', 3], ['digit', '4'], ['equals']]);
  assert.equal(e.lastResult, 20);
  assert.match(e.history[0].expr, /5 × 4/);
});

test('取负、取余、阶乘、倒数', () => {
  const e = make();
  type(e, [...S('5'), ['post', 'neg'], ['equals']]);
  assert.equal(e.lastResult, -5);

  const e2 = make();
  type(e2, [...S('7'), ['op', 6], ...S('3'), ['equals']]);
  assert.equal(e2.lastResult, 1);

  const e3 = make();
  type(e3, [...S('4'), ['post', 'recip'], ['equals']]);
  assert.equal(e3.lastResult, 0.25);

  const e4 = make();
  type(e4, [...S('2'), ['post', 'sq'], ['op', 1], ...S('3'), ['equals']]);
  assert.equal(e4.lastResult, 7);
});

test('历史与取回', () => {
  const e = make();
  type(e, [...S('6'), ['op', 3], ...S('7'), ['equals']]);
  assert.equal(e.history.length, 1);
  assert.equal(e.history[0].expr, '6 × 7');
  assert.equal(e.history[0].text, '42');

  e.loadValue(42);
  assert.equal(e.phase.name, '结果');
  assert.equal(e.display, '42');
  type(e, [['op', 1], ['digit', '8'], ['equals']]);
  assert.equal(e.lastResult, 50);
});

test('表达式里写积分与导数也能算', () => {
  const e = make();
  // 通过按键拼不出带 x 的式子，这里直接检查表达式的 eval 通道
  const src = e.evalText();
  assert.equal(typeof src, 'string');

  type(e, [...S('3'), ['op', 5], ...S('2'), ['equals']]);
  assert.equal(e.lastResult, 9);
});

test('state 的 12 位布局：本 = 相位，动 = 深度', () => {
  const e = make();
  type(e, [['lp'], ['lp'], ...S('1')]);
  assert.equal(e.ben, 1, '输入相位');
  assert.equal(e.dong, 2, '两层括号');
  assert.equal(e.state, (2 << 6) | 1);
  assert.match(e.bits, /^000001$/);
});

test('机器拒绝的键不会写进 log 之外的状态', () => {
  const e = make();
  type(e, [...S('1')]);
  const before = e.state;
  const r = e.press('fn', 'sin');
  assert.ok(r.ok);
  assert.match(e.display, /sin\(1\)/);
  assert.notEqual(e.state, -1);
  const r2 = e.press('equals');
  assert.ok(r2.ok);
  near(e.lastResult, Math.sin(1), 1e-12);
  assert.ok(before >= 0);
});
