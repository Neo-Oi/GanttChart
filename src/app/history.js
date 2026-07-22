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

  // スナップショットを DB とメモリの両方へ反映する(undo と履歴ロールバックの共通処理)。
  // 一旦プロジェクトの3ドメインを消してから書き戻す。
  async function applySnapshot(snap) {
    const pid = state.project.id;
    for (const store of ['schedules', 'milestones', 'dependencies']) {
      const cur = await DB.getAllByProject(store, pid);
      await DB.bulkRemove(store, cur.map(r => r.id));
    }
    for (const n of snap.schedules) await DB.put('schedules', { ...n, projectId: pid });
    for (const m of snap.milestones) await DB.put('milestones', { ...m, projectId: pid });
    for (const d of snap.dependencies) await DB.put('dependencies', { ...d, projectId: pid });
    state.schedules = snap.schedules.map(x => ({ ...x }));
    state.milestones = snap.milestones.map(x => ({ ...x }));
    state.dependencies = snap.dependencies.map(x => ({ ...x }));
    await Projects.touch();
  }

  async function undo() {
    const stack = uiState.undoStack.slice();
    const snap = stack.pop();
    if (!snap) return;
    Store.setUiState({ undoStack: stack }, []);
    await applySnapshot(snap);
    toast('元に戻しました');
    Store.renderAll();
  }

  const ACTION_LABEL = { add: '追加', edit: '変更', delete: '削除' };

  async function openPanel() {
    // 履歴ログを最新の状態で読み直す(変更のたびに state を更新していないため)。
    const fresh = await DB.getAllByProject('historyLog', state.project.id);
    fresh.sort((a, b) => b.at - a.at);
    Store.setState({ history: fresh }, []);
    const items = fresh.length
      ? fresh.map(h => {
          const act = h.action || 'edit';
          const tag = ACTION_LABEL[act] || '変更';
          return `
          <div class="hist-item hist-${act}">
            <div class="hist-line">
              <span class="hist-tag hist-${act}">${tag}</span>
              <span class="what">${escapeHtml(h.label || tag)}</span>
            </div>
            <div class="hist-foot">
              <span class="when">${new Date(h.at).toLocaleString('ja-JP')}</span>
              ${h.snap ? `<button class="btn mini-restore" data-restore="${h.id}">この時点に戻す</button>` : ''}
            </div>
          </div>`;
        }).join('')
      : '<p style="color:var(--text-faint)">まだ変更履歴はありません。</p>';
    const h = UI.openPanel(`
      <div class="panel-head"><h2>変更履歴</h2><button class="icon-btn" data-close>✕</button></div>
      <div class="panel-body">
        <p class="hist-legend"><span class="hist-tag hist-add">追加</span><span class="hist-tag hist-edit">変更</span><span class="hist-tag hist-delete">削除</span></p>
        ${items}
      </div>
    `, {
      onOpen(panel) {
        panel.querySelectorAll('[data-restore]').forEach(b => {
          b.onclick = () => restoreTo(b.dataset.restore, h);
        });
      }
    });
  }

  // 指定した履歴時点のスナップショットに戻す(ロールバック)。この操作自体も undo 可能。
  async function restoreTo(entryId, panelHandle) {
    const entry = state.history.find(e => e.id === entryId);
    if (!entry || !entry.snap) return;
    // #panelHost はモーダルより前面(z-index)なので、開いたまま UI.confirm を呼ぶと
    // 確認モーダルがこのパネルの背景に隠れて見えなくなる。先に閉じてから確認する
    // (TaskPanel.closeThen と同じ対策)。
    if (panelHandle) panelHandle.close();
    const ok = await UI.confirm('この時点の状態に戻します。よろしいですか?(この操作も「元に戻す」で取り消せます)', { okLabel: '戻す' });
    if (!ok) return;
    snapshot(); // 復元前の状態を undo スタックへ
    await applySnapshot(entry.snap);
    toast('この時点に戻しました');
    Store.renderAll();
  }

  return { snapshot, canUndo, undo, openPanel, restoreTo };
})();
