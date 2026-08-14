// オフラインキャッシュ。
// ★ ファイルを追加したら PRECACHE と VERSION を必ず更新する（verify の [B] が検査する）。
// 方針: 自サイトの資材はネットワーク優先＋キャッシュ退避（更新が確実に届く）。
//       外部API（国土地理院・OSRM）はキャッシュせず素通し。

const VERSION = "v1";
const CACHE = `drive-cost-${VERSION}`;

const PRECACHE = [
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/app.js",
  "./js/api.js",
  "./js/logic.js",
  "./js/storage.js",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return; // 外部APIは素通し

  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || caches.match("./index.html"))
      )
  );
});
