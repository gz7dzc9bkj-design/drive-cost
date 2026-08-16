// 全国のインターチェンジ一覧 data/interchanges.json を作る。
//
//   node tools/build-ic-data.js                 … Overpass から取得（1〜2分かかる）
//   node tools/build-ic-data.js --from dump.json … 取得済みの生データから作る
//
// 公開Overpassは検索のたびに叩くと 504 を返すほど重い。そこで一度だけ吸い出して
// アプリに同梱し、IC検索は端末内で完結させる（即座に出る・オフラインでも動く）。
// 道路の新設で古くなったら再実行すること。

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT_DIR = join(ROOT, "data");
const OUT = join(OUT_DIR, "interchanges.json");

// 緯度経度の四角で切ると中国・韓国のジャンクションが混ざるため、国境で絞る。
const QUERY =
  '[out:json][timeout:300];' +
  'area["ISO3166-1"="JP"][admin_level=2]->.jp;' +
  'node["highway"="motorway_junction"](area.jp);' +
  "out;";

/** 全角英数を半角にする（OSMのIC名は「八王子西ＩＣ」のように全角が多い）。 */
const toHalfWidth = (s) =>
  String(s ?? "").replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

async function fetchRaw() {
  console.log("Overpass から取得中（1〜2分かかります）…");
  // User-Agent を付けないと Overpass は 406 を返す
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "drive-cost/1.0 (personal toll calculator)",
      Accept: "application/json",
    },
    body: "data=" + encodeURIComponent(QUERY),
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  return res.json();
}

const fromArg = process.argv.indexOf("--from");
const raw =
  fromArg > -1
    ? // PowerShell の Out-File は BOM を付けるので取り除く
      JSON.parse(readFileSync(process.argv[fromArg + 1], "utf-8").replace(/^﻿/, ""))
    : await fetchRaw();

const byName = new Map();
let skipped = 0;

for (const el of raw.elements ?? []) {
  const rawName = el?.tags?.name;
  if (!rawName || !Number.isFinite(el.lat) || !Number.isFinite(el.lon)) continue;
  const name = toHalfWidth(rawName).trim();

  // 「八王子 (第2出口)」のようなランプ単位のノードは候補として紛らわしいので除く
  if (/[(（]/.test(name)) {
    skipped++;
    continue;
  }
  // 同じICに複数ノードがあるので、最初の1件だけ残す
  if (!byName.has(name)) {
    byName.set(name, [name, Number(el.lat.toFixed(5)), Number(el.lon.toFixed(5))]);
  }
}

const items = [...byName.values()].sort((a, b) => a[0].localeCompare(b[0], "ja"));

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify({ v: 1, items }), "utf-8");

const bytes = Buffer.byteLength(JSON.stringify({ v: 1, items }));
console.log(`元データ: ${raw.elements?.length ?? 0} ノード`);
console.log(`ランプ単位で除外: ${skipped}`);
console.log(`書き出し: ${items.length} 件 / ${(bytes / 1024).toFixed(0)} KB -> data/interchanges.json`);
console.log("例:", items.filter((i) => i[0].includes("八王子")).map((i) => i[0]).join(", "));
