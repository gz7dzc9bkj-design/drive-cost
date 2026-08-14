# drive-cost — エージェント向け作業規約

本人専用の「高速道路料金＋ガソリン代」計算PWA。
仕様は `docs/REQUIREMENTS.md`（2026-08-14 凍結）と `docs/DESIGN.md`。
詳細な憲法は `CLAUDE.md` と同一。以下は要点。

## 鉄則

**コードを変更したら必ず `node tools/verify.js` を実行し、ALL PASS を維持する。**

## 禁止事項

1. `js/logic.js` に `fetch` / `localStorage` / `document` / `Date.now()` を書かない（純粋関数のみ）
2. `js/api.js` と `sw.js`（オフラインキャッシュ）以外のファイルで `fetch` を使わない
3. 車種の値 `"normal"` / `"kei"` を変更・追加しない（保存済みデータが壊れる）
4. 深夜割・休日割・平日朝夕割・長距離逓減などの割引ロジックを実装しない（ETC通常料金のみ）
5. フレームワーク・ビルド工程・外部CDNを追加しない（素のHTML + ES Modules のみ）
6. 絶対パスを使わない（GitHub Pages のサブパス配下で動かすため全て `./` 始まり）
7. APIキーをコードに埋め込まない（既定のAPIはキー不要）
8. localStorage 以外にデータを保存・送信しない

## 数値の扱い

- 金額は整数（円）。ガソリン代は `Math.floor`
- 軽⇔普通車の料金換算は比率0.8、**10円単位に丸める**。換算値には必ず「概算」表示を付ける

## コマンド

- 検査: `node tools/verify.js`
- テスト: `npm test`
- ローカル確認: `node tools/serve.js` → http://localhost:8124
