// ===== Tier 1 自動テスト(純ロジックのみ・DOM/IndexedDB 非依存)=====
// INTEGRATION_TEST.md の Tier 1(段階1・2・3、および段階9の集計/採番/依存の純サブセット)を
// 自動検証する。util/holidays/state/schedules/dependencies の「呼び出し時に外部モジュールへ
// 前方参照しない純関数」だけを対象にする(toast・DB・描画・レイアウトは対象外)。
//
// 実行方法(どちらでも同一結果):
//  (A) Node: リポジトリ直下で
//      cat src/app/util.js src/app/holidays.js src/app/state.js \
//          src/app/schedules.js src/app/dependencies.js tests/tier1-tests.js > /tmp/_run.js && node /tmp/_run.js
//  (B) ブラウザ Console: dist/index.html を開き、本ファイルの ok/eq 以降のテスト本体を貼り付けて実行
//      (util〜dependencies は既に読み込まれているため、先頭の連結は不要)
//
// 期待: SUMMARY pass=51 fail=0 (ALL PASS)。詳細は INTEGRATION_TEST.md 付録E。

let pass = 0, fail = 0;
const fails = [];
function ok(id, cond, detail) {
  if (cond) { pass++; console.log(`PASS ${id}  ${detail || ''}`); }
  else { fail++; fails.push(id); console.log(`FAIL ${id}  ${detail || ''}`); }
}
function eq(id, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  ok(id, a === e, `expected=${e} actual=${a}`);
}

// ---- 段階1: util ----
ok('1-1a', uid().startsWith('id_'), `uid()=${uid()}`);
ok('1-1b', uid('task').startsWith('task_'), `uid('task')=${uid('task')}`);
ok('1-1c', uid() !== uid(), 'uid() 2回で相違(一意)');
eq('1-2', escapeHtml('<b> & " \''), '&lt;b&gt; &amp; &quot; &#39;');
{
  const d = parseDate('2026-07-21');
  ok('1-3a', d && d.getFullYear() === 2026 && d.getMonth() === 6 && d.getDate() === 21, `parseDate('2026-07-21')=${d}`);
  ok('1-3b', parseDate('') === null, `parseDate('')=${parseDate('')}`);
  ok('1-3c', parseDate('20260721') === null, `parseDate('20260721')(区切り無し)=${parseDate('20260721')}`);
  eq('1-3d', fmtDate(parseDate('2026-13-01')), '2027-01-01'); // 桁上がり(不正でもnullにならない)
  eq('1-3e', fmtDate(parseDate('2026-02-30')), '2026-03-02'); // 桁上がり
}
eq('1-4', fmtDate(parseDate('2026-07-21')), '2026-07-21');
eq('1-5', dayDiff(parseDate('2026-07-21'), parseDate('2026-08-01')), 11);
eq('1-6', fmtDate(addDays(parseDate('2026-07-21'), 10)), '2026-07-31');
eq('1-7a', isWeekend(parseDate('2026-07-18')), true);  // 土
eq('1-7b', isWeekend(parseDate('2026-07-19')), true);  // 日
eq('1-7c', isWeekend(parseDate('2026-07-21')), false); // 火
eq('1-8a', periodWithinYears('2026-01-01', '2026-12-31', 3), true);
eq('1-8b', periodWithinYears('2026-12-31', '2026-01-01', 3), false); // 逆転
eq('1-8c', periodWithinYears('2026-01-01', '2030-01-02', 3), false); // 超過(3年=2029-01-01)
{
  const md = '# 見出し\n- 項目\n- [x] 完了項目\n**太字** と <script>alert(1)</script>';
  const html = renderMarkdownSafe(md);
  ok('1-9a', html.includes('<h3>見出し</h3>'), '見出し→h3');
  ok('1-9b', html.includes('<ul class="md-list">') && html.includes('<li>項目</li>'), '箇条書き→li');
  ok('1-9c', html.includes('type="checkbox" disabled checked'), 'チェック済み');
  ok('1-9d', html.includes('<strong>太字</strong>'), '太字→strong');
  ok('1-9e', html.includes('&lt;script&gt;') && !html.includes('<script>'), 'HTMLタグはエスケープされ実行されない');
}
// 段階1で個別項目にしていない純util(間接確認対象)も実測
eq('1-x-addYears', fmtDate(addYears(parseDate('2026-07-21'), 3)), '2029-07-21');
eq('1-x-fmtRange', fmtRangeLabel(parseDate('2026-07-21')), '7/21');
{
  const t = todayDate(), now = new Date();
  ok('1-x-today', t.getFullYear() === now.getFullYear() && t.getMonth() === now.getMonth() && t.getDate() === now.getDate() && t.getHours() === 0,
    `todayDate()=${fmtDate(t)}(実行日基準・時刻0)`);
}

