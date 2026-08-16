// UI 配線のみ。計算は必ず logic.js、保存は storage.js、通信は api.js を呼ぶ。

import {
  VEHICLE_LABEL,
  fuelCost,
  estimateToll,
  findToll,
  totalCost,
  formatDistanceKm,
  formatYen,
  isTollStale,
  validateNumber,
  validateVehicle,
} from "./logic.js";
import * as db from "./storage.js";
import { searchPlace, routeDistance, currentPosition, reverseLabel } from "./api.js";

const $ = (id) => document.getElementById(id);

const state = {
  start: null, // {name, lat, lon}
  dest: null,
  distanceM: null, // 経路APIから得た自動距離
  manualKm: null, // 手動上書き（null なら自動を使う）
  highwayM: null, // 入口IC〜出口IC の距離。料金を概算するのに使う
  lastVehicleId: null, // 燃費欄を車両に追従させるための記録
};

let toastTimer = null;
function toast(msg, isError = false) {
  const el = $("toast");
  el.textContent = msg;
  el.className = isError ? "toast err" : "toast";
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), isError ? 4200 : 2200);
}

// ---------------- タブ ----------------
$("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-tab]");
  if (!btn) return;
  for (const b of $("tabs").querySelectorAll("button")) b.classList.toggle("on", b === btn);
  for (const name of ["calc", "reg", "set"]) $(`tab-${name}`).hidden = name !== btn.dataset.tab;
});

// ---------------- 選択肢の描画 ----------------
function fillSelect(sel, items, { placeholder, value }) {
  sel.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = placeholder;
  sel.appendChild(opt0);
  for (const it of items) {
    const o = document.createElement("option");
    o.value = it.id;
    o.textContent = it.label;
    sel.appendChild(o);
  }
  sel.value = items.some((i) => i.id === value) ? value : "";
}

function vehicleItems() {
  return db.getVehicles().map((v) => ({
    id: v.id,
    label: `${v.name}（${VEHICLE_LABEL[v.type] ?? "?"}・${v.kmPerL} km/L）`,
  }));
}
const placeItems = () => db.getPlaces().map((p) => ({ id: p.id, label: p.name }));
const icItems = () => db.getIcs().map((i) => ({ id: i.id, label: i.name }));

function activeVehicle() {
  const s = db.getSettings();
  return db.getVehicles().find((v) => v.id === s.activeVehicleId) ?? null;
}
const currentType = () => activeVehicle()?.type ?? "normal";

/** 燃費欄を選択中の車両に追従させる（車両が変わった時と未入力の時だけ上書きする）。 */
function syncFuelField() {
  const v = activeVehicle();
  if (!v) return;
  if (state.lastVehicleId !== v.id || $("kmPerL").value === "") {
    $("kmPerL").value = v.kmPerL;
    state.lastVehicleId = v.id;
  }
}

function renderSelects() {
  const s = db.getSettings();
  const trip = db.getTrip();
  fillSelect($("vehicleSel"), vehicleItems(), { placeholder: "車両を選択…", value: s.activeVehicleId });
  fillSelect($("startPlace"), placeItems(), { placeholder: "登録地点から選ぶ…", value: "" });
  fillSelect($("destPlace"), placeItems(), { placeholder: "登録地点から選ぶ…", value: "" });
  // 起動直後は保存済みの選択を復元し、以後は画面の選択を保つ
  fillSelect($("inIc"), icItems(), { placeholder: "選択なし", value: $("inIc").value || trip.inIcId });
  fillSelect($("outIc"), icItems(), { placeholder: "選択なし", value: $("outIc").value || trip.outIcId });
  fillSelect($("tollIn"), icItems(), { placeholder: "入口ICを選択…", value: $("tollIn").value });
  fillSelect($("tollOut"), icItems(), { placeholder: "出口ICを選択…", value: $("tollOut").value });
}

