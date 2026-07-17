// ==== app/schedules.js ====
// スケジュール木(スケジュール→サブスケジュール→タスク、最大3階層)の CRUD と描画。
// タスクは独立ストアを持たず、schedules 内の「子を持たない末端ノード」。

const Schedules = (() => {
  const LEVEL_NAME = ['スケジュール', 'サブスケジュール', 'タスク'];
  const MAX_LEVEL = 2; // 0,1,2 の3階層

  // --- 木の操作 ---
  function childrenOf(parentId) {
    return state.schedules
      .filter(n => n.parentId === parentId)
      .sort((a, b) => a.order - b.order);
  }
  function byId(id) { return state.schedules.find(n => n.id === id); }

  function levelOf(node) {
    let lv = 0, p = node.parentId;
    while (p) { lv++; const par = byId(p); p = par ? par.parentId : null; }
    return lv;
  }
  function hasChildren(id) { return state.schedules.some(n => n.parentId === id); }

  // 表示番号 "1.2.3" を毎回算出(保存しない)。
  function computeNumbering() {
    const map = {};
    function walk(parentId, prefix) {
      childrenOf(parentId).forEach((n, i) => {
        const num = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
        map[n.id] = num;
        walk(n.id, num);
      });
    }
    walk(null, '');
    return map;
  }

  // 折りたたみを反映した表示順の平坦リスト(スケジュール→サブスケジュール→タスクの入れ子順)。
  // タスクはガント/ツリーにも表示しつつ、タスク管理パネルからも編集できる(併用)。
  function flattenForDisplay() {
    const rows = [];
    function walk(parentId, level) {
      for (const n of childrenOf(parentId)) {
        const kids = hasChildren(n.id);
        rows.push({ node: n, level, hasChildren: kids });
        if (kids && !uiState.collapsed[n.id]) walk(n.id, level + 1);
      }
    }
    walk(null, 0);
    return rows;
  }

  // --- ステータス集計(子から自動)---
  function effectiveStatus(node) {
    const kids = childrenOf(node.id);
    if (!kids.length) return node.status || 'todo';
    const states = kids.map(effectiveStatus);
    if (states.every(s => s === 'done')) return 'done';
    if (states.every(s => s === 'todo')) return 'todo';
    return 'doing';
  }

  // --- 期間の集計(親は子の min/max。葉は自身の日付)---
  function effectiveSpan(node) {
    const kids = childrenOf(node.id);
    if (!kids.length) {
      const s = parseDate(node.startDate), e = parseDate(node.endDate);
      if (s && e) return { start: s, end: e };
      return null;
    }
    let start = null, end = null;
    for (const k of kids) {
      const sp = effectiveSpan(k);
      if (!sp) continue;
      if (!start || sp.start < start) start = sp.start;
      if (!end || sp.end > end) end = sp.end;
    }
    return start && end ? { start, end } : null;
  }

  // --- レンダリング: 左ツリー ---
  function renderTree() {
    const host = document.getElementById('treeList');
    if (!state.project) { host.innerHTML = ''; return; }
    const rows = flattenForDisplay();
    if (!rows.length) {
      host.innerHTML = `<div class="tree-empty">まだスケジュールがありません。<br>「＋ スケジュール」から始めましょう。</div>`;
      return;
    }
    const nums = computeNumbering();
    host.innerHTML = rows.map(r => {
      const n = r.node;
      const st = effectiveStatus(n);
      const sp = effectiveSpan(n);
      const meta = sp ? `${fmtRangeLabel(sp.start)}–${fmtRangeLabel(sp.end)}` : '日付未設定';
      // 子を持つノード(スケジュール/タスク持ちサブスケジュール)は展開用の三角。タスクは葉。
      const twist = r.hasChildren
        ? `<button class="twist" data-toggle="${n.id}">${uiState.collapsed[n.id] ? '▶' : '▼'}</button>`
        : `<span class="twist leaf">•</span>`;
      // サブスケジュール(level 1)には常時表示のタスク管理チップ。
      const persistent = r.level === 1
        ? `<button class="task-chip" data-tasks="${n.id}" title="タスク管理を開く">☑ ${childrenOf(n.id).length}</button>`
        : '';
      // level 0,1 は子を追加できる(スケジュール→サブ、サブ→タスク)。
      const hoverAdd = r.level < MAX_LEVEL
        ? `<button class="icon-btn" data-addchild="${n.id}" title="${LEVEL_NAME[r.level + 1]}を追加">＋</button>` : '';
      return `
        <div class="tree-row lv${r.level} ${uiState.selectedId === n.id ? 'selected' : ''}" data-id="${n.id}"
             style="padding-left:${8 + r.level * 16}px">
          ${twist}
          <span class="status-dot ${st}"></span>
          <span class="num">${nums[n.id] || ''}</span>
          <span class="name lv${r.level}" data-edit="${n.id}">${escapeHtml(n.name)}</span>
          <span class="meta">${meta}</span>
          ${persistent}
          <span class="row-actions">
            ${hoverAdd}
            <button class="icon-btn" data-edit="${n.id}" title="編集">✎</button>
            <button class="icon-btn" data-del="${n.id}" title="削除">🗑</button>
          </span>
        </div>`;
    }).join('');
  }

  // --- 例文(アシストモードで消えないヒント)---
  function examples(level) {
    return [
      { name: '「定義」「設計」「実装」「フォロー」', note: '例: このフェーズのゴールを一言で' },
      { name: '「機能要件定義」「基本設計書作成」', note: '例: 成果物・工程の単位で分ける' },
      { name: '「ヒアリングメモ作成」「要求一覧作成」', note: '例: 実際に手を動かす作業' },
    ][level] || { name: '', note: '' };
  }

  // --- 追加/編集モーダル ---
  function openEditor(opts) {
    // opts: { id } 既存編集 / { parentId, level } 新規
    const editing = opts.id ? byId(opts.id) : null;
    const level = editing ? levelOf(editing) : opts.level;
    const parentId = editing ? editing.parentId : opts.parentId;
    const isLeaf = editing ? !hasChildren(editing.id) : true;
    const assist = document.body.dataset.mode === 'assist';
    const eg = examples(level);
    const n = editing || {};

    let start = n.startDate || '';
    let end = n.endDate || '';
    // 新規の子は、初期値として親の日程を受け継ぐ(サブスケジュール←スケジュール等)。
    if (!editing && parentId) {
      const parent = byId(parentId);
      const psp = parent
        ? (effectiveSpan(parent) || (parent.startDate && parent.endDate
            ? { start: parseDate(parent.startDate), end: parseDate(parent.endDate) } : null))
        : null;
      if (psp) { start = fmtDate(psp.start); end = fmtDate(psp.end); }
    }
    let dur = '';
    if (start && end) dur = Holidays.countWorkingDays(parseDate(start), parseDate(end));

    const egHint = (txt) => assist ? `<span class="eg-hint">${escapeHtml(txt)}</span>` : '';
    const statusSeg = isLeaf ? `
      <div class="field">
        <label>状態</label>
        <div class="seg" data-status="${n.status || 'todo'}">
          <button type="button" data-st="todo" class="${(n.status||'todo')==='todo'?'on todo':''}">未着手</button>
          <button type="button" data-st="doing" class="${n.status==='doing'?'on doing':''}">進行中</button>
          <button type="button" data-st="done" class="${n.status==='done'?'on done':''}">完了</button>
        </div>
      </div>` : `<div class="field"><label>状態</label><p style="font-size:12px;color:var(--text-muted);margin:0">子タスクから自動集計されます(現在: ${statusLabel(effectiveStatus(editing))})</p></div>`;

    // 先行タスク(依存関係)— 既存の葉タスクを編集するときだけ表示
    let depsField = '';
    if (editing && isLeaf) {
      const preds = Dependencies.predecessorsOf(editing.id);
      const others = Dependencies.leafTasks().filter(t => t.id !== editing.id);
      if (others.length) {
        const predOpts = others.map(t =>
          `<label style="display:flex;align-items:center;gap:8px;font-weight:400;margin-bottom:4px">
             <input type="checkbox" name="pred" value="${t.id}" ${preds.includes(t.id) ? 'checked' : ''} style="width:auto;height:auto">
             ${escapeHtml(t.name)}
           </label>`).join('');
        depsField = `<div class="field"><label>先行タスク(これが終わってから開始)</label>
          <div style="max-height:120px;overflow:auto;border:1px solid var(--border);border-radius:7px;padding:8px">${predOpts}</div>
          ${assist ? '<span class="eg-hint">チェックすると、先行タスクの終了に合わせて自動で日程が調整されます</span>' : ''}</div>`;
      }
    }

    const dateFields = isLeaf ? `
      <div class="field row2">
        <div><label>開始日</label><input type="date" name="startDate" value="${start}">${egHint('例: 2026-08-01')}</div>
        <div><label>期間(稼働日)</label><input type="number" name="duration" min="1" value="${dur}">${egHint('例: 10')}</div>
      </div>
      <div class="field"><label>終了日(自動計算 / 直接入力可)</label><input type="date" name="endDate" value="${end}">${egHint('土日・祝日を除いて計算します')}</div>
    ` : `<div class="field"><label>期間</label><p style="font-size:12px;color:var(--text-muted);margin:0">子の期間から自動で決まります。</p></div>`;

    UI.openModal(`
      <div class="modal-head"><h2>${editing ? LEVEL_NAME[level] + 'を編集' : LEVEL_NAME[level] + 'を追加'}</h2></div>
      <form>
        <div class="modal-body">
          <div class="field">
            <label>${LEVEL_NAME[level]}名</label>
            <input name="name" value="${escapeHtml(n.name || '')}" placeholder="${assist ? '' : LEVEL_NAME[level] + '名'}" autocomplete="off">
            ${egHint('例: ' + eg.name)}
          </div>
          ${dateFields}
          <div class="field">
            <label>担当者</label>
            <input name="assignee" value="${escapeHtml(n.assignee || '')}" autocomplete="off">
            ${egHint('例: 田中さん')}
          </div>
          ${statusSeg}
          ${depsField}
          <div class="field">
            <label>メモ・目的</label>
            <textarea name="note">${escapeHtml(n.note || '')}</textarea>
            ${egHint(eg.note)}
          </div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" data-close>キャンセル</button>
          <button type="submit" class="btn primary">${editing ? '保存' : '追加'}</button>
        </div>
      </form>
    `, {
      onOpen(modal) {
        // ステータスセグメント
        const seg = modal.querySelector('.seg');
        if (seg) seg.querySelectorAll('button').forEach(b => b.onclick = () => {
          seg.dataset.status = b.dataset.st;
          seg.querySelectorAll('button').forEach(x => x.className = '');
          b.className = 'on ' + b.dataset.st;
        });
        // 日付 ↔ 期間の相互自動計算
        const sIn = modal.querySelector('[name=startDate]');
        const dIn = modal.querySelector('[name=duration]');
        const eIn = modal.querySelector('[name=endDate]');
        if (sIn && dIn && eIn) {
          const fromDur = () => {
            const s = parseDate(sIn.value); const d = parseInt(dIn.value, 10);
            if (s && d >= 1) eIn.value = fmtDate(Holidays.endAfterWorkingDays(s, d));
          };
          const fromEnd = () => {
            const s = parseDate(sIn.value); const e = parseDate(eIn.value);
            if (s && e && dayDiff(s, e) >= 0) dIn.value = Holidays.countWorkingDays(s, e);
          };
          sIn.onchange = () => { if (dIn.value) fromDur(); else fromEnd(); };
          dIn.oninput = fromDur;
          eIn.onchange = fromEnd;
        }
      },
      onSubmit(form) {
        const name = form.name.value.trim();
        if (!name) { toast('名称を入力してください'); return false; }
        const seg = form.querySelector('.seg');
        const status = seg ? seg.dataset.status : (n.status || 'todo');
        const data = {
          name,
          assignee: form.assignee.value.trim(),
          startDate: form.startDate ? form.startDate.value : (n.startDate || ''),
          endDate: form.endDate ? form.endDate.value : (n.endDate || ''),
          status,
          note: form.note.value.trim(),
        };
        if (editing) {
          const predIds = isLeaf
            ? Array.from(form.querySelectorAll('input[name=pred]:checked')).map(i => i.value)
            : null;
          saveNode(editing.id, data, predIds);
        } else add(parentId, level, data);
      }
    });
  }

  function statusLabel(s) { return { todo: '未着手', doing: '進行中', done: '完了' }[s] || '未着手'; }

  // --- 変更操作 ---
  async function add(parentId, level, data) {
    History.snapshot();
    const siblings = childrenOf(parentId);
    const node = {
      id: uid('s'), projectId: state.project.id, parentId: parentId || null,
      order: siblings.length, ...data,
    };
    state.schedules.push(node);
    await DB.put('schedules', node, { action: 'add', label: `${LEVEL_NAME[level]}「${data.name}」を追加` });
    await Projects.touch();
    Store.setUiState({ selectedId: node.id }, []);
    afterChange();
  }

  async function saveNode(id, data, predIds) {
    History.snapshot();
    const node = byId(id);
    Object.assign(node, data);
    await DB.put('schedules', node, { action: 'edit', label: `「${node.name}」を編集` });
    await Projects.touch();
    if (predIds) await Dependencies.setPredecessors(id, predIds);
    await Dependencies.rescheduleFrom(id);
    afterChange();
  }

  // ドラッグ等からの日付更新(モーダルを介さない)。
  async function updateDates(id, startDate, endDate) {
    History.snapshot();
    const node = byId(id);
    node.startDate = startDate; node.endDate = endDate;
    await DB.put('schedules', node, { action: 'edit', label: `「${node.name}」の期間を変更` });
    await Projects.touch();
    await Dependencies.rescheduleFrom(id);
    afterChange();
  }

  async function setStatus(id, status) {
    History.snapshot();
    const node = byId(id);
    node.status = status;
    await DB.put('schedules', node, { action: 'edit', label: `「${node.name}」を${statusLabel(status)}に` });
    await Projects.touch();
    afterChange();
  }

  async function del(id) {
    const node = byId(id);
    const ok = await UI.confirm(`「${node.name}」${hasChildren(id) ? 'と、その配下すべて' : ''}を削除します。よろしいですか?`, { danger: true, okLabel: '削除' });
    if (!ok) return;
    History.snapshot();
    // 子孫を集める(自分自身は最後に別途 remove してログを残す)
    const descIds = [];
    (function collect(pid) { for (const c of state.schedules.filter(n => n.parentId === pid)) { descIds.push(c.id); collect(c.id); } })(id);
    const allIds = descIds.concat([id]);
    // 依存関係も掃除
    const deps = state.dependencies.filter(d => allIds.includes(d.fromId) || allIds.includes(d.toId));
    state.schedules = state.schedules.filter(n => !allIds.includes(n.id));
    state.dependencies = state.dependencies.filter(d => !allIds.includes(d.fromId) && !allIds.includes(d.toId));
    await DB.bulkRemove('schedules', descIds);
    await DB.bulkRemove('dependencies', deps.map(d => d.id));
    await DB.remove('schedules', id, { projectId: state.project.id, action: 'delete', label: `「${node.name}」を削除` });
    await Projects.touch();
    if (uiState.selectedId === id) Store.setUiState({ selectedId: null }, []);
    afterChange();
  }

  async function reorder(id, newParentId, newOrder) {
    History.snapshot();
    const node = byId(id);
    node.parentId = newParentId;
    node.order = newOrder;
    // 兄弟の order を詰め直す
    childrenOf(newParentId).forEach((n, i) => { n.order = i; });
    for (const n of childrenOf(newParentId)) await DB.put('schedules', n);
    await Projects.touch();
    afterChange();
  }

  function afterChange() {
    Store.renderAll();
  }

  return {
    childrenOf, byId, levelOf, hasChildren, computeNumbering, flattenForDisplay,
    effectiveStatus, effectiveSpan, renderTree, openEditor, add, saveNode, del, reorder,
    updateDates, setStatus, LEVEL_NAME, MAX_LEVEL, statusLabel,
  };
})();
