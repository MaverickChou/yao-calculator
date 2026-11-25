import test from 'node:test';
import assert from 'node:assert/strict';

import { integrate, derivative, compileFunction, secondDerivative } from '../app/calculus.js';

const near = (a, b, tol = 1e-8) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test('定积分：多项式', () => {
  near(integrate((x) => x * x, 0, 1).value, 1 / 3);
  near(integrate((x) => x * x, 0, 3).value, 9);
  near(integrate((x) => 1, 0, 1).value, 1);
  near(integrate((x) => 3 * x * x + 2 * x + 1, -1, 2).value, 15);
});

test('定积分：超越函数', () => {
  near(integrate(Math.sin, 0, Math.PI).value, 2, 1e-9);
  near(integrate((x) => Math.exp(x), 0, 1).value, Math.E - 1, 1e-9);
  near(integrate((x) => 1 / x, 1, 2).value, Math.LN2, 1e-9);
  near(integrate((x) => Math.log(x), 1, Math.E).value, 1, 1e-9);
});

test('定积分：上下限颠倒取负、a = b 为 0', () => {
  near(integrate((x) => x * x, 1, 0).value, -1 / 3);
  assert.equal(integrate((x) => x * x, 2, 2).value, 0);
});

test('定积分：报告收敛信息', () => {
  const r = integrate((x) => Math.exp(-x * x), -2, 2);
  assert.ok(r.converged);
  assert.ok(r.evals > 0);
  near(r.value, 1.7641627815248434, 1e-6);
});

test('定积分：被积函数发散要报错', () => {
  assert.throws(() => integrate((x) => 1 / x, -1, 1), /发散|实数值/);
  assert.throws(() => integrate((x) => Math.sqrt(x), -1, 1), /实数值/);
  assert.throws(() => integrate((x) => x, -Infinity, 1), /有限/);
});

test('导数：常见函数', () => {
  near(derivative(Math.sin, 0).value, 1, 1e-7);
  near(derivative(Math.cos, 0).value, 0, 1e-7);
  near(derivative((x) => x * x, 3).value, 6, 1e-7);
  near(derivative(Math.exp, 0).value, 1, 1e-7);
  near(derivative(Math.log, 2).value, 0.5, 1e-7);
  near(derivative((x) => 1 / x, 1).value, -1, 1e-6);
  near(derivative((x) => Math.abs(x), 1).value, 1, 1e-7);
});

test('导数：二阶导', () => {
  near(secondDerivative((x) => x * x * x, 2).value, 12, 1e-4);
});

test('compileFunction 支持角度制', () => {
  const { f } = compileFunction('sin(x)', { angleMode: 'deg' });
  near(f(30), 0.5, 1e-12);
});
