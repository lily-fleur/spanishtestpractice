// EspañolQuiz Service Worker
const CACHE_NAME = "espanyol-quiz-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
];

// インストール時にアセットをキャッシュ
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// 古いキャッシュを削除
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ネットワーク優先、失敗したらキャッシュ（スプシ読み込みは常にネットワーク）
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Google Sheetsへのリクエストはキャッシュしない
  if (url.hostname.includes("docs.google.com")) {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // 成功したらキャッシュを更新
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, resClone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
