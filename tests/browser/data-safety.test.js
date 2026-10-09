/*
  真实浏览器中的数据安全：损坏数据且另存失败、未来版本只读、导入失败回滚。
*/
const test = require("node:test");
const { before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, launchBrowser, dom, sleep, openFresh } = require("./harness.js");

const KEY = "starryStudyRoom_v2";
let server;
let browser;

before(async () => {
  server = await startServer();
  browser = await launchBrowser();
});

after(async () => {
  await browser.close();
  await server.close();
});

/* 让带有指定片段的键写入时抛出 QuotaExceededError */
const failWritesTo = (fragment) => `
  (() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (String(key).includes(${JSON.stringify(fragment)})) throw new DOMException("quota", "QuotaExceededError");
      return original.call(this, key, value);
    };
  })();
`;

test("损坏数据且另存失败：顶部提示、停止保存，原文不被覆盖，可下载", async () => {
  const page = await browser.newPage();
  await openFresh(page, server.origin + "/index.html", { [KEY]: "{broken" }, { init: failWritesTo("_corrupt_") });

  assert.equal(await page.evaluate(`storageStatus.issue`), "corrupt-unsaved");
  assert.equal(await page.evaluate(`document.getElementById("storageAlert").hidden`), false);
  assert.match(await page.evaluate(`document.getElementById("storageAlertTitle").textContent`), /未能另存/);

  await page.evaluate(dom.setValue("#taskInput", "不应保存"));
  await page.evaluate(dom.submit("#taskForm"));
  await sleep(200);

  assert.equal(await page.evaluate(`localStorage.getItem("${KEY}")`), "{broken");
  assert.equal(await page.evaluate(`document.getElementById("taskList").textContent.includes("不应保存")`), false);
  assert.equal(await page.evaluate(`document.getElementById("taskInput").value`), "不应保存");
  const toasts = await page.evaluate(dom.toasts());
  assert.ok(toasts.some((t) => t.includes("只读保护中")), JSON.stringify(toasts));

  const download = await page.evaluate(`(() => {
    let name = "";
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() { name = this.download; };
    document.querySelector('[data-storage-action="download-raw"]').click();
    HTMLAnchorElement.prototype.click = click;
    return name;
  })()`);
  assert.match(download, /^starry-study-room-raw-\d+\.txt$/);
  assert.deepEqual(page.errors.filter((e) => !e.includes("保存失败")), []);
  await page.closeTab();
});

test("未来版本数据：只读打开，操作给出明确反馈且不显示成功，导出原文", async () => {
  const future = JSON.stringify({ schemaVersion: 3, stars: 4, seals: 1, currentPracticeDone: false, newField: { keep: true } });
  const page = await browser.newPage();
  await openFresh(page, server.origin + "/index.html#practice", { [KEY]: future });

  assert.equal(await page.evaluate(`storageStatus.writeLocked`), true);
  assert.equal(await page.evaluate(`document.getElementById("storageAlert").hidden`), false);

  await page.evaluate(dom.click("#practiceComplete"));
  await sleep(200);
  let toasts = await page.evaluate(dom.toasts());
  assert.equal(toasts.some((t) => t.includes("获得一枚御印")), false, JSON.stringify(toasts));
  assert.ok(toasts.some((t) => t.includes("只读保护中")));
  assert.equal(await page.evaluate(`document.getElementById("practiceSeals").textContent`), "1");

  // 浏览、切换页面不受影响
  await page.evaluate(`location.hash = "archive"; true`);
  await sleep(200);
  assert.equal(await page.evaluate(`document.querySelector('.page[data-route="archive"]').hidden`), false);

  // 主题切换只在本页生效
  await page.evaluate(dom.click("#themeToggle"));
  await sleep(100);
  toasts = await page.evaluate(dom.toasts());
  assert.ok(toasts.some((t) => t.includes("外观调整仅在本页生效")), JSON.stringify(toasts));

  const exported = await page.evaluate(`(async () => {
    let blob = null;
    const create = URL.createObjectURL;
    URL.createObjectURL = function(b) { blob = b; return create.call(URL, b); };
    exportAppData();
    URL.createObjectURL = create;
    return await blob.text();
  })()`);
  assert.equal(exported, future);
  assert.equal(await page.evaluate(`localStorage.getItem("${KEY}")`), future);
  assert.deepEqual(page.errors, []);
  await page.closeTab();
});

async function importFile(page, text, name = "backup.json") {
  await page.evaluate(`(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)}, { type: "application/json" }));
    const input = document.getElementById("importDataInput");
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
    return true;
  })()`);
  await sleep(300);
}

test("导入：非法文件被拒绝；写入失败时回滚且不提示成功；成功后才提示", async () => {
  const page = await browser.newPage();
  await openFresh(page, server.origin + "/index.html");
  await page.evaluate(dom.setValue("#taskInput", "导入前的任务"));
  await page.evaluate(dom.submit("#taskForm"));
  await sleep(150);
  const before = await page.evaluate(`localStorage.getItem("${KEY}")`);

  await importFile(page, '{"hello":"world"}');
  assert.ok((await page.evaluate(dom.toasts())).some((t) => t.includes("导入失败")));
  assert.equal(await page.evaluate(`localStorage.getItem("${KEY}")`), before);

  const backup = JSON.stringify({ appName: "星辰御书房", schemaVersion: 2, data: { schemaVersion: 2, stars: 42, tasksByDay: {} } });
  await page.evaluate(`(() => {
    const original = Storage.prototype.setItem;
    window.__restoreSetItem = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function(key, value) {
      if (key === "${KEY}") throw new DOMException("quota", "QuotaExceededError");
      return original.call(this, key, value);
    };
    return true;
  })()`);
  await importFile(page, backup);
  await page.waitFor(`document.getElementById("confirmDialog").open`);
  await page.evaluate(dom.click("#confirmOk"));
  await sleep(300);
  let toasts = await page.evaluate(dom.toasts());
  assert.ok(toasts.some((t) => t.includes("无法写入本机存储")), JSON.stringify(toasts));
  assert.equal(toasts.some((t) => t.includes("导入成功")), false);
  assert.equal(await page.evaluate(`appData.stars`), 0);
  assert.equal(await page.evaluate(`getTasksFor()[0].name`), "导入前的任务");
  assert.equal(await page.evaluate(`localStorage.getItem("${KEY}")`), before);

  await page.evaluate(`window.__restoreSetItem(); true`);
  await importFile(page, backup);
  await page.waitFor(`document.getElementById("confirmDialog").open`);
  await page.evaluate(dom.click("#confirmOk"));
  await sleep(300);
  toasts = await page.evaluate(dom.toasts());
  assert.ok(toasts.some((t) => t.includes("导入成功")), JSON.stringify(toasts));
  assert.equal(JSON.parse(await page.evaluate(`localStorage.getItem("${KEY}")`)).stars, 42);
  assert.deepEqual(page.errors.filter((e) => !e.includes("保存失败")), []);
  await page.closeTab();
});
