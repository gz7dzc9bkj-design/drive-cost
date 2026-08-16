// drive-cost 凍結モジュール
// 純粋関数のみ。副作用（通信・保存・DOM）と現在時刻の取得をここに書かない。
// 日付が必要な関数は必ず引数で受け取る（テストの再現性のため）。
// 変更したら node tools/verify.js を実行し ALL PASS を維持すること。

/** 車種。この2値以外に増やさない（保存済みデータが壊れる）。 */
export const VEHICLE_TYPES = ["normal", "kei"];

export const VEHICLE_LABEL = { normal: "普通車", kei: "軽自動車" };

/** NEXCO の車種間料金比率（軽自動車等 = 普通車 × 0.8）。換算値は必ず「概算」扱い。 */
export const KEI_RATIO = 0.8;

/** 高速料金の最小単位（円）。 */
const TOLL_UNIT = 10;

/** ガソリン代の表示単位（円）。1円の位は切り上げて丸める。 */
const FUEL_UNIT = 10;

/** 浮動小数点の誤差で 1 円ずれるのを防ぐための微小値。 */
const EPS = 1e-9;

/**
 * 数値として妥当なら数値を、そうでなければ null を返す。
 * @param {unknown} v
 * @param {{min?: number, max?: number}} [range]
 * @returns {number|null}
 */
