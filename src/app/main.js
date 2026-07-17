// ==== app/main.js ====
// 全体の配線。DOMContentLoaded で一度だけ初期化・イベント委譲を行う。

async function init() {
  await DB.open();

  // レンダー関数をタグで購読(main で一度だけ配線)。
  Store.subscribe(['header'], renderHeader);
  Store.subscribe(['tree'], Schedules.renderTree);
  Store.subscribe(['gantt'], Gantt.renderGantt);
  Store.subscribe(['assist'], Assist.renderAssist);

  wireHeader();
  wireTree();
  wireGantt();
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

// ---- ヘッダー操作 ----
function wireHeader() {
  document.getElementById('projectSelect').onchange = (e) => Projects.select(e.target.value);
  document.getElementById('newProjectBtn').onclick = openNewProjectDialog;
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
    if (bar) { selectNode(bar.dataset.bar); Gantt.beginDrag(e, bar); }
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
}

function selectNode(id) {
  Store.setUiState({ selectedId: id }, []);
  Schedules.renderTree(); Gantt.renderGantt();
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
            <button type="button" data-m="assist" class="on done">アシスト(初学者向け・緑)</button>
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
        b.className = 'on done';
      });
      const tplInput = modal.querySelector('[name=template]');
      const cards = modal.querySelectorAll('.template-card');
      function markTpl(key) { cards.forEach(c => c.style.borderColor = c.dataset.tpl === key ? 'var(--accent)' : ''); }
      markTpl(tplInput.value);
      cards.forEach(c => c.onclick = () => { tplInput.value = c.dataset.tpl; markTpl(c.dataset.tpl); });
    },
    onSubmit(form, modal) {
      const name = form.name.value.trim() || '新しいプロジェクト';
      const mode = modal.querySelector('.seg').dataset.mode;
      const tpl = form.template.value;
      Projects.create(name, mode, tpl);
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