// ---------------- 一覧の描画 ----------------
function row(mainHtml, onDelete) {
  const r = document.createElement("div");
  r.className = "r";
  const box = document.createElement("span");
  box.className = "item";
  box.innerHTML = mainHtml;
  r.appendChild(box);
  const del = document.createElement("button");
  del.type = "button";
  del.className = "btn del";
  del.textContent = "削除";
  del.addEventListener("click", onDelete);
  r.appendChild(del);
  return r;
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function renderLists() {
  const today = db.todayStr();

  const pl = $("placeList");
  pl.innerHTML = "";
  for (const p of db.getPlaces()) {
    pl.appendChild(
      row(`${esc(p.name)}<small>${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</small>`, () => {
        db.setPlaces(db.getPlaces().filter((x) => x.id !== p.id));
        renderAll();
      })
    );
  }

  const il = $("icList");
  il.innerHTML = "";
  for (const i of db.getIcs()) {
    const coord =
      Number.isFinite(i.lat) && Number.isFinite(i.lon)
        ? `${i.lat.toFixed(5)}, ${i.lon.toFixed(5)}`
        : "座標なし";
    il.appendChild(
      row(`${esc(i.name)}<small>${coord}</small>`, () => {
        db.setIcs(db.getIcs().filter((x) => x.id !== i.id));
        renderAll();
      })
    );
  }

  const tl = $("tollList");
  tl.innerHTML = "";
  const ics = db.getIcs();
  const nameOf = (id) => ics.find((x) => x.id === id)?.name ?? "(削除されたIC)";
  for (const t of db.getTolls()) {
    const stale = isTollStale(t.updatedAt, today) ? '<span class="badge warn">要更新</span>' : "";
    tl.appendChild(
      row(
        `${esc(nameOf(t.inIcId))} → ${esc(nameOf(t.outIcId))}` +
          `<small>${stale}${VEHICLE_LABEL[t.type] ?? "?"} ${formatYen(t.yen)}円・${esc(t.updatedAt)} 更新</small>`,
        () => {
          db.setTolls(
            db.getTolls().filter(
              (x) => !(x.inIcId === t.inIcId && x.outIcId === t.outIcId && x.type === t.type)
            )
          );
          renderAll();
        }
      )
    );
  }

  const vl = $("vehicleList");
  vl.innerHTML = "";
  for (const v of db.getVehicles()) {
    vl.appendChild(
      row(
        `${esc(v.name)}<small>${VEHICLE_LABEL[v.type] ?? "?"}・${v.kmPerL} km/L</small>`,
        () => {
          db.setVehicles(db.getVehicles().filter((x) => x.id !== v.id));
          renderAll();
        }
      )
    );
  }
}

// ---------------- 計算 ----------------
function currentKm() {
  if (state.manualKm !== null) return state.manualKm;
  if (state.distanceM === null) return null;
  return formatDistanceKm(state.distanceM);
}

function recalc() {
  const km = currentKm();
  const rt = $("roundTrip").checked;

  $("distLabel").textContent = km === null ? "-" : `${km.toFixed(1)} km`;
  if (state.manualKm !== null) $("distLabel").textContent += "（手動）";

  const kmPerL = validateNumber($("kmPerL").value, { min: 0.1 });
  const yenPerL = validateNumber($("yenPerL").value, { min: 0 });
  const fuel = km === null ? null : fuelCost(km, kmPerL, yenPerL);
  $("fuelLabel").textContent = fuel === null ? "-" : `${formatYen(fuel)} 円`;

  const inIcId = $("inIc").value;
  const outIcId = $("outIc").value;
  const type = currentType();
  const tollEl = $("tollLabel");
  const entry = $("tollEntry");
  let tollYen = null;

  if (!inIcId || !outIcId) {
    tollEl.innerHTML = '<span class="lb2">ICを選択</span>';
    entry.hidden = true;
  } else {
    const t = findToll(db.getTolls(), inIcId, outIcId, type);
    const stale = t ? isTollStale(t.updatedAt, db.todayStr()) : false;

    if (t && t.exact) {
      // 1. その車種で登録済み（一番正確）
      tollYen = t.yen;
      tollEl.innerHTML =
        `${stale ? '<span class="badge warn">要更新</span>' : ""}` +
        `<span class="money">${formatYen(t.yen)} 円</span>`;
      $("tollEntryMsg").textContent = "金額を登録し直す場合はこちら";
      entry.hidden = !stale;
    } else if (t) {
      // 2. 他の車種の登録額から換算
      tollYen = t.yen;
      tollEl.innerHTML = `<span class="badge">換算</span><span class="money">${formatYen(t.yen)} 円</span>`;
      $("tollEntryMsg").textContent =
        `${VEHICLE_LABEL[t.fromType]}の登録額から換算した値です。正確な額を登録できます`;
      entry.hidden = false;
    } else {
      // 3. 未登録 → IC間の距離から概算する
      const hwKm = state.highwayM === null ? null : formatDistanceKm(state.highwayM);
      const est = hwKm === null ? null : estimateToll(hwKm, type);
      if (est !== null) {
        tollYen = est;
        tollEl.innerHTML = `<span class="badge">概算</span><span class="money">${formatYen(est)} 円</span>`;
        $("tollEntryMsg").textContent =
          `IC間 ${hwKm.toFixed(1)}km からの概算です（割引を含めないため実額より高めに出ます）`;
      } else {
        tollEl.innerHTML = '<span class="miss">未登録</span>';
        $("tollEntryMsg").textContent =
          "料金が未登録です（登録タブでICに座標を入れると概算が出ます）";
      }
      entry.hidden = false;
    }

    // どの区間・どの車種として保存されるかを明示する
    const icName = (id) => db.getIcs().find((x) => x.id === id)?.name ?? "?";
    $("tollEntryTarget").textContent =
      `${icName(inIcId)} → ${icName(outIcId)}（${VEHICLE_LABEL[type]}）`;

    // 入力欄が空なら候補を入れておき、そのまま保存できるようにする
    if (!$("tollInput").value && tollYen !== null) $("tollInput").value = tollYen;
  }

  $("totalLb").textContent = rt ? "合計（往復）" : "合計";
  const total = fuel === null && tollYen === null ? null : totalCost(fuel ?? 0, tollYen ?? 0, rt);
  $("totalLabel").textContent = total === null ? "-" : `${formatYen(total)} 円`;
}

// IC間の距離は毎回同じなので、一度引いたら覚えておく
const icDistanceCache = new Map();

// 続けてICを変えると通信の応答順が入れ替わり、古い結果が新しい結果を
// 上書きすることがある（実測で概算が壊れた）。通し番号で古い応答を捨てる。
let highwaySeq = 0;

/** 入口IC〜出口IC の距離（＝高速を走る距離）を求める。座標が無ければ null。 */
async function updateHighwayDistance() {
  const seq = ++highwaySeq;
  const ics = db.getIcs();
  const inId = $("inIc").value;
  const outId = $("outIc").value;
  const a = ics.find((x) => x.id === inId);
  const b = ics.find((x) => x.id === outId);
  const ok = (i) => i && Number.isFinite(i.lat) && Number.isFinite(i.lon);

  // 入口と出口が同じ／座標が無い区間は概算しない
  if (!ok(a) || !ok(b) || inId === outId) {
    state.highwayM = null;
    saveTrip();
    recalc();
    return;
  }

  const key = `${a.id}>${b.id}`;
  if (icDistanceCache.has(key)) {
    state.highwayM = icDistanceCache.get(key);
    saveTrip();
    recalc();
    return;
  }
  let m = null;
  try {
    m = await routeDistance([a, b], db.getSettings());
    icDistanceCache.set(key, m);
  } catch {
    m = null; // 概算が出ないだけで、登録済みの料金には影響しない
  }
  if (seq !== highwaySeq) return; // 選択が変わった後の古い応答は捨てる
  state.highwayM = m;
  saveTrip();
  recalc();
}

let distanceSeq = 0;

async function autoDistance() {
  if (!state.start || !state.dest) return;
  const seq = ++distanceSeq;
  const ics = db.getIcs();
  const byId = (id) => ics.find((x) => x.id === id);
  const via = [byId($("inIc").value), byId($("outIc").value)].filter(
    (i) => i && Number.isFinite(i.lat) && Number.isFinite(i.lon)
  );
  const points = [state.start, ...via, state.dest];

  $("distLabel").textContent = "計算中…";
  let m = null;
  let error = null;
  try {
    m = await routeDistance(points, db.getSettings());
  } catch (e) {
    error = e;
  }
  if (seq !== distanceSeq) return; // 条件が変わった後の古い応答は捨てる
  // 通信に失敗しても、前回の距離が残っているならそれを保つ（圏外で消えないように）
  if (m !== null) state.distanceM = m;
  if (error) toast(`距離を計算できませんでした：${error.message}`, true);
  saveTrip();
  recalc();
}

// ---------------- 地点の検索 ----------------
async function runSearch(query, container, onPick) {
  container.hidden = false;
  container.innerHTML = '<div class="empty">検索中…</div>';
  let results = [];
  try {
    results = await searchPlace(query);
  } catch (e) {
    container.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    return;
  }
  if (!results.length) {
    container.innerHTML = '<div class="empty">見つかりませんでした</div>';
    return;
  }
  container.innerHTML = "";
  for (const r of results) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = r.name;
    b.addEventListener("click", () => {
      container.hidden = true;
      onPick(r);
    });
    container.appendChild(b);
  }
}

