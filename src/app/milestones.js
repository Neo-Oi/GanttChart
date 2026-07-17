// ==== app/milestones.js ====
// マイルストーン: 期間を持たない、特定日付の目印(納期・レビュー会など)。

const Milestones = (() => {

  function openEditor(id) {
    const editing = id ? state.milestones.find(m => m.id === id) : null;
    const assist = document.body.dataset.mode === 'assist';
    const m = editing || {};
    const h = UI.openModal(`
      <div class="modal-head"><h2>${editing ? 'マイルストーンを編集' : 'マイルストーンを追加'}</h2></div>
      <form>
        <div class="modal-body">
          <div class="field">
            <label>名称</label>
            <input name="name" value="${escapeHtml(m.name || '')}" autocomplete="off">
            ${assist ? '<span class="eg-hint">例: 納品、中間レビュー、リリース</span>' : ''}
          </div>
          <div class="field">
            <label>日付</label>
            <input type="date" name="date" value="${m.date || ''}">
          </div>
        </div>
        <div class="modal-foot">
          ${editing ? '<button type="button" class="btn danger" data-del>削除</button>' : ''}
          <button type="button" class="btn" data-close style="margin-left:auto">キャンセル</button>
          <button type="submit" class="btn primary">${editing ? '保存' : '追加'}</button>
        </div>
      </form>
    `, {
      onOpen(modal) {
        const delBtn = modal.querySelector('[data-del]');
        if (delBtn) delBtn.onclick = async () => { h.close(); await remove(editing.id); };
      },
      onSubmit(form) {
        const name = form.name.value.trim();
        const date = form.date.value;
        if (!name) { toast('名称を入力してください'); return false; }
        if (!date) { toast('日付を入力してください'); return false; }
        if (editing) save(editing.id, { name, date });
        else add({ name, date });
      }
    });
  }

  async function add(data) {
    History.snapshot();
    const m = { id: uid('m'), projectId: state.project.id, ...data };
    state.milestones.push(m);
    await DB.put('milestones', m, { action: 'add', label: `マイルストーン「${data.name}」を追加` });
    await Projects.touch();
    Store.renderAll();
    // 追加した瞬間にその日付が今のスクロール位置の外にあると気づけないため、自動で連れて行く。
    Gantt.scrollToDate(parseDate(m.date));
  }

  async function save(id, data) {
    History.snapshot();
    const m = state.milestones.find(x => x.id === id);
    Object.assign(m, data);
    await DB.put('milestones', m, { action: 'edit', label: `マイルストーン「${m.name}」を編集` });
    await Projects.touch();
    Store.renderAll();
    Gantt.scrollToDate(parseDate(m.date));
  }

  async function remove(id) {
    History.snapshot();
    const m = state.milestones.find(x => x.id === id);
    state.milestones = state.milestones.filter(x => x.id !== id);
    await DB.remove('milestones', id, { projectId: state.project.id, action: 'delete', label: `マイルストーン「${m ? m.name : ''}」を削除` });
    await Projects.touch();
    Store.renderAll();
  }

  // add/save/remove はモーダル経由でのみ呼ばれる(外部公開は openEditor だけ)。
  return { openEditor };
})();
