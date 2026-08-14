import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VEHICLE_TYPES,
  fuelCost,
  convertToll,
  tollKey,
  findToll,
  totalCost,
  formatDistanceKm,
  isTollStale,
  formatYen,
  validateNumber,
  validateVehicle,
} from "../js/logic.js";

// ---------- 車種 ----------
test("車種は normal と kei の2値のみ", () => {
  assert.deepEqual(VEHICLE_TYPES, ["normal", "kei"]);
});

// ---------- ガソリン代 ----------
test("fuelCost: 円未満は切り捨て", () => {
  assert.equal(fuelCost(182.4, 15.0, 175), 2128);
});

test("fuelCost: 燃費0はゼロ除算を弾いて null", () => {
  assert.equal(fuelCost(100, 0, 175), null);
});

test("fuelCost: 距離0は0円", () => {
  assert.equal(fuelCost(0, 15, 175), 0);
});

test("fuelCost: 負の距離は null", () => {
  assert.equal(fuelCost(-1, 15, 175), null);
});

test("fuelCost: 数字でない入力は null", () => {
  assert.equal(fuelCost("abc", 15, 175), null);
  assert.equal(fuelCost(100, 15, null), null);
});

test("fuelCost: 文字列の数値も受け付ける", () => {
  assert.equal(fuelCost("361.9", "13.5", "175"), 4691);
});

test("fuelCost: 浮動小数点の誤差で1円ずれない", () => {
  assert.equal(fuelCost(361.9, 22.0, 175), 2878);
});

// ---------- 車種換算 ----------
test("convertToll: 普通車 → 軽（10円単位に丸め）", () => {
  assert.equal(convertToll(8140, "normal", "kei"), 6510);
});

test("convertToll: 軽 → 普通車（10円単位に丸め）", () => {
  assert.equal(convertToll(6510, "kei", "normal"), 8140);
});

test("convertToll: 同一車種は素通し", () => {
  assert.equal(convertToll(1000, "kei", "kei"), 1000);
  assert.equal(convertToll(1000, "normal", "normal"), 1000);
});

test("convertToll: 未知の車種は null", () => {
  assert.equal(convertToll(1000, "large", "kei"), null);
  assert.equal(convertToll(1000, "normal", ""), null);
});

test("convertToll: 0円は0円", () => {
  assert.equal(convertToll(0, "normal", "kei"), 0);
});

// ---------- 料金の検索 ----------
const TOLLS = [
  { inIcId: "i1", outIcId: "i2", type: "normal", yen: 8140, updatedAt: "2026-08-14" },
  { inIcId: "i3", outIcId: "i4", type: "kei", yen: 1500, updatedAt: "2026-01-05" },
];

test("tollKey: 入口IC・出口IC・車種の3点セット", () => {
  assert.equal(tollKey("i1", "i2", "kei"), "i1>i2#kei");
});

test("findToll: 完全一致は exact:true", () => {
  const r = findToll(TOLLS, "i1", "i2", "normal");
  assert.equal(r.yen, 8140);
  assert.equal(r.exact, true);
  assert.equal(r.updatedAt, "2026-08-14");
});

test("findToll: 他車種のみ登録なら換算して exact:false", () => {
  const r = findToll(TOLLS, "i1", "i2", "kei");
  assert.equal(r.yen, 6510);
  assert.equal(r.exact, false);
  assert.equal(r.fromType, "normal");
});

test("findToll: 軽の登録から普通車を換算", () => {
  const r = findToll(TOLLS, "i3", "i4", "normal");
  assert.equal(r.yen, 1880);
  assert.equal(r.exact, false);
});

test("findToll: 該当なしは null", () => {
  assert.equal(findToll(TOLLS, "i9", "i8", "normal"), null);
});

test("findToll: IC未選択は null", () => {
  assert.equal(findToll(TOLLS, "", "i2", "normal"), null);
  assert.equal(findToll(null, "i1", "i2", "normal"), null);
});

test("findToll: 逆方向は別ルート扱い（勝手に一致させない）", () => {
  assert.equal(findToll(TOLLS, "i2", "i1", "normal"), null);
});

// ---------- 合計 ----------
test("totalCost: 片道", () => {
  assert.equal(totalCost(2128, 4830, false), 6958);
});

test("totalCost: 往復は両方2倍", () => {
  assert.equal(totalCost(2128, 4830, true), 13916);
});

test("totalCost: 高速料金が未登録(null)でもガソリン代だけで出す", () => {
  assert.equal(totalCost(2128, null, false), 2128);
});

// ---------- 距離 ----------
test("formatDistanceKm: メートル → km 小数1桁", () => {
  assert.equal(formatDistanceKm(361925.1), 361.9);
});

test("formatDistanceKm: 0m は 0", () => {
  assert.equal(formatDistanceKm(0), 0);
});

test("formatDistanceKm: 不正値は null", () => {
  assert.equal(formatDistanceKm(-5), null);
  assert.equal(formatDistanceKm("x"), null);
});

// ---------- 料金の鮮度 ----------
test("isTollStale: 1年を超えていれば true", () => {
  assert.equal(isTollStale("2025-08-14", "2026-08-15"), true);
});

test("isTollStale: 1年以内なら false", () => {
  assert.equal(isTollStale("2026-08-01", "2026-08-15"), false);
});

test("isTollStale: ちょうど1年前は false（超えていない）", () => {
  assert.equal(isTollStale("2025-08-15", "2026-08-15"), false);
});

test("isTollStale: 日付形式が不正なら false", () => {
  assert.equal(isTollStale("", "2026-08-15"), false);
  assert.equal(isTollStale("2026/08/01", "2026-08-15"), false);
});

// ---------- 表示・検証 ----------
test("formatYen: カンマ区切り", () => {
  assert.equal(formatYen(12831), "12,831");
  assert.equal(formatYen(0), "0");
  assert.equal(formatYen(null), "-");
});

test("validateNumber: 範囲外は null", () => {
  assert.equal(validateNumber(5, { min: 1, max: 10 }), 5);
  assert.equal(validateNumber(0, { min: 1, max: 10 }), null);
  assert.equal(validateNumber(11, { min: 1, max: 10 }), null);
});

test("validateVehicle: 正常な車両はエラーなし", () => {
  assert.deepEqual(validateVehicle({ name: "アルト", type: "kei", kmPerL: 22.0 }), []);
});

test("validateVehicle: 名前・車種・燃費の異常を検出", () => {
  const e = validateVehicle({ name: "", type: "truck", kmPerL: 0 });
  assert.equal(e.length, 3);
});
