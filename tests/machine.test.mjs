import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as core from '../vendor/yao-lang/src/core.js';
import { parse } from '../vendor/yao-lang/src/parse.js';
import { buildIr } from '../vendor/yao-lang/src/ir.js';
import { Machine } from '../vendor/yao-lang/src/interp.js';
import { analyze } from '../vendor/yao-lang/src/validate.js';

const SRC = readFileSync(new URL('../calc.yao', import.meta.url), 'utf8');
const ir = buildIr(parse(SRC));

const fresh = () => new Machine(ir);
const phase = (m) => core.ben(m.state);
const depth = (m) => core.dong(m.state);

const P = { 空白: 0, 输入: 1, 待符: 2, 括号: 3, 收括: 4, 结果: 5, 出错: 6 };

test('程序能被解析成 IR', () => {
  assert.equal(ir.name, '计算器');
  assert.equal(ir.states.size, 7);
  assert.ok(ir.events.length >= 13);
});

test('基本输入路径：数字 → 运算符 → 数字 → 等号', () => {
  const m = fresh();
  assert.equal(phase(m), P.空白);
  assert.ok(m.step('数字').ok);
  assert.equal(phase(m), P.输入);
  assert.ok(m.step('运算符', 1).ok);
  assert.equal(phase(m), P.待符);
  assert.ok(m.step('数字').ok);
  assert.ok(m.step('等号').ok);
  assert.equal(phase(m), P.结果);
});

test('非法按键被机器拒绝（不是宿主猜的）', () => {
  const m = fresh();
  assert.equal(m.step('运算符', 1).ok, false, '表达式不能以运算符开头');
  assert.equal(m.step('等号').ok, false, '空表达式不能求值');
  assert.equal(m.step('右括号').ok, false, '没有左括号');
  assert.equal(m.step('三角函数', 1).ok, false, '没有操作数');
  assert.equal(phase(m), P.空白, '被拒绝之后状态不变');

  const m2 = fresh();
  m2.step('左括号');
  assert.equal(m2.step('运算符', 1).ok, false, '左括号后不能直接跟运算符');
  assert.equal(m2.step('等号').ok, false, '空括号不能求值');
});

test('括号深度存在「动」里，越界进出错态', () => {
  const m = fresh();
  for (let i = 1; i <= 5; i++) {
    assert.ok(m.step('左括号').ok);
    assert.equal(depth(m), i);
    assert.equal(phase(m), P.括号);
    assert.ok(m.step('数字').ok);
    assert.equal(depth(m), i, '数字不会改动深度');
  }
  for (let i = 4; i >= 0; i--) {
    assert.ok(m.step('右括号').ok);
    assert.equal(depth(m), i);
    assert.equal(phase(m), P.收括);
  }
  // 深度 0 再按 )：目标是出错，而不是被拒绝
  const r = m.step('右括号');
  assert.ok(r.ok);
  assert.equal(phase(m), P.出错);
});

test('63 层封顶，再开括号进出错态', () => {
  const m = fresh();
  for (let i = 0; i < 63; i++) assert.ok(m.step('左括号').ok);
  assert.equal(depth(m), 63);
  assert.ok(m.step('左括号').ok);
  assert.equal(phase(m), P.出错, '深度溢出走出错分支');
});

test('清除在任何相位都回到空白', () => {
  for (const setup of [
    [],
    [['数字']],
    [['数字'], ['运算符', 1]],
    [['左括号'], ['数字'], ['右括号']],
    [['数字'], ['等号']],
    [['出错']],
  ]) {
    const m = fresh();
    for (const [ev, arg] of setup) m.step(ev, arg ?? 0);
    assert.ok(m.step('清除').ok);
    assert.equal(phase(m), P.空白);
    assert.equal(depth(m), 0);
  }
});

test('参数越界被拒（运算符只有 1..6）', () => {
  const m = fresh();
  m.step('数字');
  assert.equal(m.step('运算符', 0).ok, false);
  assert.equal(m.step('运算符', 7).ok, false);
  assert.equal(phase(m), P.输入, '状态没有被破坏');
});

test('穷举校验：没有死态、所有声明相位可达', () => {
  const a = analyze(ir);
  assert.equal(a.stateSpace, 4096);
  assert.equal(a.deadStates.length, 0);
  assert.equal(a.reachableDeclared, 7);
  assert.ok(a.reachableCount > 200, `可达态 ${a.reachableCount}`);
  // 未被定义的转移是设计的一部分：它们就是「此路不通」
  assert.ok(a.undefined.count > 0);
});
