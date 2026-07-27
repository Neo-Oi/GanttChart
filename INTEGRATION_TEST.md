# 結合試験 仕様書 兼 実施項目書(サンドイッチ基調のボトムアップ・段階的結合)

## 0. 本書の位置づけと方式選定

### 0-1. 対象と方式

- 対象リポジトリ: `Neo-Oi/GanttChart`(配布物 兼 開発対象は単一の `index.html`)
  - ※本試験の実施当時は `src/` を `build.py` で `dist/index.html` に連結する構成だった。その後 `src/`/`build.py`/`dist/` を廃止し1ファイル(`index.html`)に統合済み。本書のハーネス手順は現行の `index.html` ベースに更新してある(試験結果・判定などの記録内容はそのまま)。
- 結合方式: **段階的結合 × ボトムアップ基調(実態はサンドイッチ)**
  - 方向は下位(依存の少ない基盤)から上位へ積み上げる。
  - ただし一部モジュールは相互依存/前方参照を持つため、純粋なボトムアップにはならず、**相互依存クラスタはまとめて結合し、必要箇所ではスタブを用いる**(理由は 0-4)。
- 実施者: コードはAIが生成し、本試験は人間が手動で実施する。
- 対象コミット: 実施時の `main` HEAD を記録すること(下部「改訂履歴」に記入)。

### 0-2. 結合方式は2つの軸で決まる

| 軸 | 選択肢 | 本件の選択 |
|---|---|---|
| 一気か少しずつか | ビッグバン / 段階的 | **段階的** |
| 結合の方向 | ボトムアップ / トップダウン | **ボトムアップ基調(サンドイッチ)** |

### 0-3. なぜこの方式か(積極的理由)

- **土台のロジックが品質の要**: 日程計算・依存関係・データ層(`util`/`holidays`/`db`/`state`/`schedules`/`dependencies`)が中核であり、ここを先に固める必要がある。ボトムアップはこの順序に合う。
- **単体試験を実施しない方針**のため、不具合が出たら「直前に足したモジュールが原因」と切り分けられる段階的結合が有効。
- **完成済みコードが対象**。したがって本書は「開発と並行して積み上げる」ものではなく、「完成品をあえて分解し、下位から1段階ずつ結合し直して検証する(後追いの段階的結合試験)」ものである。完成品を丸ごと(ビッグバン的に)試験すると切り分けができないため、あえて段階的に行う。

### 0-4.【重要】ロード順(APP_FILES)と結合試験順は一致しない

`index.html` 末尾 `<script>` 内のモジュール連結順序(`// ===== app/xxx.js =====` 区切り。旧 `build.py` の `APP_FILES` に相当)は「**連結して壊れない順序(ロード順)**」であって、「各モジュールが先行モジュールだけに依存するきれいな依存DAG」**ではない**。実コードには次の前方参照・相互依存がある(すべてソースで確認済み):

| 依存 | 実コード根拠 | 種別 |
|---|---|---|
| `db.js` → `state` | `db.js` の `_log()` が `state.schedules/milestones/dependencies` を参照(`db.js:95-97`) | 前方参照 |
| `schedules.js` → `History` | `add/saveNode/updateDates/setStatus/shiftSubtree/del` が `History.snapshot()`(`schedules.js:320,346,367,378,391,424`) | 前方参照 |
| `schedules.js` ⇄ `dependencies.js` | schedules が `Dependencies.setPredecessors/rescheduleFrom`(`:360,361,373`)、dependencies が `Schedules.hasChildren/byId`(`dependencies.js:7,57`) | **相互依存(循環)** |
| `milestones.js` → `History` / `Gantt` | `add/save/remove` が `History.snapshot()`(`milestones.js:47,58,68`)、うち `add/save` はさらに `Gantt.scrollToDate()`(`:54,64`。`remove` は呼ばない) | 前方参照 |
| `projects.js` → `Assist` | `create()`→`Assist.applyTemplate`(`projects.js:50`)、`ensureOne()`→`create(...,'teamdev')`(`:106`) | 前方参照 |

上記の前方参照を持つモジュール(`DB`/`Projects`/`Schedules`/`Milestones`/`Dependencies`)はいずれも `const X = (() => {…})()` の IIFE で本体を包んでおり、外部モジュール参照は関数本体=**呼び出し時**にのみ評価されるため**ロード時には壊れない**(`util.js` の各ヘルパーと `main.js` の `init` 等は前方参照を持たない素のグローバル宣言、`state.js` は `state`/`uiState` がグローバル `const` で `Store` のみ IIFE)。唯一のロード時制約は `holidays.js` が IIFE 本体で `parseDate` を呼ぶ点(=util を先に読む必要、`holidays.js:42`)。しかし前方参照を持つモジュールの**書き込み系関数を実際に呼んだ瞬間**に、未ロードモジュールを参照して `ReferenceError` になる。

したがって本書の結合試験順は、**`APP_FILES` のロード順ではなく、実行時の依存グラフから導出した順序**(4章)を用いる。導出の結果、前方参照は「基盤モジュールの並べ替え」でほぼ解消でき、**残る唯一の循環は `schedules ⇄ dependencies`** である。この2つは片方だけを先に固めることが原理的にできないため、**同一段階でペアとして結合・試験する**。

### 0-5. スタブ/ドライバの扱い

- **ドライバ(上位の代役)**: ボトムアップでは下位を呼ぶだけの薄いコードで足りる。本件のモジュールはグローバル公開のため、ブラウザ Console から公開関数を直接呼ぶことがそのままドライバになる(専用コード不要)。
- **スタブ(下位の代役)**: 本方式では原則不要。例外は、循環ペアを分割せず「まとめて結合」することで回避する。どうしても単独段階で確認したい場合のみ、`History.snapshot`(no-op)などの**最小スタブ**を許容する。スタブを使った項目は「使用スタブ」欄に明記する。

### 0-6. 開発の進め方と試験の進め方は別物

本アプリは「UIを見ながら調整・追加する」反復型(トップダウン的な開発スタイル)で作られた。しかし「開発の進め方」と「結合試験の進め方」は独立に選べる。UI主導開発では画面から見えにくい下位ロジック(日程計算・依存連鎖・データ整合性)が見落とされやすいため、ボトムアップ試験で下位から固めることが開発を補完する。一方、既知の不具合(モーダルの z-index 重なり、ドラッグ中の DOM 参照喪失など)は上位UI起点でしか出ないため、最終段(段階15)の実画面操作で必ずカバーする。

---

## 1. 試験環境・前提条件

| 項目 | 内容 |
|---|---|
| 基盤層の実行環境 | Node.js(DOM/IndexedDB 非依存の関数)。`node` REPL か `node -e`。**同一コンテキストに依存モジュールを先に読み込む**(例: holidays は util を先に評価) |
| UI層の実行環境 | ブラウザ。試験専用HTML(2章)を `python3 -m http.server` 経由で配信し、`<script>` を段階順に増やしながら DevTools Console で確認 |
| 配信方法 | HTTP 経由(`file://` は IndexedDB が不安定。CLAUDE.md 参照) |
| データ永続化 | IndexedDB(DB名: `ganttchart`、`db.js:6`)。各段階の開始前に Application タブから当該DBを削除 |
| テーマ設定 | `localStorage` キー `ganttchart-theme`(`index.html` の先頭スクリプト)。必要に応じクリア |
| テストデータ | (a) 空から作成、(b) `samples/` の JSON をインポートして開始、の2系統 |
| 記録 | 各項目の「実際の結果」「判定(OK/NG)」を記入。段階完了は8章のサマリにサインオフ、NG は9章に起票 |

