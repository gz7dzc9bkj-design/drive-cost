// drive-cost 機械検査
//   [A] 構文   : 全 .js を node --check
//   [B] 不変条件: CLAUDE.md の凍結事項をソース検査で機械的に守らせる
//   [C] テスト  : node --test tests/logic.test.js
// 使い方: node tools/verify.js   → 最後に "ALL PASS" が出ることを確認する

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const rel = (p) => relative(ROOT, p).split(sep).join("/");

const results = [];
const check = (layer, name, ok, detail = "") =>
  results.push({ layer, name, ok: !!ok, detail });

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".git") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const allFiles = walk(ROOT);
const jsFiles = allFiles.filter((f) => f.endsWith(".js"));
const read = (p) => (existsSync(p) ? readFileSync(p, "utf-8") : null);

// ---------- [A] 構文 ----------
for (const f of jsFiles) {
  const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf-8" });
  check("A", `構文 ${rel(f)}`, r.status === 0, (r.stderr || "").split("\n")[0]);
}

// ---------- [B] 不変条件 ----------

// B1: logic.js は純粋関数のみ（副作用を持ち込む語を禁止）
const LOGIC = join(ROOT, "js", "logic.js");
const logicSrc = read(LOGIC);
if (logicSrc === null) {
  check("B", "js/logic.js が存在する", false);
} else {
  const stripped = logicSrc.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const bad of ["fetch", "localStorage", "document", "window", "Date.now", "new Date"]) {
    check("B", `logic.js に ${bad} が無い`, !stripped.includes(bad));
  }
  // B2: 車種は normal / kei の2値のみ
  check(
    "B",
    'logic.js の VEHICLE_TYPES が ["normal","kei"] のまま',
    /VEHICLE_TYPES\s*=\s*\[\s*"normal"\s*,\s*"kei"\s*\]/.test(stripped)
  );
  check(
    "B",
    "車種が2値以外に増えていない",
    !/"(medium|large|special|motorcycle|light)"/.test(stripped)
  );
}

// B3: fetch を書いてよいのは api.js と sw.js（オフラインキャッシュ）だけ
const API = join(ROOT, "js", "api.js");
const SW_FILE = join(ROOT, "sw.js");
for (const f of jsFiles) {
  if (f === API || f === SW_FILE) continue;
  if (f.startsWith(join(ROOT, "tools")) || f.startsWith(join(ROOT, "tests"))) continue;
  const src = read(f).replace(/\/\/[^\n]*/g, "");
  check("B", `${rel(f)} に fetch( が無い`, !src.includes("fetch("));
}

// B4: index.html のパスは全て相対（GitHub Pages のサブパス対策）
const INDEX = join(ROOT, "index.html");
const html = read(INDEX);
if (html === null) {
  check("B", "index.html が存在する", false);
} else {
  // 自サイト内のパスは ./ 始まりのみ許可（Pages のサブパス対策）。
  // 外部サイトへのリンク（ドラぷら等）は絶対URLで良い。
  const bad = [];
  for (const m of html.matchAll(/(?:src|href)\s*=\s*"([^"]*)"/g)) {
    const v = m[1];
    if (v === "" || v.startsWith("#") || v.startsWith("./") || v.startsWith("data:")) continue;
    if (/^https?:\/\//.test(v)) continue;
    bad.push(v);
  }
  check("B", "index.html の内部パスが全て ./ 始まり", bad.length === 0, bad.join(", "));
}

// B5: sw.js の PRECACHE が実ファイルを網羅している（追加忘れの定番事故を防ぐ）
const SW = join(ROOT, "sw.js");
const swSrc = read(SW);
if (swSrc !== null) {
  const listed = new Set([...swSrc.matchAll(/"(\.\/[^"]+)"/g)].map((m) => m[1]));
  const must = allFiles
    .map(rel)
    .filter(
      (p) =>
        p === "index.html" ||
        p === "manifest.webmanifest" ||
        p.startsWith("css/") ||
        p.startsWith("js/") ||
        p.startsWith("icons/")
    )
    .map((p) => "./" + p);
  const missing = must.filter((p) => !listed.has(p));
  check("B", "sw.js の PRECACHE に漏れが無い", missing.length === 0, missing.join(", "));
  check("B", "sw.js に VERSION がある", /VERSION\s*=/.test(swSrc));
}

// B6: 割引ロジックを持ち込んでいない（ETC通常料金のみ）
for (const f of jsFiles) {
  if (f.startsWith(join(ROOT, "tools"))) continue;
  const src = read(f);
  check("B", `${rel(f)} に割引ロジックが無い`, !/(深夜割|休日割|朝夕割|逓減|nightDiscount|holidayDiscount)/.test(src));
}

// ---------- [C] ロジックテスト ----------
const TESTS = join(ROOT, "tests", "logic.test.js");
if (!existsSync(TESTS)) {
  check("C", "tests/logic.test.js が存在する", false);
} else {
  const r = spawnSync(process.execPath, ["--test", TESTS], { encoding: "utf-8", cwd: ROOT });
  const out = (r.stdout || "") + (r.stderr || "");
  // node --test の集計行は環境により "# pass 34" / "ℹ pass 34" のどちらでも出る
  const pass = (out.match(/[#ℹ]\s*pass\s+(\d+)/) || [])[1] || "?";
  const fail = (out.match(/[#ℹ]\s*fail\s+(\d+)/) || [])[1] || "?";
  check("C", `logic テスト (pass ${pass} / fail ${fail})`, r.status === 0);
  if (r.status !== 0) console.log(out);
}

// ---------- 出力 ----------
let ng = 0;
for (const r of results) {
  if (!r.ok) ng++;
  const mark = r.ok ? "[OK]" : "[NG]";
  console.log(`${mark} [${r.layer}] ${r.name}${r.detail && !r.ok ? "  -> " + r.detail : ""}`);
}
console.log("-".repeat(50));
if (ng === 0) {
  console.log(`ALL PASS (${results.length} checks)`);
  process.exit(0);
} else {
  console.log(`FAILED: ${ng} / ${results.length} checks`);
  process.exit(1);
}
