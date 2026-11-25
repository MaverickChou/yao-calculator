/**
 * 爻 · 算 —— 数值微积分
 *
 * 定积分：自适应 Simpson，误差估计直接写进递归判据。
 * 导数：四点差分 + Richardson 外推（消掉 h⁴ 项）。
 *
 * 都是纯数值方法，不需要符号求导，因此 f(x) 可以是任何表达式。
 */

import { CalcError, parseExpression, evaluateAst } from './expr.js';

/**
 * 把一段 f(x) 源码编译成函数。
 * @param {string} src
 * @param {{angleMode?:'rad'|'deg'}} [opts]
 * @returns {{f:(x:number)=>number, ast:object, usesX:boolean}}
 */
export function compileFunction(src, opts = {}) {
  const ast = parseExpression(src);
  const f = (x) => evaluateAst(ast, { x, angleMode: opts.angleMode ?? 'rad' });
  return { f, ast, usesX: true };
}

const EPS_TOL = 1e-11;

/**
 * 定积分 ∫ₐᵇ f dx，自适应 Simpson。
 * @param {(x:number)=>number} f
 * @param {number} a
 * @param {number} b
 * @param {{tol?:number, maxDepth?:number}} [opts]
 * @returns {{value:number, evals:number, segments:number, error:number, converged:boolean}}
 */
export function integrate(f, a, b, opts = {}) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    throw new CalcError('积分上下限必须是有限数', 'E_BOUND');
  }

  const tol = opts.tol ?? EPS_TOL;
  const maxDepth = opts.maxDepth ?? 40;
  const sign = a <= b ? 1 : -1;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);

  if (lo === hi) return { value: 0, evals: 0, segments: 0, error: 0, converged: true };

  let evals = 0;
  let segments = 1;

  const F = (x) => {
    evals++;
    let v;
    try {
      v = f(x);
    } catch (err) {
      throw new CalcError(`被积函数在 x=${x} 处求值失败：${err.message}`, 'E_F');
    }
    if (typeof v !== 'number' || Number.isNaN(v)) {
      throw new CalcError(`被积函数在 x≈${x} 处取不到实数值`, 'E_F');
    }
    if (!Number.isFinite(v)) {
      throw new CalcError(`被积函数在 x≈${x} 处发散`, 'E_F');
    }
    return v;
  };

  const mid = (lo + hi) / 2;
  const f0 = F(lo);
  const f1 = F(mid);
  const f2 = F(hi);
  const whole = ((hi - lo) * (f0 + 4 * f1 + f2)) / 6;

  let estimatedErr = 0;

  /** @returns {number} */
  const rec = (x0, x2, g0, g1, g2, S, depth) => {
    const m = (x0 + x2) / 2;
    const lm = (x0 + m) / 2;
    const rm = (m + x2) / 2;
    const glm = F(lm);
    const grm = F(rm);

    const Sl = ((m - x0) * (g0 + 4 * glm + g1)) / 6;
    const Sr = ((x2 - m) * (g1 + 4 * grm + g2)) / 6;
    const delta = Sl + Sr - S;

    if (depth <= 0 || Math.abs(delta) <= 15 * tol) {
      estimatedErr += Math.abs(delta) / 15;
      return Sl + Sr + delta / 15;
    }

    segments++;
    return (
      rec(x0, m, g0, glm, g1, Sl, depth - 1) +
      rec(m, x2, g1, grm, g2, Sr, depth - 1)
    );
  };

  const value = rec(lo, hi, f0, f1, f2, whole, maxDepth);

  if (!Number.isFinite(value)) {
    throw new CalcError('积分结果超出浮点数范围', 'E_OVERFLOW');
  }

  return {
    value: sign * value,
    evals,
    segments,
    error: estimatedErr,
    converged: estimatedErr <= Math.max(1e-10, 1e-8 * Math.abs(value)),
  };
}

/**
 * f′(x₀)，四点差分 + Richardson 外推。
 * @param {(x:number)=>number} f
 * @param {number} x0
 * @param {{h?:number}} [opts]
 * @returns {{value:number, h:number, evals:number, error:number, converged:boolean}}
 */
export function derivative(f, x0, opts = {}) {
  if (!Number.isFinite(x0)) throw new CalcError('求导点必须是有限数', 'E_BOUND');

  let evals = 0;
  const F = (x) => {
    evals++;
    let v;
    try {
      v = f(x);
    } catch (err) {
      throw new CalcError(`函数在 x≈${x} 处求值失败：${err.message}`, 'E_F');
    }
    if (typeof v !== 'number' || Number.isNaN(v)) {
      throw new CalcError(`函数在 x≈${x} 处取不到实数值`, 'E_F');
    }
    if (!Number.isFinite(v)) {
      throw new CalcError(`函数在 x≈${x} 处发散，无法差商`, 'E_F');
    }
    return v;
  };

  // 四点差分：误差 O(h⁴)，再 Richardson 一次得到 O(h⁶)
  const D = (h) =>
    (F(x0 - 2 * h) - 8 * F(x0 - h) + 8 * F(x0 + h) - F(x0 + 2 * h)) / (12 * h);

  let h = (opts.h ?? 1e-2) * Math.max(1, Math.abs(x0));
  let prev = null;
  let best = null;
  let bestDiff = Infinity;

  for (let k = 0; k < 12; k++) {
    const d1 = D(h);
    const d2 = D(h / 2);
    const R = (16 * d2 - d1) / 15;

    if (!Number.isFinite(R)) break;

    const diff = prev === null ? Infinity : Math.abs(R - prev);
    if (prev !== null && diff <= 1e-8 * (1 + Math.abs(R))) {
      return { value: R, h, evals, error: diff, converged: true };
    }
    if (diff < bestDiff) {
      bestDiff = diff;
      best = { value: R, h, evals };
    }
    prev = R;
    h /= 2;
  }

  if (!best) throw new CalcError('数值求导失败：函数在该点附近没有可用的差商', 'E_DIFF');
  return { value: best.value, h: best.h, evals: best.evals, error: bestDiff, converged: false };
}

/** 二阶导（对一阶导再差商），给「微积分」面板留个余量 */
export function secondDerivative(f, x0, opts = {}) {
  const f1 = (x) => derivative(f, x, opts).value;
  return derivative(f1, x0, opts);
}
