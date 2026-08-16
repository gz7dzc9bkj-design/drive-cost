# drive-cost プロジェクト憲法

本人専用の「高速道路料金＋ガソリン代」計算PWA。
出発地・目的地・経由IC・燃費・単価を指定して合計金額を出すことだけが目的。

仕様は `docs/REQUIREMENTS.md`（2026-08-14 凍結）と `docs/DESIGN.md` に従う。
**会話で合意しただけの事項は存在しないものとして扱う。決定は必ずファイルに書く。**

## 絶対に守る制約

1. **`js/logic.js` は凍結モジュール**。純粋関数のみ。
   `fetch` / `localStorage` / `document` / `Date.now()` を書かない（日付は引数で受ける）。
   変更したら必ず `node tools/verify.js` を実行し、ALL PASS まで直す。
2. **`fetch` を書いてよいのは `js/api.js` と `sw.js`（オフラインキャッシュ）だけ**。
   他のファイルから外部通信しない。
3. **車種の値は `"normal"`(普通車) と `"kei"`(軽自動車) の2つのみ**。
   文字列を変えたり増やしたりしない（保存済みデータが壊れる）。
4. **高速料金は ETC・通常料金のみ**。深夜割・休日割・平日朝夕割・長距離逓減などの
   割引ロジックを実装しない（ユーザーの明示的な指示）。
5. **金額は整数（円）**。ガソリン代は `Math.floor`、車種換算は10円単位に丸める。
6. **フレームワーク・ビルド工程・外部CDNを追加しない**。素のHTML + ES Modules のみ。
7. **すべてのパスは相対パス**（`./` 始まり）。GitHub Pages のサブパス配下で動くため。
8. **データを外部に送信しない**。保存先は localStorage のみ。
   外部通信は座標→距離、地名→座標の取得のみで、個人データを送らない。
9. **`.nojekyll` を消さない**。GitHub Pages は既定で Jekyll 処理を通すため、
   ドキュメント中の `{{` などをテンプレート構文と誤解してビルドが落ちる
   （実際に `docs/TASKS.md` の `{{壊れた` で公開が失敗した）。素の静的配信を維持する。
10. **APIキーをコードに埋め込まない**。既定のAPIはキー不要。
   OpenRouteService を使う場合のみユーザーが設定画面で入力し localStorage に保存する。

## 構成

- `index.html` … 全画面（計算 / 登録 / 設定）を含む単一ページ
- `js/logic.js` … 凍結:計算・換算・検証(純粋関数)
- `js/storage.js` … localStorage の読み書きのみ
- `js/api.js` … 外部通信のみ（国土地理院検索 / OSRM経路 / 位置情報）
- `js/app.js` … UI配線。ロジックは書かない（必ず logic.js を呼ぶ）
- `sw.js` … オフラインキャッシュ。**ファイル追加時は PRECACHE と VERSION を更新**
- `tests/logic.test.js` … `node --test`。境界値・異常系を必ず維持

## コマンド

- 検査（必須）: `node tools/verify.js`
- テストのみ: `npm test`
- ローカル確認: `node tools/serve.js` → http://localhost:8124

## 環境の罠（このPC固有）

- **PowerShell 5.1**: `&&` / `||` は使えない → `A; if ($?) { B }`。
  `Set-Content` は ANSI 既定 → `-Encoding utf8` を明示
- **`Invoke-WebRequest` で日本語JSONを保存しない**。UTF-8 を Latin-1 として解釈し
  文字化けしたまま保存される（IC名が全部壊れた実例あり）。データ取得は Node の `fetch` で行う
- **Overpass API は User-Agent が無いと 406** を返す。`node tools/build-ic-data.js` 参照
- **ブラウザ検証**: `screenshot` はこの環境でタイムアウトする。
  `read_page` / `javascript_tool` / `get_page_text` で検証する
- **index.html が激しくキャッシュされる**。「直したのに変わらない」ときは
  まず `location.reload(true)` を実行してから疑う
- `javascript_tool` に渡すJSは素直に書く。`(async function(){...})()` が安全

## ユーザーの流儀

- 「この通りに実装して」と言われたら仕様を忠実に再現する。**勝手な再設計・改善をしない。**
  改善案があれば実装前に一度だけ提案し、却下されたら従う
- 説明は日本語で平易に。ユーザーは非エンジニア
- 報告は「結果の表 + 次にユーザーがやること」の形式で簡潔に
