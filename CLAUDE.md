# CLAUDE.md

このファイルは、このリポジトリで作業する Claude Code (claude.ai/code) に向けたガイダンスです。

## これは何か

GanttChart は、**単一の自己完結した `.html` ファイル**として配布される、ローカルファーストのガントチャート/プロジェクト計画ツールです。バックエンドなし、ビルド時フレームワークなし、実行時の外部ネットワーク通信なし — 全データはブラウザの IndexedDB に保存されます。配布物は `dist/index.html` で、`src/` 配下のファイルを連結して生成されます。

機能仕様と確定済みの設計判断はこのリポジトリの `SPEC.md` にあります。アーキテクチャ変更を行う前に読んでください — 単に何を作るかだけでなく、*なぜ*このような構造になっているかが記載されています。

## コマンド

```bash
python3 build.py                      # src/ を連結して dist/index.html を生成する
python3 -m http.server 8000           # dist/ から、ビルド済みアプリを配信する
```

`file://` ではなく HTTP 経由で配信してください — 一部のブラウザでは `file://` オリジン下で IndexedDB の挙動が不安定になります。このプロジェクトに npm/Node のツールチェーンはありません(Nodeがインストールされている前提を置いていません)。`build.py` は意図的に Python 3 標準ライブラリ(`pathlib`)のみを使っているため、依存関係のインストール手順は存在しません。

lint・テストスイートはまだ設定されていません。

**開発ループ:** `src/` 配下のファイルを編集し、`python3 build.py` を再実行してから、`dist/index.html` を開いているブラウザタブを更新してください。`build.py` は単純な文字列連結スクリプトで、ウォッチモードもバンドル/トランスパイルも行いません — 設定すべきことは何もありません。

## アーキテクチャ

### ビルド: 複数のソースファイル → 1つの配布ファイル

`src/index.html` には、`build.py` が順に置き換える3つのプレースホルダーコメントがあります:
- `<!-- BUILD:STYLES -->` → `src/styles.css` を `<style>` ブロックにインライン化
- `<!-- BUILD:VENDOR -->` → `build.py` の `VENDOR_FILES` に列挙された各ファイルを、ベンダーライブラリごとに1つの `<script>` タグとしてインライン化(現時点では空 — `marked`/`jsPDF`/SheetJS のようなサードパーティライブラリは、後のフェーズで `src/vendor/` にベンダリングされこのリストに追加される。CDNからの読み込みは行わない)
- `<!-- BUILD:APP -->` → `build.py` の `APP_FILES` をすべて1つの `<script>` ブロックに連結

**ファイルの読み込み順序は `build.py` 内の明示的な配列(`APP_FILES`)で決まり、ディレクトリ/globの順序ではありません。** 新しい `src/app/*.js` モジュールを追加する際は、依存関係の順序でこの配列に追加する必要があります(state/db は、それらを利用するモジュールより前に。`main.js` は `DOMContentLoaded` で全体を配線するため最後)。

### 状態管理: 1つの共有可変ストアと、タグスコープのpub/sub

`src/app/state.js` は2つのグローバルオブジェクトを定義します:
- `state` — *現在選択中*のプロジェクトのドメインデータ(`projects` 一覧、`project`、`schedules`、`milestones`、`dependencies`、`history`)。プロジェクト切り替えのたびにIndexedDBから完全に再読み込みされます。個人プロジェクト規模のレコード数を前提とし、パーティション化/ページネーションはしていません。
- `uiState` — トランジェントなUI専用状態(`selectedId`、`collapsed`(ツリー折りたたみ)、`granularity`、`undoStack`)。ドメインデータの再レンダリングが選択・折りたたみ・粒度・undo履歴を消さないよう、`state` とは分離されています。

`Store.setState(patch, tags)` / `Store.setUiState(patch, tags)` はパッチをマージし、指定された `tags`(`header`/`tree`/`gantt`/`assist`)を購読しているレンダー関数のみを呼び出します(`Store.subscribe(tags, fn)` 経由で、`main.js#init` 内で一度だけ配線されます)。全面更新は `Store.renderAll()`。**UIに影響する変更を追加する際は、正しいタグを渡すか `renderAll()` を呼ぶこと** — 誤った(または空の)タグで呼ぶと、画面が更新されないまま状態だけが黙って更新されます。新しい状態を足すときは、それに依存する全レンダー関数に通知が届くか各書き込み箇所で確認してください。

