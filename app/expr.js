/**
 * 爻 · 算 —— 表达式层
 *
 * 这一层是「宿主语言」：爻只管按键序列合法不合法，
 * 浮点、函数、括号这些真正的算术在这里。
 *
 * 纯 ESM、零依赖，Node 与浏览器共用同一份源码。
 */

export class CalcError extends Error {
  constructor(message, code = 'E_CALC') {
    super(message);
    this.name = 'CalcError';
    this.code = code;
  }
}

/** 弯引号之类的「长得像运算符」的字符，统一折成 ASCII */
const CHAR_MAP = {
  '×': '*', '·': '*', '÷': '/', '−': '-', '–': '-', '—': '-',
  '，': ',', '（': '(', '）': ')', '：': ':', '＋': '+', '－': '-',
  '＊': '*', '／': '/', '＾': '^', '！': '!', '％': '%',
};

/** 在词法层直接换成一个标识符/记号 */
const ALIAS_CHAR = {
  'π': 'pi', '∞': 'inf', 'Σ': 'sum', '∫': 'integral',
};

const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'asin', 'acos', 'atan',
  'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'ln', 'lg', 'log', 'log2', 'log10', 'exp',
  'sqrt', 'cbrt', 'abs', 'sign',
  'floor', 'ceil', 'round', 'trunc',
  'min', 'max', 'mod', 'pow', 'fact', 'gcd', 'lcm',
  'integral', '积分', 'deriv', '导数',
]);

const CONSTANTS = new Set(['pi', 'e', 'tau', 'ans', 'x', 'phi']);

// ---------------------------------------------------------------- 词法

/**
 * @param {string} src
 * @returns {{t:string, v?:any, pos:number}[]}
 */
export function tokenize(src) {
  if (typeof src !== 'string') throw new CalcError('表达式必须是字符串', 'E_TYPE');
  const toks = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (/\s/.test(ch) || ch === '\u3000') { i++; continue; }

    if (ch >= '0' && ch <= '9') {
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      const text = m[0];
      toks.push({ t: 'num', v: Number(text), text, pos: i });
      i += text.length;
      continue;
    }

    if (ch === '.') {
      const m = /^\.\d+(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new CalcError('小数点后面缺少数字', 'E_SYNTAX');
      toks.push({ t: 'num', v: Number(m[0]), text: m[0], pos: i });
      i += m[0].length;
      continue;
    }

    if (/[A-Za-z_\u4e00-\u9fff]/.test(ch)) {
      const m = /^[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*/.exec(src.slice(i));
      const name = m[0];
      const lower = name.toLowerCase();
      const canon = FUNCTIONS.has(lower) ? lower : CONSTANTS.has(lower) ? lower : name;
      toks.push({ t: 'name', v: canon, text: name, pos: i });
      i += name.length;
      continue;
    }

    if (ALIAS_CHAR[ch]) {
      const name = ALIAS_CHAR[ch];
      toks.push({ t: 'name', v: name, text: ch, pos: i });
      i += 1;
      continue;
    }

    const mapped = CHAR_MAP[ch] ?? ch;
    if ('+-*/^%(),!'.includes(mapped)) {
      toks.push({ t: 'op', v: mapped, text: ch, pos: i });
      i += 1;
      continue;
    }

    if (ch === '²') { toks.push({ t: 'op', v: '²', text: ch, pos: i }); i++; continue; }
    if (ch === '³') { toks.push({ t: 'op', v: '³', text: ch, pos: i }); i++; continue; }
    if (ch === '√') { toks.push({ t: 'op', v: '√', text: ch, pos: i }); i++; continue; }
    if (ch === '∛') { toks.push({ t: 'op', v: '∛', text: ch, pos: i }); i++; continue; }

    throw new CalcError(`无法识别的字符 “${ch}”`, 'E_SYNTAX');
  }

  toks.push({ t: 'eof', v: null, pos: src.length });
  return toks;
}

// ---------------------------------------------------------------- 语法

const BIN_PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2 };

class ExprParser {
  constructor(toks) {
    this.toks = toks;
    this.i = 0;
  }

  peek(k = 0) { return this.toks[this.i + k]; }
  next() { return this.toks[this.i++]; }
  isOp(v) { const t = this.peek(); return t.t === 'op' && t.v === v; }
  eatOp(v) { if (this.isOp(v)) { this.i++; return true; } return false; }
  expectOp(v) {
    if (!this.eatOp(v)) throw new CalcError(`缺少 “${v}”`, 'E_SYNTAX');
  }

  startsPrimary(t) {
    if (t.t === 'num') return true;
    if (t.t === 'name') return true;
    if (t.t === 'op' && t.v === '(') return true;
    return false;
  }

