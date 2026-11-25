/**
 * 爻 · 算 —— 宿主层：把按键送进状态机，把状态机的裁决变成界面行为
 *
 * 分工（和 SPEC §10 一致）：
 *   爻  ：这个键在这个相位能不能按、按完进入哪个相位、括号还剩几层
 *   宿主：操作数长什么样、算出来是多少
 *
 * 所有按键都必须先过 state.machine.step()。state.machine 说「此路不通」，
 * 宿主就只负责响一声，绝不自己猜。
 */

import { CalcError, evaluate, formatNumber } from './expr.js';

export const PHASE_NAMES = ['空白', '输入', '待符', '括号', '收括', '结果', '出错'];

export const PHASE = {
  空白: 0, 输入: 1, 待符: 2, 括号: 3, 收括: 4, 结果: 5, 出错: 6,
};

/** 事件名 → 机器里的事 */
const EV = {
  digit: '数字',
  dot: '小数点',
  op: '运算符',
  lp: '左括号',
  rp: '右括号',
  const: '常数',
  equals: '等号',
  clear: '清除',
  error: '出错',
};

/** 一元函数：机器只认「哪一类 + 编号」，具体是哪个函数由宿主解释 */
export const FUNCS = {
  sin:  { ev: '三角函数', arg: 1, label: 'sin', kind: 'fn' },
  cos:  { ev: '三角函数', arg: 2, label: 'cos', kind: 'fn' },
  tan:  { ev: '三角函数', arg: 3, label: 'tan', kind: 'fn' },
  asin: { ev: '三角函数', arg: 4, label: 'asin', kind: 'fn' },
  acos: { ev: '三角函数', arg: 5, label: 'acos', kind: 'fn' },
  atan: { ev: '三角函数', arg: 6, label: 'atan', kind: 'fn' },

  ln:   { ev: '对数函数', arg: 1, label: 'ln', kind: 'fn' },
  lg:   { ev: '对数函数', arg: 2, label: 'lg', kind: 'fn' },
  log2: { ev: '对数函数', arg: 3, label: 'log2', kind: 'fn' },
  exp:  { ev: '对数函数', arg: 4, label: 'exp', kind: 'fn' },
  pow10:{ ev: '对数函数', arg: 5, label: '10^', kind: 'fn' },
  sinh: { ev: '对数函数', arg: 6, label: 'sinh', kind: 'fn' },

  sqrt: { ev: '幂函数', arg: 1, label: '√', kind: 'fn' },
  cbrt: { ev: '幂函数', arg: 2, label: '∛', kind: 'fn' },
  abs:  { ev: '幂函数', arg: 6, label: 'abs', kind: 'fn' },

  sq:   { ev: '幂函数', arg: 3, label: 'x²', kind: 'post' },
  cube: { ev: '幂函数', arg: 4, label: 'x³', kind: 'post' },
  recip:{ ev: '幂函数', arg: 5, label: '1/x', kind: 'post' },
  fact: { ev: '阶乘',   arg: 0, label: 'x!', kind: 'post' },
  neg:  { ev: '负号',   arg: 0, label: '±', kind: 'post' },
};

export const OPS = {
  1: { ch: '+', display: ' + ', pretty: '+' },
  2: { ch: '-', display: ' − ', pretty: '−' },
  3: { ch: '*', display: ' × ', pretty: '×' },
  4: { ch: '/', display: ' ÷ ', pretty: '÷' },
  5: { ch: '^', display: ' ^ ', pretty: '^' },
  6: { ch: '%', display: ' mod ', pretty: 'mod' },
};

export const CONSTS = {
  1: { name: 'pi', display: 'π' },
  2: { name: 'e', display: 'e' },
  3: { name: 'ans', display: 'Ans' },
};

// ---------------------------------------------------------------- 渲染

function needsParens(s) {
  return !/^[0-9.]+$/.test(s) && !/^[A-Za-z]+$/.test(s);
}

function wrapPost(kind, inner, mode) {
  const disp = mode === 'display';
  switch (kind) {
    case 'sq': return disp ? `${needsParens(inner) ? `(${inner})` : inner}²` : `(${inner})^2`;
    case 'cube': return disp ? `${needsParens(inner) ? `(${inner})` : inner}³` : `(${inner})^3`;
    case 'recip': return `1/(${inner})`;
    case 'fact': return disp ? `${needsParens(inner) ? `(${inner})` : inner}!` : `(${inner})!`;
    case 'neg': return disp ? `−${needsParens(inner) ? `(${inner})` : inner}` : `-(${inner})`;
    default: return inner;
  }
}

