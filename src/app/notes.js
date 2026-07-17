// ==== app/notes.js ====
// プロジェクトメモ(複数・名前付きの Markdown)。タスクの洗い出し・下書き用。
// 右下ドッキングの非モーダル浮遊パネル。モーダル表示中でも操作できるよう z-index はモーダルより上。
// 左に「メモ一覧(蓄積欄)」、右に編集/プレビュー。メモ名は変更可能。
// メモは `notes` ストアに保存(履歴追跡の対象外)。

const NotesPanel = (() => {
  let builtForProjectId = null;

  function host() { return document.getElementById('notesFloatHost'); }
  function notes() { return state.notes; }
  function current() {
    return notes().find(n => n.id === uiState.currentNoteId) || notes()[0] || null;
  }

  async function persist(note) {
    note.updatedAt = Date.now();
    await DB.put('notes', note);
  }

  function build() {
    const h = host();
    if (!current() && notes().length) uiState.currentNoteId = notes()[0].id;
    h.innerHTML = `
      <div class="panel-head">
        <h2>プロジェクトメモ</h2>
        <button class="icon-btn" id="notesFloatClose" title="閉じる(内容は保持されます)">✕</button>
      </div>
      <div class="notes-cols">
        <div class="notes-list" id="notesList"></div>
        <div class="notes-main" id="notesMain"></div>
      </div>`;
    h.querySelector('#notesFloatClose').onclick = close;
    // 一覧はクリック委譲(一度だけ)。
    h.querySelector('#notesList').addEventListener('click', (e) => {
      const add = e.target.closest('[data-addnote]');
      if (add) { addNote(); return; }
      const item = e.target.closest('[data-note]');
      if (item) selectNote(item.dataset.note);
    });
    renderList();
    renderMain();
    builtForProjectId = state.project.id;
  }

  function renderList() {
    const list = host().querySelector('#notesList');
    if (!list) return;
    const cur = current();
    list.innerHTML = `
      <button type="button" class="btn notes-add" data-addnote>＋ 新規メモ</button>
      <div class="notes-items">
        ${notes().map(n => `
          <button type="button" class="notes-item ${cur && n.id === cur.id ? 'on' : ''}" data-note="${n.id}" title="${escapeHtml(n.name)}">
            ${escapeHtml(n.name || '(無題)')}
          </button>`).join('') || '<p class="notes-empty">メモがありません</p>'}
      </div>`;
  }

  function renderMain() {
    const main = host().querySelector('#notesMain');
    if (!main) return;
    const cur = current();
    if (!cur) {
      main.innerHTML = `<p class="notes-empty" style="padding:20px">「＋ 新規メモ」でメモを作成しましょう。</p>`;
      return;
    }
    main.innerHTML = `
      <input class="notes-name" id="notesName" value="${escapeHtml(cur.name || '')}" placeholder="メモ名" autocomplete="off">
      <div class="notes-tabs">
        <button type="button" class="notes-tab on" data-nt="edit">編集</button>
        <button type="button" class="notes-tab" data-nt="preview">プレビュー</button>
      </div>
      <textarea id="notesEditor" class="notes-editor" placeholder="Markdown(# 見出し / - 箇条書き / - [ ] チェック / **太字**)">${escapeHtml(cur.body || '')}</textarea>
      <div class="notes-preview md-preview" id="notesPreview" hidden></div>
      <div class="notes-foot">
        <button type="button" class="btn" id="notesImportBtn">📄 読込</button>
        <button type="button" class="btn" id="notesExportBtn">📄 書出</button>
        <button type="button" class="btn danger" id="notesDelBtn">削除</button>
        <button type="button" class="btn primary" id="notesSaveBtn">保存</button>
        <input type="file" accept=".md,text/markdown" id="notesFileInput" hidden>
      </div>`;

    const nameIn = main.querySelector('#notesName');
    const ta = main.querySelector('#notesEditor');
    const preview = main.querySelector('#notesPreview');
    const updatePreview = () => {
      preview.innerHTML = renderMarkdownSafe(ta.value) || '<p class="notes-preview-empty">まだ何も書かれていません。</p>';
    };
    // 入力は即メモ(メモリ)へ反映し、切替・保存時に永続化。
    nameIn.oninput = () => { cur.name = nameIn.value; };
    nameIn.onchange = () => { persist(cur); renderList(); };
    ta.oninput = () => { cur.body = ta.value; };

    const tabs = main.querySelectorAll('.notes-tab');
    tabs.forEach(t => t.onclick = () => {
      tabs.forEach(x => x.classList.toggle('on', x === t));
      const isEdit = t.dataset.nt === 'edit';
      ta.hidden = !isEdit; preview.hidden = isEdit;
      if (!isEdit) updatePreview();
    });

    const fileInput = main.querySelector('#notesFileInput');
    main.querySelector('#notesImportBtn').onclick = () => fileInput.click();
    fileInput.onchange = () => {
      const f = fileInput.files[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = () => { ta.value = reader.result; cur.body = reader.result; };
      reader.readAsText(f);
    };
    main.querySelector('#notesExportBtn').onclick = () => {
      const blob = new Blob([ta.value], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${cur.name || 'memo'}.md`; a.click();
      URL.revokeObjectURL(url);
    };
    main.querySelector('#notesSaveBtn').onclick = async () => { await persist(cur); renderList(); toast('メモを保存しました'); };
    main.querySelector('#notesDelBtn').onclick = () => deleteNote(cur.id);
  }

  // いずれも「UIを先に更新 → 永続化は後」にして、保存が失敗/遅延しても表示が固まらないようにする。
  async function addNote() {
    const prev = current();
    const note = { id: uid('n'), projectId: state.project.id, name: `メモ${notes().length + 1}`, body: '', order: notes().length, updatedAt: Date.now() };
    state.notes.push(note);
    uiState.currentNoteId = note.id;
    renderList(); renderMain();
    if (prev) await persist(prev);
    await DB.put('notes', note);
  }

  async function selectNote(id) {
    const prev = current();
    uiState.currentNoteId = id;
    renderList(); renderMain();
    if (prev && prev.id !== id) await persist(prev); // 切替前のメモを保存
  }

  async function deleteNote(id) {
    const note = state.notes.find(n => n.id === id);
    if (!note) return;
    const ok = await UI.confirm(`メモ「${note.name}」を削除します。よろしいですか?`, { danger: true, okLabel: '削除' });
    if (!ok) return;
    state.notes = state.notes.filter(n => n.id !== id);
    if (uiState.currentNoteId === id) uiState.currentNoteId = state.notes.length ? state.notes[0].id : null;
    renderList(); renderMain();
    await DB.remove('notes', id);
  }

  function open() {
    if (!state.project) return;
    if (builtForProjectId !== state.project.id) build();
    host().classList.remove('hidden');
  }
  function close() { host().classList.add('hidden'); }
  function toggle() { host().classList.contains('hidden') ? open() : close(); }

  // 再レンダリング追随。ノーマルは常時表示。プロジェクトが変わったときだけ作り直す。
  function refresh() {
    if (!state.project) { builtForProjectId = null; return; }
    const normal = document.body.dataset.mode === 'normal';
    if (normal) {
      if (builtForProjectId !== state.project.id) build();
      host().classList.remove('hidden');
      return;
    }
    if (host().classList.contains('hidden')) return;
    if (builtForProjectId !== state.project.id) build();
  }

  return { open, close, toggle, refresh };
})();