// ---- 段階2: holidays ----
ok('2-1a', typeof Holidays.isHoliday === 'function', 'Holidays ロード');
eq('2-1b', Holidays.isHoliday(parseDate('2026-01-01')), true); // 元日
// 2-2 振替休日: 日曜の祝日の翌日が休日化される(2024〜2030 の全日曜祝日で検証)
{
  let sundayHolidays = 0, satisfied = 0, example = '';
  let d = parseDate('2024-01-01');
  const end = parseDate('2030-12-31');
  while (dayDiff(d, end) >= 0) {
    if (Holidays.isHoliday(d) && d.getDay() === 0) {
      sundayHolidays++;
      if (Holidays.isHoliday(addDays(d, 1))) { satisfied++; if (!example) example = `${fmtDate(d)}(日)→翌${fmtDate(addDays(d, 1))}休`; }
    }
    d = addDays(d, 1);
  }
  ok('2-2', sundayHolidays > 0 && satisfied === sundayHolidays, `日曜祝日${sundayHolidays}件すべてで翌日が休日 例:${example}`);
}
// 2-3 稼働日数(祝日/週末を挟む)
{
  const wd = Holidays.countWorkingDays(parseDate('2026-07-20'), parseDate('2026-07-31'));
  console.log(`  [実測] countWorkingDays(2026-07-20〜07-31) = ${wd}`);
  eq('2-3a', wd, 9); // 稼働日: 21,22,23,24,27,28,29,30,31 = 9(20=海の日/祝, 25土26日を除外)
  eq('2-3b', Holidays.countWorkingDays(parseDate('2026-07-31'), parseDate('2026-07-20')), 0); // start>end
}
// 2-4 endAfterWorkingDays / nextWorkingDay
{
  const e = Holidays.endAfterWorkingDays(parseDate('2026-07-20'), 3);
  console.log(`  [実測] endAfterWorkingDays(2026-07-20, 3) = ${fmtDate(e)}`);
  eq('2-4a', fmtDate(e), '2026-07-23'); // 起点は次稼働日07-21、稼働3日=21,22,23
  eq('2-4b', fmtDate(Holidays.nextWorkingDay(parseDate('2026-07-20'))), '2026-07-21'); // 祝日→次稼働日
  eq('2-4c', fmtDate(Holidays.nextWorkingDay(parseDate('2026-07-21'))), '2026-07-21'); // 稼働日はそのまま
}

// ---- 段階3: state / Store(純: タグ配線)----
{
  let cx = 0, cy = 0;
  Store.subscribe(['x'], () => cx++);
  Store.subscribe(['y'], () => cy++);
  Store.setState({}, ['x']); ok('3-2a', cx === 1 && cy === 0, `x発火のみ cx=${cx} cy=${cy}`);
  Store.setState({}, []);    ok('3-2b', cx === 1 && cy === 0, `空タグは非発火 cx=${cx} cy=${cy}`);
  Store.setState({}, ['y']); ok('3-2c', cx === 1 && cy === 1, `y発火 cx=${cx} cy=${cy}`);
}
{
  let cf = 0; const f = () => cf++;
  Store.subscribe(['a'], f); Store.subscribe(['b'], f); // 同一 fn を2エントリで購読
  Store.renderAll();                                    // renderAll は fn で重複排除
  ok('3-3', cf === 1, `renderAll は同一fnを1回だけ呼ぶ cf=${cf}`);
}
{
  state.foo = 'keep';
  Store.setState({ bar: 1 }, []);
  ok('3-4', state.foo === 'keep' && state.bar === 1, `マージ: foo保持 bar追加 (foo=${state.foo}, bar=${state.bar})`);
  delete state.foo; delete state.bar;
}

// ---- 段階9(純サブセット): schedules 集計・採番 / dependencies 純 ----
{
  state.schedules = [
    { id: 's1', projectId: 'p', parentId: null, order: 0, name: 'S1', status: 'todo' },
    { id: 's2', projectId: 'p', parentId: 's1', order: 0, name: 'S2', status: 'todo' },
    { id: 't1', projectId: 'p', parentId: 's2', order: 0, name: 'T1', status: 'doing', startDate: '2026-08-03', endDate: '2026-08-07' },
    { id: 't2', projectId: 'p', parentId: 's2', order: 1, name: 'T2', status: 'done', startDate: '2026-08-10', endDate: '2026-08-14' },
  ];
  uiState.collapsed = {};
  const nums = Schedules.computeNumbering();
  eq('9-2', [nums.s1, nums.s2, nums.t1, nums.t2], ['1', '1.1', '1.1.1', '1.1.2']);
  eq('9-3a', Schedules.effectiveStatus(Schedules.byId('s2')), 'doing'); // doing+done → doing
  Schedules.byId('t1').status = 'done';
  eq('9-3b', Schedules.effectiveStatus(Schedules.byId('s2')), 'done');
  eq('9-3c-s1', Schedules.effectiveStatus(Schedules.byId('s1')), 'done'); // 親も集計
  Schedules.byId('t1').status = 'todo'; Schedules.byId('t2').status = 'todo';
  eq('9-3d', Schedules.effectiveStatus(Schedules.byId('s2')), 'todo');
  Schedules.byId('t1').status = 'doing'; Schedules.byId('t2').status = 'done';
  const sp = Schedules.effectiveSpan(Schedules.byId('s2'));
  eq('9-3e-span', [fmtDate(sp.start), fmtDate(sp.end)], ['2026-08-03', '2026-08-14']); // 子の min/max
  eq('9-1a-level', [Schedules.levelOf(Schedules.byId('s1')), Schedules.levelOf(Schedules.byId('s2')), Schedules.levelOf(Schedules.byId('t1'))], [0, 1, 2]);
  eq('9-1b-haschild', [Schedules.hasChildren('s1'), Schedules.hasChildren('s2'), Schedules.hasChildren('t1')], [true, true, false]);
  eq('9-1c-flatten', Schedules.flattenForDisplay().map(r => r.node.id), ['s1', 's2', 't1', 't2']);
  eq('statusLabel', [Schedules.statusLabel('todo'), Schedules.statusLabel('doing'), Schedules.statusLabel('done')], ['未着手', '進行中', '完了']);
  state.dependencies = [{ id: 'd1', projectId: 'p', fromId: 't1', toId: 't2' }];
  eq('9-dep-pred', Dependencies.predecessorsOf('t2'), ['t1']);
  eq('9-dep-leaf', Dependencies.leafTasks().map(n => n.id).sort(), ['t1', 't2']); // 葉のみ
}

console.log(`\nSUMMARY pass=${pass} fail=${fail}` + (fail ? ` FAILED:[${fails.join(', ')}]` : ' (ALL PASS)'));