/**
 * token 序列 → 可读文本（display）或可解析文本（eval）。
 * 后缀函数会把「上一个操作数」整个包起来，所以这里要记住操作数的起点。
 */
export function render(tokens, mode = 'display') {
  const disp = mode === 'display';
  let out = '';
  const parenStarts = [];
  let lastStart = null;
  let prevOperand = false;

  const mul = disp ? ' × ' : '*';

  for (const t of tokens) {
    if (prevOperand && (t.k === 'num' || t.k === 'const' || t.k === 'lp')) {
      out += mul;
      lastStart = null;
      prevOperand = false;
    }

    switch (t.k) {
      case 'num': {
        lastStart = out.length;
        out += disp ? (t.display ?? t.text) : t.text;
        prevOperand = true;
        break;
      }
      case 'const': {
        const c = CONSTS[t.v];
        lastStart = out.length;
        if (c.name === 'ans') {
          out += disp ? (t.display ?? `Ans`) : 'ans';
        } else {
          out += c.display;
        }
        prevOperand = true;
        break;
      }
      case 'lp': {
        parenStarts.push(out.length);
        out += '(';
        prevOperand = false;
        lastStart = null;
        break;
      }
      case 'rp': {
        const s = parenStarts.pop();
        out += ')';
        lastStart = s ?? null;
        prevOperand = true;
        break;
      }
      case 'op': {
        out += disp ? OPS[t.v].display : OPS[t.v].ch;
        prevOperand = false;
        lastStart = null;
        break;
      }
      case 'fn': {
        const s = lastStart ?? 0;
        const inner = out.slice(s);
        let head = t.v;
        if (t.v === 'pow10') head = disp ? '10^' : '10^';
        else if (disp) {
          const f = FUNCS[t.v];
          head = f ? f.label : t.v;
        }
        out = out.slice(0, s) + head + '(' + inner + ')';
        lastStart = s;
        prevOperand = true;
        break;
      }
      case 'post': {
        const s = lastStart ?? 0;
        const inner = out.slice(s);
        out = out.slice(0, s) + wrapPost(t.v, inner, mode);
        lastStart = s;
        prevOperand = true;
        break;
      }
      default:
        break;
    }
  }

  return out;
}

// ---------------------------------------------------------------- 引擎

/**
 * @param {{yao:object, source:string, hooks?:object, angleMode?:'rad'|'deg'}} opts
 */
