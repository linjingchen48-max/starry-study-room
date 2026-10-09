/*
  多标签页专注结算：有 / 无 Web Locks、入座页关闭后代为结算、过期标签页、冻结后恢复。
*/
const test = require("node:test");
const { before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, launchBrowser, openFresh, dom, sleep } = require("./harness.js");

const KEY = "starryStudyRoom_v2";
const NO_LOCKS = `try { Object.defineProperty(Navigator.prototype, "locks", { get() { return undefined; }, configurable: true }); } catch (e) {}`;
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

const stored = (page) => page.evaluate(`JSON.parse(localStorage.getItem("${KEY}"))`);
const starToasts = (page) => page.evaluate(`[...document.querySelectorAll("#toastRegion .toast-star")].length`);

/* A 入座后把剩余时间缩短到 ms，模拟一轮即将结束（通过正常写入路径，B 会收到 storage 事件） */
async function startShortRound(page, ms) {
  await page.evaluate(dom.click("#focusPrimary"));
  await sleep(100);
  await page.evaluate(`persistChange(function() { appData.activeFocus.endsAt = Date.now() + ${ms}; }); restoreFocusSession(); true`);
}

async function openPair(init) {
  const a = await browser.newPage();
  await openFresh(a, server.origin + "/index.html#focus", {}, { init });
  const b = await browser.newPage();
  if (init) await b.addInitScript(init);
  await b.goto(server.origin + "/index.html#focus");
  return [a, b];
}

for (const mode of ["有 Web Locks", "无 Web Locks"]) {
  test("两个标签页同时打开，一轮到点只结算一次（" + mode + "）", async () => {
    const init = mode === "无 Web Locks" ? NO_LOCKS : undefined;
    for (let trial = 0; trial < 3; trial++) {
      const [a, b] = await openPair(init);
      assert.equal(await a.evaluate(`typeof navigator.locks`), init ? "undefined" : "object");

      await startShortRound(a, 1200);
      await sleep(400);
      assert.ok(await b.evaluate(`Boolean(appData.activeFocus)`), "B 应已同步到进行中的一轮");
      await sleep(2000);

      const data = await stored(a);
      assert.equal(data.stars, 1, "trial " + trial);
      assert.equal(data.focusSessions, 1);
      assert.equal(data.activeFocus, null);
      assert.equal((await starToasts(a)) + (await starToasts(b)), 1);
      assert.equal(await b.evaluate(`appData.activeFocus`), null);
      assert.deepEqual(a.errors.concat(b.errors), []);
      await a.closeTab();
      await b.closeTab();
    }
  });
}

test("入座的标签页已关闭：其他标签页在宽限期后代为结算（无 Web Locks）", async () => {
  const [a, b] = await openPair(NO_LOCKS);
  await startShortRound(a, 800);
  await sleep(300);
  await a.closeTab();

  await sleep(2500);
  assert.equal((await stored(b)).stars, 0, "宽限期内不抢先结算");
  await b.waitFor(`JSON.parse(localStorage.getItem("${KEY}")).stars === 1`, 8000);
  assert.equal((await stored(b)).focusSessions, 1);
  assert.equal(await starToasts(b), 1);
  assert.deepEqual(b.errors, []);
  await b.closeTab();
});

test("一个标签页暂停 / 提前收卷，另一个标签页同步显示且不会把会话写回", async () => {
  const [a, b] = await openPair();
  await a.evaluate(dom.click("#focusPrimary"));
  await sleep(300);
  await b.evaluate(dom.click("#focusPrimary"));
  await sleep(300);
  assert.equal(await a.evaluate(`appData.activeFocus.status`), "paused");

  // 让这一轮已过 2 分钟，再在 A 提前收卷
  await a.evaluate(`persistChange(function() { appData.activeFocus.remainingMs -= 120000; }); true`);
  await a.bringToFront();
  await a.evaluate(dom.click("#focusFinish"));
  await a.waitFor(`document.getElementById("confirmDialog").open`);
  await a.evaluate(dom.click("#confirmOk"));
  await sleep(400);
  assert.equal((await stored(a)).totalMinutes, 2);
  assert.equal(await b.evaluate(`appData.activeFocus`), null);

  // B 上残留的按钮再点一次：开新一轮而不是复活旧会话
  await b.bringToFront();
  await b.evaluate(dom.click("#focusPrimary"));
  await sleep(200);
  const data = await stored(b);
  assert.equal(data.totalMinutes, 2);
  assert.equal(data.focusSessions, 1);
  assert.equal(data.activeFocus.status, "running");
  assert.deepEqual(a.errors.concat(b.errors), []);
  await a.closeTab();
  await b.closeTab();
});

test("标签页冻结期间其他页写入，恢复后先同步再操作，不覆盖他页数据", async () => {
  const [a, b] = await openPair();
  await a.evaluate(dom.setValue("#taskInput", "冻结前"));
  await a.evaluate(`location.hash = "today"; document.getElementById("taskForm").requestSubmit(); true`);
  await sleep(200);

  await a.send("Page.setWebLifecycleState", { state: "frozen" });
  await b.evaluate(`location.hash = "today"; true`);
  await b.evaluate(dom.setValue("#taskInput", "冻结期间 B 写的"));
  await b.evaluate(dom.submit("#taskForm"));
  await sleep(200);
  await a.send("Page.setWebLifecycleState", { state: "active" });
  await sleep(300);

  await a.evaluate(dom.setValue("#taskInput", "恢复后 A 写的"));
  await a.evaluate(dom.submit("#taskForm"));
  await sleep(200);
  const names = (await stored(a)).tasksByDay[await a.evaluate(`dateKey()`)].map((t) => t.name);
  assert.deepEqual(names, ["冻结前", "冻结期间 B 写的", "恢复后 A 写的"]);
  assert.deepEqual(a.errors.concat(b.errors), []);
  await a.closeTab();
  await b.closeTab();
});

test("刷新后进行中的一轮继续计时，归属不变", async () => {
  const page = await browser.newPage();
  await openFresh(page, server.origin + "/index.html#focus");
  await page.evaluate(dom.click("#focusPrimary"));
  await sleep(200);
  const before = await stored(page);
  await page.reload();
  const after = await stored(page);
  assert.equal(after.activeFocus.id, before.activeFocus.id);
  assert.equal(await page.evaluate(`appData.activeFocus.ownerTab === TAB_ID`), true);
  assert.equal(await page.evaluate(`document.getElementById("focusStage").classList.contains("is-running")`), true);
  assert.deepEqual(page.errors, []);
  await page.closeTab();
});
