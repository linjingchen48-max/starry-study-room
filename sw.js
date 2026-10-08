/*
  预缓存全部静态资源，缓存优先、离线可用。
  发版时更新 CACHE_NAME；新版本安装后会等待，由页面提示用户刷新再接管。
*/

const CACHE_NAME = "starry-study-room-v2.0.0";

const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.svg",
  "./css/tokens.css",
  "./css/base.css",
  "./css/components.css",
  "./css/pages.css",
  "./js/store.js",
  "./js/domain.js",
  "./js/ui.js",
  "./js/today.js",
  "./js/focus.js",
  "./js/practice.js",
  "./js/radar.js",
  "./js/mistakes.js",
  "./js/archive.js",
  "./js/settings.js",
  "./js/app.js"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys.map(function (key) {
            if (key !== CACHE_NAME) return caches.delete(key);
          })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).catch(function () {
        if (event.request.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      });
    })
  );
});
