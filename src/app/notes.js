// ==== app/notes.js ====
// プロジェクトメモ(Markdown)。タスクの洗い出し・下書き用。
// 「開いたまま作業したい」という要望から、モーダル/サイドパネル(#modalHost/#panelHost、
// 背景をブロックする全画面オーバーレイ)は使わず、右下にドッキングする非モーダルな
// 浮遊パネル(#notesFloatHost)として実装する。開いている間も、ツリー/ガント/他のモーダルは
// 通常どおり操作できる。
// 履歴(history.js)の追跡対象外(CLAUDE.md の HISTORY_DOMAINS 参照)。

const NotesPanel = (() => {
  // 直近にこのプロジェクトIDで中身を組み立てたかを覚えておく。
  // 他の操作(スケジュール追加など)による全体再描画のたびに中身を作り直すと、
  // 開いたまま入力中の未保存テキストが消えてしまうため、
  // 「プロジェクトが変わった/初めて開いた」ときだけ組み立て直す。
  let builtForProjectId = null;

  function host() { return document.getElementById('notesFloatHost'); }

  function build() {
    const h = host();
    const md = state.project.notesMd || '';
    h.innerHTML = `
      <div class="panel-head">
        <h2>プロジェクトメモ</h2>
        <button class="icon-btn" id="notesFloatClose" title="閉じる(内容は保持されます)">✕</button>
      </div>
      <div class="panel-sub">
        <div class="notes-tabs">
          <button type="button" class="notes-tab on" data-nt="edit">編集</button>
          <button type="button" class="notes-tab" data-nt="preview">プレビュー</button>
        </div>
      </div>
      <div class="panel-body notes-body">
        <textarea id="notesEditor" class="notes-editor" placeholder="タスクの洗い出し・下書きに。Markdown記法(見出し #、箇条書き -、チェックリスト - [ ]、太字 **）が使えます。">${escapeHtml(md)}</textarea>
        <div class="notes-preview md-preview" id="notesPreview" hidden></div>
      </div>
      <div class="panel-foot notes-foot">
        <button type="button" class="btn" id="notesImportBtn">📄 読み込む</button>
        <button type="button" class="btn" id="notesExportBtn">📄 書き出す</button>
        <button type="button" class="btn primary" id="notesSaveBtn">保存</button>
        <input type="file" accept=".md,text/markdown" id="notesFileInput" hidden>
      </div>`;

    const ta = h.querySelector('#notesEditor');
    const preview = h.querySelector('#notesPreview');
    const update = () => {
      const html = renderMarkdownSafe(ta.value);
      preview.innerHTML = html || '<p class="notes-preview-empty">まだ何も書かれていません。</p>';
    };

    // 編集/プレビューのタブ切替(インライン式: 同じ場所に片方だけ表示)。
    const tabs = h.querySelectorAll('.notes-tab');
    const showTab = (which) => {
      tabs.forEach(t => t.classList.toggle('on', t.dataset.nt === which));
      const isEdit = which === 'edit';
      ta.hidden = !isEdit;
      preview.hidden = isEdit;
      if (!isEdit) update();
    };
    tabs.forEach(t => t.onclick = () => showTab(t.dataset.nt));

    h.querySelector('#notesFloatClose').onclick = close;

    const fileInput = h.querySelector('#notesFileInput');
    h.querySelector('#notesImportBtn').onclick = () => fileInput.click();
    fileInput.onchange = () => {
      const f = fileInput.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => { ta.value = reader.result; update(); };
      reader.readAsText(f);
    };
    h.querySelector('#notesExportBtn').onclick = () => {
      const blob = new Blob([ta.value], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${state.project.name || 'notes'}.md`;
      a.click();
      URL.revokeObjectURL(url);
    };
    h.querySelector('#notesSaveBtn').onclick = async () => {
      await Projects.updateNotes(ta.value);
      toast('メモを保存しました');
    };

    builtForProjectId = state.project.id;
  }

  function open() {
    if (!state.project) return;
    if (builtForProjectId !== state.project.id) build();
    host().classList.remove('hidden');
  }

  function close() {
    host().classList.add('hidden');
  }

  function toggle() {
    if (host().classList.contains('hidden')) open();
    else close();
  }

  // 他の操作による全体再描画に追随する。
  // ノーマルモードでは常時表示(自動で開く)。アシストモードでは、開いているときだけ内容を追随
  // (閉じているなら未保存テキストを壊さないよう何もしない)。
  // どちらも、プロジェクトが切り替わったときだけ中身を作り直す。
  function refresh() {
    if (!state.project) { builtForProjectId = null; return; }
    const normal = document.body.dataset.mode === 'normal';
    if (normal) {
      if (builtForProjectId !== state.project.id) build();
      host().classList.remove('hidden');   // ノーマルは常に表示
      return;
    }
    if (host().classList.contains('hidden')) return;
    if (builtForProjectId !== state.project.id) build();
  }

  return { open, close, toggle, refresh };
})();