### 永続化: IndexedDB、単一DB、隣接リスト方式のスケジュールツリー

`src/app/db.js` は単一の `ganttchart` データベースを開き、ドメインごとに1つのオブジェクトストア(`projects`、`schedules`、`milestones`、`dependencies`、`comments`、`notes`、`historyLog`)+ 選択中プロジェクトIDなどを保持する `meta` ストアを持ち、ドメインストアはすべて `projectId` でインデックスされています。変更は他の場所で場当たり的に生のトランザクションを開くのではなく、すべて `DB.put(store, record, historyMeta?)` / `DB.remove(store, id, historyMeta?)`(および複数削除用の `DB.bulkRemove(store, ids)`)を経由させてください — `put`/`remove` は変更履歴のロギングも担っており(後述)、これをバイパスすると変更が黙って履歴に記録されなくなります。

スケジュールの階層(スケジュール → サブスケジュール → タスク、末端まで最大3階層。SPEC.md 4.3参照)は**隣接リスト**(`parentId` + 兄弟の `order` 整数)で表現されており、実体化されたパス文字列ではありません。表示用の番号("1.2.3")は*決して保存されず*、`Schedules.computeNumbering()` / `Schedules.flattenForDisplay()`(`src/app/schedules.js` 内)が毎回のレンダリング時に `parentId`/`order` から都度計算するため、スケジュールの削除・並べ替えの際に他の兄弟の番号を振り直す必要はありません。タスクは独立したオブジェクトストアを持たず、`schedules` ストア内の子を持たない末端ノードとして表現します(SPEC.md 4.3で確定済み)。

### 変更履歴のロギング

履歴追跡の対象は `schedules`(タスクも含む)、`milestones`、`comments` の3ドメインのみです(`db.js` 内の `HISTORY_DOMAINS` を参照)。マインドマップ・メモ・即時メモは意図的に除外されています — これは見落としではなく確定済みのプロダクト判断です。`DB.put`/`DB.remove` は、`historyMeta` オブジェクトが渡され、*かつ*そのストアが `HISTORY_DOMAINS` に含まれる場合にのみ `historyLog` エントリを書き込みます。ロギング対象外のドメインでは `historyMeta` を渡さないでください。

### タスクのステータスと依存関係

タスク(葉ノード)は `status`(`todo`/`doing`/`done`)を持ち、ガントバーの色分けに反映されます。親(スケジュール/サブスケジュール)は自身のステータスを持たず、`Schedules.effectiveStatus()` が子から集計します(全 done→done、全 todo→todo、それ以外→doing)。期間も同様に、親は `Schedules.effectiveSpan()` で子の min/max から算出し、葉は自身の `startDate`/`endDate` を使います。

依存関係は `dependencies` ストア(`{ fromId, toId }`、fromId=先行)で、**タスク同士のみ**張れます。`Dependencies.rescheduleFrom(nodeId)` が先行の日程変更を後続へ波及させます(稼働日ベース、循環は visited セットで防止)。日付を変更する経路(モーダル保存・バードラッグ)は必ずこの関数を呼びます。

### レンダリングパターン

フレームワークも仮想DOMもありません。各パネルは `container.innerHTML = templateString(...)` による全置換です(`src/app/schedules.js#renderTree`、`src/app/gantt.js#renderGantt` が参考例)。ガントのスクロール位置は、innerHTML を置換する `#ganttBody` 自体がスクロールコンテナなので再レンダリングでリセットされ得ますが、パン/ズーム相当は粒度(`uiState.granularity`)で制御しているため実害は小さめです。`Store.setState`/`setUiState` はタグに購読したレンダー関数だけを呼び、全面更新が必要なとき(プロジェクト切替・undo など)は `Store.renderAll()` を使います。

**落とし穴: mousedown で掴んだ要素への参照を、その後の再描画をまたいで使わない。** `innerHTML` 全置換は子要素を作り直すため、`mousedown` ハンドラで捕まえた DOM 参照(例: ガントバー)に対して、同期的に `render*()`(`innerHTML` を差し替える系)を呼んでしまうと、その参照は直後に親を失った(`parentElement === null`)要素になり、以後スタイルを変更しても画面には一切反映されません。バーのドラッグ開始(`Gantt.beginDrag`)がまさにこれで壊れていたことがあります(`main.js#wireGantt` の mousedown ハンドラが `selectNode()`→`Gantt.renderGantt()` を先に呼んでいた)。掴んだ要素をその後操作する処理の前には、その要素を含むコンテナの `innerHTML` 差し替えを挟まないこと。`Gantt.js` にはドラッグ中 `renderGantt()` を no-op にする `isDragging` フラグもあり、ドラッグ中に外部要因(undo、他のドラッグの非同期完了など)で再描画が走っても同じ理由で壊れないようにしています。

