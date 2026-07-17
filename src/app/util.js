// ==== app/util.js ====
// 全モジュール共通のヘルパー。名前は全体で1つのグローバルスコープを共有するため一意に保つこと。

function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 日付は 'YYYY-MM-DD' 文字列で保持。TZの影響を避けるためローカル日付として手動パースする。
function parseDate(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

function fmtDate(d) {
  if (!d) return '';
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

function todayDate() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

// 2日付間の暦日差(d2 - d1)。同日=0。
function dayDiff(d1, d2) {
  const a = Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate());
  const b = Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate());
  return Math.round((b - a) / 86400000);
}

function addDays(d, n) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
}

function isWeekend(d) {
  const w = d.getDay();
  return w === 0 || w === 6;
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function fmtRangeLabel(d) {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// トースト通知
function toast(msg) {
  const host = document.getElementById('toastHost');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 1800);
  setTimeout(() => el.remove(), 2150);
}
