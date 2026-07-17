// ==== app/notes.js ====
// プロジェクトメモ(Markdown)。タスクの洗い出し・下書き用。
// 編集(テキストエリア)とプレビューを同時に表示し、.mdファイルの読み込み・書き出しができる。
// 履歴(history.js)の追跡対象外(CLAUDE.md の HISTORY_DOMAINS 参照)。

const NotesPanel = (() => {
  function open() {
    if (!state.project) return;
    const md = state.project.notesMd || '';
    UI.openPanel(`
      <div class="panel-head">
        <h2>プロジェクトメモ</h2>
        <button class="icon-btn" data-close>✕</button>
      </div>
      <div class="panel-sub">
        <div class="tp-hint">タスクの洗い出し・下書きに使えます。スケジュール/サブスケジュール/タスクの追加・編集画面からも参照できます。Markdown記法(見出し #、箇条書き -、チェックリスト - [ ]、太字 **太字**)が使えます。</div>
      </div>
      <div class="panel-body notes-body">
        <textarea id="notesEditor" class="notes-editor">${escapeHtml(md)}</textarea>
        <div class="notes-preview md-preview" id="notesPreview"></div>
      </div>
      <div class="panel-foot notes-foot">
        <button type="button" class="btn" id="notesImportBtn">📄 読み込む</button>
        <button type="button" class="btn" id="notesExportBtn">📄 書き出す</button>
        <button type="button" class="btn primary" id="notesSaveBtn">保存</button>
        <input type="file" accept=".md,text/markdown" id="notesFileInput" hidden>
      </div>
    `, {
      onOpen(panel) {
        const ta = panel.querySelector('#notesEditor');
        const preview = panel.querySelector('#notesPreview');
        const update = () => {
          const html = renderMarkdownSafe(ta.value);
          preview.innerHTML = html || '<p class="notes-preview-empty">ここにプレビューが表示されます。</p>';
        };
        update();
        ta.addEventListener('input', update);

        const fileInput = panel.querySelector('#notesFileInput');
        panel.querySelector('#notesImportBtn').onclick = () => fileInput.click();
        fileInput.onchange = () => {
          const f = fileInput.files[0];
          if (!f) return;
          const reader = new FileReader();
          reader.onload = () => { ta.value = reader.result; update(); };
          reader.readAsText(f);
        };
        panel.querySelector('#notesExportBtn').onclick = () => {
          const blob = new Blob([ta.value], { type: 'text/markdown' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${state.project.name || 'notes'}.md`;
          a.click();
          URL.revokeObjectURL(url);
        };
        panel.querySelector('#notesSaveBtn').onclick = async () => {
          await Projects.updateNotes(ta.value);
          toast('メモを保存しました');
        };
      }
    });
  }

  return { open };
})();
