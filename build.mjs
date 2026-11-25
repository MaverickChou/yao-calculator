#!/usr/bin/env node
/**
 * 把 yao 内核 + 计算器源码 + 页面打包成**一个 HTML 文件**。
 *
 * 与仓库自带的 tools/build_web.mjs 同一种做法：内核是纯 ESM，
 * 唯一的 Node 依赖是 core.js 里读 hexagrams.json 的那一句，
 * 这里换成内联数据。替换点找不到就直接报错，不产出「只能在 Node 跑」的坏包。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const VENDOR = join(ROOT, 'vendor', 'yao-lang');
const OUT = join(ROOT, 'docs', 'index.html');

function ensureVendor() {
  if (!existsSync(join(VENDOR, 'src', 'core.js'))) {
    throw new Error(
      `找不到 ${join(VENDOR, 'src')}。\n` +
        '这是 git submodule，第一次拉下来要初始化：\n' +
        '  git submodule update --init --recursive\n' +
        '（或者克隆时直接 git clone --recursive <repo>）'
    );
  }
}

/** 只带上计算器真正用到的六个文件 */
const KERNEL = ['core.js', 'evalast.js', 'lex.js', 'parse.js', 'ir.js', 'interp.js'];
const APP = ['expr.js', 'calculus.js', 'engine.js', 'ui.js'];

function stripModuleSyntax(src, file) {
  const out = src
    .replace(/^import\s*\{[^}]*\}\s*from\s*['"][^'"]*['"];?[ \t]*$/gm, '')
    .replace(/^import\s+[^;{]*from\s*['"][^'"]*['"];?[ \t]*$/gm, '')
    .replace(/^import\s+['"][^'"]*['"];?[ \t]*$/gm, '')
    .replace(/^export\s*\{[^}]*\};?[ \t]*$/gm, '')
    .replace(/^export\s+(?=(const|let|var|function|class|async))/gm, '');

  const leftover = out.split('\n').find((l) => /^(import|export)\s/.test(l));
  if (leftover) throw new Error(`${file}: 还有没剥掉的模块语法 → ${leftover.trim()}`);
  return out;
}

function patchData(src, file) {
  const before = src;
  let out = src.replace(
    "JSON.parse(readFileSync(DATA_URL, 'utf8'))",
    'globalThis.__YAO_DATA__.hexagrams'
  );
  if (file === 'core.js' && out === before) {
    throw new Error('core.js 的数据读取点没匹配上，打包会产出坏包');
  }
  if (file === 'core.js') {
    // import.meta 只在 module 里合法；数据已经内联，这个 URL 不再需要
    const stripped = out.replace(
      /^const DATA_URL = .*import\.meta\.url.*$/m,
      "const DATA_URL = 'data/hexagrams.json';"
    );
    if (stripped === out) throw new Error('core.js 里的 DATA_URL 没匹配上');
    out = stripped;
  }
  return out;
}

export function buildHtml() {
  ensureVendor();
  const data = {
    hexagrams: JSON.parse(readFileSync(join(VENDOR, 'data', 'hexagrams.json'), 'utf8')),
  };
  const calcSource = readFileSync(join(ROOT, 'calc.yao'), 'utf8');

  const parts = [];
  parts.push('/* 由 build.mjs 生成，请勿手工修改。 */');
  parts.push('"use strict";');
  parts.push(`globalThis.__YAO_DATA__ = ${JSON.stringify(data)};`);
  parts.push(`globalThis.__YAO_CALC_SRC__ = ${JSON.stringify(calcSource)};`);

  for (const f of KERNEL) {
    const src = patchData(readFileSync(join(VENDOR, 'src', f), 'utf8'), f);
    parts.push(`\n/* ───────── yao/src/${f} ───────── */`);
    parts.push(stripModuleSyntax(src, f));
  }

  parts.push(`
globalThis.__YAO__ = {
  ben, dong, zhi, bian, cuo, zong, hu,
  nameOf, glyphOf, meta, HEXAGRAMS, BY_ID, BY_NAME, POS_NAMES,
  parse, buildIr, Machine, trace, evalAst, lex, renderLines,
};
`);

  for (const f of APP) {
    const src = readFileSync(join(ROOT, 'app', f), 'utf8');
    parts.push(`\n/* ───────── app/${f} ───────── */`);
    parts.push(stripModuleSyntax(src, f));
  }

  const script = parts.join('\n');
  const css = readFileSync(join(ROOT, 'app', 'style.css'), 'utf8');
  const tpl = readFileSync(join(ROOT, 'app', 'template.html'), 'utf8');

  return tpl
    .replace('/*__CSS__*/', () => css)
    .replace('/*__SCRIPT__*/', () => script);
}

function main() {
  const html = buildHtml();
  mkdirSync(join(ROOT, 'docs'), { recursive: true });
  writeFileSync(OUT, html, 'utf8');
  const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  console.log(`✓ docs/index.html  ${kb} KB（单文件，双击即开）`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