  parse() {
    if (this.peek().t === 'eof') throw new CalcError('表达式是空的', 'E_EMPTY');
    const node = this.parseExpr();
    if (this.peek().t !== 'eof') {
      const t = this.peek();
      throw new CalcError(`多余的内容 “${t.text ?? t.v}”`, 'E_SYNTAX');
    }
    return node;
  }

  parseExpr() { return this.parseAdd(); }

  parseAdd() {
    let left = this.parseMul();
    for (;;) {
      const t = this.peek();
      if (t.t !== 'op' || (t.v !== '+' && t.v !== '-')) break;
      this.i++;
      const right = this.parseMul();
      left = { t: 'bin', op: t.v, l: left, r: right };
    }
    return left;
  }

  parseMul() {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.t === 'op' && BIN_PREC[t.v] >= 2) {
        this.i++;
        left = { t: 'bin', op: t.v, l: left, r: this.parseUnary() };
        continue;
      }
      // 隐式乘法：2π、3(4+5)、2sin(30)
      if (this.startsPrimary(t)) {
        left = { t: 'bin', op: '*', l: left, r: this.parseUnary(), implicit: true };
        continue;
      }
      break;
    }
    return left;
  }

  parseUnary() {
    if (this.isOp('-')) { this.i++; return { t: 'neg', x: this.parseUnary() }; }
    if (this.isOp('+')) { this.i++; return this.parseUnary(); }
    if (this.isOp('√')) { this.i++; return { t: 'call', name: 'sqrt', args: [this.parseUnary()] }; }
    if (this.isOp('∛')) { this.i++; return { t: 'call', name: 'cbrt', args: [this.parseUnary()] }; }
    return this.parsePower();
  }

  parsePower() {
    const base = this.parsePostfix();
    if (this.isOp('^')) {
      this.i++;
      return { t: 'bin', op: '^', l: base, r: this.parseUnary() };
    }
    return base;
  }

  parsePostfix() {
    let node = this.parsePrimary();
    for (;;) {
      if (this.isOp('!')) { this.i++; node = { t: 'post', op: 'fact', x: node }; continue; }
      if (this.isOp('²')) { this.i++; node = { t: 'bin', op: '^', l: node, r: { t: 'num', v: 2 } }; continue; }
      if (this.isOp('³')) { this.i++; node = { t: 'bin', op: '^', l: node, r: { t: 'num', v: 3 } }; continue; }
      break;
    }
    return node;
  }

  parsePrimary() {
    const t = this.peek();

    if (t.t === 'num') { this.i++; return { t: 'num', v: t.v }; }

    if (t.t === 'op' && t.v === '(') {
      this.i++;
      const inner = this.parseExpr();
      this.expectOp(')');
      return inner;
    }

    if (t.t === 'name') {
      this.i++;
      const name = t.v;

      if (this.eatOp('(')) {
        const args = [];
        if (!this.isOp(')')) {
          for (;;) {
            args.push(this.parseExpr());
            if (this.eatOp(',')) continue;
            break;
          }
        }
        this.expectOp(')');
        if (!FUNCTIONS.has(name)) throw new CalcError(`未知函数 “${name}”`, 'E_NAME');
        return { t: 'call', name, args };
      }

      if (CONSTANTS.has(name)) return { t: 'var', name };
      if (FUNCTIONS.has(name)) {
        throw new CalcError(`函数 “${name}” 后面缺少括号和参数`, 'E_SYNTAX');
      }
      throw new CalcError(`未知的名字 “${name}”`, 'E_NAME');
    }

    if (t.t === 'eof') throw new CalcError('表达式不完整', 'E_SYNTAX');
    throw new CalcError(`此处不应出现 “${t.text ?? t.v}”`, 'E_SYNTAX');
  }
}

/** @param {string} src */
export function parseExpression(src) {
  return new ExprParser(tokenize(src)).parse();
}

// ---------------------------------------------------------------- 求值

const DEG = Math.PI / 180;

function toRad(v, mode) { return mode === 'deg' ? v * DEG : v; }
function fromRad(v, mode) { return mode === 'deg' ? v / DEG : v; }

function need(cond, message) {
  if (!cond) throw new CalcError(message, 'E_DOMAIN');
}