---

## 2. 試験用ハーネスの作り方

### 2-1. 基盤層(段階1〜2 の一部): Node

DOM非依存の純粋関数は HTML 不要。依存を先に読み込んでから対象を評価する。

```bash
# 純ロジック(util/holidays/state/schedules/dependencies)は index.html から抽出して評価する。
# Tier1 の自動テスト(下記 付録E):
node tests/run-tier1.js
# 個別関数を確かめたいときは test-harness.html を http.server 経由で開き、DevTools Console で
#   Holidays.countWorkingDays(new Date(2026,6,20), new Date(2026,6,31))
# のように直接呼ぶ(ハーネスが index.html から純ロジックを読み込む)。
```

> **Node が無い環境向けフォールバック**: `util`/`holidays` は `toast` を除き DOM/IndexedDB 非依存の純粋ロジックで、Node 固有APIも使っていない。したがって `node` が使えない場合は、2-2 のハーネスをブラウザで開き、DevTools Console で同じ公開関数(`uid()`・`Holidays.countWorkingDays(...)` 等)を直接呼べば段階1・2 を同一に検証できる。**(この試験環境も Node 未導入のため、実施は基本ブラウザ Console で行う。)**

### 2-2. UI層(段階3以降): ブラウザ + index.html 本体

`UI.openModal`/`renderTree`/`renderGantt`/`renderAssist` などは特定の要素ID(付録Bの約25個)を参照するため、フルDOMスケルトンが必要(要素が欠けると `null.innerHTML` で落ちる)。単一ファイル化後は **`index.html` 本体がそのフルDOMスケルトン + 全モジュールを備えている**ので、段階3以降(=DOMを要する結合)は `index.html` を直接開いて確認する。

> かつては `src/index.html` をコピーし `<script src>` を段階順に1本ずつ増やしてモジュールを切り分けていたが、`src/` を廃止し1ファイルに統合した現在、この「個別ファイル読み込みによる段階切り分け」はできない。**純ロジック**(段階1〜2 と、段階9の集計/採番/依存の純サブセット)の切り分けには `test-harness.html`(下記)を、**DOMを要する段階3以降**は `index.html` 本体を使う。

**`test-harness.html`(純ロジックのサンドボックス)**: `index.html` から `util`/`holidays`/`state`/`schedules`/`dependencies` のセクションだけを抽出して評価する軽量ページ。`http.server` 経由で開き(`http://localhost:8000/test-harness.html`)、DevTools Console で `uid()` / `Holidays.*` / `Schedules.*` / `Dependencies.*` を直接呼ぶ。`#toastHost` のみ持つ最小DOMなので、DOMを要する描画系(段階3以降)はここでは扱わない。

> **配信**: リポジトリ直下で `python3 -m http.server 8000` を起動し、`index.html`(全結合=段階15相当)または `test-harness.html`(純ロジック)を開く。全データは IndexedDB に入るため `file://` ではなく HTTP 経由で開くこと。

---

## 3. 実施方法の区分

イベントリスナー登録関数(`wireHeader`/`wireTree`/`wireGantt`/`wireAssist`/`wireScrollSync`/`wireKeyboard`)は**すべて `main.js` にのみ定義**され、`init()`(`main.js:4`)で一度だけ配線される。したがって:

- **ヘッダーのボタン・ツリー行など「外部からの入口」は段階15(main.js結合)まで反応しない。**
- **一方、`UI.openModal`/`UI.openPanel` や各パネル(`TaskPanel.open` 等)は、開いた時点で内部要素に独自の `addEventListener` を張る**(`main.js` の配線とは独立)。よって**公開関数でパネル/モーダルを開けば、その中のボタンは途中段階でも実クリックが効く。**
- **購読(`Store.subscribe`)も `main.js:8-16` でのみ配線される。** そのため段階15以前は `Store.renderAll()` を呼んでも購読者ゼロで**何も描画されない**。途中段階で目視したいときは、描画関数(`Schedules.renderTree()`・`Gantt.renderGantt()`・`Assist.renderAssist()`・`renderProgress()` 等)を**直接呼ぶ**。

| 方法 | 対象 |
|---|---|
| Node直接実行 | DOM/IndexedDB非依存の純粋関数(`util` の大半、`holidays`) |
| ブラウザConsole(関数直接呼出) | `document`/`indexedDB` 依存関数(`DB.open()`、`toast()`、`Store.*`) |
| ブラウザConsole + 目視(描画は直接呼出) | 描画関数。`state` にデータを入れてから `renderTree()`/`renderGantt()` 等を直接呼ぶ |
| ブラウザConsole(公開関数でパネル/モーダルを開く)+ 内部は実クリック | `TaskPanel.open()`・`Milestones.openEditor()`・`ExportImport.openMenu()`・`NotesPanel.open()`・`History.openPanel()` |
| 実画面操作 | 段階15のみ。ヘッダー/ツリー等「入口」の配線を含む全体操作 |

---

## 4. 結合段階一覧(実行時依存グラフから導出)

`APP_FILES`(ロード順)との差分は付録Aに対応表を置く。要点は **(1) `state` を `db` より前に読む(前方参照 db→state を解消)、(2) `history` を `schedules` より前に読む(前方参照 schedules→History を解消)、(3) `schedules` と `dependencies` は循環のため同一段階、(4) `gantt` を `milestones` より前に読む(前方参照 milestones→Gantt を解消)**、の4点(詳細は付録A)。

| 段階 | 追加モジュール | 主な役割 | 前方参照の解消状況 | 実施方法 |
|---|---|---|---|---|
| 1 | `util.js` | 共通ヘルパー(`toast` のみDOM依存) | — | Node(toastのみブラウザ) |
| 2 | `holidays.js` | 祝日・振替休日・稼働日計算 | util を先に評価 | Node |
| 3 | `state.js` | 共有ストア + タグpub/sub(`Store`) | 依存なし。db より前に配置 | ブラウザConsole |
| 4 | `db.js` | IndexedDBラッパー + 履歴ロギング | state 済 → `_log` が動く | ブラウザConsole |
| 5 | `ui.js` | 共有モーダル/パネル | util 済 | ブラウザConsole+目視 |
| 6 | `notes.js` | プロジェクトメモ(複数・非モーダル浮遊) | DB/state/UI 済 | ブラウザConsole+目視 |
| 7 | `projects.js` | プロジェクトCRUD・切替 | create のテンプレ経路のみ Assist 未ロード(下記注) | ブラウザConsole+目視 |
| 8 | `history.js` | undo・変更履歴・各時点復元 | 前方参照なし。schedules より前に配置 | ブラウザConsole+パネル操作 |
| 9 | `schedules.js` + `dependencies.js` | 木構造CRUD ＋ 依存・自動リスケジュール | **循環ペアをまとめて結合** | ブラウザConsole+目視 |
| 10 | `tasks.js` | タスク管理パネル | Schedules/UI 済 | パネル操作 |
| 11 | `gantt.js` | ガント描画・バードラッグ | Schedules/Holidays 済 | ブラウザConsole+目視 |
| 12 | `milestones.js` | マイルストーン | History/Gantt 済 → add/save が動く | モーダル操作 |
| 13 | `assist.js` | アシストガイド・テンプレート | Schedules/Milestones/Notes 済(projects.create のテンプレ経路もここで回帰確認) | ブラウザConsole+目視 |
| 14 | `exportimport.js` | JSON/CSV入出力・印刷 | Schedules/Projects 済 | モーダル操作 |
| 15 | `main.js` | 全体配線・購読・イベント委譲 | 全モジュール済 | 実画面操作 |

