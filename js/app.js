// UI 配線のみ。計算は必ず logic.js、保存は storage.js、通信は api.js を呼ぶ。

import {
  VEHICLE_LABEL,
  fuelCost,
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
  fillSelect($("vehicleSel"), vehicleItems(), { placeholder: "車両を選択…", value: s.activeVehicleId });
  fillSelect($("startPlace"), placeItems(), { placeholder: "登録地点から選ぶ…", value: "" });
  fillSelect($("destPlace"), placeItems(), { placeholder: "登録地点から選ぶ…", value: "" });
  fillSelect($("inIc"), icItems(), { placeholder: "選択なし", value: $("inIc").value });
  fillSelect($("outIc"), icItems(), { placeholder: "選択なし", value: $("outIc").value });
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
  const t = inIcId && outIcId ? findToll(db.getTolls(), inIcId, outIcId, type) : null;

  const tollEl = $("tollLabel");
  if (!inIcId || !outIcId) {
    tollEl.innerHTML = '<span class="lb2">ICを選択</span>';
    $("tollEntry").hidden = true;
  } else if (!t) {
    tollEl.innerHTML = '<span class="miss">未登録</span>';
    $("tollEntryMsg").textContent = "この区間の料金が未登録です";
    $("tollEntry").hidden = false;
  } else {
    const stale = isTollStale(t.updatedAt, db.todayStr()) ? '<span class="badge warn">要更新</span>' : "";
    const approx = t.exact ? "" : '<span class="badge">概算</span>';
    tollEl.innerHTML = `${stale}${approx}<span class="money">${formatYen(t.yen)} 円</span>`;
    $("tollEntryMsg").textContent = t.exact
      ? "登録し直す場合はこちら"
      : `${VEHICLE_LABEL[t.fromType]}の登録額から換算した概算です。正確な額を登録できます`;
    $("tollEntry").hidden = t.exact && !isTollStale(t.updatedAt, db.todayStr());
  }

  $("totalLb").textContent = rt ? "合計（往復）" : "合計";
  const total = fuel === null && !t ? null : totalCost(fuel ?? 0, t?.yen ?? 0, rt);
  $("totalLabel").textContent = total === null ? "-" : `${formatYen(total)} 円`;
}

async function autoDistance() {
  if (!state.start || !state.dest) return;
  const ics = db.getIcs();
  const byId = (id) => ics.find((x) => x.id === id);
  const via = [byId($("inIc").value), byId($("outIc").value)].filter(
    (i) => i && Number.isFinite(i.lat) && Number.isFinite(i.lon)
  );
  const points = [state.start, ...via, state.dest];

  $("distLabel").textContent = "計算中…";
  try {
    state.distanceM = await routeDistance(points, db.getSettings());
  } catch (e) {
    state.distanceM = null;
    toast(`距離を計算できませんでした：${e.message}`, true);
  }
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

function setStart(p) {
  state.start = p;
  $("startLabel").textContent = p ? p.name : "未設定";
  state.manualKm = null;
  $("distEditRow").hidden = true;
  autoDistance();
}
function setDest(p) {
  state.dest = p;
  $("destLabel").textContent = p ? p.name : "未設定";
  state.manualKm = null;
  $("distEditRow").hidden = true;
  autoDistance();
}

// ---------------- イベント ----------------
$("vehicleSel").addEventListener("change", () => {
  db.setSettings({ activeVehicleId: $("vehicleSel").value || null });
  syncFuelField();
  recalc();
});

$("btnHere").addEventListener("click", async () => {
  $("startLabel").textContent = "取得中…";
  try {
    const pos = await currentPosition();
    const label = await reverseLabel(pos.lat, pos.lon);
    setStart({ name: label ? `現在地（${label}）` : "現在地", lat: pos.lat, lon: pos.lon });
  } catch (e) {
    $("startLabel").textContent = "未設定";
    toast(e.message, true);
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

for (const id of ["inIc", "outIc"]) {
  $(id).addEventListener("change", () => {
    if (state.manualKm === null) autoDistance();
    recalc();
  });
}
for (const id of ["kmPerL", "roundTrip"]) $(id).addEventListener("input", recalc);
$("roundTrip").addEventListener("change", recalc);
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
  recalc();
});
$("btnAutoDist").addEventListener("click", () => {
  state.manualKm = null;
  $("distEditRow").hidden = true;
  $("distManual").value = "";
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
  renderAll();
}

boot();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
