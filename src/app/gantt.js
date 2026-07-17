// ==== app/gantt.js ====
// 日付↔ピクセル変換を集約し、ヘッダー目盛り・グリッド・バー・マイルストーン・今日線・依存線を描画。
// バーはドラッグで移動/期間変更でき、フォーム編集(schedules.js)と同じデータを更新する。

const Gantt = (() => {
  const PX_PER_DAY = { day: 30, week: 16, month: 7, quarter: 3.5 };
  const ROW_H = 38;

  // 現在の描画スケール(ドラッグ時の逆変換に使う)。
  let scale = { origin: null, pxPerDay: 30, width: 0 };
  // ドラッグ中は true。renderGantt() が #ganttBody を丸ごと差し替えると、
  // 掴んでいるバー/ゴースト/ツールチップが指すDOMごと消えてしまうため、その間は再描画を抑制する。
  let isDragging = false;

  function computeDateScale() {
    const pxPerDay = PX_PER_DAY[uiState.granularity] || 30;
    let min = null, max = null;
    for (const n of state.schedules) {
      if (Schedules.hasChildren(n.id)) continue; // 葉のみ実日付を持つ
      const sp = Schedules.effectiveSpan(n);
      if (!sp) continue;
      if (!min || sp.start < min) min = sp.start;
      if (!max || sp.end > max) max = sp.end;
    }
    for (const m of state.milestones) {
      const d = parseDate(m.date);
      if (!d) continue;
      if (!min || d < min) min = d;
      if (!max || d > max) max = d;
    }
    const today = todayDate();
    if (!min) { min = addDays(today, -7); max = addDays(today, 30); }
    if (!max || max < min) max = addDays(min, 14);
    // 前後に余白。開始は週頭(月曜)に丸める。
    let origin = addDays(min, -3);
    while (origin.getDay() !== 1) origin = addDays(origin, -1);
    const end = addDays(max, 10);
    const days = dayDiff(origin, end) + 1;
    const width = Math.max(days * pxPerDay, 600);
    scale = { origin, pxPerDay, width, end };
    return scale;
  }

  function dateToX(d) { return dayDiff(scale.origin, d) * scale.pxPerDay; }
  function xToDate(x) { return addDays(scale.origin, Math.round(x / scale.pxPerDay)); }

  // --- ヘッダー目盛り ---
  function renderScale() {
    const g = uiState.granularity;
    const ticks = [];
    let d = new Date(scale.origin.getFullYear(), scale.origin.getMonth(), scale.origin.getDate());
    const end = scale.end;
    while (dayDiff(d, end) >= 0) {
      let show = false, major = false, label = '', sub = '';
      if (g === 'day') {
        show = true;
        major = d.getDate() === 1;
        label = major ? `${d.getMonth() + 1}月` : '';
        sub = String(d.getDate());
      } else if (g === 'week') {
        if (d.getDay() === 1) { show = true; major = d.getDate() <= 7; label = major ? `${d.getMonth() + 1}月` : ''; sub = `${d.getMonth() + 1}/${d.getDate()}`; }
      } else if (g === 'month') {
        if (d.getDate() === 1) { show = true; major = d.getMonth() === 0; label = major ? `${d.getFullYear()}` : ''; sub = `${d.getMonth() + 1}月`; }
      } else if (g === 'quarter') {
        if (d.getDate() === 1 && d.getMonth() % 3 === 0) { show = true; major = d.getMonth() === 0; label = major ? `${d.getFullYear()}` : ''; sub = `Q${Math.floor(d.getMonth() / 3) + 1}`; }
      }
      if (show) ticks.push(`<div class="scale-tick ${major ? 'major' : ''}" style="left:${dateToX(d)}px">${label}<span class="sub">${sub}</span></div>`);
      d = addDays(d, 1);
    }
    return `<div class="gantt-scale" style="width:${scale.width}px">${ticks.join('')}</div>`;
  }

  // --- グリッド(縦線・週末/祝日シェード・今日線)---
  function renderGridDecor(totalH) {
    const g = uiState.granularity;
    const parts = [];
    let d = new Date(scale.origin.getFullYear(), scale.origin.getMonth(), scale.origin.getDate());
    const end = scale.end;
    const showWeekendShade = (g === 'day' || g === 'week');
    while (dayDiff(d, end) >= 0) {
      const x = dateToX(d);
      // 縦グリッド線
      let line = false, major = false;
      if (g === 'day') { line = true; major = d.getDay() === 1; }
      else if (g === 'week') { line = d.getDay() === 1; major = d.getDate() <= 7; }
      else if (g === 'month') { line = d.getDate() === 1; major = d.getMonth() === 0; }
      else if (g === 'quarter') { line = d.getDate() === 1 && d.getMonth() % 3 === 0; major = d.getMonth() === 0; }
      if (line) parts.push(`<div class="grid-line ${major ? 'major' : ''}" style="left:${x}px"></div>`);
      // 週末/祝日シェード(日・週表示のみ)
      if (showWeekendShade) {
        if (isWeekend(d)) parts.push(`<div class="grid-weekend" style="left:${x}px;width:${scale.pxPerDay}px"></div>`);
        else if (Holidays.isHoliday(d)) parts.push(`<div class="grid-holiday" style="left:${x}px;width:${scale.pxPerDay}px"></div>`);
      }
      d = addDays(d, 1);
    }
    // 今日線
    const today = todayDate();
    if (dayDiff(scale.origin, today) >= 0 && dayDiff(today, scale.end) >= 0) {
      const tx = dateToX(today) + scale.pxPerDay / 2;
      parts.push(`<div class="today-flag" style="left:${tx}px">今日</div>`);
      parts.push(`<div class="today-line" style="left:${tx}px;height:${totalH}px"></div>`);
    }
    return parts.join('');
  }

  // --- バー行 ---
  // 色・太さは階層(レベル)だけで決める: スケジュール(lv0)=テーマ色・最太、
  // サブスケジュール(lv1)=グレー・中太、タスク(lv2)=ステータス濃淡・最細。
  // 子を持つかどうかは「集計値(summary)を出すか、自分の日程を直接ドラッグできるか」だけに影響する。
  function renderRows(rows) {
    return rows.map(r => {
      const n = r.node;
      const sp = Schedules.effectiveSpan(n);
      let bar = '';
      if (sp) {
        const left = dateToX(sp.start);
        const width = Math.max((dayDiff(sp.start, sp.end) + 1) * scale.pxPerDay, 6);
        const draggable = !r.hasChildren;
        if (r.level === 2) {
          // タスク(常に葉): ステータス濃淡・最細・ドラッグ可。
          const st = Schedules.effectiveStatus(n);
          const label = width > 40 ? `<span class="bar-label">${escapeHtml(n.name)}</span>` : '';
          bar = `<div class="bar lv2 ${st}" data-bar="${n.id}" style="left:${left}px;width:${width}px" title="${escapeHtml(n.name)}">
                   <span class="grip left"></span>${label}<span class="grip right"></span>
                 </div>`;
        } else {
          // スケジュール/サブスケジュール: レベル色。子が無ければ自身の日程を直接ドラッグできる。
          const lv = r.level === 0 ? 'lv0' : 'lv1';
          const label = `<span class="bar-label">${escapeHtml(n.name)}</span>`;
          if (draggable) {
            bar = `<div class="bar ${lv}" data-bar="${n.id}" style="left:${left}px;width:${width}px" title="${escapeHtml(n.name)}">
                     <span class="grip left"></span>${label}<span class="grip right"></span>
                   </div>`;
          } else {
            bar = `<div class="bar summary ${lv}" style="left:${left}px;width:${width}px">${label}</div>`;
          }
        }
      }
      return `<div class="gantt-row ${uiState.selectedId === n.id ? 'selected' : ''}" data-row="${n.id}">${bar}</div>`;
    }).join('');
  }

  // --- マイルストーン ---
  // 今日線と同じく、チャートを縦に貫く線として描画する(行数やスクロール位置に関係なく見える)。
  function renderMilestones(totalH) {
    return state.milestones.map(m => {
      const d = parseDate(m.date);
      if (!d || dayDiff(scale.origin, d) < 0 || dayDiff(d, scale.end) > 0) return '';
      const x = dateToX(d) + scale.pxPerDay / 2;
      return `<div class="milestone-line" style="left:${x}px;height:${totalH}px"></div>
              <button type="button" class="milestone-flag" data-ms="${m.id}" style="left:${x}px" title="${escapeHtml(m.name)} (${m.date})">◆ ${escapeHtml(m.name)}</button>`;
    }).join('');
  }

  // --- 依存線 ---
  function renderDeps(rows) {
    const rowIndex = {};
    rows.forEach((r, i) => { rowIndex[r.node.id] = i; });
    const segs = [];
    for (const dep of state.dependencies) {
      const fi = rowIndex[dep.fromId], ti = rowIndex[dep.toId];
      if (fi == null || ti == null) continue; // 折りたたみ等で非表示
      const from = Schedules.byId(dep.fromId), to = Schedules.byId(dep.toId);
      const fsp = Schedules.effectiveSpan(from), tsp = Schedules.effectiveSpan(to);
      if (!fsp || !tsp) continue;
      const x1 = dateToX(fsp.end) + scale.pxPerDay; // from バーの右端
      const y1 = fi * ROW_H + ROW_H / 2;
      const x2 = dateToX(tsp.start);
      const y2 = ti * ROW_H + ROW_H / 2;
      const midX = Math.max(x1 + 12, x2 - 12);
      segs.push(`<path class="dep-path" d="M${x1},${y1} H${midX} V${y2} H${x2}"/>
                 <path class="dep-arrow" d="M${x2},${y2} l-6,-4 v8 z"/>`);
    }
    return segs.join('');
  }

  function renderGantt() {
    if (isDragging) return; // ドラッグ中に外部から呼ばれても、掴んでいるDOMを壊さないよう何もしない
    const header = document.getElementById('ganttHeader');
    const body = document.getElementById('ganttBody');
    if (!state.project) { header.innerHTML = ''; body.innerHTML = ''; return; }
    computeDateScale();
    const rows = Schedules.flattenForDisplay();
    header.innerHTML = renderScale();

    // マイルストーンはスケジュールの木構造と無関係な独立した日付マーカーなので、
    // スケジュールの行が1つも無くても(マイルストーンだけあれば)描画する。
    if (!rows.length && !state.milestones.length) {
      body.innerHTML = `<div class="gantt-empty">左でスケジュールを追加すると、ここにガントチャートが表示されます。</div>`;
      return;
    }
    const totalH = Math.max(rows.length * ROW_H, ROW_H * 3);
    body.innerHTML = `
      <div class="gantt-grid" style="width:${scale.width}px;height:${totalH}px;position:relative">
        ${renderGridDecor(totalH)}
        <div class="gantt-rows">${renderRows(rows)}</div>
        <svg id="depSvg" width="${scale.width}" height="${totalH}">${renderDeps(rows)}</svg>
        ${renderMilestones(totalH)}
      </div>`;
  }

  // --- ドラッグ(移動 / 期間変更)---
  function beginDrag(e, barEl) {
    const id = barEl.dataset.bar;
    const node = Schedules.byId(id);
    if (!node) return;
    const sp = Schedules.effectiveSpan(node);
    if (!sp) return;
    const mode = e.target.classList.contains('grip')
      ? (e.target.classList.contains('left') ? 'resize-l' : 'resize-r')
      : 'move';
    const startX = e.clientX;
    const origStart = sp.start, origEnd = sp.end;
    const origLeftPx = dateToX(origStart);
    const origRightPx = dateToX(origEnd) + scale.pxPerDay; // バー右端のピクセル位置
    const MIN_PX = 6;
    const baseClasses = barEl.className; // ゴーストに複製する(lv0/lv1/lv2・ステータスの色/太さを引き継ぐため)
    isDragging = true;
    e.preventDefault();
    document.body.style.cursor = mode === 'move' ? 'grabbing' : 'ew-resize';
    barEl.classList.add('dragging'); // 実バー: 半透明のまま連続追従 = 「動いている」ことが分かる

    // 予測ゴースト: 確定される日付(グリッドにスナップ済み)の位置に、点線・半透明で表示する。
    const ghost = document.createElement('div');
    ghost.className = baseClasses + ' bar-ghost';
    ghost.style.left = origLeftPx + 'px';
    ghost.style.width = (origRightPx - origLeftPx) + 'px';
    barEl.parentElement.appendChild(ghost);

    // ドラッグ中の日付ツールチップ
    const tip = document.createElement('div');
    tip.className = 'drag-tip';
    document.body.appendChild(tip);
    function showTip(ev, ns, ne) {
      tip.textContent = `${fmtDate(ns)} 〜 ${fmtDate(ne)}(${Holidays.countWorkingDays(ns, ne)}稼働日)`;
      tip.style.left = (ev.clientX + 14) + 'px';
      tip.style.top = (ev.clientY + 16) + 'px';
    }

    // 実バーの見た目はマウスに1pxずつ連続追従させ(リアルタイム感を出す)、
    // ゴーストは「確定するとどこに来るか」を日単位のグリッドにスナップして表示する。
    function onMove(ev) {
      const deltaPx = ev.clientX - startX;
      const deltaDays = Math.round(deltaPx / scale.pxPerDay);
      let ns = origStart, ne = origEnd, leftPx, widthPx;
      if (mode === 'move') {
        ns = addDays(origStart, deltaDays);
        ne = addDays(origEnd, deltaDays);
        leftPx = origLeftPx + deltaPx;
        widthPx = origRightPx - origLeftPx;
      } else if (mode === 'resize-l') {
        ns = addDays(origStart, deltaDays); if (dayDiff(ns, ne) < 0) ns = ne;
        leftPx = Math.min(origLeftPx + deltaPx, origRightPx - MIN_PX);
        widthPx = origRightPx - leftPx;
      } else {
        ne = addDays(origEnd, deltaDays); if (dayDiff(ns, ne) < 0) ne = ns;
        leftPx = origLeftPx;
        widthPx = Math.max(origRightPx - origLeftPx + deltaPx, MIN_PX);
      }
      barEl.style.left = leftPx + 'px';
      barEl.style.width = widthPx + 'px';
      ghost.style.left = dateToX(ns) + 'px';
      ghost.style.width = Math.max((dayDiff(ns, ne) + 1) * scale.pxPerDay, MIN_PX) + 'px';
      barEl._pending = { start: fmtDate(ns), end: fmtDate(ne) };
      showTip(ev, ns, ne);
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      barEl.classList.remove('dragging');
      ghost.remove();
      tip.remove();
      isDragging = false; // 以降の renderGantt() を再び有効にする(この後の再描画呼び出しより前に)
      const p = barEl._pending;
      if (p && (p.start !== fmtDate(origStart) || p.end !== fmtDate(origEnd))) {
        Schedules.updateDates(id, p.start, p.end);
      } else {
        // 変化なし(またはスナップで元に戻った)ときは、日付グリッドの位置に戻す。
        renderGantt();
      }
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  return { renderGantt, computeDateScale, dateToX, xToDate, beginDrag, ROW_H };
})();
