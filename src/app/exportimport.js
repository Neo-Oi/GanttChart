// ==== app/exportimport.js ====
// JSON エクスポート/インポート(バックアップ・復元用)と、印刷による PDF/画像出力(共有用)。

const ExportImport = (() => {

  function openMenu() {
    UI.openModal(`
      <div class="modal-head"><h2>出力 / バックアップ</h2></div>
      <div class="modal-body">
        <div class="field">
          <label>共有用(閲覧のために書き出す)</label>
          <button type="button" class="btn" data-act="print" style="width:100%">🖨 印刷 / PDF・画像として保存</button>
          <span class="eg-hint">ブラウザの印刷ダイアログから「PDFに保存」を選べます。上司・チームへの共有に。</span>
        </div>
        <div class="field">
          <label>バックアップ用(このプロジェクトのデータ全体)</label>
          <button type="button" class="btn" data-act="json-out" style="width:100%;margin-bottom:8px">⬇ JSONファイルに書き出す</button>
          <button type="button" class="btn" data-act="json-in" style="width:100%">⬆ JSONファイルから読み込む(新規プロジェクトとして)</button>
          <span class="eg-hint">ブラウザのデータ消失に備えた保存・復元用です。</span>
        </div>
        <input type="file" accept="application/json,.json" data-file hidden>
      </div>
      <div class="modal-foot"><button type="button" class="btn" data-close>閉じる</button></div>
    `, {
      onOpen(modal) {
        const fileIn = modal.querySelector('[data-file]');
        modal.querySelector('[data-act="print"]').onclick = () => { window.print(); };
        modal.querySelector('[data-act="json-out"]').onclick = () => exportJson();
        modal.querySelector('[data-act="json-in"]').onclick = () => fileIn.click();
        fileIn.onchange = () => { if (fileIn.files[0]) importJson(fileIn.files[0]); };
      }
    });
  }

  function exportJson() {
    if (!state.project) return;
    const data = {
      app: 'GanttChart', version: 1, exportedAt: new Date().toISOString(),
      project: { name: state.project.name, mode: state.project.mode },
      schedules: state.schedules,
      milestones: state.milestones,
      dependencies: state.dependencies,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.project.name || 'gantt'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('JSONを書き出しました');
  }

  async function importJson(file) {
    let data;
    try { data = JSON.parse(await file.text()); }
    catch { toast('JSONの読み込みに失敗しました'); return; }
    if (!data || data.app !== 'GanttChart' || !Array.isArray(data.schedules)) {
      toast('GanttChart のファイルではありません'); return;
    }
    const now = Date.now();
    const projectId = uid('p');
    const project = { id: projectId, name: (data.project && data.project.name || '読み込んだプロジェクト') + '(復元)', mode: (data.project && data.project.mode) || 'assist', createdAt: now, updatedAt: now };
    await DB.put('projects', project);

    // id を振り直して参照を張り替える。
    const idMap = {};
    for (const n of data.schedules) idMap[n.id] = uid('s');
    for (const n of data.schedules) {
      await DB.put('schedules', { ...n, id: idMap[n.id], projectId, parentId: n.parentId ? (idMap[n.parentId] || null) : null });
    }
    for (const m of (data.milestones || [])) {
      await DB.put('milestones', { ...m, id: uid('m'), projectId });
    }
    for (const d of (data.dependencies || [])) {
      if (!idMap[d.fromId] || !idMap[d.toId]) continue;
      await DB.put('dependencies', { id: uid('d'), projectId, fromId: idMap[d.fromId], toId: idMap[d.toId] });
    }
    document.getElementById('modalHost').classList.add('hidden');
    document.getElementById('modalHost').innerHTML = '';
    await Projects.loadAll();
    await Projects.select(projectId);
    toast('読み込みました');
  }

  return { openMenu, exportJson, importJson };
})();
