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
    // プロジェクト期間もタイムラインに含める(スケジュールが無くても期間全体が見える)。
    if (state.project) {
      const ps = parseDate(state.project.startDate), pe = parseDate(state.project.endDate);
      if (ps && (!min || ps < min)) min = ps;
      if (pe && (!max || pe > max)) max = pe;
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

  // 指定日が画面内に見えるよう、ガント本体を水平スクロールする(先頭に戻す)。
  // 位置が正しく計算されていても、現在のスクロール位置の外にあると
  // 「見えているのに気づけない」ことがあるため、追加・編集の直後に呼ぶ。
  function scrollToDate(d) {
    if (!d || !scale.origin) return;
    const body = document.getElementById('ganttBody');
    if (!body) return;
    const x = dateToX(d);
    body.scrollLeft = Math.max(0, x - body.clientWidth / 2);
    body.scrollTop = 0;
  }

  // --- ヘッダー目盛り ---
  function renderScale() {
    const g = uiState.granularity;
    const ticks = [];
    let d = new Date(scale.origin.getFullYear(), scale.origin.getMonth(), scale.origin.getDate());
    const end = scale.end;
    const WD = ['日', '月', '火', '水', '木', '金', '土'];
    while (dayDiff(d, end) >= 0) {
      let show = false, major = false, label = '', sub = '', wd = '', cls = '';
      if (g === 'day') {
        show = true;
        major = d.getDate() === 1;
        label = major ? `${d.getMonth() + 1}月` : '';
        sub = String(d.getDate());
        wd = WD[d.getDay()];  // 曜日を表示
        // 土=青、日/祝=赤 で色分け
        if (d.getDay() === 0 || Holidays.isHoliday(d)) cls = 'sun';
        else if (d.getDay() === 6) cls = 'sat';
      } else if (g === 'week') {
        if (d.getDay() === 1) { show = true; major = d.getDate() <= 7; label = major ? `${d.getMonth() + 1}月` : ''; sub = `${d.getMonth() + 1}/${d.getDate()}`; }
      } else if (g === 'month') {
        if (d.getDate() === 1) {
          show = true;
          const isQ = d.getMonth() % 3 === 0;  // 四半期の頭(1/4/7/10月)
          major = isQ;
          // 月粒度でも四半期(Q)を表示する。四半期頭には Q ラベル、1月は年も。
          label = isQ ? (d.getMonth() === 0 ? `${d.getFullYear()} Q1` : `Q${Math.floor(d.getMonth() / 3) + 1}`) : '';
          sub = `${d.getMonth() + 1}月`;
        }
      } else if (g === 'quarter') {
        if (d.getDate() === 1 && d.getMonth() % 3 === 0) { show = true; major = d.getMonth() === 0; label = major ? `${d.getFullYear()}` : ''; sub = `Q${Math.floor(d.getMonth() / 3) + 1}`; }
      }
      if (show) ticks.push(`<div class="scale-tick ${major ? 'major' : ''} ${cls}" style="left:${dateToX(d)}px">${label}<span class="sub">${sub}</span>${wd ? `<span class="wd">${wd}</span>` : ''}</div>`);
      d = addDays(d, 1);
    }
    return `<div class="gantt-scale" style="width:${scale.width}px">${ticks.join('')}${renderFlags()}</div>`;
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
      // 週末/祝日シェード(日・週表示のみ)。土=青、日/祝=赤。
      if (showWeekendShade) {
        if (d.getDay() === 0 || Holidays.isHoliday(d)) parts.push(`<div class="grid-holiday" style="left:${x}px;width:${scale.pxPerDay}px"></div>`);
        else if (d.getDay() === 6) parts.push(`<div class="grid-weekend" style="left:${x}px;width:${scale.pxPerDay}px"></div>`);
      }
      d = addDays(d, 1);
    }
    // 今日線(縦線のみ。フラグはヘッダー側 renderScale で出す)
    const today = todayDate();
    if (dayDiff(scale.origin, today) >= 0 && dayDiff(today, scale.end) >= 0) {
      const tx = dateToX(today) + scale.pxPerDay / 2;
      parts.push(`<div class="today-line" style="left:${tx}px;height:${totalH}px"></div>`);
    }
    // マイルストーン線(縦線のみ。フラグはヘッダー側 renderScale で出す)
    state.milestones.forEach((m) => {
      const d = parseDate(m.date);
      if (!d || dayDiff(scale.origin, d) < 0 || dayDiff(d, scale.end) < 0) return;
      const mx = dateToX(d) + scale.pxPerDay / 2;
      parts.push(`<div class="milestone-line" style="left:${mx}px;height:${totalH}px"></div>`);
    });
    // プロジェクト期間の開始/終了の境界線(縦線)。
    if (state.project) {
      [state.project.startDate, state.project.endDate].forEach(ds => {
        const pd = parseDate(ds);
        if (!pd || dayDiff(scale.origin, pd) < 0 || dayDiff(pd, scale.end) < 0) return;
        parts.push(`<div class="project-line" style="left:${dateToX(pd)}px;height:${totalH}px"></div>`);
      });
    }
    return parts.join('');
  }

  // ヘッダー(目盛りの1段上)に出す旗: 今日 + マイルストーン。
  // グリッド本体ではなくヘッダーに置くことで、行のバーと重ならず常に見える。
  function renderFlags() {
    const out = [];
    const today = todayDate();
    if (dayDiff(scale.origin, today) >= 0 && dayDiff(today, scale.end) >= 0) {
      const tx = dateToX(today) + scale.pxPerDay / 2;
      out.push(`<div class="today-flag" style="left:${tx}px">今日</div>`);
    }
    state.milestones.forEach((m) => {
      const d = parseDate(m.date);
      if (!d || dayDiff(scale.origin, d) < 0 || dayDiff(d, scale.end) < 0) return;
      const mx = dateToX(d) + scale.pxPerDay / 2;
      out.push(`<button type="button" class="milestone-flag" data-ms="${m.id}" style="left:${mx}px" title="${escapeHtml(m.name)} (${m.date})">◆ ${escapeHtml(m.name)}</button>`);
    });
    // プロジェクト期間の開始/終了フラグ
    if (state.project) {
      const mk = (ds, txt) => {
        const pd = parseDate(ds);
        if (!pd || dayDiff(scale.origin, pd) < 0 || dayDiff(pd, scale.end) < 0) return;
        out.push(`<div class="project-flag" style="left:${dateToX(pd)}px" title="${txt} (${ds})">${txt}</div>`);
      };
      mk(state.project.startDate, '計画開始');
      mk(state.project.endDate, '計画終了');
    }
    return out.join('');
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
        // バーのラベルにも実稼働日数「(N日)」を付ける(土日・祝日を除く)。
        const wdays = Holidays.countWorkingDays(sp.start, sp.end);
        const nameDays = `${escapeHtml(n.name)}<span class="bar-days">(${wdays}日)</span>`;
        const titleDays = `${escapeHtml(n.name)}(${wdays}稼働日)`;
        if (r.level === 2) {
          // タスク(常に葉): ステータス濃淡・最細・ドラッグ可。
          const st = Schedules.effectiveStatus(n);
          const label = width > 40 ? `<span class="bar-label">${nameDays}</span>` : '';
          bar = `<div class="bar lv2 ${st}" data-bar="${n.id}" style="left:${left}px;width:${width}px" title="${titleDays}">
                   <span class="grip left"></span>${label}<span class="grip right"></span>
                 </div>`;
        } else {
          // スケジュール/サブスケジュール: レベル色。子が無ければ自身の日程を直接ドラッグできる。
          const lv = r.level === 0 ? 'lv0' : 'lv1';
          const label = `<span class="bar-label">${nameDays}</span>`;
          if (draggable) {
            bar = `<div class="bar ${lv}" data-bar="${n.id}" style="left:${left}px;width:${width}px" title="${titleDays}">
                     <span class="grip left"></span>${label}<span class="grip right"></span>
                   </div>`;
          } else {
            // 子を持つ親(サマリー): 期間の伸縮は不可(子から集計)だが、
            // バー本体をドラッグして配下ごと「ずらす」ことはできる。グリップ(端リサイズ)は付けない。
            bar = `<div class="bar summary ${lv}" data-bar="${n.id}" data-summary="1" style="left:${left}px;width:${width}px" title="${titleDays}(ドラッグで配下ごと移動)">${label}</div>`;
          }
        }
      }
      return `<div class="gantt-row ${uiState.selectedId === n.id ? 'selected' : ''}" data-row="${n.id}">${bar}</div>`;
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
    // 今日/マイルストーンの縦線は renderGridDecor(グリッド内)、旗は renderScale(ヘッダー)で描く。
    body.innerHTML = `
      <div class="gantt-grid" style="width:${scale.width}px;height:${totalH}px;position:relative">
        ${renderGridDecor(totalH)}
        <div class="gantt-rows">${renderRows(rows)}</div>
        <svg id="depSvg" width="${scale.width}" height="${totalH}">${renderDeps(rows)}</svg>
      </div>`;
  }

  // --- ドラッグ(移動 / 期間変更)---
  function beginDrag(e, barEl) {
    const id = barEl.dataset.bar;
    const node = Schedules.byId(id);
    if (!node) return;
    const sp = Schedules.effectiveSpan(node);
    if (!sp) return;
    const isSummary = !!barEl.dataset.summary; // 親(子あり): 移動のみ、伸縮不可
    const mode = (!isSummary && e.target.classList.contains('grip'))
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
        if (isSummary) {
          // 親は移動のみ: 移動量(暦日)ぶん、配下すべてを一括でずらす。
          Schedules.shiftSubtree(id, dayDiff(origStart, parseDate(p.start)));
        } else {
          Schedules.updateDates(id, p.start, p.end);
        }
      } else {
        // ドラッグせずクリックしただけ → そのバーの編集画面を直接開く。
        // (見た目が微小にずれている場合に備え、先にグリッド位置へ描き直す。)
        renderGantt();
        Schedules.openEditor({ id: id });
      }
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  return { renderGantt, computeDateScale, dateToX, xToDate, scrollToDate, beginDrag, ROW_H };
})();
