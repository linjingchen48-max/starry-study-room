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

/* setItem 对满足 shouldFail(key) 的键抛出 QuotaExceededError，模拟存储空间不足 */
function failingStorage(storage, shouldFail) {
  const setItem = storage.setItem;
  storage.failWrites = true;
  storage.setItem = function(key, value) {
    if (storage.failWrites && shouldFail(key)) {
      const error = new Error("The quota has been exceeded.");
      error.name = "QuotaExceededError";
      throw error;
    }
    setItem.call(storage, key, value);
  };
  return storage;
}

function runFiles(context, files) {
  files.forEach(function(file) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
  });
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

  runFiles(context, ["js/store.js", "js/domain.js", "js/radar.js"]);

  return {
    context: context,
    storage: storage,
    run(code) {
      return vm.runInContext(code, context);
    }
  };
}

/* ---------- 带 DOM 桩的页面脚本 ---------- */

function fakeElement() {
  return {
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    style: {},
    dataset: {},
    lastChild: { textContent: "" },
    textContent: "",
    innerHTML: "",
    value: "",
    disabled: false,
    hidden: false,
    open: false,
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    appendChild() {},
    remove() {},
    focus() {},
    click() {},
    showModal() {},
    close() {}
  };
}

/* 跨上下文共享的互斥锁，模拟 navigator.locks（同一浏览器的多个标签页） */
function createSharedLocks() {
  const tails = {};
  return {
    request(name, callback) {
      const previous = tails[name] || Promise.resolve();
      const result = previous.then(function() {
        return callback();
      });
      tails[name] = result.catch(function() {});
      return result;
    }
  };
}

/*
  加载 store + domain + 指定页面脚本（focus.js / settings.js），UI 层函数以桩代替。
  返回的 toasts 记录所有提示；confirmResult 控制确认框结果。
*/
function loadPage(files, options = {}) {
  const storage = options.storage || createMemoryStorage();
  const toasts = [];
  const elements = {};
  const state = { confirmResult: true, confirmCalls: 0 };

  const context = vm.createContext({
    console: { error() {}, warn() {}, log: console.log },
    localStorage: storage,
    queueMicrotask: queueMicrotask,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: function() { return 1; },
    clearInterval: function() {},
    Date: Date,
    Math: Math,
    navigator: options.locks ? { locks: options.locks } : {},
    document: {
      title: "",
      visibilityState: "visible",
      body: fakeElement(),
      getElementById(id) {
        if (!elements[id]) elements[id] = fakeElement();
        return elements[id];
      },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      createElement() { return fakeElement(); },
      addEventListener() {}
    },
    Blob: function(parts) { this.parts = parts; },
    URL: { createObjectURL() { return "blob:x"; }, revokeObjectURL() {} },
    FileReader: function() {
      const reader = this;
      reader.readAsText = function(file) {
        setTimeout(function() {
          reader.result = file.text;
          reader.onload();
        }, 0);
      };
    }
  });

  const stubs = `
    function icon() { return ""; }
    function showToast(message, options) { __toasts.push({ message: message, options: options || {} }); }
    function confirmAction() { __state.confirmCalls += 1; return Promise.resolve(__state.confirmResult); }
    function applyTheme() {}
    function resetFocusNightSuppression() {}
    function baseDocumentTitle() { return ""; }
    function playSealStamp() {}
  `;
  context.__toasts = toasts;
  context.__state = state;

  runFiles(context, ["js/store.js", "js/domain.js"]);
  vm.runInContext(stubs, context);
  runFiles(context, files);

  return {
    context: context,
    storage: storage,
    toasts: toasts,
    state: state,
    elements: elements,
    run(code) {
      return vm.runInContext(code, context);
    }
  };
}

/* 等待页面脚本中的异步链（锁、确认框、FileReader）完成 */
function flush() {
  return new Promise(function(resolve) {
    setTimeout(resolve, 10);
  });
}

module.exports = { loadApp, loadPage, createMemoryStorage, failingStorage, createSharedLocks, flush, ROOT };