export function createEngine(opts) {
  const { yao, source } = opts;
  const hooks = opts.hooks ?? {};
  const ast = yao.parse(source);
  const ir = yao.buildIr(ast);

  let machine = new yao.Machine(ir);
  let tokens = [];
  let lastResult = null;
  let angleMode = opts.angleMode === 'deg' ? 'deg' : 'rad';
  let history = [];
  let log = [];
  let lastError = null;

  const ben = () => yao.ben(machine.state);
  const dong = () => yao.dong(machine.state);
  const phaseId = () => ben();
  const phaseName = () => PHASE_NAMES[phaseId()] ?? '?';

  function record(ev, arg, from, to, ok) {
    log.push({ ev, arg, from, to, ok, at: Date.now() });
    if (log.length > 60) log.shift();
  }

  function step(ev, arg = 0) {
    const from = machine.state;
    const r = machine.step(ev, arg);
    record(ev, arg, from, r.to, r.ok);
    return r;
  }

  function ok(extra = {}) { return { ok: true, phase: phaseName(), ...extra }; }
  function fail(message, code = 'E_REJECT') { lastError = message; return { ok: false, message, code, phase: phaseName() }; }

  function sync() {
    machine = new yao.Machine(ir);
    for (const t of tokens) {
      if (!t.ev) continue;
      const r = machine.step(t.ev, t.arg ?? 0);
      if (!r.ok) break;
    }
  }

  function ansToken() {
    const t = { k: 'const', v: 3, ev: '常数', arg: 3 };
    if (lastResult !== null) t.display = formatNumber(lastResult);
    return t;
  }

  function valueToken(value) {
    return { k: 'num', text: String(value), display: formatNumber(value), ev: '数字' };
  }

  function opToken(code) {
    return { k: 'op', v: code, ev: '运算符', arg: code };
  }

  // -------------------------------------------------------------- 按键

  function press(kind, payload) {
    lastError = null;
    const p = phaseId();

    switch (kind) {
      case 'digit': return inputDigit(String(payload), p);
      case 'dot': return inputDot(p);
      case 'op': return inputOp(payload, p);
      case 'lp': return inputLp(p);
      case 'rp': return inputRp(p);
      case 'const': return inputConst(payload, p);
      case 'fn': return inputFn(payload, p);
      case 'post': return inputPost(payload, p);
      case 'equals': return doEquals(p);
      case 'clear': return doClear();
      case 'back': return doBack(p);
      case 'error': step('出错'); return fail('已进入出错状态');
      default: return fail(`未知按键 “${kind}”`, 'E_KEY');
    }
  }

  function inputDigit(dig, p) {
    if (!/^[0-9]$/.test(dig)) return fail('不是数字');
    const r = step('数字');
    if (!r.ok) return fail(`「${phaseName()}」相位不能输入数字`);

    if (p === PHASE.结果 || p === PHASE.出错) tokens = [];
    const last = tokens[tokens.length - 1];
    if (p === PHASE.输入 && last && last.k === 'num') {
      last.text = last.text === '0' ? dig : last.text + dig;
      delete last.display;
      return ok();
    }
    tokens.push({ k: 'num', text: dig, ev: '数字' });
    return ok();
  }

  function inputDot(p) {
    const last = tokens[tokens.length - 1];
    if (p === PHASE.输入 && last && last.k === 'num') {
      if (last.text.includes('.')) return fail('一个数里只能有一个小数点');
    }
    const r = step('小数点');
    if (!r.ok) return fail(`「${phaseName()}」相位不能输入小数点`);

    if (p === PHASE.结果 || p === PHASE.出错) tokens = [];
    const tail = tokens[tokens.length - 1];
    if (p === PHASE.输入 && tail && tail.k === 'num') {
      if (!tail.text.includes('.')) tail.text += '.';
      return ok();
    }
    tokens.push({ k: 'num', text: '0.', ev: '小数点' });
    return ok();
  }

  function inputOp(code, p) {
    code = Number(code);
    if (!(code >= 1 && code <= 6)) return fail('没有这个运算符');
    if (p === PHASE.空白 || p === PHASE.括号) {
      return fail('表达式不能以运算符开头；要取负请按 ±');
    }
    const r = step('运算符', code);
    if (!r.ok) return fail(`「${phaseName()}」相位不能输入运算符`);

    if (p === PHASE.结果) tokens = [ansToken()];
    if (p === PHASE.待符) tokens[tokens.length - 1] = opToken(code);
    else tokens.push(opToken(code));
    return ok();
  }

  function inputLp(p) {
    const r = step('左括号');
    if (!r.ok) return fail('此处不能加左括号');
    if (phaseId() === PHASE.出错) {
      sync();
      return fail('括号嵌套超过 63 层');
    }
    if (p === PHASE.结果 || p === PHASE.出错) tokens = [];
    tokens.push({ k: 'lp', ev: '左括号' });
    return ok();
  }

  function inputRp(p) {
    if (p === PHASE.空白 || p === PHASE.括号 || p === PHASE.待符) {
      return fail('右括号没有匹配的左括号');
    }
    const r = step('右括号');
    if (!r.ok) return fail('此处不能加右括号');
    if (phaseId() === PHASE.出错) {
      sync();
      return fail('右括号没有匹配的左括号');
    }
    tokens.push({ k: 'rp', ev: '右括号' });
    return ok();
  }

  function inputConst(code, p) {
    code = Number(code);
    if (!CONSTS[code]) return fail('没有这个常数');
    const r = step('常数', code);
    if (!r.ok) return fail(`「${phaseName()}」相位不能插入常数`);
    if (p === PHASE.结果 || p === PHASE.出错) tokens = [];
    tokens.push({ k: 'const', v: code, ev: '常数', arg: code });
    return ok();
  }

  /**
   * 结果相位上按一元函数：像卡片计算器一样**立刻**算出新结果，
   * 而不是把函数挂在表达式上等下一个等号。
   */
  function applyImmediately(token) {
    const list = [valueToken(lastResult), token];
    const src = render(list, 'eval');
    try {
      const value = evaluate(src, { ans: lastResult ?? 0, angleMode, hooks });
      lastResult = value;
      tokens = [valueToken(value)];
      return ok({ value, text: formatNumber(value), expr: render(list, 'display') });
    } catch (err) {
      step('出错');
      return fail(err instanceof CalcError ? err.message : String(err.message), err.code ?? 'E_CALC');
    }
  }

  function inputFn(key, p) {
    const def = FUNCS[key];
    if (!def) return fail(`未知函数 “${key}”`);
    if (p === PHASE.结果) {
      const r0 = step(def.ev, def.arg);
      if (!r0.ok) return fail(`「${phaseName()}」相位不能求函数值`);
      return applyImmediately({ k: 'fn', v: key, ev: def.ev, arg: def.arg });
    }
    const r = step(def.ev, def.arg);
    if (!r.ok) return fail(`「${phaseName()}」相位不能对空表达式求函数值；先输入一个数`);
    tokens.push({ k: 'fn', v: key, ev: def.ev, arg: def.arg });
    return ok();
  }

  function inputPost(key, p) {
    const def = FUNCS[key];
    if (!def) return fail(`未知运算 “${key}”`);
    if (p === PHASE.结果) {
      const r0 = step(def.ev, def.arg);
      if (!r0.ok) return fail(`「${phaseName()}」相位不能施加这个运算`);
      return applyImmediately({ k: 'post', v: key, ev: def.ev, arg: def.arg });
    }
    const r = step(def.ev, def.arg);
    if (!r.ok) return fail(`「${phaseName()}」相位不能施加这个运算`);
    tokens.push({ k: 'post', v: key, ev: def.ev, arg: def.arg });
    return ok();
  }

  function doClear() {
    step('清除');
    tokens = [];
    lastError = null;
    return ok({ cleared: true });
  }

  function doBack(p) {
    if (p === PHASE.结果) return fail('等号之后不能退格；按 C 重新开始');
    if (p === PHASE.出错) return fail('出错状态按 C 重新开始');
    if (p === PHASE.空白) return fail('没有可删的内容');

    const last = tokens[tokens.length - 1];
    if (last && last.k === 'num' && last.text.length > 1) {
      last.text = last.text.slice(0, -1);
      delete last.display;
      return ok();
    }

    tokens.pop();
    sync();
    return ok({ removed: last?.k });
  }

  function doEquals(p) {
    if (p === PHASE.结果) return ok({ unchanged: true });
    if (p === PHASE.空白) return fail('还没有输入任何东西');
    if (p === PHASE.待符) return fail('运算符后面还缺一个操作数');

    // 括号没闭合：替用户补上右括号，每一步仍然走状态机
    let guard = 0;
    while (dong() > 0) {
      const r = step('右括号');
      if (!r.ok || phaseId() === PHASE.出错) {
        sync();
        return fail('括号不匹配，无法求值');
      }
      tokens.push({ k: 'rp', ev: '右括号' });
      if (++guard > 70) break;
    }

    const r = step('等号');
    if (!r.ok) return fail(`「${phaseName()}」相位不能求值`);

    const src = render(tokens, 'eval');
    if (!tokens.length) return fail('还没有输入任何东西');

    let value;
    try {
      value = evaluate(src, {
        ans: lastResult ?? 0,
        angleMode,
        hooks,
      });
    } catch (err) {
      step('出错');
      const message = err instanceof CalcError ? err.message : `计算失败：${err.message}`;
      return fail(message, err.code ?? 'E_CALC');
    }

    const exprText = render(tokens, 'display');
    lastResult = value;
    history.unshift({ expr: exprText, value, text: formatNumber(value) });
    if (history.length > 40) history.pop();

    tokens = [valueToken(value)];
    return ok({ value, text: formatNumber(value), expr: exprText });
  }

  // -------------------------------------------------------------- 对外

  function exprText() {
    return render(tokens, 'display');
  }

  function evalText() {
    return render(tokens, 'eval');
  }

  function preview() {
    const d = dong();
    return d > 0 ? ')'.repeat(d) : '';
  }

  /** 从别的面板塞一个结果进来（等价于「算完了一个数」） */
  function loadValue(value) {
    machine = new yao.Machine(ir);
    machine.step('数字');
    machine.step('等号');
    tokens = [valueToken(value)];
    lastResult = value;
    return ok({ value });
  }

  function setAngleMode(mode) {
    angleMode = mode === 'deg' ? 'deg' : 'rad';
    return angleMode;
  }

  return {
    press,
    loadValue,
    setAngleMode,
    get angleMode() { return angleMode; },
    get tokens() { return tokens; },
    get state() { return machine.state; },
    get phase() { return { id: phaseId(), name: phaseName() }; },
    get ben() { return ben(); },
    get dong() { return dong(); },
    get depth() { return dong(); },
    get bits() { return ben().toString(2).padStart(6, '0'); },
    get glyph() { return yao.glyphOf(ben()); },
    get hexagram() { return yao.nameOf(ben()); },
    get display() { return tokens.length ? exprText() : '0'; },
    get expression() { return exprText(); },
    get preview() { return preview(); },
    get lastResult() { return lastResult; },
    get history() { return history; },
    get log() { return log; },
    get lastError() { return lastError; },
    get machine() { return machine; },
    get ir() { return ir; },
    get tokensRef() { return tokens; },
    evalText,
    render,
    sync,
    clearHistory() { history = []; },
  };
}
