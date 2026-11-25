import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluate, parseExpression, formatNumber, CalcError, variablesOf,
} from '../app/expr.js';
import { integrate, derivative } from '../app/calculus.js';

const hooks = {
  integrate: (f, a, b) => integrate(f, a, b).value,
  derivative: (f, x0) => derivative(f, x0).value,
};

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test('四则运算与优先级', () => {
  assert.equal(evaluate('1+2*3'), 7);
  assert.equal(evaluate('(1+2)*3'), 9);
  assert.equal(evaluate('10-2-3'), 5);
  assert.equal(evaluate('100/4/5'), 5);
  assert.equal(evaluate('2^3^2'), 512);
  assert.equal(evaluate('-2^2'), -4);
  assert.equal(evaluate('(-2)^2'), 4);
  assert.equal(evaluate('2^-2'), 0.25);
  assert.equal(evaluate('7%3'), 1);
  assert.equal(evaluate('5!'), 120);
});

test('隐式乘法', () => {
  near(evaluate('2(3+4)'), 14);
  near(evaluate('2pi'), Math.PI * 2);
  near(evaluate('3sin(pi/2)'), 3);
  near(evaluate('2e'), Math.E * 2);
  near(evaluate('(1+1)(2+2)'), 8);
});

test('对数：ln / lg / log / log2', () => {
  near(evaluate('ln(e)'), 1);
  near(evaluate('lg(1000)'), 3);
  near(evaluate('log(1000)'), 3);
  near(evaluate('log(8, 2)'), 3);
  near(evaluate('log2(1024)'), 10);
  near(evaluate('log(27, 3)'), 3);
  near(evaluate('exp(1)'), Math.E);
});

test('三角函数与角度制', () => {
  near(evaluate('sin(0)'), 0);
  near(evaluate('cos(0)'), 1);
  near(evaluate('sin(pi/2)'), 1);
  near(evaluate('sin(30)', { angleMode: 'deg' }), 0.5);
  near(evaluate('tan(45)', { angleMode: 'deg' }), 1);
  near(evaluate('asin(0.5)', { angleMode: 'deg' }), 30);
  assert.throws(() => evaluate('tan(90)', { angleMode: 'deg' }), /无定义/);
});

test('根式、绝对值、取整', () => {
  near(evaluate('sqrt(2)^2'), 2);
  assert.equal(evaluate('cbrt(27)'), 3);
  assert.equal(evaluate('abs(-3)'), 3);
  assert.equal(evaluate('floor(2.9)'), 2);
  assert.equal(evaluate('ceil(2.1)'), 3);
  assert.equal(evaluate('round(2.5)'), 3);
  assert.throws(() => evaluate('sqrt(-1)'), /不能为负/);
});

test('定义域与语法错误都有中文说明', () => {
  assert.throws(() => evaluate('1/0'), /除数不能为 0/);
  assert.throws(() => evaluate('ln(0)'), /真数/);
  assert.throws(() => evaluate('log(-1)'), /真数/);
  assert.throws(() => evaluate('log(8, 1)'), /底数/);
  assert.throws(() => evaluate('asin(2)'), /\[-1, 1\]/);
  assert.throws(() => evaluate('2+'), /不完整/);
  assert.throws(() => evaluate('(1+2'), /缺少/);
  assert.throws(() => evaluate(''), /空的/);
  assert.throws(() => evaluate('foo(1)'), /未知函数/);
  assert.throws(() => evaluate('3.5!'), /整数/);
});

test('科学计数法与全角符号', () => {
  near(evaluate('1.5e3'), 1500);
  near(evaluate('2.5e-2'), 0.025);
  near(evaluate('3×4'), 12);
  near(evaluate('10÷4'), 2.5);
  near(evaluate('π'), Math.PI);
  near(evaluate('√9'), 3);
});

test('表达式里的定积分与导数', () => {
  near(evaluate('integral(x^2, 0, 1)', { hooks }), 1 / 3, 1e-8);
  near(evaluate('integral(sin(x), 0, pi)', { hooks }), 2, 1e-8);
  near(evaluate('deriv(sin(x), 0)', { hooks }), 1, 1e-7);
  near(evaluate('deriv(x^3, 2)', { hooks }), 12, 1e-6);
});

test('formatNumber 的可读性', () => {
  assert.equal(formatNumber(0), '0');
  assert.equal(formatNumber(-0), '0');
  assert.equal(formatNumber(42), '42');
  assert.equal(formatNumber(1 / 3), '0.333333333333');
  assert.equal(formatNumber(0.1 + 0.2), '0.3');
  assert.equal(formatNumber(-2.5), '-2.5');
  assert.equal(formatNumber(1e13), '1e+13');
  assert.equal(formatNumber(1e-10), '1e-10');
  assert.equal(formatNumber(1.23456789012345e20), '1.23456789012e+20');
  assert.equal(formatNumber(Infinity), '∞');
});

test('variablesOf 能识别 x', () => {
  const v = variablesOf(parseExpression('x^2 + sin(x) + pi'));
  assert.ok(v.has('x'));
  assert.ok(v.has('pi'));
  assert.ok(!v.has('sin'));
});
