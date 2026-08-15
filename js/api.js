// 外部通信はこのファイルだけが行う（CLAUDE.md の凍結事項）。
// 送るのは検索語と座標のみ。個人データは送らない。
// いずれの関数も 10 秒でタイムアウトし、失敗しても例外で画面が固まらないよう Error を投げる。

const TIMEOUT_MS = 10000;

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const GSI_SEARCH = "https://msearch.gsi.go.jp/address-search/AddressSearch";
const GSI_REVERSE = "https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress";
const OSRM = "https://router.project-osrm.org/route/v1/driving/";
const ORS = "https://api.openrouteservice.org/v2/directions/driving-car";

export const DRIVEPLAZA_URL = "https://www.driveplaza.com/dp/SearchTop";

async function getJson(url, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    if (!res.ok) throw new Error(`通信エラー (HTTP ${res.status})`);
    return await res.json();
  } catch (e) {
    if (e.name === "AbortError") throw new Error("通信がタイムアウトしました（10秒）");
    // 圏外・機内モードは fetch が TypeError で落ちる。英語のまま出さない。
    if (!navigator.onLine || e instanceof TypeError)
      throw new Error("オフラインのため取得できません（距離は［直す］から手入力できます）");
    throw new Error(e.message || "通信に失敗しました");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 地名・住所を検索して候補を返す。キー不要。
 * 主: Nominatim（駅名・施設名に強い）／予備: 国土地理院（詳細な住所に強い）。
 * 国土地理院は住所専用のため「東京駅」を「東」として解釈してしまう（実測）。
 * そのため必ず Nominatim を先に引き、0件のときだけ国土地理院に落とす。
 * @returns {Promise<Array<{name:string, lat:number, lon:number}>>}
 */
export async function searchPlace(q) {
  const query = String(q ?? "").trim();
  if (!query) return [];
  const settled = await Promise.allSettled([searchNominatim(query), searchGsi(query)]);
  const merged = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (!merged.length) {
    const reason = settled.find((r) => r.status === "rejected")?.reason;
    if (reason) throw reason;
    return [];
  }
  return rankAndDedupe(merged, query).slice(0, 10);
}

/**
 * 関連度で並べ替えつつ、ほぼ同じ座標の重複を落とす。
 * どちらの情報源も単独では外すため（Nominatim は「仙台駅」を、
 * 国土地理院は「東京駅」を取り違える）、統合して名前の一致度で並べる。
 */
function rankAndDedupe(items, query) {
  const q = query.trim();
  const qBase = q.replace(/[駅]$/u, "").trim();

  const score = (key) => {
    const k = String(key ?? "");
    if (k === q) return 0;
    if (k.startsWith(q)) return 1;
    if (k.includes(q)) return 2;
    if (qBase && qBase !== q && k.includes(qBase)) return 3;
    if (qBase && q.includes(k) && k.length >= 2) return 4;
    return 9;
  };

  // 先頭何文字が一致しているか。住所は表記ゆれ（「中央1」と「中央一丁目」）があるため、
  // 完全な部分一致ではなく先頭一致で関連の有無を判定する。
  const lcp = (a, b) => {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  };

  const seen = new Set();
  return items
    .map((it) => {
      const key = String(it.key ?? it.name ?? "");
      return { ...it, _s: score(key), _p: lcp(key, q) };
    })
    // 国土地理院は単純な前方一致検索のため、問い合わせ語とまったく重ならない結果が
    // 大量に返る（「東京駅」→「北海道湧別町東」）。それらは表示しない。
    // Nominatim はサービス側が関連度順に返すので、一致しなくても残す。
    .filter((it) => !(it.src === "gsi" && it._s === 9 && it._p < 2))
    .sort(
      (a, b) => a._s - b._s || b._p - a._p || String(a.key ?? "").length - String(b.key ?? "").length
    )
    .filter((it) => {
      const k = `${it.lat.toFixed(4)},${it.lon.toFixed(4)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map(({ name, lat, lon }) => ({ name, lat, lon }));
}

// Nominatim の利用規約に沿って呼び出し間隔を 1 秒以上あける。
let lastNominatimAt = 0;
async function searchNominatim(query) {
  const wait = 1100 - (Date.now() - lastNominatimAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatimAt = Date.now();

  const url =
    `${NOMINATIM}?q=${encodeURIComponent(query)}` +
    `&format=json&countrycodes=jp&limit=10&accept-language=ja`;
  const data = await getJson(url);
  if (!Array.isArray(data)) return [];
  return data
    .map((d) => ({
      ...shortLabel(d.display_name),
      src: "nominatim",
      lat: Number(d.lat),
      lon: Number(d.lon),
    }))
    .filter((p) => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

/**
 * 「東京駅(改札外), 丸の内一丁目, …, 千代田区, 東京都, 100-0005, 日本」を短く整える。
 * name は画面表示用、key は並べ替え用（施設名だけ）。
 * @returns {{name:string, key:string}}
 */
function shortLabel(displayName) {
  const parts = String(displayName ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return { name: "", key: "" };
  const head = parts[0];
  const pref = parts.find((p) => /[都道府県]$/.test(p)) ?? "";
  const city = parts.find((p) => p !== pref && /[市区町村]$/.test(p)) ?? "";
  const ctx = `${pref}${city}`;
  const name = ctx && !head.includes(ctx) ? `${head}（${ctx}）` : head;
  return { name, key: head };
}

async function searchGsi(query) {
  const data = await getJson(`${GSI_SEARCH}?q=${encodeURIComponent(query)}`);
  if (!Array.isArray(data)) return [];
  return data
    .filter((f) => f?.geometry?.coordinates?.length === 2)
    .slice(0, 20)
    .map((f) => ({
      name: f.properties?.title ?? query,
      key: f.properties?.title ?? query,
      src: "gsi",
      lon: Number(f.geometry.coordinates[0]),
      lat: Number(f.geometry.coordinates[1]),
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

/**
 * 座標から住所らしい文字列を得る。失敗しても呼び出し側を止めないよう null を返す。
 * @returns {Promise<string|null>}
 */
export async function reverseLabel(lat, lon) {
  try {
    const d = await getJson(`${GSI_REVERSE}?lat=${lat}&lon=${lon}`);
    const m = d?.results?.muniCd;
    const s = d?.results?.lv01Nm;
    return s ? String(s) : m ? `市区町村コード ${m}` : null;
  } catch {
    return null;
  }
}

/**
 * 経路の走行距離（メートル）。points は [{lat,lon}, ...] で2点以上。
 * 経由IC の座標があれば出発地と目的地の間に挟んで渡す。
 * @returns {Promise<number>}
 */
export async function routeDistance(points, settings = {}) {
  const pts = (points ?? []).filter(
    (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon))
  );
  if (pts.length < 2) throw new Error("出発地と目的地の両方が必要です");

  if (settings.router === "ors" && settings.orsKey) {
    return routeDistanceOrs(pts, settings.orsKey);
  }
  const coords = pts.map((p) => `${p.lon},${p.lat}`).join(";");
  const data = await getJson(`${OSRM}${coords}?overview=false`);
  const m = data?.routes?.[0]?.distance;
  if (!Number.isFinite(m)) throw new Error("経路が見つかりませんでした");
  return m;
}

async function routeDistanceOrs(pts, key) {
  const data = await getJson(ORS, {
    method: "POST",
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify({ coordinates: pts.map((p) => [Number(p.lon), Number(p.lat)]) }),
  });
  const m = data?.routes?.[0]?.summary?.distance ?? data?.features?.[0]?.properties?.summary?.distance;
  if (!Number.isFinite(m)) throw new Error("経路が見つかりませんでした");
  return m;
}

/**
 * 現在地（HTTPS 必須）。
 * @returns {Promise<{lat:number, lon:number}>}
 */
export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("この端末では現在地を取得できません"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => {
        const msg =
          err.code === 1
            ? "位置情報の利用が許可されていません（設定から許可してください）"
            : "現在地を取得できませんでした";
        reject(new Error(msg));
      },
      { enableHighAccuracy: false, timeout: TIMEOUT_MS, maximumAge: 60000 }
    );
  });
}