/** 入力中の内容を保存する。これが無いとアプリを開き直したとき全部消える。 */
function saveTrip() {
  db.setTrip({
    start: state.start,
    dest: state.dest,
    inIcId: $("inIc").value,
    outIcId: $("outIc").value,
    manualKm: state.manualKm,
    roundTrip: $("roundTrip").checked,
    distanceM: state.distanceM,
    highwayM: state.highwayM,
  });
}

function setStart(p) {
  state.start = p;
  $("startLabel").textContent = p ? p.name : "未設定";
  state.manualKm = null;
  $("distEditRow").hidden = true;
  saveTrip();
  autoDistance();
}
function setDest(p) {
  state.dest = p;
  $("destLabel").textContent = p ? p.name : "未設定";
  state.manualKm = null;
  $("distEditRow").hidden = true;
  saveTrip();
  autoDistance();
}

// ---------------- イベント ----------------
$("vehicleSel").addEventListener("change", () => {
  db.setSettings({ activeVehicleId: $("vehicleSel").value || null });
  syncFuelField();
  $("tollInput").value = ""; // 車種が変われば料金の候補も変わる
  recalc();
});

/** 位置情報が使えないときの案内。トーストは消えてしまうので画面に残す。 */
const GEO_HELP = {
  denied: {
    title: "位置情報が許可されていません",
    body:
      "<b>iPhoneでの許可のしかた</b><ol>" +
      "<li>「設定」→「プライバシーとセキュリティ」→「位置情報サービス」を<b>オン</b></li>" +
      "<li>同じ画面を下にたどり「<b>Safari Webサイト</b>」→「このAppの使用中のみ許可」</li>" +
      "<li>このアプリを開き直して、もう一度［現在地］を押す</li></ol>" +
      "ホーム画面に追加したアプリの場合は、初回に出る確認で「<b>許可</b>」を選んでください。" +
      "一度「許可しない」を選ぶと以後は聞かれないため、上の手順が必要です。",
  },
  insecure: {
    title: "安全な接続ではないため取得できません",
    body: "<code>https://</code> で始まるURLから開いてください。",
  },
  timeout: {
    title: "現在地の取得に時間がかかっています",
    body: "電波の届く場所でもう一度［現在地］を押してください。屋内や地下では取得できないことがあります。",
  },
  unavailable: {
    title: "現在地を取得できませんでした",
    body: "電波の届く場所でもう一度お試しください。",
  },
  unsupported: {
    title: "この端末では現在地を取得できません",
    body: "「登録から」または「地名・住所で検索」で出発地を指定してください。",
  },
};

