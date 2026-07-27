// ===== Tier 1 テストランナー(単一 index.html 対応)=====
// リポジトリ直下の index.html から純ロジックのセクション
// (util / holidays / state / schedules / dependencies)だけを取り出し、
// tests/tier1-tests.js を同一スコープで評価する。
// 旧方式(src/app/*.js を cat して node に流す)を置き換えるもの。
//
// 実行:  リポジトリ直下で  node tests/run-tier1.js
// 期待:  SUMMARY pass=51 fail=0 (ALL PASS)

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// index.html 内の <script> のうち、モジュール区切り(// ===== app/xxx.js =====)を
// 含むアプリ本体ブロックを取り出す。
const appScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1])
  .find((s) => s.includes('// ===== app/'));

if (!appScript) {
  console.error('index.html にアプリ本体の <script> ブロックが見つかりません');
  process.exit(1);
}

// build 時に挿入される区切りコメント「\n// ===== app/xxx.js =====\n」でセクション分割。
// (5 個の '=' を要求するので、util.js 内の「// ==== app/util.js ====」(4 個)には誤マッチしない)
const parts = appScript.split(/\n\/\/ ===== (app\/\S+) ===== *\n/);
const sections = {};
for (let i = 1; i < parts.length; i += 2) sections[parts[i]] = parts[i + 1];

// Tier 1 は DOM/IndexedDB 非依存の純ロジックのみを対象にする。
const NEEDED = ['app/util.js', 'app/holidays.js', 'app/state.js', 'app/schedules.js', 'app/dependencies.js'];

const code = NEEDED.map((name) => {
  if (sections[name] == null) {
    console.error(`index.html にセクションが見つかりません: ${name}`);
    process.exit(1);
  }
  return `// ===== ${name} =====\n${sections[name]}`;
}).join('\n\n');

const tests = fs.readFileSync(path.join(__dirname, 'tier1-tests.js'), 'utf8');

// code と tests を 1 回の eval で同一スコープに置く(旧 cat 方式と等価)。
eval(code + '\n' + tests);