> 段階7の注: `projects.create()` はテンプレ指定時に `Assist.applyTemplate`(段階13)を呼ぶ。段階7では **`select`/`loadAll`/`updateSettings`/`setMode`/`remove` と、テンプレ `'blank'` の create のみ**を試験し、**テンプレ付き create は段階13で回帰確認**する。`db→state` は段階3→4の順で解消済みのため、段階4以降は履歴付き `put` が正常動作する。

---

## 5. 境界値の扱い方針

単体試験を行わないため、境界値も本結合試験で確認する。対象は「モジュール間を渡る状態」に起因するものに絞る。

- スケジュール0件(空の初期状態)での各描画
- タスク(level 2)への子追加拒否 = 3階層の最大深さ境界(9-11)
- 依存関係が循環一歩手前の状態での追加
- **undoスタック**(メモリ、`history.js:6` の `MAX = 40`)が0件/上限での操作
- **永続化される変更履歴**(IndexedDB、`db.js:83` の `HISTORY_MAX = 80`)が上限を超えたときの間引き
- IndexedDBが空(初回起動)での起動シーケンス

> 履歴の上限は**2種類**ある点に注意: `MAX = 40` はメモリ上の undo スタック、`HISTORY_MAX = 80` は DB に残す変更履歴ログ(履歴パネルの表示元)の間引き閾値。両者は別物。

---

## 6. 段階別・試験項目

### 段階1: util.js(Node、確認済み)

| No | 項目 | 実行 | 期待結果 | 判定 |
|---|---|---|---|---|
| 1-1 | `uid()` 一意性・接頭辞 | `uid()` / `uid('task')` | `id_...` / `task_...`(一意) | ✓ 自動(付録E) |
| 1-2 | `escapeHtml()` | `<b> & " '` を含む文字列 | すべて実体参照化 | ✓ 自動 |
| 1-3 | `parseDate()` 正常/異常/桁上がり | `'2026-07-21'` / `''`・`'20260721'`(区切り無し) / `'2026-13-01'`・`'2026-02-30'` | Date / どちらも `null` / **桁上がりした Date**(現仕様。不正日付でも null にはならず翌月等へ繰り上がる。実測: `2026-13-01`→`2027-01-01`) | ✓ 自動 |
| 1-4 | `fmtDate()` 往復 | `fmtDate(parseDate('2026-07-21'))` | `2026-07-21` | ✓ 自動 |
| 1-5 | `dayDiff()` | 2026-07-21→2026-08-01 | `11` | ✓ 自動 |
| 1-6 | `addDays()` | 21日+10日 → fmt | `2026-07-31` | ✓ 自動 |
| 1-7 | `isWeekend()` | 土(07-18)/日(07-19)/火(07-21) | `true` / `true` / `false` | ✓ 自動 |
| 1-8 | `periodWithinYears()` | 3年以内 / 逆転 / 超過 | `true` / `false` / `false` | ✓ 自動 |
| 1-9 | `renderMarkdownSafe()` | 見出し・箇条書き・チェック・強調・`<script>` 混入 | 記法はHTML化、タグはエスケープされ実行されない | ✓ 自動 |
| 1-10 | `toast()` のDOM依存 | Node上で `toast('x')` | `document is not defined`(想定通り。段階3で確認) | 手動(DOM) |

> 公開util のうち `todayDate`/`addYears`/`fmtRangeLabel` は個別項目にしていないが、それぞれ 11-1(今日線)・1-8(`periodWithinYears` 経由)・9/11 の期間ラベル描画で間接的に確認される。

### 段階2: holidays.js(Node、util を先に評価)

| No | 項目 | 確認 | 期待結果 | 判定 |
|---|---|---|---|---|
| 2-1 | データロード(IIFE内で parseDate 実行) | `Holidays` を参照 / `isHoliday('2026-01-01')` | 例外なくロード、元日=true。util 未評価なら失敗(ロード順制約) | ✓ 自動 |
| 2-2 | 振替休日の自動算出 | 2024〜2030 の全日曜祝日 | 翌日が休日化される(`holidays.js:41-47`)。実測: 日曜祝日16件すべてで成立(例 2024-02-11→02-12) | ✓ 自動 |
| 2-3 | `countWorkingDays()` | 2026-07-20〜07-31 / start>end | 実測 **9稼働日**(20=海の日/祝, 25土26日を除外)/ 0 | ✓ 自動 |
| 2-4 | `endAfterWorkingDays()` / `nextWorkingDay()` | 祝日起点+3稼働日 / 祝日 / 稼働日 | `endAfterWorkingDays(07-20,3)`=**07-23**(起点は次稼働日21) / `nextWorkingDay(07-20)`=07-21 / `(07-21)`=07-21 | ✓ 自動 |

### 段階3: + state.js(ブラウザConsole)

| No | 項目 | 確認 | 期待結果 | 判定 |
|---|---|---|---|---|
| 3-1 | `toast()` 実動作(段階1の持ち越し) | `#toastHost` があるハーネスで `toast('x')` | トーストが表示され自動消滅 | 手動(DOM) |
| 3-2 | pub/subのタグ配線 | `Store.subscribe(['x'],fn)` → `Store.setState({},['x'])` / `[]` / `['y']` | `['x']` のみ発火、`[]`・`['y']` では非発火 | ✓ 自動 |
| 3-3 | `renderAll()` の重複排除 | 同一 fn を複数タグで購読 → `renderAll()` | fn は1回だけ呼ばれる(`state.js:52-57`) | ✓ 自動 |
| 3-4 | `setState`/`setUiState` のマージ | 部分patchを適用 | 既存キーは保持、指定キーのみ更新 | ✓ 自動 |

### 段階4: + db.js(ブラウザConsole)

| No | 項目 | 確認 | 期待結果 | 判定 |
|---|---|---|---|---|
| 4-1 | DB初期化 | `await DB.open()` → Applicationタブ | `projects`/`schedules`/`milestones`/`dependencies`/`comments`/`notes`/`historyLog`/`meta` が作成 | |
| 4-2 | 書込/読込往復・projectId索引 | `put` 後 `getAllByProject` | 書いた内容が索引経由で取得できる | |
| 4-3 | 履歴ロギング(state 依存の解消確認) | HISTORY_DOMAIN へ `historyMeta` 付き `put` | `historyLog` に snap 付きエントリが追加(`db.js:85-103`)。**state を先読みしているので ReferenceError にならない** | |
| 4-4 | 非対象ドメインは記録しない | `notes` へ `historyMeta` 付き `put` | `historyLog` に記録されない(`HISTORY_DOMAINS` 外) | |
| 4-5 | 空DB(初回)境界 | 空ストアに `getAllByProject` | 例外なく `[]` | |