function factorial(n) {
  need(Number.isInteger(n), '阶乘只对非负整数有定义');
  need(n >= 0 && n <= 170, '阶乘的定义域是 0..170');
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

/** 一元/多元函数表（角度模式只影响三角与反三角） */
function applyFunction(name, args, mode) {
  const a = (k = 0) => {
    if (args.length <= k) throw new CalcError(`“${name}” 缺少第 ${k + 1} 个参数`, 'E_ARITY');
    return args[k];
  };

  switch (name) {
    case 'sin': return Math.sin(toRad(a(), mode));
    case 'cos': return Math.cos(toRad(a(), mode));
    case 'tan': {
      const r = toRad(a(), mode);
      need(Math.abs(Math.cos(r)) > 1e-12, 'tan 在该点无定义');
      return Math.tan(r);
    }
    case 'cot': { const r = toRad(a(), mode); need(Math.abs(Math.sin(r)) > 1e-12, 'cot 在该点无定义'); return 1 / Math.tan(r); }
    case 'sec': { const r = toRad(a(), mode); need(Math.abs(Math.cos(r)) > 1e-12, 'sec 在该点无定义'); return 1 / Math.cos(r); }
    case 'csc': { const r = toRad(a(), mode); need(Math.abs(Math.sin(r)) > 1e-12, 'csc 在该点无定义'); return 1 / Math.sin(r); }

    case 'asin': { need(a() >= -1 && a() <= 1, 'asin 的参数必须在 [-1, 1] 内'); return fromRad(Math.asin(a()), mode); }
    case 'acos': { need(a() >= -1 && a() <= 1, 'acos 的参数必须在 [-1, 1] 内'); return fromRad(Math.acos(a()), mode); }
    case 'atan': return fromRad(Math.atan(a()), mode);

    case 'sinh': return Math.sinh(a());
    case 'cosh': return Math.cosh(a());
    case 'tanh': return Math.tanh(a());
    case 'asinh': return Math.asinh(a());
    case 'acosh': need(a() >= 1, 'acosh 的参数必须 ≥ 1'); return Math.acosh(a());
    case 'atanh': need(Math.abs(a()) < 1, 'atanh 的参数必须在 (-1, 1) 内'); return Math.atanh(a());

    case 'ln': need(a() > 0, 'ln 的真数必须大于 0'); return Math.log(a());
    case 'lg':
    case 'log10':
      need(a() > 0, 'lg 的真数必须大于 0'); return Math.log10(a());
    case 'log': {
      if (args.length === 1) { need(a() > 0, 'log 的真数必须大于 0'); return Math.log10(a()); }
      need(a() > 0, 'log 的真数必须大于 0');
      const b = a(1);
      need(b > 0 && b !== 1, 'log 的底数必须大于 0 且不等于 1');
      return Math.log(a()) / Math.log(b);
    }
    case 'log2': need(a() > 0, 'log₂ 的真数必须大于 0'); return Math.log2(a());
    case 'exp': return Math.exp(a());

    case 'sqrt': need(a() >= 0, '√ 的参数不能为负'); return Math.sqrt(a());
    case 'cbrt': return Math.cbrt(a());
    case 'abs': return Math.abs(a());
    case 'sign': return Math.sign(a());
    case 'floor': return Math.floor(a());
    case 'ceil': return Math.ceil(a());
    case 'round': return Math.round(a());
    case 'trunc': return Math.trunc(a());

    case 'min': need(args.length >= 1, 'min 至少需要一个参数'); return Math.min(...args);
    case 'max': need(args.length >= 1, 'max 至少需要一个参数'); return Math.max(...args);
    case 'pow': return Math.pow(a(), a(1));
    case 'mod': { const d = a(1); need(d !== 0, '取余的除数不能为 0'); return ((a() % d) + d) % d; }
    case 'fact': return factorial(a());
    case 'gcd': return gcd(Math.abs(Math.trunc(a())), Math.abs(Math.trunc(a(1))));
    case 'lcm': {
      const x = Math.abs(Math.trunc(a())), y = Math.abs(Math.trunc(a(1)));
      need(x !== 0 && y !== 0, 'lcm 不接受 0');
      return (x / gcd(x, y)) * y;
    }

    default:
      throw new CalcError(`“${name}” 还没实现`, 'E_NAME');
  }
}

function gcd(a, b) { while (b) { const t = a % b; a = b; b = t; } return a || 1; }

/**
 * 求值。
 * @param {object} node  parseExpression / parse 出来的 AST
 * @param {object} [ctx]
 * @param {number} [ctx.x]     变量 x（微积分用）
 * @param {number} [ctx.ans]   上一次结果
 * @param {'rad'|'deg'} [ctx.angleMode]
 * @param {{integrate?:Function, derivative?:Function}} [ctx.hooks]
 * @returns {number}
 */
export function evaluateAst(node, ctx = {}) {
  const mode = ctx.angleMode === 'deg' ? 'deg' : 'rad';
  const hooks = ctx.hooks ?? {};

  const go = (n) => {
    switch (n.t) {
      case 'num': return n.v;

      case 'var': {
        switch (n.name) {
          case 'pi': return Math.PI;
          case 'e': return Math.E;
          case 'tau': return Math.PI * 2;
          case 'phi': return (1 + Math.sqrt(5)) / 2;
          case 'ans': return ctx.ans ?? 0;
          case 'x': {
            if (ctx.x === undefined) throw new CalcError('这里的 x 没有取值（只有在微积分里才有）', 'E_NAME');
            return ctx.x;
          }
          default: throw new CalcError(`未知的常量 “${n.name}”`, 'E_NAME');
        }
      }

      case 'neg': return -go(n.x);
      case 'post': {
        if (n.op === 'fact') return factorial(go(n.x));
        throw new CalcError(`未知的后缀运算 “${n.op}”`, 'E_CODE');
      }

      case 'bin': {
        const a = go(n.l);
        const b = go(n.r);
        switch (n.op) {
          case '+': return a + b;
          case '-': return a - b;
          case '*': return a * b;
          case '/':
            if (b === 0) throw new CalcError('除数不能为 0', 'E_ZERO');
            return a / b;
          case '%':
            if (b === 0) throw new CalcError('取余的除数不能为 0', 'E_ZERO');
            return ((a % b) + b) % b;
          case '^': {
            if (a < 0 && !Number.isInteger(b)) throw new CalcError('负数的非整数次幂不在实数范围内', 'E_DOMAIN');
            return Math.pow(a, b);
          }
          default: throw new CalcError(`未知运算符 “${n.op}”`, 'E_CODE');
        }
      }

      case 'call': {
        // 微积分在 AST 上直接取子表达式，交给宿主数值库
        if (n.name === 'integral' || n.name === '积分') {
          need(n.args.length === 3, '∫ 需要三个参数：∫(f(x), 下限, 上限)');
          if (typeof hooks.integrate !== 'function') throw new CalcError('积分器不可用', 'E_HOOK');
          const a = go(n.args[1]);
          const b = go(n.args[2]);
          return hooks.integrate((v) => evaluateAst(n.args[0], { ...ctx, x: v }), a, b);
        }
        if (n.name === 'deriv' || n.name === '导数') {
          need(n.args.length === 2, 'd 需要两个参数：d(f(x), x₀)');
          if (typeof hooks.derivative !== 'function') throw new CalcError('求导器不可用', 'E_HOOK');
          const x0 = go(n.args[1]);
          return hooks.derivative((v) => evaluateAst(n.args[0], { ...ctx, x: v }), x0);
        }

        const args = n.args.map(go);
        const v = applyFunction(n.name, args, mode);
        if (Number.isNaN(v)) throw new CalcError('结果未定义（NaN）', 'E_NAN');
        if (!Number.isFinite(v)) throw new CalcError('结果超出浮点数范围', 'E_OVERFLOW');
        return v;
      }

      default:
        throw new CalcError(`未知的表达式节点 “${n.t}”`, 'E_CODE');
    }
  };

  const value = go(node);
  if (Number.isNaN(value)) throw new CalcError('结果未定义（NaN）', 'E_NAN');
  if (!Number.isFinite(value)) throw new CalcError('结果超出浮点数范围', 'E_OVERFLOW');
  return value;
}

/**
 * 一步到位：字符串 → 数。
 */
export function evaluate(src, ctx = {}) {
  return evaluateAst(parseExpression(src), ctx);
}

/** 收集表达式里用到的变量（微积分面板据此判断要不要 x） */
export function variablesOf(node, out = new Set()) {
  switch (node.t) {
    case 'var': out.add(node.name); break;
    case 'neg': variablesOf(node.x, out); break;
    case 'post': variablesOf(node.x, out); break;
    case 'bin': variablesOf(node.l, out); variablesOf(node.r, out); break;
    case 'call': for (const a of node.args) variablesOf(a, out); break;
    default: break;
  }
  return out;
}

// ---------------------------------------------------------------- 显示

/**
 * 数字 → 人能读的短字符串。
 * 12 位有效数字；过大/过小时用科学计数法。
 */
export function formatNumber(v, digits = 12) {
  if (typeof v !== 'number' || Number.isNaN(v)) return 'NaN';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '-∞';
  if (v === 0) return '0';

  const a = Math.abs(v);
  if (a >= 1e12 || a < 1e-9) {
    const exp = v.toExponential(Math.min(Math.max(digits - 1, 1), 17));
    const [mant, e] = exp.split('e');
    const m = mant.replace(/\.?0+$/, '');
    const sign = e[0] === '-' ? '-' : '+';
    const num = e.slice(1).replace(/^0+/, '') || '0';
    return `${m}e${sign}${num}`;
  }

  let s = v.toPrecision(Math.min(Math.max(digits, 1), 17));
  if (s.includes('e')) {
    let [mant, e] = s.split('e');
    mant = mant.replace(/\.?0+$/, '');
    const sign = e[0] === '-' ? '-' : '+';
    return `${mant}e${sign}${e.slice(1).replace(/^0+/, '') || '0'}`;
  }
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  return s;
}

/** 结果里给「复制」用的全精度形式 */
export function fullPrecision(v) {
  if (!Number.isFinite(v)) return String(v);
  return String(v);
}
