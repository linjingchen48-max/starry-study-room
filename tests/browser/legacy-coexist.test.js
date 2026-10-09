/*
  v1（main 分支的旧版本，挂载在同源 /v1/，共享 localStorage）与 v2 同时运行。
  v1 代码不可修改：验证 v2 的数据不会被旧版页面覆盖，旧版写入可以找回。
*/
const test = require("node:test");
const { before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, launchBrowser, exportLegacySite, openFresh, dom, sleep, legacyData } = require("./harness.js");

const KEY = "starryStudyRoom_v2";
const LEGACY = "starryStudyRoom_v1";
let server;
let browser;

before(async () => {
  server = await startServer({ mounts: { "/v1/": exportLegacySite() } });
  browser = await launchBrowser();
});

after(async () => {
  await browser.close();
  await server.close();
});

async function addV2Task(page, name) {
  await page.evaluate(dom.setValue("#taskInput", name));
  await page.evaluate(dom.submit("#taskForm"));
  await sleep(150);
}

async function addV1Task(page, name) {
  await page.evaluate(`document.getElementById("taskInput").value = ${JSON.stringify(name)}; true`);
  await page.evaluate(dom.click("#saveTaskBtn"));
  await sleep(150);
}

test("v1 先打开、v2 迁移并写入按日数据后，v1 再保存：v2 数据完整，并提示旧版写入", async () => {
  const v1Raw = JSON.stringify(legacyData());
  const v1 = await browser.newPage();
  await openFresh(v1, server.origin + "/v1/index.html", { [LEGACY]: v1Raw });

  // v1 启动时会规范化并整份写回自己的键
  const v1Normalized = await v1.evaluate(`localStorage.getItem("${LEGACY}")`);
  const v2 = await browser.newPage();
  await v2.goto(server.origin + "/index.html#today");
  assert.equal(await v2.evaluate(`appData.stars`), 6);
  assert.equal(await v2.evaluate(`localStorage.getItem("${LEGACY}")`), v1Normalized);

  await addV2Task(v2, "v2 新任务");
  await v2.evaluate(`(() => {
    document.querySelector('#reviewSummary [data-review-action="edit"]').click();
    document.getElementById("review-done").value = "v2 奏对";
    document.getElementById("reviewForm").requestSubmit();
    return true;
  })()`);
  await sleep(200);

  // 旧版页面用它内存中的旧数据整份写回自己的键
  await addV1Task(v1, "v1 后来写的");
  await sleep(300);

  assert.equal(await v2.evaluate(`storageStatus.issue`), "legacy-changed");
  assert.equal(await v2.evaluate(`document.getElementById("storageAlert").hidden`), false);
  const stored = JSON.parse(await v2.evaluate(`localStorage.getItem("${KEY}")`));
  const today = await v2.evaluate(`dateKey()`);
  assert.ok(stored.tasksByDay[today].some((t) => t.name === "v2 新任务"));
  assert.equal(stored.reviews[today].done, "v2 奏对");

  await v2.reload();
  assert.ok(await v2.evaluate(`getTasksFor().some((t) => t.name === "v2 新任务")`));
  assert.equal(await v2.evaluate(`storageStatus.issue`), "legacy-changed");

  const downloaded = await v2.evaluate(`(async () => {
    let blob = null;
    const create = URL.createObjectURL;
    URL.createObjectURL = function(b) { blob = b; return create.call(URL, b); };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {};
    document.querySelector('[data-storage-action="download-raw"]').click();
    URL.createObjectURL = create;
    HTMLAnchorElement.prototype.click = click;
    return await blob.text();
  })()`);
  assert.ok(JSON.parse(downloaded).tasks.some((t) => t.name === "v1 后来写的"));

  await v2.evaluate(dom.click('[data-storage-action="acknowledge"]'));
  await v2.reload();
  assert.equal(await v2.evaluate(`storageStatus.issue`), null);
  assert.equal(await v2.evaluate(`document.getElementById("storageAlert").hidden`), true);

  assert.deepEqual(v2.errors, []);
  await v1.closeTab();
  await v2.closeTab();
});

test("v2 先使用、之后才打开 v1：v1 的保存不影响 v2 内存与存储", async () => {
  const v2 = await browser.newPage();
  await openFresh(v2, server.origin + "/index.html#today");
  await addV2Task(v2, "早先任务");

  const v1 = await browser.newPage();
  await v1.goto(server.origin + "/v1/index.html");
  await addV2Task(v2, "之后任务");
  await addV1Task(v1, "旧版任务");
  await sleep(300);

  const names = await v2.evaluate(`getTasksFor().map((t) => t.name)`);
  const stored = await v2.evaluate(`JSON.parse(localStorage.getItem("${KEY}")).tasksByDay[dateKey()].map((t) => t.name)`);
  assert.deepEqual(names, ["早先任务", "之后任务"]);
  assert.deepEqual(stored, ["早先任务", "之后任务"]);

  // 继续在 v2 中操作，仍基于完整数据
  await addV2Task(v2, "第三项");
  assert.equal(await v2.evaluate(`JSON.parse(localStorage.getItem("${KEY}")).tasksByDay[dateKey()].length`), 3);
  assert.equal(await v2.evaluate(`storageStatus.issue`), "legacy-changed");
  assert.deepEqual(v2.errors, []);
  await v1.closeTab();
  await v2.closeTab();
});

test("找回：下载的旧版数据可用「导入备份」恢复；回退到旧版时仍能读到迁移前的数据", async () => {
  const v1Raw = JSON.stringify(legacyData({ tasks: [{ name: "迁移前任务", done: false }] }));
  const v2 = await browser.newPage();
  await openFresh(v2, server.origin + "/index.html#today", { [LEGACY]: v1Raw });
  await addV2Task(v2, "迁移后任务");

  // 回退：旧版页面读取的 v1 键仍是迁移前的原样
  const v1 = await browser.newPage();
  await v1.goto(server.origin + "/v1/index.html");
  assert.ok(await v1.evaluate(`document.getElementById("taskList").textContent.includes("迁移前任务")`));
  assert.deepEqual(v1.errors, []);
  await v1.closeTab();

  // 恢复：把 v1 原文作为备份导入
  await v2.evaluate(`(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([localStorage.getItem("${LEGACY}")], "raw.json", { type: "application/json" }));
    const input = document.getElementById("importDataInput");
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
    return true;
  })()`);
  await v2.waitFor(`document.getElementById("confirmDialog").open`);
  await v2.evaluate(dom.click("#confirmOk"));
  await sleep(300);
  assert.ok(await v2.evaluate(`getTasksFor().some((t) => t.name === "迁移前任务")`));
  assert.ok((await v2.evaluate(dom.toasts())).some((t) => t.includes("导入成功")));
  assert.deepEqual(v2.errors, []);
  await v2.closeTab();
});

test("v1 键中的数据损坏：v2 不改动它、不锁定，可下载原文", async () => {
  const v2 = await browser.newPage();
  await openFresh(v2, server.origin + "/index.html#today", { [LEGACY]: "{not json" });
  assert.equal(await v2.evaluate(`storageStatus.issue`), "legacy-corrupt");
  assert.equal(await v2.evaluate(`document.getElementById("storageAlert").hidden`), false);
  await addV2Task(v2, "照常使用");
  assert.equal(await v2.evaluate(`localStorage.getItem("${LEGACY}")`), "{not json");
  assert.ok(await v2.evaluate(`JSON.parse(localStorage.getItem("${KEY}")).tasksByDay[dateKey()].length === 1`));
  assert.deepEqual(v2.errors, []);
  await v2.closeTab();
});