### 段階5: + ui.js(ブラウザConsole+目視)

| No | 項目 | 確認 | 期待結果 | 判定 |
|---|---|---|---|---|
| 5-1 | モーダル表示/確定/取消 | `UI.openModal(html,{onSubmit})` | 表示・`data-close` で閉じる・submit で `onSubmit` 実行 | |
| 5-2 | `onSubmit` が `false` を返す | バリデーションエラー想定 | モーダルが開いたまま。閉じない実処理は `if (result !== false) close();` | |
| 5-3 | モーダルはメモより前面(既定) | メモを開いた状態で `UI.confirm('?')` / 任意モーダル | 全モーダルが z160 でメモ(150)より前面。暗幕(#modalBackdrop, z145)がメモの下で画面を暗転(メモは暗転しない)。※不具合#1修正で `above-notes` は廃止 | ✓ 確認済み(2026-07-22) |
| 5-4 | サイドパネル表示 | `UI.openPanel(...)` | 右寄せ表示・閉じる動作(外側クリック=暗幕で閉じる) | |
| 5-5 | メモ×モーダルの重なり(不具合#1 回帰) | メモを開き、幅を変えながら編集モーダル等を開く | ①メモは暗転しない ②モーダルが最前面(かぶったら上) ③かぶる幅はモーダルがメモ左端へ右揃えで両方視認 ④広幅は中央維持 ⑤メモはモーダル中も操作可 | ✓ 確認済み(2026-07-22) |

### 段階6: + notes.js(ブラウザConsole+目視)

| No | 項目 | 確認 | 期待結果 | 判定 |
|---|---|---|---|---|
| 6-1 | 浮遊パネル開閉 | `NotesPanel.open()`/`close()`/`toggle()` | バックドロップ無しで開閉。開いたまま他操作可 | |
| 6-2 | 複数メモの追加/切替/リネーム/削除 | パネル内の実操作 | `state.notes` と `notes` ストアが整合。削除確認あり | |
| 6-3 | プロジェクト単位の再構築ガード | `state.project.id` を変えて `refresh()` | ID変化時のみ `build()`。入力中テキストが不用意に消えない(`notes.js:193-203`) | |
| 6-4 | リスト継続入力 | 箇条書き行で Enter | 次項目を自動継続、空項目でマーカー除去(`notes.js:96-120`) | |
| 6-5 | `.md` ファイル読込 | 「📄 読込」→ファイル選択 | `FileReader` が本文をエディタ(`ta.value`/`cur.body`)へ反映(`notes.js:136-143`) | |
| 6-6 | `.md` 書出 | 「📄 書出」 | 本文が `text/markdown` Blob としてDL、ファイル名 `{メモ名}.md`(空なら `memo.md`、`notes.js:144-149`) | |

### 段階7: + projects.js(ブラウザConsole+目視)

| No | 項目 | 確認 | 期待結果 | 判定 |
|---|---|---|---|---|
| 7-1 | `select` の全ドメイン入替 | 事前投入済みの別プロジェクトへ `Projects.select(id)` | `state` の各配列が総入替、前プロジェクトのデータが残らない(`projects.js:14-39`) | |
| 7-2 | `create('...','assist','blank')` | テンプレ無し作成 | 空スケジュールで作成。**テンプレ付きは段階13で確認**(Assist未ロードのため) | |
| 7-3 | 旧単一メモの移行 | `project.notesMd` を持つデータで `select` | `notes` の1件目へ移行、`notesMd` が空化(`projects.js:26-33`) | |
| 7-4 | `updateSettings`/`setMode`/`remove` | 各関数を直接呼ぶ | 名称・期間・モード更新、削除時は関連ドメインをカスケード削除(`projects.js:88-100`) | |

> 段階7では `Store.renderAll()` は購読者未配線のため無反応。`state` を直接検査して判定する(3章)。

### 段階8: + history.js(ブラウザConsole+パネル操作)

| No | 項目 | 確認 | 期待結果 | 判定 |
|---|---|---|---|---|
| 8-1 | snapshot→undo の整合 | `History.snapshot()` → `state` を手で変更 → `applySnapshot` 経由の `undo()` | schedules/milestones/dependencies が一貫して直前へ戻る | |
| 8-2 | `canUndo()` 0件境界 | スタック空 | `false`(`history.js:21`) | |
| 8-3 | undoスタック上限(40) | `snapshot()` を41回 | 最古が破棄されスタック長 ≤ 40(`history.js:6,17`) | |
| 8-4 | `openPanel()` の履歴読出 | `History.openPanel()` | `historyLog` を最新順に表示。追加/変更/削除の色分け | |
| 8-5 | `restoreTo()` 各時点復元 | パネルの「この時点に戻す」→ 確認モーダル→戻す | 当該 snap へ復元。**確認前にパネルを閉じてから `UI.confirm`**(パネルはモーダルより前面のため背面に隠れるのを回避。不具合#1と同種の対策、`history.js:90-101`) | |
| 8-6 | 永続履歴の間引き(80) | 81件以上の履歴付き変更 | 古い順に間引かれ `historyLog` ≤ 80(`db.js:105-111`) | |

### 段階9: + schedules.js + dependencies.js(相互依存ペア、ブラウザConsole+目視)

> 循環(`schedules ⇄ dependencies`)のため同一段階。追加/編集は非公開の `add`/`saveNode` を直接呼べないので **`Schedules.openEditor()` のモーダル送信経由**で行う。削除は公開 `Schedules.del()`。
>
> **自動化済みの純ロジック(付録E)**: 9-2(採番)・9-3(集計)に加え、`levelOf`/`hasChildren`/`flattenForDisplay`/`statusLabel` と `Dependencies.predecessorsOf`/`leafTasks` を実測確認済み。**未自動(手動/Tier2)**: 追加・削除・親付け替え(`saveNode`)・自動リスケジュール(9-4/9-6)・循環検知(9-5、`wouldCycle` は `setPredecessors` 経由=DB依存)・`shiftSubtree`(9-7)・描画(9-8/9-10/9-11)は DB/DOM を要するため段階9実施時に手動。

| No | 項目 | 確認 | 期待結果 | 判定 |
|---|---|---|---|---|
| 9-1 | 木構造の親子整合 | `openEditor` で追加、`del` で削除 → `flattenForDisplay()` | 3階層(スケ→サブ→タスク)が正しく構成。削除は子孫と依存もカスケード(`schedules.js:420-439`) | |
| 9-2 | 番号採番 | `computeNumbering()` | 保存せず毎回 "1.2.3" を算出。並べ替え/削除後も再計算 | ✓ 自動(付録E) |
| 9-3 | ステータス/期間の自動集計 | 子タスクの状態・日程を変えて `effectiveStatus`/`effectiveSpan` | 親=全done→done/全todo→todo/他→doing、期間=子のmin/max | ✓ 自動(付録E) |
| 9-4 | 自動リスケジュール | 先行タスクの日程変更(`updateDates`) | 後続が稼働日ベースで連動(`dependencies.js:53-75`) | |
| 9-5 | 循環検知(一歩手前の境界) | `Dependencies.setPredecessors(toId,[...])` に循環となる組を渡す(`wouldCycle` は非公開のため間接) | 該当依存は追加されず `toast('循環する依存関係は設定できません')`(`dependencies.js:43`) | |
| 9-6 | 祝日との結合 | 祝日/振替を挟む日程でリスケジュール | 稼働日(週末+祝日除外)で算出 | |
| 9-7 | 親のずらし移動 | `shiftSubtree(id,days)` | 配下を暦日一括移動、相対関係を保持(`schedules.js:389-408`) | |
| 9-8 | 0件境界 | 0件で `renderTree()` | 空表示、例外なし | |
| 9-9 | 既存タスクの編集(`saveNode` 経路) | 葉タスクを `openEditor({id})` で開き、名称/担当/状態/親を変えて送信 | `describeChanges` が差分ラベルを生成(名称/期間/担当/状態、`schedules.js:334-343`)。別スケジュール/サブへ親付け替え時は `order` が新親の末尾に再計算され、所属変更ラベルが出る(`:351-356`) | |
| 9-10 | 折りたたみ(`uiState.collapsed`) | `uiState.collapsed[nodeId]=true` にして `renderTree()`/`renderGantt()` を直接呼ぶ | 子孫行が `flattenForDisplay` の出力から消え、twist が ▼→▶。隠れた行を端点に持つ依存線は `renderDeps` でスキップ(`gantt.js:228`)。実クリック(`data-toggle`)での同挙動は 15-3 で回帰確認 | |
| 9-11 | 最大深さ境界(3階層固定) | level 2(タスク)に子追加を試みる | ツリーに `＋`(子追加)が出ず、`openEditor` の親候補に level 2 が現れない(`MAX_LEVEL=2`、`schedules.js:7,112`) | |

### 段階10: + tasks.js(パネル操作)

公開API: `open` / `refresh`(`closeThen`/`renderBody` は内部)。

| No | 項目 | 確認 | 期待結果 | 判定 |
|---|---|---|---|---|
| 10-1 | パネル表示と一覧描画 | `TaskPanel.open(subId)` | 対象サブ配下のタスク一覧。状態○(未/進/完)を表示 | |
| 10-2 | 0件表示 | タスク無しサブID | 「まだタスクがありません」 | |
| 10-3 | 状態変更/編集/削除の入口 | パネル内ボタンを実クリック | `setStatus` 反映、編集/削除はパネルを閉じてモーダルへ(`tasks.js:13-17,33-43`) | |
| 10-4 | 閉時 `refresh()` | パネルが閉じた状態で `refresh()` | 何もせず `openSubId` クリア(`tasks.js:84-89`) | |

### 段階11: + gantt.js(ブラウザConsole+目視)

| No | 項目 | 確認 | 期待結果 | 判定 |
|---|---|---|---|---|
| 11-1 | 描画とデータ同期 | `state` 変更後 `Gantt.renderGantt()` | バー・依存線・今日線・週末/祝日シェードが反映 | |
| 11-2 | 粒度切替 | `uiState.granularity` を day/week/month/quarter に変えて再描画 | `pxPerDay` が day=30/week=16/month=7/quarter=3.5 に変化(`gantt.js:6`)。origin+10日 のバー左端は day で 300px・week で 160px(=dayDiff×pxPerDay)。粒度を変えても origin 起点の比率と相対順序が保たれる | |
| 11-3 | バードラッグ(移動/端リサイズ) | バーを掴んで移動・端ドラッグ | ゴースト表示→ドロップで `updateDates`。**掴んだ要素をドラッグ前に再描画で失わない**(`isDragging`、CLAUDE.md 落とし穴) | |
| 11-4 | パン操作(空白ドラッグ) | ガント空白をホールド&ドラッグ | 上下左右にスクロール、閾値未満はクリック扱い(直近追加の回帰、`main.js#beginPan`) | |
| 11-5 | 0件境界 | 0件で描画 | 空ガント表示、例外なし | |

### 段階12: + milestones.js(モーダル操作)

公開API: `openEditor` のみ(`add`/`save`/`remove` は非公開、送信経由)。

| No | 項目 | 確認 | 期待結果 | 判定 |
|---|---|---|---|---|
| 12-1 | 追加/編集/削除 | `Milestones.openEditor()` でフォーム送信/削除 | 追加・編集は `snapshot`→保存(`DB.put`)→`Projects.touch`→`renderAll` の後に `Gantt.scrollToDate` でその日付へスクロール(`:47,54`/`:58,64`)。削除は `snapshot`→`DB.remove`→`touch`→`renderAll` で完結し `scrollToDate` は呼ばれない(`:67-74`) | |
| 12-2 | タスクとの時間軸整合 | タスクと同時期にマイルストーンを置き描画 | 同一タイムライン基準で矛盾なく配置(旗はヘッダー側) | |
| 12-3 | 範囲外の非表示 | タイムライン範囲外の日付 | 線/旗を描かない(`gantt.js:132-137,158-163`) | |

### 段階13: + assist.js(ブラウザConsole+目視)

| No | 項目 | 確認 | 期待結果 | 判定 |
|---|---|---|---|---|
| 13-1 | ガイドの進捗判定 | 各レベル投入後に `renderAssist()` | 完了ステップに✓、次を active 強調。全完了で「できること」に変化(`assist.js:114-163`) | |
| 13-2 | ステップ/アクション実行 | `runStep(i)`/`runAction(key)` | 対応モーダル/パネルを開く(schedule/sub/task/milestone/memo) | |
| 13-3 | テンプレ適用(段階7-2の回帰) | `Assist.applyTemplate(pid,'teamdev')` または `Projects.create(...,'teamdev')` | チーム開発の3階層が投入され、稼働日で日程が入る(`assist.js:32-53`)。**前方参照 projects→Assist がここで解消されることを確認** | |
| 13-4 | モード非表示 | ノーマルモードで `renderAssist()` | `#assistGuide` は空(`assist.js:116`) | |

### 段階14: + exportimport.js(モーダル操作)

公開API: `openMenu` / `exportJson` / `importJson`(`exportExcel`/印刷は非公開、モーダル内クリック)。

| No | 項目 | 確認 | 期待結果 | 判定 |
|---|---|---|---|---|
| 14-1 | JSON往復 | `exportJson()` の出力を `importJson(file)` へ | id を振り直しつつ参照(parentId/依存)を維持、往復でデータ整合(`exportimport.js:100-139`) | |
| 14-2 | 依存/履歴の整合 | インポート後に依存・木構造を確認 | 循環や親子破綻が起きない。無効な依存(端点欠落)は除外(`:128`) | |
| 14-3 | CSV/印刷(モーダル経由) | `ExportImport.openMenu()` → 「Excel形式(CSV)」「印刷」を実クリック | CSVはUTF-8 BOM付き・階層/番号/稼働日数/状態を含む。印刷は `window.print()`(`exportimport.js:32-33,47-75`) | |

### 段階15: + main.js(実画面操作)

`init()` の購読配線(`main.js:8-16`、実コードと一致):
`['header']→renderHeader`、`['tree']→Schedules.renderTree`、`['gantt']→Gantt.renderGantt`、`['assist']→Assist.renderAssist`、`['gantt','tree']→renderProgress / TaskPanel.refresh / vscrollRefresh`、`['gantt','tree','header']→NotesPanel.refresh / alignNotesTop`。

| No | 項目 | 確認 | 期待結果 | 判定 |
|---|---|---|---|---|
| 15-1 | 起動シーケンス(空DB境界) | 空DBでページを開く | `DB.open`→購読配線→`wireX`→`loadAll`→`ensureOne`(既定プロジェクト自動作成)→`select` が完走、例外なし(`main.js:4-29`) | |
| 15-2 | タグ配線の総合確認 | 各操作を実行 | 対応する描画のみ発火、無関係な過剰描画が起きない | |
| 15-3 | ヘッダー入口の配線 | プロジェクト切替/新規/メモ/設定/粒度/undo/履歴/入出力/テーマ | 各ボタンが期待の関数へ配線(`main.js:73-104`) | |
| 15-4 | `toast()` 実動作 | 通知が出る操作 | `#toastHost` に表示・自動消滅 | |
| 15-5 | 循環依存のUI阻止 | UI上で循環依存を追加 | 阻止され toast 表示(段階9-5の実UI版) | |
| 15-6 | ダークモード永続化 | テーマ切替→リロード | `localStorage` の選択が引き継がれ、初期描画前に適用(`index.html` 先頭、`main.js:94-103`) | |
| 15-7 | 全体リグレッション | 段階1〜14の主要機能を実操作で再確認 | すべて壊れていない | |
| 15-8 | キーボード undo | 入力欄の外にフォーカスがある状態で Ctrl/⌘+Z | `History.undo` が発火(`main.js:347,352`)。ヘッダーの undo ボタン(15-3)とは別経路 | |
| 15-9 | 入力中は undo 無効 | INPUT/TEXTAREA/SELECT にフォーカス中に Ctrl/⌘+Z | undo が発火しない(`main.js:349-350`) | |

---

## 7. 各段階共通のチェック項目(横断観点)

| No | 観点 | 内容 |
|---|---|---|
| C-1 | グローバル名の衝突 | 追加モジュールが既存の関数・変数名を上書きしていないか(全モジュールが同一スコープ) |
| C-2 | 前方参照の顕在化 | 追加段階の書込系関数が、未ロードモジュール(0-4の表)を呼んで `ReferenceError` を出さないか。出た場合は4章の順序前提が崩れていないか確認 |
| C-3 | タグ配線の過不足 | (段階15)必要タグを購読し、無関係タグに巻き込まれていないか |
| C-4 | IndexedDBの初期化 | 開始前に前段階のデータが残っていないか |
| C-5 | リグレッション | 直前まで結合済みの機能が今回の追加で壊れていないか |
| C-6 | 一覧の並び替え(`touch`) | ドメイン変更のたびに `Projects.touch` が `updatedAt` を進め、`loadAll` の降順ソートで当該プロジェクトが一覧の先頭へ来るか(`projects.js:80-86`) |

---

## 8. 段階別 実施サマリ(サインオフ)

各段階の完了時に記入する。横断観点 C-1〜C-6 は段階ごとにチェックする。

| 段階 | 実施日 | 実施者 | OK数 | NG数 | C-1〜C-6 | 総合判定 | 備考 |
|---|---|---|---|---|---|---|---|
| 1 util | 2026-07-21 | 自動(node v20.18.1)＋手動 | 10 | 0 | ✓ | **OK** | 1-1〜1-9 自動(付録E)、1-10(toast)手動 |
| 2 holidays | 2026-07-21 | 自動(node v20.18.1) | 4 | 0 | ✓ | **OK** | 全項目自動。付録E |
| 3 state | 2026-07-21 | 自動＋手動 | 4 | 0 | ✓ | **OK** | 3-2〜3-4 自動(付録E)、3-1(toast)手動 |
| 4 db | 2026-07-21 | Neo-Oi(手動) | 5 | 0 | ✓ | **OK** | Console(IndexedDB)で確認 |
| 5 ui | 2026-07-21 | Neo-Oi(手動) | 5 | 0 | ✓ | **OK** | 5-3/5-5 確認済み。メモ×モーダル重なり(不具合#1)は 2026-07-22 に修正・ブラウザ回帰確認済み(fix: 8db3a6f) |
| 6 notes | 2026-07-21 | Neo-Oi(手動) | 6 | 0 | ✓ | **OK** | .md 読込/書出・リスト継続含む |
| 7 projects | 2026-07-21 | Neo-Oi(手動) | 4 | 0 | ✓ | **OK** | C-6(touch 並び替え)含む |
| 8 history | 2026-07-21 | Neo-Oi(手動) | 6 | 0 | ✓ | **OK** | 8-5(restoreTo)回帰含む |
| 9 schedules+deps | 2026-07-21 | 自動＋手動(Neo-Oi) | 11 | 0 | ✓ | **OK** | 採番/集計/木ヘルパ/依存純は自動(付録E)、追加削除/リスケジュール/循環/折りたたみ/最大深さは手動 |
| 10 tasks | 2026-07-21 | Neo-Oi(手動) | 4 | 0 | ✓ | **OK** | |
| 11 gantt | 2026-07-21 | Neo-Oi(手動) | 5 | 0 | ✓ | **OK** | ドラッグ/パン含む |
| 12 milestones | 2026-07-21 | Neo-Oi(手動) | 3 | 0 | ✓ | **OK** | |
| 13 assist | 2026-07-21 | Neo-Oi(手動) | 4 | 0 | ✓ | **OK** | テンプレ作成含む |
| 14 exportimport | 2026-07-21 | Neo-Oi(手動) | 3 | 0 | ✓ | **OK** | 印刷/CSV(BOM)/JSON往復 |
| 15 main(実画面) | 2026-07-21 | Neo-Oi(手動) | 9 | 0 | ✓ | **OK** | 起動/配線/Ctrl+Z/ダークモード/総合リグレッション |

> 全15段階 **オールグリーン(NG 0)**。段階1〜3・9の純ロジックは Node 自動(付録E)、段階4〜15 と手動項目は Neo-Oi がブラウザで実施し 2026-07-21 に全項目パスを報告(本表への記録は Claude)。不具合#1(9章・メモ×モーダルの重なり)は 2026-07-22 に修正・ブラウザ回帰(5-5)確認済み(fix: 8db3a6f)。

---

## 9. 不具合記録欄(テンプレート)

| No | 発見段階 | 現象 | 再現手順 | 原因モジュール(推定) | 対応状況 |
|---|---|---|---|---|---|
| 1 | 結合試験中(モーダル表示) | メモを開いたまま幅を約60%(ビューポート≲1420px)にしてモーダルを開くと、メモ(z-index 150)がモーダル(100)の右側を覆い、モーダルが一部操作不能 | ①「📝メモ」を開く ②ウィンドウ幅を約60%(≲1420px)に ③任意のモーダル(編集/設定等)を開く → 右側がメモに隠れる | `styles.css` の `.notes-float`(z-index:150) と `.modal-host`(100) のレイヤリング。中央配置モーダルと右ドッキング450pxメモが狭幅で物理的に重なる | **修正・確認済み(2026-07-22, fix: 8db3a6f)**: 暗幕を別レイヤ `#modalBackdrop`(z145)に分離、メモ(z150)は暗転させず、`.modal-host`/`.panel-host` を z160・透明・`pointer-events:none`(本体のみ操作可)に。`ui.js` の `positionModal` でかぶる幅はモーダルをメモ左端へ右揃え・広幅は中央維持。`history.js` の restoreTo も確認前にパネルを閉じる同種対策。回帰 5-5 ブラウザ確認 OK。`styles.css`/`ui.js`/`history.js`/`index.html` 改修・コミット済み |

---

## 付録A: ロード順(APP_FILES)と試験順の対応

| APP_FILES(ロード順) | 本書の試験段階 | 差分の理由 |
|---|---|---|
| util → holidays → db → state → ui → projects → notes → schedules → dependencies → tasks → milestones → gantt → assist → exportimport → history → main | util → holidays → **state → db** → ui → notes → projects → **history** → **schedules+dependencies** → tasks → gantt → milestones → assist → exportimport → main | (1) state を db より前(db→state 前方参照の解消) (2) history を schedules より前(schedules→History の解消) (3) schedules と dependencies は循環のため同段階 (4) gantt を milestones より前(milestones→Gantt の解消) (5) notes と projects は相互に非依存のため順序は任意(本書は notes を先に置いたが依存上の要請ではない) |

> ロード順は「連結して壊れない順」、試験順は「各段階が原則として先行段階だけで動く順」。目的が異なるため一致しない。依存上必須の差分は (1)〜(4)、(5) は任意の並び。

## 付録B: ハーネスの `<body>` に含めるべき要素ID(実測)

これは「フルDOMスケルトンに静的配置されているべきIDの棚卸し一覧」である。下記24個のうち、`#appHeader` 以外の23個は `getElementById`/`querySelector` で直接参照され、欠けると `null.innerHTML` で落ちる。`#appHeader` はどのモジュールからも参照されない純粋なレイアウトコンテナだが、`index.html` の `<body>` に含まれている。

`#appHeader`(レイアウトのみ・コード非参照) `#projectSelect` `#newProjectBtn` `#notesBtn` `#projectMenuBtn` `#modeToggle` `#addScheduleBtn` `#addMilestoneBtn` `#granularityToggle` `#undoBtn` `#historyBtn` `#exportBtn` `#themeBtn` `#progressStrip` `#treeList` `#ganttHeader` `#ganttBody` `#assistGuide` `#vscroll` `#vscrollThumb` `#modalHost` `#panelHost` `#notesFloatHost` `#toastHost`

**動的生成(静的配置は不要)**: `#taskPanelBody`/`#taskPanelSub`/`#taskAddBtn`(tasks.js)、ノートパネル内の要素一式(notes.js)、新規作成ダイアログ内の `.md` 読込入力(main.js)などは、各 host コンテナ(`#panelHost`/`#modalHost`/`#notesFloatHost`)の `innerHTML` で実行時に生成される。ハーネスには host コンテナだけあればよい。

## 付録C: モジュール別 公開API(実測)

| モジュール | 公開 | 主な非公開(入口経由でのみ実行) |
|---|---|---|
| util(グローバル関数) | uid, escapeHtml, parseDate, fmtDate, todayDate, dayDiff, addDays, isWeekend, addYears, periodWithinYears, fmtRangeLabel, renderMarkdownSafe, toast | — |
| Holidays | isHoliday, isWorkingDay, countWorkingDays, endAfterWorkingDays, nextWorkingDay | — |
| DB | open, getAll, getAllByProject, get, put, remove, bulkRemove, setMeta, HISTORY_DOMAINS | _log, _pruneHistory, tx |
| Store(+ state, uiState) | subscribe, setState, setUiState, renderAll | _notify |
| UI | openModal, openPanel, confirm | — |
| Projects | loadAll, select, create, rename(※未使用: 設定モーダルは `updateSettings` を直接呼ぶ), updateSettings, setMode, touch, remove, ensureOne | — |
| NotesPanel | open, close, toggle, refresh | build, renderList, renderMain, addNote/selectNote/deleteNote |
| Schedules | childrenOf, byId, levelOf, hasChildren, computeNumbering, flattenForDisplay, effectiveStatus, effectiveSpan, renderTree, openEditor, del, updateDates, setStatus, shiftSubtree, LEVEL_NAME, statusLabel | **add, saveNode**, describeChanges, progressPercent, examples |
| Dependencies | leafTasks, predecessorsOf, setPredecessors, rescheduleFrom | **wouldCycle** |
| TaskPanel | open, refresh | closeThen, renderBody |
| Gantt | renderGantt, scrollToDate, beginDrag | computeDateScale, dateToX, renderScale ほか |
| Milestones | openEditor | **add, save, remove** |
| Assist | templateList, applyTemplate, renderAssist, runStep, runAction | steps, actions |
| History | snapshot, canUndo, undo, openPanel, restoreTo | applySnapshot |
| ExportImport | openMenu, exportJson, importJson | **exportExcel**, _csvCell |

## 付録D: 前提データの投入方法(Console スニペット)

多くの項目が「`state` にデータが入っている / 別プロジェクトが用意済み」を前提とする。投入は次の2パターンを使う。

**(a) サンプル投入(段階14以降、または `importJson` が使える段階)** — `samples/sample-project.json` を新規プロジェクトとして取り込む。実画面なら「入出力」→「JSONから読み込む」。Console からは:

```js
fetch('samples/sample-project.json').then(r => r.blob())
  .then(b => ExportImport.importJson(new File([b], 's.json')))
// 読込後: 名前に「(復元)」が付き、id は全て再生成される(exportimport.js:110-133)
```

**(b) 最小データを手で組む(描画・木構造系の段階9・11 など)** — `state` に直接載せてから描画関数を直接呼ぶ(段階15 未満は購読未配線のため、3章の通り描画は直接呼ぶ):

```js
state.project = { id:'p1', name:'T', mode:'assist', startDate:'', endDate:'' };
state.schedules = [
  { id:'s1', projectId:'p1', parentId:null, order:0, name:'定義', status:'todo' },
  { id:'s2', projectId:'p1', parentId:'s1', order:0, name:'要件定義', status:'todo' },
  { id:'t1', projectId:'p1', parentId:'s2', order:0, name:'ヒアリング', status:'doing', startDate:'2026-08-03', endDate:'2026-08-07' },
];
state.milestones = []; state.dependencies = []; state.notes = [];
Schedules.renderTree(); Gantt.renderGantt();
```

段階7〜13 で「別プロジェクト」を要する項目は (a)、段階9・11 の描画/集計確認は (b) を起点にすると迷わない。

## 付録E: 自動テスト(Tier 1・実行済み)

DOM/IndexedDB に依存しない純ロジック(段階1・2・3、および段階9の集計/採番/依存の純サブセット)を自動化した。ハーネスは `tests/tier1-tests.js`。

**方式**: `tests/run-tier1.js` が `index.html` から `util`/`holidays`/`state`/`schedules`/`dependencies` のセクション(`// ===== app/xxx.js =====` 区切り)を抽出して連結し、末尾に本ハーネス(`tests/tier1-tests.js`。最小 `ok`/`eq` アサーション)を付けて1本のスクリプトとして評価する。`state`/`uiState`(グローバル `const`)にテストデータを載せ、公開関数の戻り値を検証する。前方参照(History/Dependencies/DB/UI 等)を呼ぶ経路は含めない。

**実行コマンド(リポジトリ直下)**:

```bash
node tests/run-tier1.js          # ← node が無ければ test-harness.html を開き Console にテスト本体を貼付(同一結果)
```

**結果**: **51 アサーション / 51 PASS(0 fail)**。当初実施 Node v20.18.1・2026-07-21。単一ファイル化後 `node tests/run-tier1.js`(Node v24)で再確認し、同 51 PASS。

**カバー範囲(自動)**:
- 段階1: 1-1〜1-9(`uid`/`escapeHtml`/`parseDate` 桁上がり含む/`fmtDate`/`dayDiff`/`addDays`/`isWeekend`/`periodWithinYears`/`renderMarkdownSafe`)+ `addYears`/`fmtRangeLabel`/`todayDate`
- 段階2: 2-1〜2-4(祝日ロード・振替休日の不変条件[日曜祝日16件]・`countWorkingDays`[2026-07-20〜07-31=**9**]・`endAfterWorkingDays`[=**07-23**]/`nextWorkingDay`)
- 段階3: 3-2〜3-4(タグ配線・`renderAll` 重複排除・patch マージ)
- 段階9(純): 9-2(採番)・9-3(ステータス/期間集計)・`levelOf`/`hasChildren`/`flattenForDisplay`/`statusLabel`・`Dependencies.predecessorsOf`/`leafTasks`

**対象外(このハーネスでは実行しない)**: `toast`(1-10/3-1、DOM)、DB 依存(段階4/7/8 の永続化、9-4/9-5/9-6/9-7、`wouldCycle` は `setPredecessors` 経由)、描画・レイアウト・操作(段階5/6/10/11/12/13/15)。これらは Tier 2(要 IndexedDB)/ Tier 3(要 DOM)/ Tier 4(要実ブラウザ)として手動または別基盤で実施する。

> 注: `todayDate` は実行日に依存(`new Date()`)。本記録は 2026-07-21 実行時の値。`uid` は `Date.now()`+乱数のため実行ごとに値が変わる(一意性のみ検証)。

---

## 改訂履歴

- 本版: 実コード(全16モジュール)と突き合わせて作成。主な確定事項と前版からの修正:
  - **方式**: 「純粋ボトムアップ」→「サンドイッチ基調のボトムアップ」に修正。`APP_FILES`(ロード順)と結合試験順を分離し、前方参照(db→state, schedules→History, milestones→History/Gantt, projects→Assist)と循環(schedules⇄dependencies)を明示(0-4)。試験順を実行時依存グラフから導出し直した(4章・付録A)。
  - **ハーネス**: 必要要素IDが約25個あることを実測し、フルDOMスケルトンの流用を明記(2章・付録B)。
  - **履歴の上限**: メモリの undo(`MAX=40`)と永続履歴の間引き(`HISTORY_MAX=80`)は別物である点を明記し、後者の試験(8-6)を追加(5章)。
  - **履歴機能**: `restoreTo`(各時点復元)と `openPanel` の項目を追加(8-4/8-5)。
  - **記述精度**: 段階7で `Store.renderAll` が購読未配線のため無反応であること、`Schedules.add/saveNode`・`Milestones.add/save/remove` が非公開で入口経由でのみ実行できることを反映。
  - 実コードと一致を確認した項目: モジュール順序、DB名 `ganttchart`、`localStorage` キー `ganttchart-theme`、`#toastHost`、15章のタグ配線、各モジュール公開API、`wouldCycle`/`exportExcel` 非公開、循環時 toast 文言。
- 第2版(多角監査反映): 全事実主張を独立エージェントで再検証(誤検出は敵対的に除去)。反映した確定修正:
  - **誤り**: 「段階16」表記を全廃(schedules+dependencies を段階9に統合し全15段階のため、main.js は段階15)。0-6/2-2/3章を修正。
  - **不正確**: 4章冒頭の並べ替え「3点」→「4点」(gantt を milestones より前が抜けていた)。`ui.js:25`→`:29`(false時に閉じない実処理行)。0-4 表と 12-1 で milestones の `remove` は `Gantt.scrollToDate` を呼ばない点を明記。0-4 の「IIFE で各モジュール定義」を前方参照モジュールに限定(util/main は素のグローバル)。付録C の NotesPanel 非公開名を `addNote/selectNote/deleteNote` に訂正。付録B の `#appHeader` はコード非参照のレイアウトコンテナと明記。
  - **網羅追加**: 9-9(既存タスク編集=`saveNode` 経路・親付け替え・差分ラベル)、9-10(折りたたみ `uiState.collapsed`)、9-11(3階層の最大深さ境界)、6-5/6-6(メモの `.md` 読込/書出)、15-8/15-9(キーボード undo と入力中ガード)、C-6(`touch` による一覧並び替え)。段階1に `todayDate`/`addYears`/`fmtRangeLabel` の間接確認注記。
  - **最適化**: Node 不在環境のブラウザ Console フォールバック明記(本環境は Node 未導入)。ハーネス配信をリポジトリ直下と明確化。11-2 に検算可能な px 期待値。1-3 に桁上がり(不正日付でも null にならない)を明記。付録D(前提データ投入 Console スニペット)を追加。8章に段階別実施サマリ(サインオフ)を新設し、不具合記録を9章へ。
- 第3版(Tier 1 自動テスト実行): DOM/IndexedDB 非依存の純ロジックを自動化(`tests/tier1-tests.js`)。ポータブル Node v20.18.1 で **51/51 PASS**(2026-07-21)。段階1(1-1〜1-9)・段階2(全)・段階3(3-2〜3-4)・段階9(採番/集計/木ヘルパ/依存の純サブセット)の判定欄を「✓ 自動」で記入、8章サマリを更新、付録Eに方式・実測値・再現手順を記録。1-10/3-1(toast)と DB/描画/レイアウト依存項目は Tier 2〜4 として手動または別基盤に残す。
- 実施完了(2026-07-21): 全15段階オールグリーン(NG 0)。Tier 1(段階1〜3・9の純部分)は Node で自動実測(付録E)、段階4〜15 と手動項目は Neo-Oi がブラウザで実施・全パスを報告し、8章サマリにサインオフ(記録は Claude)。残課題は不具合#1(9章・メモ×モーダルの重なり)の修正のみ。対象コミット SHA: 8db3a6f(2026-07-22 修正、`fix:` コミット)。
- 追補(2026-07-22): 不具合#1 を修正(暗幕を `#modalBackdrop` に分離しメモは暗転させない/モーダルは z160 で前面・`positionModal` で右揃え/広幅中央、`history.js` restoreTo も同種対策)。ブラウザで回帰 5-5 を確認し 5-3/5-5/9章不具合#1 を確認済みに更新。あわせてガント欄のマウス・パン(空白ホールド&ドラッグ)を追加。fix: 8db3a6f / feat: 26c586c。
