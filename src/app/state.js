// ==== app/state.js ====
// 共有可変ストア + タグスコープの pub/sub。

// 選択中プロジェクトのドメインデータ(プロジェクト切替のたびに全再読み込み)。
const state = {
  projects: [],       // 全プロジェクトのメタ(一覧用)
  project: null,      // 選択中プロジェクト
  schedules: [],      // schedule/subschedule/task を統合した木ノード
  milestones: [],
  dependencies: [],
  notes: [],          // プロジェクトの複数メモ(名前付き Markdown)
  history: [],        // 選択中プロジェクトの historyLog
};

// UI専用の一時状態(再レンダリングで消えてはいけないもの)。
const uiState = {
  selectedId: null,       // 選択中ツリーノード
  collapsed: {},          // { nodeId: true } 折りたたみ
  granularity: 'day',     // day/week/month/quarter
  undoStack: [],          // 直近のスナップショット(元に戻す用)
  currentNoteId: null,    // メモパネルで編集中のメモID
};

const Store = (() => {
  const subs = [];  // { tags:Set, fn }

  function subscribe(tags, fn) {
    subs.push({ tags: new Set(tags), fn });
  }

  function _notify(tags) {
    const t = new Set(tags);
    for (const s of subs) {
      for (const tag of t) {
        if (s.tags.has(tag)) { s.fn(); break; }
      }
    }
  }

  function setState(patch, tags) {
    Object.assign(state, patch);
    _notify(tags || []);
  }

  function setUiState(patch, tags) {
    Object.assign(uiState, patch);
    _notify(tags || []);
  }

  // タグ指定なしで、全レンダー関数を呼ぶ(プロジェクト切替など全面更新時)。
  function renderAll() {
    const seen = new Set();
    for (const s of subs) {
      if (seen.has(s.fn)) continue;
      seen.add(s.fn);
      s.fn();
    }
  }

  return { subscribe, setState, setUiState, renderAll };
})();
