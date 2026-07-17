// ==== app/projects.js ====
// プロジェクトの CRUD と切り替え。切替のたびにドメインデータを全再読み込みする。

const Projects = (() => {

  async function loadAll() {
    const projects = await DB.getAll('projects');
    projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    Store.setState({ projects }, []);
    return projects;
  }

  // 選択中プロジェクトのドメインデータを IndexedDB から全ロードして state に載せる。
  async function select(projectId) {
    const project = await DB.get('projects', projectId);
    if (!project) return;
    const [schedules, milestones, dependencies, history] = await Promise.all([
      DB.getAllByProject('schedules', projectId),
      DB.getAllByProject('milestones', projectId),
      DB.getAllByProject('dependencies', projectId),
      DB.getAllByProject('historyLog', projectId),
    ]);
    history.sort((a, b) => b.at - a.at);
    await DB.setMeta('currentProjectId', projectId);
    document.body.dataset.mode = project.mode || 'assist';
    Store.setUiState({ selectedId: null, undoStack: [] }, []);
    Store.setState({ project, schedules, milestones, dependencies, history }, []);
    Store.renderAll();
  }

  async function create(name, mode, templateKey, notesMd, startDate, endDate) {
    const now = Date.now();
    const project = {
      id: uid('p'), name: name || '新しいプロジェクト', mode: mode || 'assist',
      notesMd: notesMd || '', startDate: startDate || '', endDate: endDate || '',
      createdAt: now, updatedAt: now,
    };
    await DB.put('projects', project);
    if (templateKey && templateKey !== 'blank') {
      await Assist.applyTemplate(project.id, templateKey);
    }
    await loadAll();
    await select(project.id);
    return project;
  }

  // プロジェクトの基本設定(名称・期間)を更新する。期間は上限3年(呼び出し側で検証済み)。
  async function updateSettings(patch) {
    if (!state.project) return;
    const p = { ...state.project, ...patch, updatedAt: Date.now() };
    await DB.put('projects', p);
    await loadAll();
    Store.setState({ project: p }, []);
    Store.renderAll();
  }

  async function rename(name) {
    return updateSettings({ name });
  }

  // プロジェクトのメモ(Markdown。タスクの洗い出し・下書き用)を更新する。
  async function updateNotes(notesMd) {
    if (!state.project) return;
    const p = { ...state.project, notesMd, updatedAt: Date.now() };
    await DB.put('projects', p);
    Store.setState({ project: p }, []);
  }

  async function setMode(mode) {
    if (!state.project || state.project.mode === mode) return;
    const p = { ...state.project, mode, updatedAt: Date.now() };
    await DB.put('projects', p);
    document.body.dataset.mode = mode;
    Store.setState({ project: p }, []);
    Store.renderAll();
  }

  async function touch() {
    // ドメイン変更時に updatedAt を進める(一覧の並び順のため)。
    if (!state.project) return;
    const p = { ...state.project, updatedAt: Date.now() };
    await DB.put('projects', p);
    state.project = p;
  }

  async function remove(projectId) {
    // 関連ドメインを全削除してからプロジェクトを消す。
    for (const store of ['schedules', 'milestones', 'dependencies', 'comments', 'notes', 'historyLog']) {
      const recs = await DB.getAllByProject(store, projectId);
      await DB.bulkRemove(store, recs.map(r => r.id));
    }
    await DB.remove('projects', projectId);
    const projects = await loadAll();
    if (state.project && state.project.id === projectId) {
      if (projects.length) await select(projects[0].id);
      else await select(await ensureOne());
    }
  }

  // プロジェクトが1つも無ければ既定を1つ作る。
  async function ensureOne() {
    const projects = await DB.getAll('projects');
    if (projects.length) return projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0].id;
    const p = await create('はじめてのプロジェクト', 'assist', 'teamdev');
    return p.id;
  }

  return { loadAll, select, create, rename, updateNotes, updateSettings, setMode, touch, remove, ensureOne };
})();
