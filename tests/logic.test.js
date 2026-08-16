import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VEHICLE_TYPES,
  fuelCost,
  convertToll,
  estimateToll,
  impliedRatePerKm,
  calibrateRatePerKm,
  summarizeRoads,
  routeReliability,
  tollKey,
  findToll,
  totalCost,
  formatDistanceKm,
  haversineKm,
  distanceToRouteKm,
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
test("fuelCost: 10円単位に切り上げ", () => {
  // 182.4 / 15.0 * 175 = 2128.0 -> 2130
  assert.equal(fuelCost(182.4, 15.0, 175), 2130);
});

test("fuelCost: ちょうど10円単位のときは繰り上げない", () => {
  // 100 / 10 * 17 = 170 ちょうど
  assert.equal(fuelCost(100, 10, 17), 170);
});

test("fuelCost: 1円でも超えたら次の10円に上がる", () => {
  // 100 / 10 * 17.1 = 171 -> 180
  assert.equal(fuelCost(100, 10, 17.1), 180);
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
  // 4691.29... -> 4700
  assert.equal(fuelCost("361.9", "13.5", "175"), 4700);
});

test("fuelCost: 浮動小数点の誤差で余計に繰り上がらない", () => {
  // 2878.75 -> 2880
  assert.equal(fuelCost(361.9, 22.0, 175), 2880);
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

// ---------- 距離からの概算 ----------
test("estimateToll: 普通車（150 + 100×24.6）×1.1 = 2871 -> 2880", () => {
  assert.equal(estimateToll(100, "normal"), 2880);
});

test("estimateToll: 軽自動車は普通車の0.8倍", () => {
  // (150 + 100*24.6) * 0.8 * 1.1 = 2296.8 -> 2300
  assert.equal(estimateToll(100, "kei"), 2300);
});

test("estimateToll: 距離0でもターミナルチャージ分は出る", () => {
  // 150 * 1.1 = 165 -> 170
  assert.equal(estimateToll(0, "normal"), 170);
});

test("estimateToll: 長距離逓減は適用しないので実額より高めに出る", () => {
  // 340km: (150 + 340*24.6) * 1.1 = 9365.4 -> 9370（実額 8,140円より高い）
  assert.equal(estimateToll(340, "normal"), 9370);
});

test("estimateToll: 不正な入力は null", () => {
  assert.equal(estimateToll(-1, "normal"), null);
  assert.equal(estimateToll(100, "large"), null);
  assert.equal(estimateToll("x", "normal"), null);
});

// ---------- 単価の学習 ----------
test("impliedRatePerKm: 実額から単価を逆算する", () => {
  // 1610円 / 58.6km 普通車 -> (1610/1.1 - 150)/58.6 = 22.4円/km
  const r = impliedRatePerKm(1610, 58.6, "normal");
  assert.ok(r > 22.3 && r < 22.5, `実際: ${r}`);
});

test("impliedRatePerKm: 軽自動車は普通車に換算してから逆算", () => {
  const kei = impliedRatePerKm(1290, 58.6, "kei");
  const normal = impliedRatePerKm(1610, 58.6, "normal");
  assert.ok(Math.abs(kei - normal) < 0.5, `軽:${kei} 普通:${normal}`);
});

test("impliedRatePerKm: 現実的でない値は採用しない", () => {
  assert.equal(impliedRatePerKm(100000, 1, "normal"), null); // 高すぎる
  assert.equal(impliedRatePerKm(200, 100, "normal"), null); // 安すぎる
  assert.equal(impliedRatePerKm(1610, 0, "normal"), null);
});

test("calibrateRatePerKm: 中央値を返す", () => {
  const r = calibrateRatePerKm([
    { yen: 1610, km: 58.6, type: "normal" },
    { yen: 2000, km: 60, type: "normal" },
    { yen: 1000, km: 40, type: "normal" },
  ]);
  assert.equal(r.samples, 3);
  assert.ok(r.ratePerKm > 20 && r.ratePerKm < 32, `実際: ${r.ratePerKm}`);
});

test("calibrateRatePerKm: 使える実績が無ければ null", () => {
  assert.equal(calibrateRatePerKm([]), null);
  assert.equal(calibrateRatePerKm([{ yen: 1610, type: "normal" }]), null);
  assert.equal(calibrateRatePerKm(null), null);
});

test("estimateToll: 学習した単価を使える", () => {
  // (150 + 100*22.4) * 1.1 = 2629 -> 2630
  assert.equal(estimateToll(100, "normal", 22.4), 2630);
  // 単価が不正なら既定値に戻る
  assert.equal(estimateToll(100, "normal", 0), estimateToll(100, "normal"));
});

// ---------- 経路の信頼度 ----------
test("summarizeRoads: 高速と一般道を分けて集計する", () => {
  const s = summarizeRoads([
    { name: "中央自動車道", meters: 24600 },
    { name: "甲州街道", meters: 8700 },
    { name: "首都高速4号新宿線", meters: 5000 },
    { name: "宝町入口", meters: 300 },
  ]);
  assert.equal(s.totalKm, 38.6);
  assert.equal(s.surfaceKm, 8.7);
  assert.equal(s.urbanKm, 5);
  assert.equal(s.expresswayKm, 29.9);
});

test("routeReliability: 一般道が2割を超えたら低い", () => {
  const r = routeReliability({ totalKm: 58.6, expresswayKm: 36.6, urbanKm: 0, surfaceKm: 22 });
  assert.equal(r.level, "low");
});

test("routeReliability: 都市高速を含むと中くらい", () => {
  const r = routeReliability({ totalKm: 50, expresswayKm: 50, urbanKm: 8, surfaceKm: 0 });
  assert.equal(r.level, "mid");
});

test("routeReliability: ほぼ高速だけなら高い", () => {
  const r = routeReliability({ totalKm: 50, expresswayKm: 50, urbanKm: 0, surfaceKm: 0 });
  assert.equal(r.level, "high");
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

// ---------- 経路との距離 ----------
test("haversineKm: 東京駅と横浜駅は約27km", () => {
  const d = haversineKm(35.6812, 139.7671, 35.4657, 139.6222);
  assert.ok(d > 25 && d < 29, `実際: ${d}`);
});

test("haversineKm: 同じ地点は0km", () => {
  assert.equal(haversineKm(35.68, 139.76, 35.68, 139.76), 0);
});

test("haversineKm: 不正な座標は null", () => {
  assert.equal(haversineKm(999, 139.76, 35.68, 139.76), null);
  assert.equal(haversineKm(null, 139.76, 35.68, 139.76), null);
});

test("distanceToRouteKm: 経路上の点は0に近い", () => {
  const line = [
    [139.7671, 35.6812],
    [139.7, 35.6],
    [139.6222, 35.4657],
  ];
  const d = distanceToRouteKm({ lat: 35.6, lon: 139.7 }, line);
  assert.ok(d < 0.01, `実際: ${d}`);
});

test("distanceToRouteKm: 経路から離れた点は距離が出る", () => {
  const line = [
    [139.7671, 35.6812],
    [139.7, 35.6],
  ];
  const d = distanceToRouteKm({ lat: 35.6812, lon: 139.2513 }, line);
  assert.ok(d > 40, `実際: ${d}`);
});

test("distanceToRouteKm: 経路が無ければ null", () => {
  assert.equal(distanceToRouteKm({ lat: 35, lon: 139 }, []), null);
  assert.equal(distanceToRouteKm(null, [[139, 35]]), null);
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
