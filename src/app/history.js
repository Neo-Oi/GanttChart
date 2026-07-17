// ==== app/history.js ====
// 元に戻す(undo)と変更履歴の表示。
// undo は「選択中プロジェクトのドメイン配列のスナップショット」を積み、復元する簡潔な方式。

const History = (() => {
  const MAX = 40;

  // 変更の直前に呼ぶ。現在のドメイン状態を deep copy して積む。
  function snapshot() {
    const snap = {
      schedules: state.schedules.map(x => ({ ...x })),
      milestones: state.milestones.map(x => ({ ...x })),
      dependencies: state.dependencies.map(x => ({ ...x })),
    };
    const stack = uiState.undoStack.slice();
    stack.push(snap);
    if (stack.length > MAX) stack.shift();
    Store.setUiState({ undoStack: stack }, ['header']);
  }

  function canUndo() { return uiState.undoStack.length > 0; }

  async function undo() {
    const stack = uiState.undoStack.slice();
    const snap = stack.pop();
    if (!snap) return;
    Store.setUiState({ undoStack: stack }, []);

    // DB を現在の内容から差し替える: 一旦プロジェクトの3ドメインを消して、スナップショットを書き戻す。
    const pid = state.project.id;
    for (const store of ['schedules', 'milestones', 'dependencies']) {
      const cur = await DB.getAllByProject(store, pid);
      await DB.bulkRemove(store, cur.map(r => r.id));
    }
    for (const n of snap.schedules) await DB.put('schedules', n);
    for (const m of snap.milestones) await DB.put('milestones', m);
    for (const d of snap.dependencies) await DB.put('dependencies', d);

    state.schedules = snap.schedules;
    state.milestones = snap.milestones;
    state.dependencies = snap.dependencies;
    await Projects.touch();
    toast('元に戻しました');
    Store.renderAll();
  }

  async function openPanel() {
    // 履歴ログを最新の状態で読み直す(変更のたびに state を更新していないため)。
    const fresh = await DB.getAllByProject('historyLog', state.project.id);
    fresh.sort((a, b) => b.at - a.at);
    Store.setState({ history: fresh }, []);
    const items = fresh.length
      ? fresh.map(h => `
          <div class="hist-item">
            <span class="when">${new Date(h.at).toLocaleString('ja-JP')}</span><br>
            <span class="what">${escapeHtml(h.label || h.action)}</span>
          </div>`).join('')
      : '<p style="color:var(--text-faint)">まだ変更履歴はありません。</p>';
    UI.openPanel(`
      <div class="panel-head"><h2>変更履歴</h2><button class="icon-btn" data-close>✕</button></div>
      <div class="panel-body">${items}</div>
    `);
  }

  async function refresh() {
    if (!state.project) return;
    const fresh = await DB.getAllByProject('historyLog', state.project.id);
    fresh.sort((a, b) => b.at - a.at);
    Store.setState({ history: fresh }, []);
  }

  return { snapshot, canUndo, undo, openPanel, refresh };
})();
