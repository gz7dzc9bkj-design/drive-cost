# drive-cost 設計書

前提は [REQUIREMENTS.md](./REQUIREMENTS.md)（2026-08-14 凍結）に従う。

---

## 1. 技術スタック

**素の HTML + ES Modules のみ。フレームワーク・ビルド工程・CDN を一切使わない。**
keihi-note で実績のある構成をそのまま踏襲する（壊れる部品を増やさないことが最優先）。

- 実行環境: ブラウザのみ。サーバーなし
- 公開先: GitHub Pages（サブパス配下で動くよう **全パスは `./` 始まりの相対パス**）
- 保存: localStorage のみ
- テスト: `node --test`（Node v24 確認済み）

---

## 2. ファイル構成

```
drive-cost/
├── index.html              全画面（計算 / 登録 / 設定）を含む単一ページ
├── css/style.css
├── js/
│   ├── logic.js            ★凍結: 純粋関数のみ（DOM・localStorage・fetch 禁止）
│   ├── storage.js          localStorage の読み書きのみ
│   ├── api.js              外部API通信のみ（fetch はここだけ）
│   └── app.js              UI配線。ロジックは書かず logic.js を呼ぶ
├── tests/logic.test.js     node --test
├── tools/
│   ├── serve.js            ローカル確認用（http://localhost:8124）
│   └── verify.js           ★機械検査（構文 + 不変条件 + テスト）
├── icons/                  180 / 192 / 512 PNG
├── manifest.webmanifest
├── sw.js                   オフラインキャッシュ
└── package.json
```

---

## 3. データモデル（localStorage）

キーは全て `dc.` 接頭辞。

```js
// dc.settings
{ yenPerL: 175, activeVehicleId: "v1", router: "osrm", orsKey: "" }

// dc.vehicles  — 車両プリセット
[{ id: "v1", name: "ヴォクシー", type: "normal", kmPerL: 13.5 },
 { id: "v2", name: "アルト",     type: "kei",    kmPerL: 22.0 }]
// type は "normal"(普通車) | "kei"(軽自動車) の2値のみ

// dc.places   — 登録地点
[{ id: "p1", name: "自宅", lat: 35.6812, lon: 139.7671 }]

// dc.ics      — 登録IC（lat/lon は任意。あれば経路の経由地に使う）
[{ id: "i1", name: "川口IC", lat: 35.82, lon: 139.72 }]

// dc.tolls    — 高速料金（IC2つ + 車種 の3点セットが主キー）
[{ inIcId: "i1", outIcId: "i2", type: "normal", yen: 8140, updatedAt: "2026-08-14" }]
```

**重要**: 車種は `"normal"` / `"kei"` の文字列で固定。保存済みデータが壊れるため後から値を変えない。

---

## 4. js/logic.js（凍結モジュール / 純粋関数のみ）

DOM・localStorage・fetch・`Date.now()` を **使わない**（テスト再現性のため、日付は引数で受ける）。

| 関数 | 仕様 |
|---|---|
| `fuelCost(distanceKm, kmPerL, yenPerL)` | `distanceKm / kmPerL * yenPerL` を **10円単位に切り上げ**（1円の位を出さない。2026-08-15 ユーザー要望）。kmPerL≤0 なら `null` |
| `tollKey(inIcId, outIcId, type)` | `` `${inIcId}>${outIcId}#${type}` `` |
| `findToll(tolls, inIcId, outIcId, type)` | 完全一致 → `{yen, exact:true}` / 他車種のみ有 → 換算して `{yen, exact:false}` / 無 → `null` |
| `convertToll(yen, fromType, toType)` | 軽=普通×0.8、普通=軽÷0.8。**10円単位に四捨五入**（NEXCO料金は10円単位） |
| `estimateToll(highwayKm, type)` | `(150 + km×24.6) × 車種比率 × 1.1` を10円単位に切り上げ。**長距離逓減は適用しない**（多めに出す方針）。登録が無いときの目安 |
| `totalCost(fuelYen, tollYen, roundTrip)` | `roundTrip` なら両方2倍して合計 |
| `formatDistanceKm(meters)` | m → km、小数1桁の数値 |
| `isTollStale(updatedAt, todayStr)` | 更新から1年以上経過なら `true` |
| `validateNumber(v, {min, max})` | 入力検証。NaN・範囲外を弾く |

