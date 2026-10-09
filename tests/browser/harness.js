/*
  浏览器端到端测试工具（无第三方依赖）：
  - 静态服务器：站点根目录 + 可选 /v1/ 挂载（main 分支的旧版本，同源共享 localStorage）
  - 无头 Chrome + Chrome DevTools Protocol（Node 22 内置 WebSocket）
  需要本机安装 Chrome / Chromium；可用 CHROME_PATH 指定路径。
*/

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn, execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "..");
const SITE_FILES = ["index.html", "manifest.json", "icon.svg", "sw.js", "css", "js"];
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChrome() {
  const candidates = [process.env.CHROME_PATH, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].filter(Boolean);
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "pipe" });
      return candidate;
    } catch (error) {}
  }
  throw new Error("未找到 Chrome / Chromium。请安装后重试，或设置 CHROME_PATH。");
}

/* 复制当前站点到临时目录，供需要「发布新版本」的场景修改 */
function copySite(dest = fs.mkdtempSync(path.join(os.tmpdir(), "ssr-site-"))) {
  fs.mkdirSync(dest, { recursive: true });
  SITE_FILES.forEach((name) => fs.cpSync(path.join(ROOT, name), path.join(dest, name), { recursive: true }));
  return dest;
}

/* 导出 main 分支（v1）到临时目录 */
function exportLegacySite(ref = "main") {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "ssr-v1-"));
  const tar = execFileSync("git", ["-C", ROOT, "archive", ref], { maxBuffer: 64 * 1024 * 1024 });
  execFileSync("tar", ["-x", "-C", dest], { input: tar });
  return dest;
}

/* 模拟常见静态托管：带 max-age，用来暴露 Service Worker 安装时误用 HTTP 缓存的问题 */
function startServer({ root = ROOT, mounts = {} } = {}) {
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (urlPath === "/__blank__") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end('<!doctype html><title>blank</title><link rel="icon" href="data:,">');
      return;
    }
    let base = root;
    for (const prefix of Object.keys(mounts)) {
      if (urlPath.startsWith(prefix)) {
        base = mounts[prefix];
        urlPath = "/" + urlPath.slice(prefix.length);
        break;
      }
    }
    if (urlPath.endsWith("/")) urlPath += "index.html";
    const file = path.join(base, urlPath);
    if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "max-age=600"
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const origin = "http://127.0.0.1:" + server.address().port;
      resolve({
        origin,
        close: () =>
          new Promise((r) => {
            server.closeAllConnections();
            server.close(r);
          })
      });
    });
  });
}

