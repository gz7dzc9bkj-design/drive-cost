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
 * ガソリン代（円）。円未満は切り捨て。
 * @returns {number|null} 入力が不正なら null
 */
export function fuelCost(distanceKm, kmPerL, yenPerL) {
  const d = validateNumber(distanceKm, { min: 0 });
  const e = validateNumber(kmPerL, { min: 0 });
  const p = validateNumber(yenPerL, { min: 0 });
  if (d === null || e === null || p === null) return null;
  if (e <= 0) return null;
  return Math.floor((d / e) * p + EPS);
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
