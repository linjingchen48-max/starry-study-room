/*
  Service Worker 更新：未提交输入不丢、不强制刷新其他标签页、离线可用、长期未关闭的 v1 PWA。
  每个场景使用独立的站点副本与浏览器配置，通过改写副本来「发布新版本」。
*/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { startServer, launchBrowser, copySite, exportLegacySite, openFresh, dom, sleep } = require("./harness.js");

const swReady = `navigator.serviceWorker.getRegistration().then((r) => Boolean(r && r.active && r.active.state === "activated" && navigator.serviceWorker.controller))`;

/* 发布新版本：改动一个预缓存资源并更新 CACHE_NAME */
function publishNextVersion(site, tag = "next") {
  fs.appendFileSync(path.join(site, "js/app.js"), "\n/* " + tag + " */\n");
  const swFile = path.join(site, "sw.js");
  fs.writeFileSync(swFile, fs.readFileSync(swFile, "utf8").replace(/CACHE_NAME = "([^"]+)"/, 'CACHE_NAME = "$1-' + tag + '"'));
}

const hasToast = (text) => `[...document.querySelectorAll("#toastRegion .toast")].some((t) => t.textContent.includes(${JSON.stringify(text)}))`;
const clickToastAction = (text) =>
  `(() => { const t = [...document.querySelectorAll("#toastRegion .toast")].find((t) => t.textContent.includes(${JSON.stringify(text)})); t.querySelector(".toast-action").click(); return true; })()`;

async function writeDrafts(page, prefix) {
  await page.evaluate(`location.hash = "today"; true`);
  await page.evaluate(dom.click('#reviewSummary [data-review-action="edit"]'));
  await sleep(100);
  await page.evaluate(dom.setValue("#review-done", prefix + "写了一半的奏对"));
  await page.evaluate(dom.setValue("#taskInput", prefix + "写了一半的御案"));
  await page.evaluate(`location.hash = "mistakes"; document.getElementById("mistakeFormDetails").open = true; true`);
  await page.evaluate(dom.setValue("#mistakeTitle", prefix + "错题草稿"));
  await page.evaluate(`location.hash = "today"; true`);
}

async function readDrafts(page) {
  return page.evaluate(`({
    task: document.getElementById("taskInput").value,
    review: document.getElementById("review-done").value,
    reviewOpen: !document.getElementById("reviewForm").hidden,
    mistake: document.getElementById("mistakeTitle").value,
    mistakeOpen: document.getElementById("mistakeFormDetails").open
  })`);
}

