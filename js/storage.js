// localStorage の読み書きのみを担当する。計算ロジックは書かない（logic.js を呼ぶこと）。
// 壊れたデータが入っていても例外を投げず、必ず初期値で復帰する。

const K = {
  settings: "dc.settings",
  vehicles: "dc.vehicles",
  places: "dc.places",
  ics: "dc.ics",
  tolls: "dc.tolls",
  trip: "dc.trip",
};

export const DEFAULT_SETTINGS = {
  yenPerL: 175,
  activeVehicleId: null,
  router: "osrm",
  orsKey: "",
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === "") return fallback;
    const v = JSON.parse(raw);
    if (v === null || v === undefined) return fallback;
    if (Array.isArray(fallback) && !Array.isArray(v)) return fallback;
    return v;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function newId(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

/** 端末ローカルの YYYY-MM-DD（UTC 変換を挟まない）。 */
export function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const getSettings = () => ({ ...DEFAULT_SETTINGS, ...read(K.settings, {}) });
export const setSettings = (s) => write(K.settings, { ...getSettings(), ...s });

export const getVehicles = () => read(K.vehicles, []);
export const setVehicles = (v) => write(K.vehicles, v);

export const getPlaces = () => read(K.places, []);
export const setPlaces = (v) => write(K.places, v);

export const getIcs = () => read(K.ics, []);
export const setIcs = (v) => write(K.ics, v);

export const getTolls = () => read(K.tolls, []);
export const setTolls = (v) => write(K.tolls, v);

/**
 * 入力中の内容（出発地・目的地・IC・往復・距離）。
 * これを保存しないと、アプリを開き直すたびに距離とガソリン代が消える。
 */
export const DEFAULT_TRIP = {
  start: null,
  dest: null,
  inIcId: "",
  outIcId: "",
  manualKm: null,
  roundTrip: false,
  distanceM: null,
  highwayM: null,
};

export const getTrip = () => ({ ...DEFAULT_TRIP, ...read(K.trip, {}) });
export const setTrip = (t) => write(K.trip, { ...getTrip(), ...t });

/** 料金を保存（同じ 入口IC・出口IC・車種 があれば上書き）。 */
export function saveToll(inIcId, outIcId, type, yen, updatedAt) {
  const tolls = getTolls().filter(
    (t) => !(t.inIcId === inIcId && t.outIcId === outIcId && t.type === type)
  );
  tolls.push({ inIcId, outIcId, type, yen, updatedAt });
  setTolls(tolls);
  return tolls;
}

/** 機種変更用の書き出し。 */
export function exportAll() {
  return JSON.stringify(
    {
      app: "drive-cost",
      version: 1,
      exportedAt: todayStr(),
      settings: getSettings(),
      vehicles: getVehicles(),
      places: getPlaces(),
      ics: getIcs(),
      tolls: getTolls(),
    },
    null,
    2
  );
}

/** 読み込み。壊れていれば false を返し、既存データには一切触れない。 */
export function importAll(text) {
  let d;
  try {
    d = JSON.parse(text);
  } catch {
    return false;
  }
  if (!d || d.app !== "drive-cost") return false;
  if (d.settings) setSettings(d.settings);
  if (Array.isArray(d.vehicles)) setVehicles(d.vehicles);
  if (Array.isArray(d.places)) setPlaces(d.places);
  if (Array.isArray(d.ics)) setIcs(d.ics);
  if (Array.isArray(d.tolls)) setTolls(d.tolls);
  return true;
}
