/*
  回归冒烟：桌面与移动视口下的主要流程、控制台无报错、移动端无横向溢出；迁移与写入性能。
*/
const test = require("node:test");
const { before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, launchBrowser, openFresh, dom, sleep, legacyData } = require("./harness.js");

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

const VIEWPORTS = [
  { name: "桌面", width: 1280, height: 860, mobile: false },
  { name: "移动", width: 390, height: 844, mobile: true }
];

for (const vp of VIEWPORTS) {
  test("主要流程（" + vp.name + " " + vp.width + "×" + vp.height + "）", async () => {
    const page = await browser.newPage();
    await page.viewport(vp.width, vp.height, vp.mobile);
    await openFresh(page, server.origin + "/index.html#today");

    for (const route of ["today", "focus", "practice", "mistakes", "archive"]) {
      await page.evaluate(`location.hash = "${route}"; true`);
      await sleep(150);
      assert.equal(await page.evaluate(`document.querySelector('.page[data-route="${route}"]').hidden`), false, route);
      if (vp.mobile) {
        assert.ok(await page.evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), route + " 横向溢出");
      }
    }

    await page.evaluate(`location.hash = "today"; true`);
    await page.evaluate(dom.setValue("#taskInput", "冒烟任务"));
    await page.evaluate(dom.setValue("#goalInput", "最低一题"));
    await page.evaluate(dom.submit("#taskForm"));
    await sleep(150);
    await page.evaluate(dom.click('#taskList [data-task-action="toggle"]'));
    await page.evaluate(dom.click('#reviewSummary [data-review-action="edit"]'));
    await page.evaluate(dom.setValue("#review-done", "今天完成了冒烟"));
    await page.evaluate(dom.submit("#reviewForm"));
    await sleep(200);

    await page.evaluate(`location.hash = "focus"; true`);
    await page.evaluate(dom.click("#focusPrimary"));
    await sleep(150);
    await page.evaluate(dom.click("#focusPrimary"));
    await page.evaluate(dom.click('#distractionChips [data-distraction="phone"]'));
    await page.evaluate(dom.click("#focusReset"));
    await sleep(150);

    await page.evaluate(`location.hash = "practice"; true`);
    await page.evaluate(dom.click("#practiceComplete"));
    await sleep(150);

    await page.evaluate(`location.hash = "mistakes"; document.getElementById("mistakeFormDetails").open = true; true`);
    await page.evaluate(dom.setValue("#mistakeTitle", "冒烟错题"));
    await page.evaluate(dom.submit("#mistakeForm"));
    await sleep(150);
    await page.evaluate(`document.querySelector("#mistakeList details").open = true; true`);
    await page.evaluate(dom.click('#mistakeList [data-mistake-action="review"]'));
    await sleep(150);

    await page.evaluate(dom.click("#settingsBtn"));
    await page.evaluate(`document.querySelector('input[name="themePref"][value="night"]').click(); true`);
    await sleep(100);
    assert.equal(await page.evaluate(`document.documentElement.dataset.theme`), "night");
    await page.evaluate(`document.getElementById("settingsDialog").close(); true`);

    const data = await page.evaluate(`JSON.parse(localStorage.getItem("${KEY}"))`);
    const today = await page.evaluate(`dateKey()`);
    assert.equal(data.tasksByDay[today][0].done, true);
    assert.ok(data.reviews[today].comment);
    assert.equal(data.distractions.phone, 1);
    assert.equal(data.activeFocus, null);
    assert.equal(data.seals, 1);
    assert.equal(data.stars, 1);
    assert.equal(data.mistakes[0].reviewed, true);
    assert.equal(data.settings.theme, "night");
    assert.equal(await page.evaluate(`localStorage.getItem("starryStudyRoom_v1")`), null);

    const errorToasts = await page.evaluate(`[...document.querySelectorAll("#toastRegion .toast-error")].length`);
    assert.equal(errorToasts, 0);
    assert.deepEqual(page.errors, []);
    await page.closeTab();
  });
}

function bigV2Data() {
  const tasksByDay = {};
  const reviews = {};
  const dailyData = {};
  const start = new Date(2025, 9, 1);
  for (let i = 0; i < 365; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    tasksByDay[key] = Array.from({ length: 5 }, (_, j) => ({ id: "t" + i + "_" + j, name: "任务 " + i + "-" + j, goal: "最低标准", done: j % 2 === 0, createdAt: d.toISOString() }));
    reviews[key] = { done: "完成内容".repeat(20), distraction: "分心", restless: "", calm: "", tomorrow: "明日", comment: "御批", updatedAt: d.toISOString() };
    dailyData[key] = { minutes: 90, sessions: 3, practice: 1, review: true };
  }
  const mistakes = Array.from({ length: 300 }, (_, i) => ({ id: "m" + i, title: "错题 " + i, reason: "logic", wrong: "错误过程".repeat(10), correct: "正确思路".repeat(10), reviewed: false, starRewarded: false, createdAt: start.toISOString() }));
  return { schemaVersion: 2, stars: 500, totalMinutes: 30000, focusSessions: 1000, seals: 300, tasksByDay, reviews, dailyData, mistakes };
}

test("性能：一年数据（约 1825 项御案、365 篇奏对、300 道错题）启动与单次写入耗时", async (t) => {
  const page = await browser.newPage();
  const raw = JSON.stringify(bigV2Data());
  await openFresh(page, server.origin + "/index.html#today", { [KEY]: raw });
  const perf = await page.evaluate(`(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) persistChange(function() { appData.distractions.hard += 1; });
    const persistMs = (performance.now() - t0) / 20;
    const t2 = performance.now();
    for (let i = 0; i < 20; i++) saveData();
    const saveMs = (performance.now() - t2) / 20;
    const t1 = performance.now();
    renderAllNow();
    return { domContentLoaded: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd), persistMs: +persistMs.toFixed(2), plainSaveMs: +saveMs.toFixed(2), renderMs: +(performance.now() - t1).toFixed(2), kb: Math.round(localStorage.getItem("${KEY}").length / 1024) };
  })()`);
  t.diagnostic(JSON.stringify(perf));
  assert.ok(perf.load < 3000, "启动过慢：" + perf.load);
  assert.ok(perf.persistMs < 50, "单次写入过慢：" + perf.persistMs);
  assert.deepEqual(page.errors, []);
  await page.closeTab();
});

test("迁移：v1 数据首次打开即迁移到 v2 键，数据一致，耗时可接受", async (t) => {
  const page = await browser.newPage();
  const v1 = legacyData({ tasks: Array.from({ length: 500 }, (_, i) => ({ name: "旧任务 " + i, goal: "", done: i % 3 === 0 })) });
  await openFresh(page, server.origin + "/index.html#today", { starryStudyRoom_v1: JSON.stringify(v1) });
  const result = await page.evaluate(`({
    tasks: getTasksFor().length,
    stars: appData.stars,
    seals: appData.seals,
    review: Object.keys(appData.reviews),
    migrated: JSON.parse(localStorage.getItem("${KEY}")).tasksByDay[dateKey()].length,
    load: Math.round(performance.getEntriesByType("navigation")[0].loadEventEnd)
  })`);
  t.diagnostic(JSON.stringify(result));
  assert.equal(result.tasks, 500);
  assert.equal(result.migrated, 500);
  assert.equal(result.stars, 6);
  assert.equal(result.seals, 2);
  assert.deepEqual(result.review, ["2026-10-01"]);
  assert.ok(result.load < 3000);
  assert.deepEqual(page.errors, []);
  await page.closeTab();
});