車種間比率 0.8 は **概算**であり、`exact:false` の結果には UI で必ず「概算」バッジを出す。

---

## 5. js/api.js（外部通信 / 実測検証済み）

| 関数 | 呼び先 | 備考 |
|---|---|---|
| `searchPlace(q)` | 主 `https://nominatim.openstreetmap.org/search`／予備 `https://msearch.gsi.go.jp/address-search/AddressSearch` | どちらもキー不要・CORS `*` 確認済み。**国土地理院は住所専用で「東京駅」を「東」と解釈する**ため主に使わない。Nominatim を先に引き 0 件のときだけ国土地理院へ。呼び出し間隔は1秒以上あける（利用規約）。`display_name` は「施設名（都道府県市区町村）」に短縮して表示 |
| `routeDistance(points)` | `https://router.project-osrm.org/route/v1/driving/{lon,lat};…?overview=false` | 経由IC座標があれば出発地と目的地の間に挟む。返り値 `routes[0].distance`(m) |
| `routeDistanceORS(points, key)` | OpenRouteService | OSRM 不調時のみ。設定でキーを入れると切替 |
| `currentPosition()` | `navigator.geolocation` | HTTPS 必須（GitHub Pages はHTTPS ✓） |

- 通信は全て **10秒タイムアウト + 失敗時は画面にエラー表示**。落ちても手動入力で計算は続行できる
- ドラぷらは `https://www.driveplaza.com/dp/SearchTop` を新規タブで開くだけ（プリフィル不可）

---

## 6. 画面（単一ページ・タブ切替）

### ① 計算（メイン）
```
[普通車 | 軽自動車]  ← 車種トグル（車両プリセットと連動）
出発地   [現在地を取得] / [登録地点▼] / [検索…]
目的地   [登録地点▼] / [検索…]
入口IC   [登録IC▼]     出口IC [登録IC▼]
燃費 [13.5] km/L     単価 [175] 円/L     [ ] 往復

距離     182.4 km  [手動で直す]
ガソリン代   2,128 円
高速料金     4,830 円   ← 未登録なら「未登録 [ドラぷらで調べる]」
合計         6,958 円
```

### ② 登録（地点 / IC / 料金）
- 地点・IC の追加編集削除
- 料金は「入口IC・出口IC・車種・金額」で登録。一覧に更新日を表示し、古いものに注意マーク

### ③ 設定
- 車両プリセットの追加編集削除（名前 / 車種 / 燃費）
- ガソリン単価の既定値
- 経路APIの切替（OSRM ⇔ OpenRouteService＋キー）
- データの書き出し / 読み込み（JSON、機種変更用）

---

## 7. 機械検査 `node tools/verify.js`

3層構成。**コード変更後は必ず実行し ALL PASS を維持する。**

- **[A] 構文**: 全 `.js` を `node --check`
- **[B] 不変条件**（grep による凍結検査）
  - `js/logic.js` に `fetch` / `localStorage` / `document` / `Date.now` が **無い**こと
  - `js/api.js` 以外に `fetch(` が **無い**こと
  - `index.html` の `src` / `href` が全て `./` 始まりであること（Pages サブパス対策）
  - 車種文字列が `"normal"` / `"kei"` 以外に増えていないこと
- **[C] ロジックテスト**: `node --test tests/logic.test.js`

---

## 8. 既知の割り切り

- OSRM の経路は純正マップと選び方が違うため **距離が数km単位でズレる**。手動上書きで対応
- OSRM は公開デモサーバーのため無保証。落ちた場合は距離手動入力 or ORS へ切替
- 軽⇔普通車の換算は比率0.8の概算。正確な値が要るときは両方登録する