export function validateNumber(v, range = {}) {
  const { min = -Infinity, max = Infinity } = range;
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").trim());
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

/**
 * ガソリン代（円）。**10円単位に切り上げる**（1円の位を出さない）。
 * 例: 4,680.9円 → 4,690円
 * @returns {number|null} 入力が不正なら null
 */
export function fuelCost(distanceKm, kmPerL, yenPerL) {
  const d = validateNumber(distanceKm, { min: 0 });
  const e = validateNumber(kmPerL, { min: 0 });
  const p = validateNumber(yenPerL, { min: 0 });
  if (d === null || e === null || p === null) return null;
  if (e <= 0) return null;
  const yen = Math.ceil(((d / e) * p) / FUEL_UNIT - EPS) * FUEL_UNIT;
  return yen === 0 ? 0 : yen; // 距離0のとき -0 になるのを正規化する
}

/**
 * 車種間で高速料金を換算する。10円単位に丸める。
 * 同一車種はそのまま返す。結果は概算であり UI で必ずその旨を示すこと。
 * @returns {number|null}
 */
export function convertToll(yen, fromType, toType) {
  const y = validateNumber(yen, { min: 0 });
  if (y === null) return null;
  if (!VEHICLE_TYPES.includes(fromType) || !VEHICLE_TYPES.includes(toType)) return null;
  if (fromType === toType) return Math.round(y);
  const raw = fromType === "normal" ? y * KEI_RATIO : y / KEI_RATIO;
  return Math.round(raw / TOLL_UNIT) * TOLL_UNIT;
}

/** NEXCO 対距離制の普通車キロ当たり料金（円/km・税抜）。 */
export const RATE_PER_KM = 24.6;

/** ターミナルチャージ（円・税抜）。1回の利用ごとに加算される固定額。 */
export const TERMINAL_CHARGE = 150;

/** 消費税率。 */
const TAX = 1.1;

/**
 * 高速区間の距離から料金を概算する（登録済みの料金が無いときの目安）。
 *
 * 長距離逓減（100km超の値引き）は**適用しない**。ユーザーの指示が
 * 「ETCの通常の一番高い値段」であり、不足するより多めに出るほうを選ぶため。
 * その結果、長距離では実額より1割ほど高く出る。必ず「概算」と明示すること。
 *
 * @param {number} highwayKm 高速道路を走る距離（一般道を含めない）
 * @param {string} type "normal" | "kei"
 * @returns {number|null} 10円単位に切り上げた金額。入力が不正なら null
 */
export function estimateToll(highwayKm, type) {
  const km = validateNumber(highwayKm, { min: 0 });
  if (km === null || !VEHICLE_TYPES.includes(type)) return null;
  const ratio = type === "kei" ? KEI_RATIO : 1;
  const raw = (TERMINAL_CHARGE + km * RATE_PER_KM) * ratio * TAX;
  return Math.ceil(raw / TOLL_UNIT - EPS) * TOLL_UNIT;
}

/**
 * 料金レコードの主キー。入口IC・出口IC・車種の3点セット。
 * @returns {string}
 */
export function tollKey(inIcId, outIcId, type) {
  return `${inIcId}>${outIcId}#${type}`;
}

/**
 * 登録済み料金から該当するものを探す。
 * 完全一致があれば exact:true。他車種のみ登録済みなら換算して exact:false。
 * @returns {{yen:number, exact:boolean, updatedAt:string|null, fromType?:string}|null}
 */
export function findToll(tolls, inIcId, outIcId, type) {
  if (!Array.isArray(tolls) || !inIcId || !outIcId) return null;
  const onRoute = tolls.filter((t) => t && t.inIcId === inIcId && t.outIcId === outIcId);

  const same = onRoute.find((t) => t.type === type);
  if (same) {
    const yen = validateNumber(same.yen, { min: 0 });
    if (yen === null) return null;
    return { yen: Math.round(yen), exact: true, updatedAt: same.updatedAt ?? null };
  }

  const other = onRoute.find((t) => VEHICLE_TYPES.includes(t.type));
  if (other) {
    const yen = convertToll(other.yen, other.type, type);
    if (yen === null) return null;
    return { yen, exact: false, updatedAt: other.updatedAt ?? null, fromType: other.type };
  }
  return null;
}

/**
 * 合計金額。往復なら ガソリン代・高速料金の両方を2倍する。
 * @returns {number}
 */
export function totalCost(fuelYen, tollYen, roundTrip) {
  const f = validateNumber(fuelYen, { min: 0 }) ?? 0;
  const t = validateNumber(tollYen, { min: 0 }) ?? 0;
  return (f + t) * (roundTrip ? 2 : 1);
}

/**
 * メートル → キロメートル（小数1桁）。
 * @returns {number|null}
 */
export function formatDistanceKm(meters) {
  const m = validateNumber(meters, { min: 0 });
  if (m === null) return null;
  return Math.round(m / 100) / 10;
}

/**
 * 2点間の直線距離（km）。地球を半径6371kmの球として計算する。
 * @returns {number|null}
 */
export function haversineKm(aLat, aLon, bLat, bLon) {
  const la1 = validateNumber(aLat, { min: -90, max: 90 });
  const lo1 = validateNumber(aLon, { min: -180, max: 180 });
  const la2 = validateNumber(bLat, { min: -90, max: 90 });
  const lo2 = validateNumber(bLon, { min: -180, max: 180 });
  if (la1 === null || lo1 === null || la2 === null || lo2 === null) return null;
  const R = 6371;
  const rad = Math.PI / 180;
  const dLa = (la2 - la1) * rad;
  const dLo = (lo2 - lo1) * rad;
  const h =
    Math.sin(dLa / 2) ** 2 + Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 経路（[lon,lat] の配列）から、ある地点までの最短距離（km）。
 * 選んだICが本当にその経路上にあるかを確かめるのに使う。
 * @param {{lat:number, lon:number}} point
 * @param {Array<[number, number]>} lineCoords OSRM の GeoJSON 座標（[lon,lat]）
 * @returns {number|null}
 */
export function distanceToRouteKm(point, lineCoords) {
  if (!point || !Array.isArray(lineCoords) || !lineCoords.length) return null;
  let min = Infinity;
  for (const c of lineCoords) {
    if (!Array.isArray(c) || c.length < 2) continue;
    const d = haversineKm(point.lat, point.lon, c[1], c[0]);
    if (d !== null && d < min) min = d;
  }
  return Number.isFinite(min) ? min : null;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * 料金の登録が古い（1年以上前）か。
 * 現在時刻は取得せず、必ず today を引数で受ける。
 * @param {string} updatedAt YYYY-MM-DD
 * @param {string} today     YYYY-MM-DD
 * @returns {boolean}
 */
export function isTollStale(updatedAt, today) {
  if (!DATE_RE.test(String(updatedAt ?? "")) || !DATE_RE.test(String(today ?? ""))) return false;
  const [, y, m, d] = today.match(DATE_RE);
  const threshold = `${String(Number(y) - 1).padStart(4, "0")}-${m}-${d}`;
  return updatedAt < threshold;
}

/**
 * 金額表示用のカンマ区切り。
 * @returns {string}
 */
export function formatYen(yen) {
  const n = validateNumber(yen);
  if (n === null) return "-";
  return Math.round(n).toLocaleString("ja-JP");
}

/**
 * 車両プリセットの検証。問題があればエラーメッセージの配列を返す。
 * @returns {string[]}
 */
export function validateVehicle(v) {
  const errors = [];
  if (!v || !String(v.name ?? "").trim()) errors.push("名前を入力してください");
  if (!VEHICLE_TYPES.includes(v?.type)) errors.push("車種を選んでください");
  if (validateNumber(v?.kmPerL, { min: 0.1, max: 100 }) === null)
    errors.push("燃費は 0.1〜100 km/L の範囲で入力してください");
  return errors;
}
