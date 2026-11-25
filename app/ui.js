/**
 * 爻 · 算 —— 界面层
 *
 * 每次按键都先过 engine.press()（内部就是 state machine.step），
 * 被机器拒绝的键只会响一声、抖一下，绝不改表达式。
 */

(function () {
  const YAO = globalThis.__YAO__;
  const SRC = globalThis.__YAO_CALC_SRC__ || '';
  const $ = (id) => document.getElementById(id);

  const engine = createEngine({
    yao: YAO,
    source: SRC,
    hooks: {
      integrate: (f, a, b) => integrate(f, a, b).value,
      derivative: (f, x0) => derivative(f, x0).value,
    },
  });

  // 给自动化测试 / 控制台留个入口
  globalThis.__CALC__ = engine;

  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // -------------------------------------------------------------- 键盘布局

  const SCI = [
    ['sin', 'fn', 'sin'],
    ['cos', 'fn', 'cos'],
    ['tan', 'fn', 'tan'],
    ['ln', 'fn', 'ln'],
    ['lg', 'fn', 'lg'],
    ['log₂', 'fn', 'log2'],

    ['asin', 'fn', 'asin'],
    ['acos', 'fn', 'acos'],
    ['atan', 'fn', 'atan'],
    ['eˣ', 'fn', 'exp'],
    ['10ˣ', 'fn', 'pow10'],
    ['√', 'fn', 'sqrt'],

    ['x²', 'post', 'sq'],
    ['x³', 'post', 'cube'],
    ['x!', 'post', 'fact'],
    ['1/x', 'post', 'recip'],
    ['|x|', 'fn', 'abs'],
    ['±', 'post', 'neg'],

    ['∛', 'fn', 'cbrt'],
    ['xʸ', 'op', 5],
    ['mod', 'op', 6],
    ['Ans', 'const', 3],
    ['π', 'const', 1],
    ['e', 'const', 2],
  ];

  const CORE = [
    ['DEL', 'back', undefined, 'del'],
    ['C', 'clear', undefined, 'clear'],
    ['(', 'lp', undefined, 'op'],
    [')', 'rp', undefined, 'op'],

    ['7', 'digit', '7'],
    ['8', 'digit', '8'],
    ['9', 'digit', '9'],
    ['÷', 'op', 4, 'op'],

    ['4', 'digit', '4'],
    ['5', 'digit', '5'],
    ['6', 'digit', '6'],
    ['×', 'op', 3, 'op'],

    ['1', 'digit', '1'],
    ['2', 'digit', '2'],
    ['3', 'digit', '3'],
    ['−', 'op', 2, 'op'],

    ['0', 'digit', '0'],
    ['.', 'dot', undefined, ''],
    ['+', 'op', 1, 'op'],
    ['=', 'equals', undefined, 'eq'],
  ];

  const TITLE = {
    sin: '正弦', cos: '余弦', tan: '正切',
    asin: '反正弦', acos: '反余弦', atan: '反正切',
    ln: '自然对数 ln', lg: '常用对数 lg (log₁₀)', log2: '以 2 为底的对数',
    exp: 'e 的幂', pow10: '10 的幂', sqrt: '平方根', cbrt: '立方根',
    sq: '平方', cube: '立方', fact: '阶乘', recip: '倒数', abs: '绝对值', neg: '取负',
  };

  function makeKey(label, kind, value, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'key' + (cls ? ' ' + cls : '') + (kind === 'fn' || kind === 'post' ? ' sci-key' : '');
    b.textContent = label;
    if (kind === 'fn' || kind === 'post') b.title = TITLE[value] || value;
    b.addEventListener('click', (e) => {
      e.preventDefault();
      press(kind, value, b);
      b.blur();
    });
    return b;
  }

  const sciEl = document.createElement('div');
  sciEl.className = 'sci';
  for (const [label, kind, value] of SCI) sciEl.appendChild(makeKey(label, kind, value));
  $('pad').appendChild(sciEl);

  const coreEl = document.createElement('div');
  coreEl.className = 'core';
  for (const [label, kind, value, cls] of CORE) coreEl.appendChild(makeKey(label, kind, value, cls));
  $('pad').appendChild(coreEl);

  // -------------------------------------------------------------- 提示条

  let hintTimer = null;
  const hintEl = $('hint');
  const DEFAULT_HINT = '先输入数字，再按函数或运算符。括号没闭合时按 = 会自动补齐。';

  function hint(text, kind = '') {
    hintEl.textContent = text;
    hintEl.className = 'hint ' + kind;
    clearTimeout(hintTimer);
    if (kind) hintTimer = setTimeout(() => { hintEl.textContent = DEFAULT_HINT; hintEl.className = 'hint'; }, 3200);
  }

  function reject(el) {
    if (el) {
      el.classList.remove('reject');
      void el.offsetWidth;
      el.classList.add('reject');
      setTimeout(() => el.classList.remove('reject'), 340);
    }
    const scr = document.querySelector('.screen');
    scr.classList.remove('shake');
    void scr.offsetWidth;
    scr.classList.add('shake');
    setTimeout(() => scr.classList.remove('shake'), 320);
  }

  function press(kind, value, el) {
    const r = engine.press(kind, value);
    peek = null;
    if (!r.ok) {
      reject(el);
      hint('此路不通：' + (r.message || '该相位不接受这个键'), 'err');
    } else if (kind === 'equals' && r.value !== undefined) {
      hint(r.text !== undefined ? `= ${r.text}` : '', 'ok');
    } else if (kind === 'clear') {
      hint('已清空', '');
    } else {
      hint('', '');
    }
    update();
    return r;
  }

  // -------------------------------------------------------------- 渲染

  const exprEl = $('expr');
  const phasePill = $('phase-pill');
  const depthPill = $('depth-pill');
  const anglePill = $('angle-pill');

  const mPhase = $('m-phase');
  const mCode = $('m-code');
  const mGlyph = $('m-glyph');
  const mGua = $('m-gua');
  const mBits = $('m-bits');
  const mDepthFill = $('m-depth-fill');
  const mDepthVal = $('m-depth-val');
  const mLog = $('m-log');
  const mSteps = $('m-steps');

  const POS = ['初', '二', '三', '四', '五', '上'];
  const bitEls = POS.map((p, i) => {
    const d = document.createElement('div');
    d.className = 'bit';
    d.title = `${p}爻 · bit ${i}`;
    d.innerHTML = '<b>0</b>';
    mBits.appendChild(d);
    return d;
  });

  // ------------------------------------------------------------ 相位面板

  const PHASE_DESC = [
    '还没输入任何东西',
    '一个操作数刚结束',
    '等右操作数',
    '等括号里的内容',
    '一个括号组刚闭合',
    '等号算完了',
    '等 C 或数字重来',
  ];

  const EVENT_LABEL = {
    数字: '0-9',
    小数点: '.',
    运算符: '+ − × ÷ ^ mod',
    左括号: '(',
    右括号: ')',
    常数: 'π e Ans',
    三角函数: 'sin cos tan',
    对数函数: 'ln lg log₂',
    幂函数: '√ x² 1/x',
    阶乘: 'x!',
    负号: '±',
    等号: '=',
    清除: 'C',
  };

  const pillsEl = $('phase-pills');
  const phasePills = PHASE_NAMES.map((name, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'phase-pill';
    b.textContent = name;
    b.title = PHASE_DESC[i];
    b.addEventListener('click', () => {
      peek = peek === i ? null : i;
      renderPhases();
    });
    pillsEl.appendChild(b);
    return b;
  });

  let peek = null;

  function renderPhases() {
    const cur = engine.ben;
    const shown = peek === null ? cur : peek;

    phasePills.forEach((b, i) => {
      b.classList.toggle('on', i === cur);
      b.classList.toggle('peek', peek !== null && i === shown);
    });

    $('pn-title').textContent = peek === null
      ? `现在处于「${PHASE_NAMES[cur]}」相位 · ${PHASE_DESC[cur]}`
      : `查看「${PHASE_NAMES[shown]}」相位 · ${PHASE_DESC[shown]}（再点一次回到当前）`;

    const groups = engine.machine.groups;
    const allowed = engine.ir.events.filter((ev) => {
      if (ev.name === '出错') return false;
      const g = groups.get(ev.name);
      return g && (g.specific.has(shown) || g.wildcard);
    });

    $('phase-keys').innerHTML = allowed.length
      ? allowed.map((ev) => `<span class="k">${esc(EVENT_LABEL[ev.name] ?? ev.name)}</span>`).join('')
      : '<span class="none">这个相位没有可接受的键</span>';
  }

  function updateMachineLog() {
    const rows = engine.log.slice(-7).reverse();
    if (!rows.length) {
      mLog.innerHTML = '<li><span class="empty">等一次按键</span><span></span></li>';
      return;
    }
    mLog.innerHTML = rows
      .map((r) => {
        const from = PHASE_NAMES[YAO.ben(r.from)] || '?';
        const to = r.ok ? PHASE_NAMES[YAO.ben(r.to)] || '?' : null;
        const ev = r.ev + (r.arg ? `(${r.arg})` : '');
        const right = r.ok
          ? `<span class="to">${esc(to)}</span>`
          : `<span class="ev fail">此路不通</span>`;
        return `<li><span><span class="ev${r.ok ? '' : ' fail'}">${esc(ev)}</span><span class="arrow">→</span>${right}</span><span class="muted">${esc(from)}</span></li>`;
      })
      .join('');
  }

  let historyStamp = '';

  function updateHistory() {
    const h = engine.history;
    const stamp = h.map((x) => x.expr + x.text).join('|');
    if (stamp === historyStamp) return;
    historyStamp = stamp;
    const tape = $('tape');
    if (!h.length) {
      tape.innerHTML = '<li class="empty">还没有计算记录。按 = 之后，算式会落在这里。</li>';
      return;
    }
    tape.innerHTML = h
      .map(
        (item, i) =>
          `<li data-i="${i}" title="点击把这个结果送回计算器"><span class="h-expr">${esc(item.expr)}</span><span class="h-val">${esc(item.text)}</span></li>`
      )
      .join('');
  }

  function update() {
    const text = engine.display;
    const ghost = engine.preview;
    exprEl.innerHTML = esc(text || '0') + (ghost ? `<span class="ghost">${esc(ghost)}</span>` : '');

    const isErr = engine.phase.id === 6;
    phasePill.textContent = engine.phase.name;
    phasePill.className = 'pill' + (isErr ? ' error' : '');
    depthPill.textContent = `括号 ${engine.depth}`;
    anglePill.textContent = engine.angleMode === 'deg' ? 'DEG' : 'RAD';

    mPhase.textContent = engine.phase.name;
    mCode.textContent = `相位 ${engine.ben}`;
    mGlyph.textContent = engine.glyph;
    const bits = engine.bits;
    mGua.textContent = `${engine.hexagram} · 本 ${bits} · 动 ${engine.depth}`;

    for (let i = 0; i < 6; i++) {
      const yang = bits[5 - i] === '1';
      bitEls[i].className = 'bit ' + (yang ? 'yang' : 'yin');
      bitEls[i].innerHTML = `<b>${bits[5 - i]}</b>`;
    }

    mDepthFill.style.width = `${Math.min(100, (engine.depth / 63) * 100)}%`;
    mDepthVal.textContent = engine.depth;
    mSteps.textContent = `${engine.machine.stepCount} 步`;

    updateMachineLog();
    updateHistory();
    renderPhases();
  }

  // -------------------------------------------------------------- 历史点击

  $('tape').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    const item = engine.history[Number(li.dataset.i)];
    if (!item) return;
    engine.loadValue(item.value);
    hint(`已取回 ${item.text}`, 'ok');
    update();
    document.querySelector('.screen').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  $('clear-history').addEventListener('click', () => {
    engine.clearHistory();
    updateHistory();
    hint('历史已清空');
  });

  // -------------------------------------------------------------- 角度制

  const angleBtn = $('angle-btn');
  angleBtn.addEventListener('click', () => {
    const next = engine.angleMode === 'deg' ? 'rad' : 'deg';
    engine.setAngleMode(next);
    angleBtn.textContent = next === 'deg' ? 'DEG' : 'RAD';
    angleBtn.classList.toggle('on', next === 'deg');
    hint(next === 'deg' ? '三角函数按角度制计算' : '三角函数按弧度制计算', 'ok');
    update();
  });

  // -------------------------------------------------------------- 复制

  $('copy-btn').addEventListener('click', async () => {
    const v = engine.lastResult;
    if (v === null || v === undefined) {
      hint('还没有结果可复制', 'err');
      return;
    }
    const txt = String(v);
    try {
      await navigator.clipboard.writeText(txt);
      hint(`已复制 ${txt}`, 'ok');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); hint(`已复制 ${txt}`, 'ok'); }
      catch { hint('复制失败，请手动选择', 'err'); }
      document.body.removeChild(ta);
    }
  });

  // -------------------------------------------------------------- 微积分

  let tabs = document.querySelectorAll('.tab');
  tabs.forEach((t) =>
    t.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.toggle('active', x === t));
      $('form-int').classList.toggle('hidden', t.dataset.tab !== 'int');
      $('form-der').classList.toggle('hidden', t.dataset.tab !== 'der');
    })
  );

  let intResult = null;
  let derResult = null;

  function readNumber(id, label) {
    const raw = $(id).value.trim();
    if (!raw) throw new CalcError(`${label} 不能为空`);
    return evaluate(raw, { angleMode: engine.angleMode, ans: engine.lastResult ?? 0 });
  }

  $('int-go').addEventListener('click', () => {
    const out = $('int-out');
    $('int-fill').disabled = true;
    intResult = null;
    try {
      const { f } = compileFunction($('int-f').value.trim(), { angleMode: engine.angleMode });
      const a = readNumber('int-a', '下限');
      const b = readNumber('int-b', '上限');
      const r = integrate(f, a, b);
      intResult = r;
      out.innerHTML =
        `<span class="big">${esc(formatNumber(r.value, 12))}</span><br>` +
        `<span class="k">区间</span> [${esc(formatNumber(a, 8))}, ${esc(formatNumber(b, 8))}] ` +
        `<span class="k">·</span> ${r.evals} 次求值 <span class="k">·</span> ${r.segments} 段 ` +
        `<span class="k">·</span> 误差估计 ${esc(r.error.toExponential(1))} ` +
        `<span class="k">·</span> ${r.converged ? '已收敛' : '未收敛（可能不光滑）'}`;
      $('int-fill').disabled = false;
    } catch (err) {
      out.innerHTML = `<span class="err">${esc(err.message)}</span>`;
    }
  });

  $('der-go').addEventListener('click', () => {
    const out = $('der-out');
    $('der-fill').disabled = true;
    derResult = null;
    try {
      const { f } = compileFunction($('der-f').value.trim(), { angleMode: engine.angleMode });
      const x0 = readNumber('der-x', '求导点');
      const r = derivative(f, x0);
      derResult = r;
      out.innerHTML =
        `<span class="big">${esc(formatNumber(r.value, 12))}</span><br>` +
        `<span class="k">在 x =</span> ${esc(formatNumber(x0, 10))} ` +
        `<span class="k">·</span> h = ${esc(r.h.toExponential(1))} ` +
        `<span class="k">·</span> ${r.evals} 次求值 ` +
        `<span class="k">·</span> ${r.converged ? 'Richardson 已收敛' : '未完全收敛（该点可能不可导）'}`;
      $('der-fill').disabled = false;
    } catch (err) {
      out.innerHTML = `<span class="err">${esc(err.message)}</span>`;
    }
  });

  function fill(v) {
    engine.loadValue(v);
    update();
    hint(`已填入 ${formatNumber(v)}`, 'ok');
    document.querySelector('.calc').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('int-fill').addEventListener('click', () => intResult && fill(intResult.value));
  $('der-fill').addEventListener('click', () => derResult && fill(derResult.value));

  $('m-src').textContent = SRC;

  // -------------------------------------------------------------- 物理键盘

  const KEYMAP = {
    '+': ['op', 1], '-': ['op', 2], '*': ['op', 3], '/': ['op', 4],
    '^': ['op', 5], '%': ['op', 6], 'x': ['op', 3],
    '(': ['lp'], ')': ['rp'], '.': ['dot'], ',': ['dot'],
    'Enter': ['equals'], '=': ['equals'],
    'Backspace': ['back'], 'Escape': ['clear'], 'Delete': ['clear'],
    'p': ['const', 1], 'e': ['const', 2], 'a': ['const', 3],
    's': ['fn', 'sin'], 'c': ['fn', 'cos'], 't': ['fn', 'tan'],
    'l': ['fn', 'ln'], 'g': ['fn', 'lg'], 'r': ['fn', 'sqrt'],
    '!': ['post', 'fact'], 'q': ['post', 'sq'],
  };

  window.addEventListener('keydown', (e) => {
    const el = e.target;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      press('digit', e.key);
      return;
    }
    const m = KEYMAP[e.key];
    if (!m) return;
    e.preventDefault();
    press(m[0], m[1]);
  });

  // -------------------------------------------------------------- 启动

  angleBtn.textContent = engine.angleMode === 'deg' ? 'DEG' : 'RAD';
  angleBtn.classList.toggle('on', engine.angleMode === 'deg');
  hint(DEFAULT_HINT);
  update();
})();
