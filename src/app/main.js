// ==== app/main.js ====
// 全体の配線。DOMContentLoaded で一度だけ初期化・イベント委譲を行う。

async function init() {
  await DB.open();

  // レンダー関数をタグで購読(main で一度だけ配線)。
  Store.subscribe(['header'], renderHeader);
  Store.subscribe(['tree'], Schedules.renderTree);
  Store.subscribe(['gantt'], Gantt.renderGantt);
  Store.subscribe(['assist'], Assist.renderAssist);
  Store.subscribe(['gantt', 'tree'], renderProgress);
  Store.subscribe(['gantt', 'tree'], TaskPanel.refresh);
  Store.subscribe(['gantt', 'tree', 'header'], NotesPanel.refresh);

  wireHeader();
  wireTree();
  wireGantt();
  wireAssist();
  wireScrollSync();
  wireKeyboard();

  await Projects.loadAll();
  const id = await Projects.ensureOne();
  await Projects.select(id);
}

// ---- ヘッダー描画 ----
function renderHeader() {
  const sel = document.getElementById('projectSelect');
  sel.innerHTML = state.projects.map(p =>
    `<option value="${p.id}" ${state.project && p.id === state.project.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
  ).join('');
  document.getElementById('granularitySelect').value = uiState.granularity;
  document.getElementById('undoBtn').disabled = !History.canUndo();
}

// ---- 全体の進捗バー ----
function renderProgress() {
  const strip = document.getElementById('progressStrip');
  const legend = `<span class="pr-sub">
      <span class="status-dot todo"></span>未着手
      <span class="status-dot doing" style="margin-left:8px"></span>進行中
      <span class="status-dot done" style="margin-left:8px"></span>完了</span>`;
  if (!state.project) { strip.className = 'progress-strip hidden'; strip.innerHTML = ''; return; }
  const leaves = state.schedules.filter(n => !Schedules.hasChildren(n.id));
  strip.className = 'progress-strip';
  if (!leaves.length) {
    strip.innerHTML = `<span class="pr-label">全体の進捗</span>
      <div class="pr-track"><div class="pr-fill" style="width:0%"></div></div>
      <span class="pr-pct">–</span><span class="pr-sub">タスクを追加すると進捗が表示されます</span>`;
    return;
  }
  let sum = 0, done = 0;
  for (const l of leaves) {
    const s = Schedules.effectiveStatus(l);
    sum += s === 'done' ? 1 : s === 'doing' ? 0.5 : 0;
    if (s === 'done') done++;
  }
  const pct = Math.round(sum / leaves.length * 100);
  strip.innerHTML = `<span class="pr-label">全体の進捗</span>
    <div class="pr-track"><div class="pr-fill" style="width:${pct}%"></div></div>
    <span class="pr-pct">${pct}%</span>
    <span class="pr-sub">タスク ${done}/${leaves.length} 完了</span>
    ${legend}`;
}

// ---- ヘッダー操作 ----
function wireHeader() {
  document.getElementById('projectSelect').onchange = (e) => Projects.select(e.target.value);
  document.getElementById('newProjectBtn').onclick = openNewProjectDialog;
  document.getElementById('projectMenuBtn').onclick = openProjectSettings;
  document.getElementById('notesBtn').onclick = () => NotesPanel.toggle();
  document.getElementById('modeToggle').onclick = (e) => {
    const btn = e.target.closest('[data-mode]');
    if (btn) Projects.setMode(btn.dataset.mode);
  };
  document.getElementById('granularitySelect').onchange = (e) => {
    Store.setUiState({ granularity: e.target.value }, []);
    Gantt.renderGantt();
  };
  document.getElementById('addScheduleBtn').onclick = () => Schedules.openEditor({ parentId: null, level: 0 });
  document.getElementById('addMilestoneBtn').onclick = () => Milestones.openEditor(null);
  document.getElementById('undoBtn').onclick = () => History.undo();
  document.getElementById('historyBtn').onclick = () => History.openPanel();
  document.getElementById('exportBtn').onclick = () => ExportImport.openMenu();
}

// ---- ツリー(イベント委譲)----
function wireTree() {
  const list = document.getElementById('treeList');
  list.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-toggle]');
    if (toggle) {
      const id = toggle.dataset.toggle;
      const collapsed = { ...uiState.collapsed, [id]: !uiState.collapsed[id] };
      Store.setUiState({ collapsed }, []);
      Schedules.renderTree(); Gantt.renderGantt();
      return;
    }
    const addChild = e.target.closest('[data-addchild]');
    if (addChild) {
      const parent = Schedules.byId(addChild.dataset.addchild);
      Schedules.openEditor({ parentId: parent.id, level: Schedules.levelOf(parent) + 1 });
      return;
    }
    const tasks = e.target.closest('[data-tasks]');
    if (tasks) { TaskPanel.open(tasks.dataset.tasks); return; }
    const edit = e.target.closest('[data-edit]');
    if (edit) { Schedules.openEditor({ id: edit.dataset.edit }); return; }
    const del = e.target.closest('[data-del]');
    if (del) { Schedules.del(del.dataset.del); return; }
    const row = e.target.closest('[data-id]');
    if (row) selectNode(row.dataset.id);
  });
}

// ---- ガント(イベント委譲)----
function wireGantt() {
  const body = document.getElementById('ganttBody');
  body.addEventListener('mousedown', (e) => {
    const bar = e.target.closest('.bar[data-bar]');
    if (bar) {
      // selectNode() は Gantt.renderGantt() で #ganttBody を丸ごと差し替えるため、
      // ここで呼ぶと掴んだ直後に bar 自身がDOMから外れ、以後のドラッグ演出(半透明化・
      // ゴースト・追従)が「もう画面にない要素」に対する操作になり何も見えなくなる。
      // 選択状態はツリー側にだけ反映し、ガントの再描画はドラッグ終了後の通常フローに任せる。
      Store.setUiState({ selectedId: bar.dataset.bar }, []);
      Schedules.renderTree();
      Gantt.beginDrag(e, bar);
    }
  });
  body.addEventListener('click', (e) => {
    const ms = e.target.closest('[data-ms]');
    if (ms) { Milestones.openEditor(ms.dataset.ms); return; }
    const row = e.target.closest('[data-row]');
    if (row && !e.target.closest('.bar')) selectNode(row.dataset.row);
  });
  body.addEventListener('dblclick', (e) => {
    const bar = e.target.closest('.bar[data-bar]');
    if (bar) Schedules.openEditor({ id: bar.dataset.bar });
  });
  // マイルストーンの旗はヘッダー(#ganttHeader)に移動したので、こちらでもクリックを拾う。
  document.getElementById('ganttHeader').addEventListener('click', (e) => {
    const ms = e.target.closest('[data-ms]');
    if (ms) Milestones.openEditor(ms.dataset.ms);
  });
}

function selectNode(id) {
  Store.setUiState({ selectedId: id }, []);
  Schedules.renderTree(); Gantt.renderGantt();
}

// ---- アシストガイド(項目クリックで対応モーダルを開く)----
function wireAssist() {
  document.getElementById('assistGuide').addEventListener('click', (e) => {
    const step = e.target.closest('[data-step]');
    if (step) Assist.runStep(parseInt(step.dataset.step, 10));
  });
}

// ---- プロジェクト設定(名称変更 / 削除)----
function openProjectSettings() {
  if (!state.project) return;
  const p = state.project;
  UI.openModal(`
    <div class="modal-head"><h2>プロジェクト設定</h2></div>
    <form>
      <div class="modal-body">
        <div class="field">
          <label>プロジェクト名</label>
          <input name="name" value="${escapeHtml(p.name)}" autocomplete="off">
        </div>
        <div class="field">
          <label>削除</label>
          <button type="button" class="btn danger" data-del style="width:100%">🗑 このプロジェクトを削除</button>
          <span class="eg-hint">このプロジェクトのスケジュール・マイルストーンなどがすべて消えます(元に戻せません)。</span>
        </div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn" data-close>閉じる</button>
        <button type="submit" class="btn primary">名前を保存</button>
      </div>
    </form>
  `, {
    onOpen(modal) {
      modal.querySelector('[data-del]').onclick = async () => {
        const ok = await UI.confirm(`「${p.name}」を削除します。よろしいですか?`, { danger: true, okLabel: '削除' });
        if (!ok) return;
        await Projects.remove(p.id);
        toast('プロジェクトを削除しました');
      };
    },
    onSubmit(form) {
      const name = form.name.value.trim();
      if (!name) { toast('名前を入力してください'); return false; }
      Projects.rename(name);
    }
  });
}

// ---- スクロール同期 ----
function wireScrollSync() {
  const body = document.getElementById('ganttBody');
  const header = document.getElementById('ganttHeader');
  const tree = document.getElementById('treeList');
  let lock = false;
  body.addEventListener('scroll', () => {
    header.scrollLeft = body.scrollLeft;
    if (lock) return; lock = true;
    tree.scrollTop = body.scrollTop;
    lock = false;
  });
  tree.addEventListener('scroll', () => {
    if (lock) return; lock = true;
    body.scrollTop = tree.scrollTop;
    lock = false;
  });
}

// ---- キーボード ----
function wireKeyboard() {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      // 入力中は無効
      const t = e.target.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
      e.preventDefault();
      History.undo();
    }
  });
}

// ---- 新規プロジェクト ----
function openNewProjectDialog() {
  const templates = Assist.templateList();
  UI.openModal(`
    <div class="modal-head"><h2>新しいプロジェクト</h2></div>
    <form>
      <div class="modal-body">
        <div class="field">
          <label>プロジェクト名</label>
          <input name="name" value="" placeholder="例: 新サービス開発" autocomplete="off">
        </div>
        <div class="field">
          <label>モード</label>
          <div class="seg" data-mode="assist">
            <button type="button" data-m="assist" class="on accent">アシスト(初学者向け・緑)</button>
            <button type="button" data-m="normal" class="">ノーマル(経験者向け・青)</button>
          </div>
        </div>
        <div class="field">
          <label>テンプレート</label>
          <div class="template-grid">
            ${templates.map(t => `
              <button type="button" class="template-card" data-tpl="${t.key}">
                <h4>${escapeHtml(t.title)}</h4><p>${escapeHtml(t.desc)}</p>
              </button>`).join('')}
            <button type="button" class="template-card" data-tpl="blank">
              <h4>空から始める</h4><p>何もない状態から自由に</p>
            </button>
          </div>
          <input type="hidden" name="template" value="${templates[0] ? templates[0].key : 'blank'}">
        </div>
        <div class="field">
          <label>メモ(Markdown・任意)</label>
          <textarea name="notesMd" class="notes-editor notes-editor-sm" placeholder="タスクの洗い出し・下書きに。あとから編集もできます"></textarea>
          <div class="notes-import-row">
            <button type="button" class="btn" id="npNotesFileBtn">📄 .mdファイルを読み込む</button>
            <input type="file" accept=".md,text/markdown" id="npNotesFile" hidden>
          </div>
          <span class="eg-hint">例: 「- 要件を洗い出す」「- [ ] キックオフMTGの日程調整」のように書いておくと、スケジュール/サブスケジュール/タスクの追加画面で見ながら入力できます</span>
        </div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn" data-close>キャンセル</button>
        <button type="submit" class="btn primary">作成</button>
      </div>
    </form>
  `, {
    onOpen(modal) {
      const seg = modal.querySelector('.seg');
      seg.querySelectorAll('button').forEach(b => b.onclick = () => {
        seg.dataset.mode = b.dataset.m;
        seg.querySelectorAll('button').forEach(x => x.className = '');
        b.className = 'on accent';
      });
      const tplInput = modal.querySelector('[name=template]');
      const cards = modal.querySelectorAll('.template-card');
      function markTpl(key) { cards.forEach(c => c.style.borderColor = c.dataset.tpl === key ? 'var(--accent)' : ''); }
      markTpl(tplInput.value);
      cards.forEach(c => c.onclick = () => { tplInput.value = c.dataset.tpl; markTpl(c.dataset.tpl); });

      const notesFile = modal.querySelector('#npNotesFile');
      modal.querySelector('#npNotesFileBtn').onclick = () => notesFile.click();
      notesFile.onchange = () => {
        const f = notesFile.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => { modal.querySelector('[name=notesMd]').value = reader.result; };
        reader.readAsText(f);
      };
    },
    onSubmit(form, modal) {
      const name = form.name.value.trim() || '新しいプロジェクト';
      const mode = modal.querySelector('.seg').dataset.mode;
      const tpl = form.template.value;
      const notesMd = form.notesMd.value;
      Projects.create(name, mode, tpl, notesMd);
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
