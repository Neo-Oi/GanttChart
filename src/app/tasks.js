// ==== app/tasks.js ====
// タスク管理画面(サブスケジュールから開くサイドパネル)。
// タスクはガント本体にも表示されるが、このパネルでは一覧で手早く追加・編集・状態変更・削除できる。
// データ変更は Store.renderAll を経由するため、このパネルは購読(refresh)で自動更新される。

const TaskPanel = (() => {
  let openSubId = null;

  function open(subId) {
    openSubId = subId;
    UI.openPanel(`
      <div class="panel-head">
        <h2>タスク管理</h2>
        <button class="icon-btn" data-close>✕</button>
      </div>
      <div class="panel-sub" id="taskPanelSub"></div>
      <div class="panel-body" id="taskPanelBody"></div>
      <div class="panel-foot"><button class="btn primary" id="taskAddBtn" style="width:100%">＋ タスクを追加</button></div>
    `, {
      onOpen(panel) {
        const body = panel.querySelector('#taskPanelBody');
        body.addEventListener('click', (e) => {
          const taskEl = e.target.closest('[data-task]');
          if (!taskEl) return;
          const st = e.target.closest('[data-st]');
          if (st) { Schedules.setStatus(taskEl.dataset.task, st.dataset.st); return; }
          if (e.target.closest('[data-edit]')) { Schedules.openEditor({ id: taskEl.dataset.task }); return; }
          if (e.target.closest('[data-del]')) { Schedules.del(taskEl.dataset.task); return; }
        });
        panel.querySelector('#taskAddBtn').onclick = () =>
          Schedules.openEditor({ parentId: openSubId, level: 2 });
        renderBody();
      }
    });
  }

  function renderBody() {
    const body = document.getElementById('taskPanelBody');
    const sub = document.getElementById('taskPanelSub');
    if (!body || !sub) return;
    const s = Schedules.byId(openSubId);
    if (!s) { sub.innerHTML = '<div class="tp-subname">(削除されました)</div>'; body.innerHTML = ''; return; }
    sub.innerHTML = `<div class="tp-subname">${escapeHtml(s.name)}</div>
      <div class="tp-hint">このサブスケジュールに属するタスクを管理します。状態の○は左から 未着手 / 進行中 / 完了。</div>`;
    const tasks = Schedules.childrenOf(openSubId);
    if (!tasks.length) {
      body.innerHTML = `<p class="tp-empty">まだタスクがありません。<br>下の「＋ タスクを追加」から作りましょう。</p>`;
      return;
    }
    body.innerHTML = tasks.map(t => {
      const st = t.status || 'todo';
      const span = (t.startDate && t.endDate) ? `${t.startDate} 〜 ${t.endDate}` : '期間未設定';
      return `<div class="tp-task" data-task="${t.id}">
        <div class="seg-mini">
          <button data-st="todo" class="todo ${st === 'todo' ? 'on' : ''}" title="未着手"></button>
          <button data-st="doing" class="doing ${st === 'doing' ? 'on' : ''}" title="進行中"></button>
          <button data-st="done" class="done ${st === 'done' ? 'on' : ''}" title="完了"></button>
        </div>
        <div class="tp-main">
          <div class="tp-name">${escapeHtml(t.name)}</div>
          <div class="tp-meta">${escapeHtml(span)}${t.assignee ? ' ・ ' + escapeHtml(t.assignee) : ''}</div>
        </div>
        <div class="row-actions2">
          <button class="icon-btn" data-edit title="編集">✎</button>
          <button class="icon-btn" data-del title="削除">🗑</button>
        </div>
      </div>`;
    }).join('');
  }

  // Store の再レンダリングに追随してパネルを更新(データ変更時に自動反映)。
  function refresh() {
    if (!openSubId) return;
    const host = document.getElementById('panelHost');
    if (!host || host.classList.contains('hidden')) { openSubId = null; return; }
    renderBody();
  }

  return { open, refresh };
})();
