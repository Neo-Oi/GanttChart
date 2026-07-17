// ==== app/assist.js ====
// アシストモードの「次にやることガイド」(常設サイドパネルのチェックリスト)とテンプレート。

const Assist = (() => {

  const TEMPLATES = {
    teamdev: {
      title: 'チーム開発',
      desc: '定義 / 設計 / 実装 / フォロー',
      phases: [
        { name: '定義', subs: [
          { name: '機能要件定義', tasks: ['ヒアリング', '要求一覧作成'] },
          { name: '非機能要件定義', tasks: ['性能・セキュリティ要件整理'] },
        ] },
        { name: '設計', subs: [
          { name: '基本設計書作成', tasks: ['画面設計', 'データ設計'] },
          { name: '詳細設計書作成', tasks: ['モジュール設計'] },
        ] },
        { name: '実装', subs: [
          { name: '機能A実装', tasks: ['実装', 'コードレビュー'] },
          { name: '機能B実装', tasks: ['実装'] },
        ] },
        { name: 'フォロー', subs: [
          { name: '受入テスト', tasks: ['テスト実施', '不具合修正'] },
          { name: 'リリース対応', tasks: ['リリース作業'] },
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
      { done: hasMs, title: '5. 節目を置く(任意)', body: '納期やレビュー会などの目印を立てましょう。', eg: 'ガント上部の「＋ 節目」から追加' },
    ];
  }

  function renderAssist() {
    const host = document.getElementById('assistGuide');
    if (document.body.dataset.mode !== 'assist' || !state.project) { host.innerHTML = ''; return; }
    const list = steps();
    const activeIdx = list.findIndex(s => !s.done);
    host.innerHTML = `
      <div class="assist-head">
        <h2>次にやること</h2>
        <p>この順に進めれば、迷わずスケジュールが完成します。</p>
      </div>
      <ul class="guide-steps">
        ${list.map((s, i) => `
          <li class="guide-step ${s.done ? 'done' : ''} ${i === activeIdx ? 'active' : ''}">
            <span class="guide-check">✓</span>
            <div class="guide-body">
              <h3>${escapeHtml(s.title)}</h3>
              <p>${escapeHtml(s.body)}</p>
              <span class="eg">${escapeHtml(s.eg)}</span>
            </div>
          </li>`).join('')}
      </ul>
      <div class="assist-tip">迷ったら、上の見本の言葉をそのまま真似して大丈夫。あとから何度でも直せます。</div>
    `;
  }

  return { templateList, applyTemplate, renderAssist };
})();