function showGeoHelp(kind) {
  const h = GEO_HELP[kind] ?? GEO_HELP.unavailable;
  $("geoHelpTitle").textContent = h.title;
  $("geoHelpBody").innerHTML = h.body;
  $("geoHelp").hidden = false;
}

$("btnGeoHelpClose").addEventListener("click", () => ($("geoHelp").hidden = true));

$("btnHere").addEventListener("click", async () => {
  const previous = $("startLabel").textContent;
  $("geoHelp").hidden = true;
  $("startLabel").textContent = "取得中…";
  try {
    const pos = await currentPosition();
    const label = await reverseLabel(pos.lat, pos.lon);
    setStart({ name: label ? `現在地（${label}）` : "現在地", lat: pos.lat, lon: pos.lon });
  } catch (e) {
    $("startLabel").textContent = previous; // 失敗しても前の出発地を消さない
    toast(e.message, true);
    showGeoHelp(e.kind);
  }
});

$("startPlace").addEventListener("change", () => {
  const p = db.getPlaces().find((x) => x.id === $("startPlace").value);
  if (p) setStart({ name: p.name, lat: p.lat, lon: p.lon });
});
$("destPlace").addEventListener("change", () => {
  const p = db.getPlaces().find((x) => x.id === $("destPlace").value);
  if (p) setDest({ name: p.name, lat: p.lat, lon: p.lon });
});