クリック処理は、`main.js`(`wireTree`、`wireGantt`、`wireHeader` など)で一度だけ配線される**永続的なコンテナ上でのイベント委譲**を使っています(`#treeList`・`#ganttBody` は innerHTML を置換されるが要素自体は生き続けるので、そこに委譲する)。毎回のレンダリング/モーダルを開くたびに実行される関数の中で、生き続けるコンテナへ直接リスナーをアタッチしないでください — リスナーが蓄積します。モーダル/パネル内の要素は `UI.openModal`/`UI.openPanel` が呼び出しごとにホストの中身を完全に置き換えるため、その内部要素には `onOpen` 内で直接アタッチして構いません(蓄積しない)。

### ガントの日付・スケール計算

`src/app/gantt.js` は日付↔ピクセルの変換(`computeDateScale`、`dateToX`/`xToDate`)をすべて一箇所に集約しており、印刷(PDF/画像)経路も画面と同じレイアウト計算を再利用します。目盛りの粒度(日/週/月/四半期。ヘッダーの粒度セレクターで切り替え)は、どのグリッド線・ラベルを描くかに加えて **`pxPerDay` も変える**(日=30px 〜 四半期=3.5px)ので、長期プロジェクトを俯瞰できます(SPEC.md 15章)。バーのドラッグ(移動/端リサイズ)は `Gantt.beginDrag` が担当し、ドロップ確定時に `Schedules.updateDates` 経由で永続化+依存の自動リスケジュールを行います。

### モーダル

`src/app/ui.js#openModal(html, {onSubmit})` が共有のモーダルホストです — 呼び出しのたびに `#modalHost` の中身を完全に置き換えるため、モーダル本体の*内部*の要素にリスナーをアタッチしても安全です。`onSubmit` が `false` を返すとモーダルは開いたままになります(インラインのバリデーションエラー表示に使用)。それ以外を返すと、非同期のDB書き込みが実際に解決する前に即座に閉じます。

### モード(アシスト / ノーマル)

モードはプロジェクト単位の設定(`project.mode`)で、`document.body.dataset.mode` に反映され、CSS変数(緑=アシスト / 青=ノーマル)を切り替えます。アシストモードでは `#assistPane`(`Assist.renderAssist` の「次にやること」チェックリスト)を表示し、入力モーダルに消えない例文ヒント(`.eg-hint`)を出します。ノーマルモードでは両方とも非表示。**両モードはUI/ガイドの違いだけで、データ構造は完全に共通**(SPEC.md 3・5章)。

### 元に戻す(undo)

`History.snapshot()` を各変更の直前に呼び、選択中プロジェクトの3ドメイン(schedules/milestones/dependencies)を丸ごとディープコピーして `uiState.undoStack` に積みます。`History.undo()` はそのスナップショットで DB とメモリを差し替えます(個人プロジェクト規模を前提とした割り切り)。新しい変更系関数を追加するときは、先頭で `History.snapshot()` を呼ぶこと。

## 実装状況

初版(このリポジトリの実装)で SPEC.md の確定項目を一通り実装済み: プロジェクトCRUD/切替、3階層ツリーCRUD、ガント描画(粒度切替・今日線・週末/祝日シェード)、タスクのステータス色分けと親の自動集計、稼働日+日本の祝日での期間計算、依存関係(タスク間)と自動リスケジュール、バーのドラッグ編集、マイルストーン、アシストモード(例文プレースホルダー・次にやることガイド・テンプレート)、JSONエクスポート/インポート、印刷によるPDF/画像出力、undo・変更履歴。

まだ薄い/未実装の領域(SPEC.md の要確認事項を参照): コメント/メモ(ストアは確保済みだが未配線)、祝日データの年次更新、稼働日以外のカレンダー設定、マイルストーンの階層紐付け、より作り込んだ画像出力。
