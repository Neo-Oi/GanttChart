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

// d の years 年後の同月同日(期間上限の判定に使う)。
function addYears(d, years) {
  return new Date(d.getFullYear() + years, d.getMonth(), d.getDate());
}

// 開始〜終了の期間が maxYears 年以内か(両方指定されている場合のみ判定)。
function periodWithinYears(startStr, endStr, maxYears) {
  const s = parseDate(startStr), e = parseDate(endStr);
  if (!s || !e) return true;
  if (dayDiff(s, e) < 0) return false;         // 逆転はNG
  return dayDiff(e, addYears(s, maxYears)) >= 0; // e <= s + maxYears年
}

function fmtRangeLabel(d) {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 最小限の安全なMarkdown→HTML変換(見出し/箇条書き・チェックリスト/太字・斜体・コード/段落のみ)。
// 外部ライブラリは使わない方針(CLAUDE.md参照)。各行を escapeHtml してから記法を変換するので、
// メモ内にHTMLタグを書いてもそのまま表示され、実行されることはない。
function renderMarkdownSafe(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  const inlineMd = (s) => s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

  for (const raw of lines) {
    const line = escapeHtml(raw);
    let m = /^(#{1,3})\s+(.+)$/.exec(line);
    if (m) { closeList(); out.push(`<h${m[1].length + 2}>${inlineMd(m[2])}</h${m[1].length + 2}>`); continue; }
    m = /^[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (m) {
      if (!inList) { out.push('<ul class="md-list">'); inList = true; }
      out.push(`<li><input type="checkbox" disabled ${/x/i.test(m[1]) ? 'checked' : ''}> ${inlineMd(m[2])}</li>`);
      continue;
    }
    m = /^[-*]\s+(.+)$/.exec(line);
    if (m) {
      if (!inList) { out.push('<ul class="md-list">'); inList = true; }
      out.push(`<li>${inlineMd(m[1])}</li>`);
      continue;
    }
    closeList();
    if (line.trim() === '') continue;
    out.push(`<p>${inlineMd(line)}</p>`);
  }
  closeList();
  return out.join('\n');
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