$("btnStartSearch").addEventListener("click", () =>
  runSearch($("startQ").value, $("startResults"), setStart)
);
$("btnDestSearch").addEventListener("click", () =>
  runSearch($("destQ").value, $("destResults"), setDest)
);
for (const [input, btn] of [["startQ", "btnStartSearch"], ["destQ", "btnDestSearch"]]) {
  $(input).addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $(btn).click();
    }
  });
}

function onIcChanged() {
  $("tollInput").value = ""; // 別の区間になったので候補を入れ直す
  saveTrip();
  if (state.manualKm === null) autoDistance();
  updateHighwayDistance();
  recalc();
}

for (const id of ["inIc", "outIc"]) $(id).addEventListener("change", onIcChanged);

/**
 * 計算画面でIC名を検索して選んだときの処理。
 * 未登録なら自動で登録し、そのまま入口/出口に設定する。
 */
function pickIc(selectId, result) {
  // 「八王子西IC（首都圏中央連絡自動車道八王子市）」→「八王子西IC」
  const name = result.name.replace(/（[^）]*）\s*$/u, "").trim() || result.name;
  const ics = db.getIcs();
  let ic = ics.find((x) => x.name === name);

  if (!ic) {
    ic = { id: db.newId("i"), name, lat: result.lat, lon: result.lon };
    db.setIcs([...ics, ic]);
    toast(`${name} を登録しました`);
  } else if (!Number.isFinite(ic.lat) || !Number.isFinite(ic.lon)) {
    // 座標なしで登録済みのICなら、ここで座標を補う
    db.setIcs(ics.map((x) => (x.id === ic.id ? { ...x, lat: result.lat, lon: result.lon } : x)));
  }

  renderAll(); // プルダウンを作り直してから選択する
  $(selectId).value = ic.id;
  onIcChanged();
}

