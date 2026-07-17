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
          <label>表計算用(Excel で開ける)</label>
          <button type="button" class="btn" data-act="excel" style="width:100%">📊 Excel形式(CSV)で書き出す</button>
          <span class="eg-hint">スケジュール一覧を表として書き出します。Excel でそのまま開けます(UTF-8)。</span>
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
        modal.querySelector('[data-act="excel"]').onclick = () => exportExcel();
        modal.querySelector('[data-act="json-out"]').onclick = () => exportJson();
        modal.querySelector('[data-act="json-in"]').onclick = () => fileIn.click();
        fileIn.onchange = () => { if (fileIn.files[0]) importJson(fileIn.files[0]); };
      }
    });
  }

  function _csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // Excel で開ける CSV(UTF-8 BOM 付き)。スケジュール一覧を表として書き出す。
  function exportExcel() {
    if (!state.project) return;
    const nums = Schedules.computeNumbering();
    const rows = [['番号', '階層', '名称', '開始日', '終了日', '稼働日数', '状態', '担当者', 'メモ']];
    (function walk(parentId, depth) {
      for (const n of Schedules.childrenOf(parentId)) {
        const sp = Schedules.effectiveSpan(n);
        const st = Schedules.statusLabel(Schedules.effectiveStatus(n));
        const wd = sp ? Holidays.countWorkingDays(sp.start, sp.end) : '';
        rows.push([nums[n.id] || '', Schedules.LEVEL_NAME[depth] || '', n.name || '',
          sp ? fmtDate(sp.start) : '', sp ? fmtDate(sp.end) : '', wd, st, n.assignee || '', n.note || '']);
        walk(n.id, depth + 1);
      }
    })(null, 0);
    if (state.milestones.length) {
      rows.push([]);
      rows.push(['マイルストーン', '日付']);
      for (const m of state.milestones) rows.push([m.name || '', m.date || '']);
    }
    const csv = '﻿' + rows.map(r => r.map(_csvCell).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.project.name || 'gantt'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Excel形式(CSV)で書き出しました');
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

  return { openMenu, exportJson, exportExcel, importJson };
})();
