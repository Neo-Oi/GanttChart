// ==== app/assist.js ====
// アシストモードの「次にやることガイド」(常設サイドパネルのチェックリスト)とテンプレート。

const Assist = (() => {

  const TEMPLATES = {
    teamdev: {
      title: 'チーム開発',
      desc: '定義 / 設計 / 実装 / フォロー',
      phases: [
        { name: '定義', subs: [
          { name: '要件定義', tasks: ['ヒアリング', '要求一覧作成'] },
        ] },
        { name: '設計', subs: [
          { name: '基本設計', tasks: ['画面・データ設計'] },
        ] },
        { name: '実装', subs: [
          { name: '実装', tasks: ['実装', 'コードレビュー'] },
        ] },
        { name: 'フォロー', subs: [
          { name: 'テスト・リリース', tasks: ['受入テスト'] },
        ] },
      ],
    },
  };

  function templateList() {
    return Object.keys(TEMPLATES).map(k => ({ key: k, ...TEMPLATES[k] }));
  }

  // テンプレートから schedules を DB に直接書き込む(select() 前に呼ばれる)。
  async function applyTemplate(projectId, key) {
    const tpl = TEMPLATES[key];
    if (!tpl) return;
    let cursor = Holidays.nextWorkingDay(todayDate());
    let po = 0;
    for (const phase of tpl.phases) {
      const pid = uid('s');
      await DB.put('schedules', { id: pid, projectId, parentId: null, order: po++, name: phase.name, status: 'todo', assignee: '', startDate: '', endDate: '', note: '' });
      let so = 0;
      for (const sub of phase.subs) {
        const sid = uid('s');
        await DB.put('schedules', { id: sid, projectId, parentId: pid, order: so++, name: sub.name, status: 'todo', assignee: '', startDate: '', endDate: '', note: '' });
        let to = 0;
        for (const taskName of (sub.tasks || [])) {
          const start = cursor;
          const end = Holidays.endAfterWorkingDays(start, 3);
          await DB.put('schedules', { id: uid('s'), projectId, parentId: sid, order: to++, name: taskName, status: 'todo', assignee: '', startDate: fmtDate(start), endDate: fmtDate(end), note: '' });
          cursor = Holidays.nextWorkingDay(addDays(end, 1));
        }
      }
    }
  }

  // --- ガイド ---
  function steps() {
    const lv0 = state.schedules.some(n => Schedules.levelOf(n) === 0);
    const lv1 = state.schedules.some(n => Schedules.levelOf(n) === 1);
    const lv2 = state.schedules.some(n => Schedules.levelOf(n) === 2);
    const hasDates = state.schedules.some(n => !Schedules.hasChildren(n.id) && n.startDate && n.endDate);
    const hasMs = state.milestones.length > 0;
    return [
      { done: lv0, title: '1. スケジュールを書く', body: 'まずは大きな流れ(フェーズ)を並べましょう。', eg: '例: 定義 / 設計 / 実装 / フォロー' },
      { done: lv1, title: '2. サブスケジュールを追加', body: '各フェーズの中身を、成果物・工程の単位で分けます。', eg: '例:「定義」→ 機能要件定義 / 非機能要件定義' },
      { done: lv2, title: '3. タスクを設定', body: '実際に手を動かす単位まで分解します。', eg: '例:「機能要件定義」→ ヒアリング / 要求一覧作成' },
      { done: hasDates, title: '4. 期間を入れる', body: 'タスクに開始日と期間(稼働日)を入れると、バーが表示されます。', eg: '土日・祝日は自動で除外されます' },
      { done: hasMs, title: '5. マイルストーンを置く(任意)', body: '納期やレビュー会などの目印を立てましょう。', eg: 'クリックでマイルストーンを追加' },
    ];
  }

  // ガイド項目クリック時の動作。もっとも役立つモーダルを開く。
  function runStep(i) {
    if (i === 0) { Schedules.openEditor({ parentId: null, level: 0 }); return; }
    if (i === 1) {
      const s0 = state.schedules.find(n => Schedules.levelOf(n) === 0);
      if (s0) Schedules.openEditor({ parentId: s0.id, level: 1 });
      else { toast('先に「スケジュール」を追加しましょう'); Schedules.openEditor({ parentId: null, level: 0 }); }
      return;
    }
    if (i === 2) {
      const s1 = state.schedules.find(n => Schedules.levelOf(n) === 1);
      if (s1) Schedules.openEditor({ parentId: s1.id, level: 2 });
      else toast('先に「サブスケジュール」を追加しましょう');
      return;
    }
    if (i === 3) {
      const leaf = state.schedules.find(n => !Schedules.hasChildren(n.id) && (!n.startDate || !n.endDate));
      if (leaf) Schedules.openEditor({ id: leaf.id });
      else toast('すべてのタスクに期間が入っています');
      return;
    }
    if (i === 4) { Milestones.openEditor(null); return; }
  }

  // 全ステップ完了後の「できること」アクション一覧。
  function actions() {
    return [
      { key: 'schedule', icon: '＋', title: 'スケジュール追加', body: '新しいフェーズを追加します。' },
      { key: 'sub', icon: '＋', title: 'サブスケ追加', body: '成果物・工程を追加します。' },
      { key: 'task', icon: '＋', title: 'タスク設定', body: '具体的な作業を追加します。' },
      { key: 'milestone', icon: '◆', title: 'マイルストーン選択', body: '納期やレビュー会などの目印を置きます。' },
      { key: 'memo', icon: '📝', title: 'メモ出し', body: 'プロジェクトメモを開きます。' },
    ];
  }

  function runAction(key) {
    if (key === 'schedule') return runStep(0);
    if (key === 'sub') return runStep(1);
    if (key === 'task') return runStep(2);
    if (key === 'milestone') return Milestones.openEditor(null);
    if (key === 'memo') return NotesPanel.open();
  }

  function renderAssist() {
    const host = document.getElementById('assistGuide');
    if (document.body.dataset.mode !== 'assist' || !state.project) { host.innerHTML = ''; return; }
    const list = steps();
    const allDone = list.every(s => s.done);

    if (allDone) {
      // すべて完了 → 「できること」アクション一覧に変化。
      host.innerHTML = `
        <div class="assist-head">
          <h2>できること</h2>
          <p>ひととおり揃いました。ここから自由に追加・編集できます。</p>
        </div>
        <div class="guide-steps">
          ${actions().map(a => `
            <button type="button" class="guide-step action" data-action="${a.key}">
              <span class="guide-check act">${a.icon}</span>
              <div class="guide-body">
                <h3>${escapeHtml(a.title)}</h3>
                <p>${escapeHtml(a.body)}</p>
              </div>
              <span class="go">›</span>
            </button>`).join('')}
        </div>
        <div class="assist-tip">全ステップ完了 🎉 いつでもここから操作できます。</div>
      `;
      return;
    }

    const activeIdx = list.findIndex(s => !s.done);
    host.innerHTML = `
      <div class="assist-head">
        <h2>次にやること</h2>
        <p>この順に進めれば、迷わずスケジュールが完成します。</p>
      </div>
      <div class="guide-steps">
        ${list.map((s, i) => `
          <button type="button" class="guide-step ${s.done ? 'done' : ''} ${i === activeIdx ? 'active' : ''}" data-step="${i}">
            <span class="guide-check">✓</span>
            <div class="guide-body">
              <h3>${escapeHtml(s.title)}</h3>
              <p>${escapeHtml(s.body)}</p>
              <span class="eg">${escapeHtml(s.eg)}</span>
            </div>
            <span class="go">›</span>
          </button>`).join('')}
      </div>
      <div class="assist-tip">迷ったら、上の見本の言葉をそのまま真似して大丈夫。あとから何度でも直せます。</div>
    `;
  }

  return { templateList, applyTemplate, renderAssist, runStep, runAction };
})();