for (const [inputId, btnId, selectId, boxId] of [
  ["inIcQ", "btnInIcSearch", "inIc", "inIcResults"],
  ["outIcQ", "btnOutIcSearch", "outIc", "outIcResults"],
]) {
  $(btnId).addEventListener("click", () =>
    runSearch($(inputId).value, $(boxId), (r) => {
      $(inputId).value = "";
      pickIc(selectId, r);
    })
  );
  $(inputId).addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $(btnId).click();
    }
  });
}
for (const id of ["kmPerL", "roundTrip"]) $(id).addEventListener("input", recalc);
$("roundTrip").addEventListener("change", () => {
  saveTrip();
  recalc();
});
$("yenPerL").addEventListener("input", () => {
  const v = validateNumber($("yenPerL").value, { min: 0 });
  if (v !== null) db.setSettings({ yenPerL: v });
  recalc();
});

$("btnEditDist").addEventListener("click", () => {
  $("distEditRow").hidden = false;
  const km = currentKm();
  if (km !== null) $("distManual").value = km;
  $("distManual").focus();
});
$("distManual").addEventListener("input", () => {
  state.manualKm = validateNumber($("distManual").value, { min: 0 });
  saveTrip();
  recalc();
});
$("btnAutoDist").addEventListener("click", () => {
  state.manualKm = null;
  $("distEditRow").hidden = true;
  $("distManual").value = "";
  saveTrip();
  recalc();
  autoDistance();
});

$("btnSaveToll").addEventListener("click", () => {
  const yen = validateNumber($("tollInput").value, { min: 0 });
  const inIcId = $("inIc").value;
  const outIcId = $("outIc").value;
  if (!inIcId || !outIcId) return toast("入口ICと出口ICを選んでください", true);
  if (yen === null) return toast("金額を入力してください", true);
  db.saveToll(inIcId, outIcId, currentType(), Math.round(yen), db.todayStr());
  $("tollInput").value = "";
  toast("料金を登録しました");
  renderAll();
});

// --- 登録タブ ---
$("btnPlaceHere").addEventListener("click", async () => {
  try {
    const pos = await currentPosition();
    $("placeLat").value = pos.lat.toFixed(6);
    $("placeLon").value = pos.lon.toFixed(6);
    if (!$("placeName").value) $("placeName").value = (await reverseLabel(pos.lat, pos.lon)) ?? "現在地";
  } catch (e) {
    toast(e.message, true);
  }
});
$("btnPlaceSearch").addEventListener("click", () =>
  runSearch($("placeName").value, $("placeResults"), (r) => {
    $("placeName").value = r.name;
    $("placeLat").value = r.lat.toFixed(6);
    $("placeLon").value = r.lon.toFixed(6);
  })
);
$("btnAddPlace").addEventListener("click", () => {
  const name = $("placeName").value.trim();
  const lat = validateNumber($("placeLat").value, { min: -90, max: 90 });
  const lon = validateNumber($("placeLon").value, { min: -180, max: 180 });
  if (!name) return toast("名前を入力してください", true);
  if (lat === null || lon === null) return toast("緯度・経度を入力してください", true);
  db.setPlaces([...db.getPlaces(), { id: db.newId("p"), name, lat, lon }]);
  $("placeName").value = $("placeLat").value = $("placeLon").value = "";
  toast("地点を追加しました");
  renderAll();
});

$("btnIcSearch").addEventListener("click", () =>
  runSearch($("icName").value, $("icResults"), (r) => {
    $("icLat").value = r.lat.toFixed(6);
    $("icLon").value = r.lon.toFixed(6);
  })
);
$("btnAddIc").addEventListener("click", () => {
  const name = $("icName").value.trim();
  if (!name) return toast("IC名を入力してください", true);
  const lat = validateNumber($("icLat").value, { min: -90, max: 90 });
  const lon = validateNumber($("icLon").value, { min: -180, max: 180 });
  const ic = { id: db.newId("i"), name };
  if (lat !== null && lon !== null) Object.assign(ic, { lat, lon });
  db.setIcs([...db.getIcs(), ic]);
  $("icName").value = $("icLat").value = $("icLon").value = "";
  toast("ICを追加しました");
  renderAll();
});