test("发布新版本：只刷新点了「刷新」的标签页；其他标签页只提示，未提交的输入全部保留", async () => {
  const site = copySite();
  const server = await startServer({ root: site });
  const browser = await launchBrowser();
  try {
    const a = await browser.newPage();
    await openFresh(a, server.origin + "/index.html#today");
    await a.waitFor(swReady);
    await a.reload();
    await writeDrafts(a, "A ");
    await a.evaluate(`window.__alive = true; true`);

    publishNextVersion(site);
    const c = await browser.newPage();
    await c.goto(server.origin + "/index.html#today");
    await writeDrafts(c, "C ");
    await c.waitFor(hasToast("新版本已就绪"), 15000);
    await c.evaluate(`window.__alive = true; true`);

    await c.bringToFront();
    await c.evaluate(clickToastAction("新版本已就绪"));
    await c.waitFor(`window.__alive !== true && document.documentElement.classList.contains("is-ready")`, 10000);
    await sleep(300);

    // 点了刷新的标签页：已重新载入，草稿恢复，并有提示
    assert.deepEqual(await readDrafts(c), { task: "C 写了一半的御案", review: "C 写了一半的奏对", reviewOpen: true, mistake: "C 错题草稿", mistakeOpen: true });
    assert.ok(await c.evaluate(hasToast("已恢复上次未提交的输入")));
    assert.ok(await c.evaluate(`fetch("js/app.js").then((r) => r.text()).then((t) => t.includes("/* next */"))`));

    // 其他标签页：没有被强制刷新，输入原样保留，收到提示
    await a.bringToFront();
    await a.waitFor(hasToast("新版本已在其他标签页启用"), 5000);
    assert.equal(await a.evaluate(`window.__alive`), true);
    assert.deepEqual(await readDrafts(a), { task: "A 写了一半的御案", review: "A 写了一半的奏对", reviewOpen: true, mistake: "A 错题草稿", mistakeOpen: true });

    // 用户自己点刷新：重新载入后草稿仍在
    await a.evaluate(clickToastAction("新版本已在其他标签页启用"));
    await a.waitFor(`window.__alive !== true && document.documentElement.classList.contains("is-ready")`, 10000);
    await sleep(300);
    assert.deepEqual(await readDrafts(a), { task: "A 写了一半的御案", review: "A 写了一半的奏对", reviewOpen: true, mistake: "A 错题草稿", mistakeOpen: true });

    // 提交后草稿清空，刷新不会把已提交的内容再填回来
    await a.evaluate(dom.submit("#taskForm"));
    await sleep(200);
    await a.reload();
    assert.equal(await a.evaluate(`document.getElementById("taskInput").value`), "");
    assert.equal(await a.evaluate(`getTasksFor().filter((t) => t.name === "A 写了一半的御案").length`), 1);

    assert.deepEqual(a.errors.concat(c.errors), []);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("离线：服务器不可用时仍可从缓存打开并正常保存", async () => {
  const site = copySite();
  const server = await startServer({ root: site });
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await openFresh(page, server.origin + "/index.html#today");
    await page.waitFor(swReady);
    const origin = server.origin;
    await server.close();

    await page.goto(origin + "/index.html#today");
    assert.equal(await page.evaluate(`document.documentElement.classList.contains("is-ready")`), true);
    await page.evaluate(dom.setValue("#taskInput", "离线任务"));
    await page.evaluate(dom.submit("#taskForm"));
    await sleep(150);
    assert.ok(await page.evaluate(`JSON.parse(localStorage.getItem("starryStudyRoom_v2")).tasksByDay[dateKey()].length === 1`));
    assert.deepEqual(page.errors.filter((e) => !e.includes("Failed to load resource") && !e.includes("Service Worker")), []);
  } finally {
    await browser.close();
  }
});

/*
  旧版 PWA 长期不关：v1 的 Service Worker 缓存优先且不提示更新，v1 代码不可改。
  期望：新版 SW 安装后等待；v1 页面继续可用且只写自己的键；关闭全部旧页面后再打开即为新版本，数据完整迁移。
*/
test("长期未关闭的 v1 PWA：新版发布后旧页面继续可用、不破坏数据；关闭旧页面后升级到新版", async (t) => {
  const site = exportLegacySite();
  const server = await startServer({ root: site });
  const browser = await launchBrowser();
  try {
    const v1 = await browser.newPage();
    await openFresh(v1, server.origin + "/index.html");
    await v1.waitFor(swReady);
    await v1.evaluate(`document.getElementById("taskInput").value = "v1 时期的任务"; document.getElementById("saveTaskBtn").click(); true`);
    await sleep(150);

    copySite(site);
    // 浏览器会在导航时检查更新；这里显式触发一次
    await v1.evaluate(`navigator.serviceWorker.getRegistration().then((r) => r.update()).then(() => true)`);
    await v1.waitFor(`navigator.serviceWorker.getRegistration().then((r) => Boolean(r.waiting))`, 15000);

    // 旧页面没有被刷新，仍能正常操作
    await v1.evaluate(`document.getElementById("taskInput").value = "升级发布后在旧页面写的"; document.getElementById("saveTaskBtn").click(); true`);
    await sleep(150);
    assert.ok(await v1.evaluate(`JSON.parse(localStorage.getItem("starryStudyRoom_v1")).tasks.length === 2`));
    assert.deepEqual(v1.errors, []);

    // 关闭全部旧页面后，新版 SW 接管，再打开即为 v2
    await v1.closeTab();
    const v2 = await browser.newPage();
    await v2.goto(server.origin + "/index.html#today");
    let upgraded = await v2.evaluate(`typeof persistChange === "function"`);
    t.diagnostic(upgraded ? "关闭旧页面后首次打开即为新版本" : "首次打开仍为旧版本，再刷新一次后升级");
    if (!upgraded) {
      await sleep(1000);
      await v2.reload();
      upgraded = await v2.evaluate(`typeof persistChange === "function"`);
    }
    assert.equal(upgraded, true, "关闭旧页面后应升级到新版本");
    const names = await v2.evaluate(`getTasksFor().map((t) => t.name)`);
    assert.deepEqual(names, ["v1 时期的任务", "升级发布后在旧页面写的"]);
    assert.ok(await v2.evaluate(`caches.keys().then((keys) => keys.every((k) => k.startsWith("starry-study-room-v2")))`));
    assert.deepEqual(v2.errors, []);
  } finally {
    await browser.close();
    await server.close();
  }
});