async function launchBrowser() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ssr-chrome-"));
  const chrome = spawn(findChrome(), [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank"
  ], { stdio: "ignore" });

  const portFile = path.join(profile, "DevToolsActivePort");
  let port = null;
  for (let i = 0; i < 100 && !port; i++) {
    if (fs.existsSync(portFile)) port = Number(fs.readFileSync(portFile, "utf8").split("\n")[0]) || null;
    if (!port) await sleep(100);
  }
  if (!port) throw new Error("Chrome 启动超时");

  const http = "http://127.0.0.1:" + port;
  const pages = [];

  async function attach(target) {
    const page = await connect(target);
    page.closeTab = async () => {
      page.close();
      await fetch(http + "/json/close/" + target.id).catch(() => {});
      await sleep(200);
    };
    pages.push(page);
    return page;
  }

  return {
    async newPage() {
      const target = await (await fetch(http + "/json/new?about:blank", { method: "PUT" })).json();
      return attach(target);
    },
    async close() {
      pages.forEach((page) => page.close());
      chrome.kill();
      await sleep(200);
      fs.rmSync(profile, { recursive: true, force: true });
    },
    pages
  };
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });

  let id = 0;
  const pending = new Map();
  const errors = [];
  const listeners = [];

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
      return;
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const details = msg.params.exceptionDetails;
      errors.push("exception: " + ((details.exception && details.exception.description) || details.text));
    }
    if (msg.method === "Runtime.consoleAPICalled" && (msg.params.type === "error" || msg.params.type === "warning")) {
      errors.push(msg.params.type + ": " + msg.params.args.map((a) => a.value || a.description).join(" "));
    }
    if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
      errors.push("log: " + msg.params.entry.text + " " + (msg.params.entry.url || ""));
    }
    listeners.forEach((fn) => fn(msg));
  });

  let closed = false;
  ws.addEventListener("close", () => {
    closed = true;
    pending.forEach((resolve) => resolve({ error: { message: "连接已关闭" } }));
    pending.clear();
  });

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      if (closed) {
        resolve({ error: { message: "连接已关闭" } });
        return;
      }
      const i = ++id;
      pending.set(i, resolve);
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Log.enable");

  const page = {
    errors,
    send,
    async evaluate(expression) {
      const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (res.error) throw new Error(res.error.message);
      if (res.result.exceptionDetails) {
        const d = res.result.exceptionDetails;
        throw new Error("页面内求值失败：" + ((d.exception && d.exception.description) || d.text) + "\n" + expression);
      }
      return res.result.result.value;
    },
    /* 整页导航；等待 load 事件 */
    async goto(url, settleMs = 300) {
      const loaded = new Promise((resolve) => {
        const fn = (msg) => {
          if (msg.method === "Page.loadEventFired") {
            listeners.splice(listeners.indexOf(fn), 1);
            resolve();
          }
        };
        listeners.push(fn);
      });
      await send("Page.navigate", { url });
      await Promise.race([loaded, sleep(10000)]);
      await sleep(settleMs);
    },
    async reload(settleMs = 300) {
      const loaded = new Promise((resolve) => {
        const fn = (msg) => {
          if (msg.method === "Page.loadEventFired") {
            listeners.splice(listeners.indexOf(fn), 1);
            resolve();
          }
        };
        listeners.push(fn);
      });
      await send("Page.reload", {});
      await Promise.race([loaded, sleep(10000)]);
      await sleep(settleMs);
    },
    /* 无头 Chrome 中后台标签页不会派发 <dialog> 的 close 事件：与对话框交互前先切到前台，与真实用户一致 */
    async bringToFront() {
      await send("Page.bringToFront");
      await sleep(100);
    },
    async addInitScript(source) {
      await send("Page.addScriptToEvaluateOnNewDocument", { source });
    },
    async viewport(width, height, mobile = false) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
    },
    async screenshot(file) {
      const res = await send("Page.captureScreenshot", { format: "png" });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(res.result.data, "base64"));
    },
    async waitFor(expression, timeout = 10000, interval = 100) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if ((await page.evaluate(expression)) === true) return true;
        await sleep(interval);
      }
      throw new Error("等待超时：" + expression);
    },
    close() {
      try {
        ws.close();
      } catch (error) {}
    }
  };
  return page;
}

/* 页面内常用操作 */
const dom = {
  click: (selector) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("找不到 " + ${JSON.stringify(selector)}); el.click(); return true; })()`,
  setValue: (selector, value) =>
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`,
  submit: (selector) => `(document.querySelector(${JSON.stringify(selector)}).requestSubmit(), true)`,
  toasts: () => `[...document.querySelectorAll("#toastRegion .toast")].map((t) => t.textContent.trim())`,
  stored: (key = "starryStudyRoom_v2") => `JSON.parse(localStorage.getItem(${JSON.stringify(key)}))`
};

/*
  先停在同源的空白页（不运行应用）清空并写入存储，再打开目标地址，
  保证应用启动时读到的就是 seeds。init 为每次载入前注入的脚本。
*/
async function openFresh(page, url, seeds = {}, options = {}) {
  const origin = new URL(url).origin;
  await page.goto(origin + "/__blank__", 50);
  await page.evaluate(`localStorage.clear(); sessionStorage.clear(); true`);
  for (const [key, value] of Object.entries(seeds)) {
    await page.evaluate(`localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)}); true`);
  }
  if (options.init) await page.addInitScript(options.init);
  page.errors.length = 0;
  await page.goto(url, options.settleMs);
}

/* 构造一个最小的 v1 数据 */
function legacyData(overrides = {}) {
  return {
    tasks: [{ name: "v1 任务", done: false }],
    stars: 6,
    totalMinutes: 150,
    focusSessions: 6,
    seals: 2,
    practiceStats: { calm: 2, discipline: 1, insight: 0, vision: 0, speech: 0 },
    review: { done: "v1 复盘", distraction: "", restless: "", calm: "", tomorrow: "", comment: "", updatedAt: "2026-10-01T12:00:00Z" },
    dailyData: {},
    ...overrides
  };
}

module.exports = { ROOT, sleep, startServer, launchBrowser, copySite, exportLegacySite, openFresh, dom, legacyData };