$("btnAddToll").addEventListener("click", () => {
  const inIcId = $("tollIn").value;
  const outIcId = $("tollOut").value;
  const yen = validateNumber($("tollYen").value, { min: 0 });
  if (!inIcId || !outIcId) return toast("入口ICと出口ICを選んでください", true);
  if (inIcId === outIcId) return toast("入口ICと出口ICが同じです", true);
  if (yen === null) return toast("金額を入力してください", true);
  db.saveToll(inIcId, outIcId, $("tollType").value, Math.round(yen), db.todayStr());
  $("tollYen").value = "";
  toast("料金を登録しました");
  renderAll();
});

// --- 設定タブ ---
$("btnAddVehicle").addEventListener("click", () => {
  const v = {
    id: db.newId("v"),
    name: $("vName").value.trim(),
    type: $("vType").value,
    kmPerL: validateNumber($("vKmPerL").value, { min: 0.1, max: 100 }),
  };
  const errors = validateVehicle(v);
  if (errors.length) return toast(errors[0], true);
  const list = [...db.getVehicles(), v];
  db.setVehicles(list);
  if (list.length === 1) db.setSettings({ activeVehicleId: v.id });
  $("vName").value = $("vKmPerL").value = "";
  toast("車両を追加しました");
  renderAll();
});

$("defYenPerL").addEventListener("input", () => {
  const v = validateNumber($("defYenPerL").value, { min: 0 });
  if (v !== null) {
    db.setSettings({ yenPerL: v });
    $("yenPerL").value = v;
    recalc();
  }
});

$("routerSel").addEventListener("change", () => {
  db.setSettings({ router: $("routerSel").value });
  $("orsRow").hidden = $("routerSel").value !== "ors";
});
$("orsKey").addEventListener("input", () => db.setSettings({ orsKey: $("orsKey").value.trim() }));

$("btnExport").addEventListener("click", () => {
  $("ioBox").value = db.exportAll();
  $("ioBox").select();
  toast("書き出しました。全選択してコピーしてください");
});
$("btnImport").addEventListener("click", () => {
  if (!db.importAll($("ioBox").value)) return toast("読み込めませんでした（内容を確認してください）", true);
  toast("読み込みました");
  boot();
});

// ---------------- 起動 ----------------
function renderAll() {
  renderSelects();
  renderLists();
  syncFuelField();
  recalc();
}

function boot() {
  const s = db.getSettings();
  $("yenPerL").value = s.yenPerL;
  $("defYenPerL").value = s.yenPerL;
  $("routerSel").value = s.router;
  $("orsKey").value = s.orsKey;
  $("orsRow").hidden = s.router !== "ors";

  // 前回の続きを復元する（出発地・目的地・IC・距離・往復）
  const trip = db.getTrip();
  state.start = trip.start;
  state.dest = trip.dest;
  state.manualKm = trip.manualKm;
  state.distanceM = trip.distanceM;
  state.highwayM = trip.highwayM;
  $("startLabel").textContent = trip.start ? trip.start.name : "未設定";
  $("destLabel").textContent = trip.dest ? trip.dest.name : "未設定";
  $("roundTrip").checked = !!trip.roundTrip;
  if (trip.manualKm !== null) {
    $("distEditRow").hidden = false;
    $("distManual").value = trip.manualKm;
  }

  renderAll(); // renderSelects が trip.inIcId / outIcId を復元する

  // 保存済みの数値をすぐ出したうえで、通信できるなら裏で最新に更新する
  autoDistance();
  updateHighwayDistance();
}

boot();

if ("serviceWorker" in navigator) {
  // updateViaCache:"none" で sw.js 自体がHTTPキャッシュから読まれるのを防ぐ
  // （これが無いと更新した sw.js が端末に届かない）。
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).catch(() => {});
}
