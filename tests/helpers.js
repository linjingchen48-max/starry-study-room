const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");

function createMemoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data: data,
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    removeItem(key) {
      delete data[key];
    }
  };
}

/* 以浏览器 classic script 的方式加载纯逻辑文件（不含 DOM 依赖） */
function loadApp(options = {}) {
  const storage = options.storage || createMemoryStorage();
  const context = vm.createContext({
    console: { error() {}, warn() {}, log: console.log },
    localStorage: storage,
    queueMicrotask: queueMicrotask,
    Date: Date,
    Math: Math
  });

  ["js/store.js", "js/domain.js", "js/radar.js"].forEach(function(file) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
  });

  return {
    context: context,
    storage: storage,
    run(code) {
      return vm.runInContext(code, context);
    }
  };
}

module.exports = { loadApp, createMemoryStorage };
