const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { ROOT } = require("./helpers.js");
const { expectedCacheName, currentCacheName, getPrecacheFiles } = require("../scripts/sw-version.js");

const SOURCE = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
const CACHE_NAME = currentCacheName();

/* 内存版 CacheStorage：按 URL 存响应，记录 addAll 收到的 Request */
function createCaches(initial = {}) {
  const stores = {};
  const added = [];

  function open(name) {
    if (!stores[name]) {
      const entries = new Map();
      stores[name] = {
        entries: entries,
        addAll(requests) {
          added.push(...requests);
          requests.forEach((request) => entries.set(normalize(request.url), "fresh:" + request.url));
          return Promise.resolve();
        },
        match(request) {
          return Promise.resolve(entries.get(normalize(typeof request === "string" ? request : request.url)));
        }
      };
    }
    return stores[name];
  }

  Object.keys(initial).forEach((name) => {
    const store = open(name);
    Object.keys(initial[name]).forEach((url) => store.entries.set(normalize(url), initial[name][url]));
  });

  return {
    stores: stores,
    added: added,
    open(name) {
      return Promise.resolve(open(name));
    },
    keys() {
      return Promise.resolve(Object.keys(stores));
    },
    delete(name) {
      delete stores[name];
      return Promise.resolve(true);
    },
    match() {
      throw new Error("不应跨所有缓存匹配");
    }
  };
}

function normalize(url) {
  return url.split("?")[0];
}

function loadWorker(caches, fetchImpl) {
  const listeners = {};
  const calls = { skipWaiting: 0, claim: 0 };
  const context = vm.createContext({
    caches: caches,
    fetch: fetchImpl || (() => Promise.reject(new Error("offline"))),
    Request: function(url, init) {
      this.url = url;
      this.cache = init && init.cache;
    },
    Response: { error: () => "network-error" },
    Promise: Promise,
    self: {
      addEventListener(type, fn) {
        listeners[type] = fn;
      },
      skipWaiting() {
        calls.skipWaiting += 1;
        return Promise.resolve();
      },
      clients: {
        claim() {
          calls.claim += 1;
          return Promise.resolve();
        }
      }
    }
  });
  vm.runInContext(SOURCE, context, { filename: "sw.js" });

  async function dispatch(type, data = {}) {
    let pending = null;
    let response = null;
    const event = Object.assign(data, {
      waitUntil(promise) {
        pending = promise;
      },
      respondWith(promise) {
        response = promise;
      }
    });
    listeners[type](event);
    await pending;
    return response ? await response : undefined;
  }

  return { dispatch, calls };
}

test("CACHE_NAME 与当前预缓存资源内容一致（资源有改动时必须 npm run stamp）", () => {
  assert.equal(CACHE_NAME, expectedCacheName());
  assert.match(CACHE_NAME, /^starry-study-room-v\d+\.\d+\.\d+-[0-9a-f]{8}$/);
});

test("安装：绕过 HTTP 缓存整组拉取全部资源，且不自动 skipWaiting", async () => {
  const caches = createCaches();
  const worker = loadWorker(caches);
  await worker.dispatch("install");

  const files = getPrecacheFiles(SOURCE).map((f) => "./" + f).concat("./");
  assert.deepEqual(caches.added.map((r) => r.url).sort(), [...new Set(files)].sort());
  assert.ok(caches.added.every((r) => r.cache === "reload"));
  assert.equal(worker.calls.skipWaiting, 0);
});

test("升级：激活后删除 v1 及其他旧版本缓存，只保留当前缓存", async () => {
  const caches = createCaches({
    "starry-study-room-v11": { "./script.js": "v1" },
    "starry-study-room-v2.0.0": { "./js/store.js": "old" },
    [CACHE_NAME]: { "./js/store.js": "new" }
  });
  const worker = loadWorker(caches);
  await worker.dispatch("activate");

  assert.deepEqual(Object.keys(caches.stores), [CACHE_NAME]);
  assert.equal(worker.calls.claim, 1);
});

test("取资源：只命中当前版本缓存，不会混入旧版本脚本", async () => {
  const caches = createCaches({
    "starry-study-room-v2.0.0": { "./js/store.js": "old-store" },
    [CACHE_NAME]: { "./js/store.js": "new-store", "./index.html": "new-index" }
  });
  const worker = loadWorker(caches);

  assert.equal(await worker.dispatch("fetch", { request: { method: "GET", url: "./js/store.js?v=1" } }), "new-store");
  assert.equal(await worker.dispatch("fetch", { request: { method: "GET", mode: "navigate", url: "./offline-page" } }), "new-index");
  assert.equal(await worker.dispatch("fetch", { request: { method: "GET", url: "./unknown.js" } }), "network-error");
});

test("用户点「刷新」后（SKIP_WAITING）新版本才接管", async () => {
  const worker = loadWorker(createCaches());
  await worker.dispatch("message", { data: { type: "OTHER" } });
  assert.equal(worker.calls.skipWaiting, 0);
  await worker.dispatch("message", { data: { type: "SKIP_WAITING" } });
  assert.equal(worker.calls.skipWaiting, 1);
});

test("首次安装时 controllerchange 不会触发整页刷新", () => {
  const app = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
  const handler = app.slice(app.indexOf('addEventListener("controllerchange"'));
  assert.match(app, /const hadController = Boolean\(navigator\.serviceWorker\.controller\)/);
  assert.match(handler, /if \(!hadController \|\| reloading\) return;/);
});
