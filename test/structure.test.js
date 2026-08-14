// Guards the one architectural invariant this project cannot afford to lose: src/core/ is pure.
//
// The same core modules run in two environments — under Node inside build.js, to render the
// crawlable house-pick HTML, and in the browser over native ESM, to recompute a path after the
// quiz. A single `node:` import or DOM reference would break one of those two callers, and it
// would break it silently, at runtime, in whichever environment we happened to test less. There
// is no bundler here to catch it and no type checker to complain, so the invariant is enforced
// by test instead — the same way Tab-Closer/test/structure.test.mjs enforces "background code
// never imports UI code".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const CORE_DIR = new URL('../src/core/', import.meta.url);

// Globals that exist in only one of the two environments. Reading any of them inside core means
// the module can no longer run in the other one.
const BROWSER_ONLY = ['document', 'window', 'localStorage', 'sessionStorage', 'navigator', 'alert'];
const NODE_ONLY = ['process', 'require', '__dirname', '__filename', 'Buffer'];

/**
 * Blank out comments and string bodies so identifier matching does not trip over prose.
 * Crude on purpose — we need identifier positions, not a real parse. The one known blind spot
 * is an interpolated expression inside a template literal; core has no reason to contain one.
 * @param {string} source
 * @returns {string}
 */
function stripCommentsAndStrings(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

/**
 * Every module specifier the file imports from, whether by static import, re-export, or
 * dynamic import().
 * @param {string} source
 * @returns {string[]}
 */
function importSpecifiers(source) {
  const found = [];
  const patterns = [
    /\b(?:import|export)\b[^;'"]*\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      found.push(match[1]);
    }
  }
  return found;
}

/**
 * @returns {Promise<Array<{name: string, source: string, code: string}>>}
 */
async function readCoreModules() {
  const entries = await readdir(CORE_DIR);
  const names = entries.filter((name) => name.endsWith('.js')).sort();
  const modules = [];
  for (const name of names) {
    const source = await readFile(new URL(name, CORE_DIR), 'utf8');
    modules.push({ name, source, code: stripCommentsAndStrings(source) });
  }
  return modules;
}

test('src/core exists and is readable', async () => {
  const entries = await readdir(CORE_DIR);
  assert.ok(Array.isArray(entries), 'src/core/ must be a readable directory');
});

test('core modules import only other core modules', async () => {
  for (const module of await readCoreModules()) {
    for (const specifier of importSpecifiers(module.source)) {
      assert.ok(
        specifier.startsWith('./') || specifier.startsWith('../'),
        `src/core/${module.name} imports "${specifier}" — core must have zero dependencies, ` +
          'so only relative imports of other core modules are allowed',
      );
      assert.ok(
        !specifier.includes('/ui/') && !specifier.includes('/templates/'),
        `src/core/${module.name} imports "${specifier}" — core must not depend on UI or templates`,
      );
      assert.ok(
        specifier.endsWith('.js'),
        `src/core/${module.name} imports "${specifier}" — native ESM in the browser requires ` +
          'an explicit .js extension',
      );
    }
  }
});

test('core modules reference no environment-specific globals', async () => {
  for (const module of await readCoreModules()) {
    for (const name of [...BROWSER_ONLY, ...NODE_ONLY]) {
      const usage = new RegExp(`(?<![.\\w$])${name}\\b`);
      assert.ok(
        !usage.test(module.code),
        `src/core/${module.name} references "${name}" — core runs under both Node and the ` +
          'browser, so it cannot touch a global that exists in only one of them',
      );
    }
  }
});

test('core modules are ESM, never CommonJS', async () => {
  for (const module of await readCoreModules()) {
    assert.ok(
      !/\bmodule\.exports\b/.test(module.code) && !/\bexports\.\w/.test(module.code),
      `src/core/${module.name} uses CommonJS exports — the browser can only load ESM`,
    );
  }
});
