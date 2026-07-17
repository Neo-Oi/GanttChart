// ==== app/dependencies.js ====
// タスク同士の依存関係(先行→後続)。先行の日程が変わると後続を自動リスケジュールする。

const Dependencies = (() => {

  function leafTasks() {
    return state.schedules.filter(n => !Schedules.hasChildren(n.id));
  }

  function predecessorsOf(toId) {
    return state.dependencies.filter(d => d.toId === toId).map(d => d.fromId);
  }

  // fromId → toId を追加すると循環するか?
  function wouldCycle(fromId, toId) {
    // toId から辿って fromId に到達したら循環。
    const stack = [toId];
    const seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (cur === fromId) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const d of state.dependencies.filter(x => x.fromId === cur)) stack.push(d.toId);
    }
    return false;
  }

  // 後続タスク(toId)の先行集合を fromIds に一致させる。
  async function setPredecessors(toId, fromIds) {
    const current = state.dependencies.filter(d => d.toId === toId);
    // 削除
    for (const d of current) {
      if (!fromIds.includes(d.fromId)) {
        state.dependencies = state.dependencies.filter(x => x.id !== d.id);
        await DB.remove('dependencies', d.id);
      }
    }
    // 追加
    for (const fromId of fromIds) {
      if (fromId === toId) continue;
      if (current.some(d => d.fromId === fromId)) continue;
      if (wouldCycle(fromId, toId)) { toast('循環する依存関係は設定できません'); continue; }
      const dep = { id: uid('d'), projectId: state.project.id, fromId, toId };
      state.dependencies.push(dep);
      await DB.put('dependencies', dep);
    }
    // 先行の終了に合わせて後続を寄せる
    for (const fromId of fromIds) await rescheduleFrom(fromId);
  }

  // nodeId(先行)の日程変更を後続へ波及。循環は visited で防止。
  async function rescheduleFrom(nodeId, visited) {
    visited = visited || new Set();
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const from = Schedules.byId(nodeId);
    if (!from) return;
    const fromEnd = parseDate(from.endDate);
    if (!fromEnd) return;
    for (const d of state.dependencies.filter(x => x.fromId === nodeId)) {
      const to = Schedules.byId(d.toId);
      if (!to) continue;
      const earliest = Holidays.nextWorkingDay(addDays(fromEnd, 1));
      const toStart = parseDate(to.startDate);
      if (!toStart || dayDiff(earliest, toStart) < 0) {
        const dur = (to.startDate && to.endDate)
          ? Math.max(1, Holidays.countWorkingDays(parseDate(to.startDate), parseDate(to.endDate))) : 1;
        to.startDate = fmtDate(earliest);
        to.endDate = fmtDate(Holidays.endAfterWorkingDays(earliest, dur));
        await DB.put('schedules', to);
        await rescheduleFrom(to.id, visited);
      }
    }
  }

  return { leafTasks, predecessorsOf, wouldCycle, setPredecessors, rescheduleFrom };
})();
