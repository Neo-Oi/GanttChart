// ==== app/db.js ====
// 生の IndexedDB を Promise でラップ。ラッパーライブラリは使わない。
// 変更は必ず DB.put / DB.remove を経由する(履歴ロギングもここで行う)。

const DB = (() => {
  const DB_NAME = 'ganttchart';
  const DB_VERSION = 1;
  // projectId でインデックスするドメインストア。
  const DOMAIN_STORES = ['schedules', 'milestones', 'dependencies', 'comments', 'notes', 'historyLog'];
  // 履歴追跡の対象(CLAUDE.md / SPEC.md)。schedules にはタスクも含まれる。
  const HISTORY_DOMAINS = ['schedules', 'milestones', 'comments'];

  let _db = null;

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects', { keyPath: 'id' });
        }
        for (const s of DOMAIN_STORES) {
          if (!db.objectStoreNames.contains(s)) {
            const store = db.createObjectStore(s, { keyPath: 'id' });
            store.createIndex('projectId', 'projectId', { unique: false });
          }
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(store, mode) { return _db.transaction(store, mode).objectStore(store); }

  function reqP(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function getAll(store) { return reqP(tx(store, 'readonly').getAll()); }

  function getAllByProject(store, projectId) {
    return reqP(tx(store, 'readonly').index('projectId').getAll(projectId));
  }

  function get(store, id) { return reqP(tx(store, 'readonly').get(id)); }

  async function put(store, record, historyMeta) {
    await reqP(tx(store, 'readwrite').put(record));
    if (historyMeta && HISTORY_DOMAINS.includes(store)) {
      await _log(record.projectId, historyMeta);
    }
    return record;
  }

  async function remove(store, id, historyMeta) {
    let projectId = historyMeta && historyMeta.projectId;
    await reqP(tx(store, 'readwrite').delete(id));
    if (historyMeta && HISTORY_DOMAINS.includes(store)) {
      await _log(projectId, historyMeta);
    }
  }

  // 生トランザクションでの一括削除(カスケード)。onsuccess 連鎖で await を挟まない。
  function bulkRemove(store, ids) {
    if (!ids.length) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = _db.transaction(store, 'readwrite');
      const os = t.objectStore(store);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      for (const id of ids) os.delete(id);
    });
  }

  const HISTORY_MAX = 80; // 履歴(スナップショット付き)の保持件数の上限

  async function _log(projectId, meta) {
    const entry = {
      id: uid('h'),
      projectId,
      at: Date.now(),
      action: meta.action || 'change',
      label: meta.label || '',
      // 変更「後」の状態スナップショット。この時点への復元(ロールバック)に使う。
      // 呼び出し元は state.* を更新してから DB.put/remove するので、ここでは反映済みの状態が取れる。
      snap: {
        schedules: (state.schedules || []).map(x => ({ ...x })),
        milestones: (state.milestones || []).map(x => ({ ...x })),
        dependencies: (state.dependencies || []).map(x => ({ ...x })),
      },
    };
    await reqP(tx('historyLog', 'readwrite').put(entry));
    // 上限を超えた古い履歴を間引く(スナップショット付きで肥大化するため)。
    await _pruneHistory(projectId);
  }

  async function _pruneHistory(projectId) {
    const all = await getAllByProject('historyLog', projectId);
    if (all.length <= HISTORY_MAX) return;
    all.sort((a, b) => a.at - b.at); // 古い順
    const excess = all.slice(0, all.length - HISTORY_MAX);
    await bulkRemove('historyLog', excess.map(e => e.id));
  }

  // meta ストア(選択中プロジェクトIDなど)
  function getMeta(key) { return reqP(tx('meta', 'readonly').get(key)); }
  function setMeta(key, value) { return reqP(tx('meta', 'readwrite').put({ key, value })); }

  return {
    open, getAll, getAllByProject, get, put, remove, bulkRemove,
    getMeta, setMeta, HISTORY_DOMAINS,
  };
})();
