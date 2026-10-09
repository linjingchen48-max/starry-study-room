/*
  预缓存全部静态资源，缓存优先、离线可用。
  CACHE_NAME 由 npm run stamp 生成（版本号 + 预缓存资源哈希），npm run check 会校验；
  新版本安装后会等待，由页面提示用户刷新再接管。

  防止新旧脚本混用：
  - 安装时以 cache: "reload" 绕过浏览器 HTTP 缓存，整组资源一次性写入新缓存（addAll 要么全成功要么安装失败）
  - 只从本版本的缓存取资源，不会命中旧版本缓存
  - 激活后删除其他版本缓存（含 v1 的 starry-study-room-v11）
*/

const CACHE_NAME = "starry-study-room-v2.0.1-2ac2fcd0";

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
      return cache.addAll(
        FILES_TO_CACHE.map(function (url) {
          return new Request(url, { cache: "reload" });
        })
      );
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
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(event.request, { ignoreSearch: true }).then(function (cached) {
        if (cached) return cached;
        return fetch(event.request).catch(function () {
          if (event.request.mode === "navigate") return cache.match("./index.html");
          return Response.error();
        });
      });
    })
  );
});
