const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, loadPage, createMemoryStorage, createSharedLocks, flush } = require("./helpers.js");

const KEY = "starryStudyRoom_v2";

function dayKey(offset = 0) {
  return loadApp().run(`dateKey(${offset})`);
}

/* 写入一轮已到时的专注：入座于 startOffsetMs 之前，时长 25 分钟 */
function seedExpiredSession(storage, options = {}) {
  const startedAt = Date.now() - (options.startedAgoMs || 26 * 60000);
  const setup = loadApp({ storage });
  setup.run(`
    appData.stars = 10;
    ${options.taskDay ? `ensureTasksFor("${options.taskDay}").push(normalizeTask({ id: "t1", name: "物理第三章" }));` : ""}
    appData.activeFocus = normalizeActiveFocus({
      id: "sess1",
      dayKey: ${options.dayKey ? `"${options.dayKey}"` : "undefined"},
      duration: 25,
      status: "running",
      startedAt: ${startedAt},
      endsAt: ${startedAt + 25 * 60000},
      taskId: "${options.taskDay ? "t1" : ""}"
    });
    saveData();
  `);
}

test("activeFocus 保留会话 id 与入座日期；旧会话的 id 由开始时间稳定推导", () => {
  const app = loadApp();
  const kept = app.run(`normalizeActiveFocus({ id: "abc", dayKey: "2026-01-02", duration: 25, status: "paused", remainingMs: 1000, startedAt: 5 })`);
  assert.equal(kept.id, "abc");
  assert.equal(kept.dayKey, "2026-01-02");

  const startedAt = new Date(2026, 0, 3, 23, 50).getTime();
  const legacy = `({ duration: 25, status: "running", startedAt: ${startedAt}, endsAt: ${startedAt + 1500000} })`;
  const first = app.run(`normalizeActiveFocus(${legacy})`);
  const second = loadApp().run(`normalizeActiveFocus(${legacy})`);
  assert.equal(first.dayKey, "2026-01-03");
  assert.equal(first.id, second.id);
});

test("跨日：一轮专注计入入座当天，而不是结算当天", async () => {
  const storage = createMemoryStorage();
  const yesterday = dayKey(-1);
  seedExpiredSession(storage, { dayKey: yesterday, taskDay: yesterday });

  const page = loadPage(["js/focus.js"], { storage });
  page.run("completeFocus()");
  await flush();

  const data = JSON.parse(storage.getItem(KEY));
  assert.equal(data.activeFocus, null);
  assert.equal(data.stars, 11);
  assert.equal(data.dailyData[yesterday].minutes, 25);
  assert.equal(data.dailyData[yesterday].sessions, 1);
  assert.equal(data.dailyData[dayKey()], undefined);
});

test("跨日：绑定昨日御案的会话结算后仍能勾选该任务", async () => {
  const storage = createMemoryStorage();
  const yesterday = dayKey(-1);
  seedExpiredSession(storage, { dayKey: yesterday, taskDay: yesterday });

  const page = loadPage(["js/focus.js"], { storage });
  page.run("completeFocus()");
  await flush();

  const toast = page.toasts.find((t) => t.options.type === "star");
  assert.ok(toast.options.onAction, "应提供勾选任务的操作");
  toast.options.onAction();
  assert.equal(JSON.parse(storage.getItem(KEY)).tasksByDay[yesterday][0].done, true);
});

test("跨日：御案已被结转到今日时，仍能找到绑定任务", () => {
  const app = loadApp();
  const yesterday = dayKey(-1);
  app.run(`ensureTasksFor("${dayKey()}").push(normalizeTask({ id: "t1", name: "已结转" }));`);
  const task = app.run(`findSessionTask({ taskId: "t1", dayKey: "${yesterday}" })`);
  assert.equal(task.name, "已结转");
  assert.equal(app.run(`findSessionTask({ taskId: "missing", dayKey: "${yesterday}" })`), null);
});

test("跨日：提前收卷的实际分钟同样计入入座当天", async () => {
  const storage = createMemoryStorage();
  const yesterday = dayKey(-1);
  const setup = loadApp({ storage });
  const startedAt = Date.now() - 7 * 60000;
  setup.run(`appData.activeFocus = normalizeActiveFocus({ id: "s7", dayKey: "${yesterday}", duration: 25, status: "running", startedAt: ${startedAt}, endsAt: ${startedAt + 25 * 60000} }); saveData();`);

  const page = loadPage(["js/focus.js"], { storage });
  await page.run("finishFocusEarly()");
  const data = JSON.parse(storage.getItem(KEY));
  assert.equal(data.dailyData[yesterday].minutes, 7);
  assert.equal(data.stars, 0);
  assert.equal(data.activeFocus, null);
});

test("多标签页：两个标签页同时结算同一轮，只点亮一颗星", async () => {
  const storage = createMemoryStorage();
  seedExpiredSession(storage);
  const locks = createSharedLocks();
  const a = loadPage(["js/focus.js"], { storage, locks });
  const b = loadPage(["js/focus.js"], { storage, locks });

  a.run("completeFocus()");
  b.run("completeFocus()");
  await flush();

  const data = JSON.parse(storage.getItem(KEY));
  assert.equal(data.stars, 11);
  assert.equal(data.focusSessions, 1);
  assert.equal(data.totalMinutes, 25);
  assert.equal(b.run("appData.activeFocus"), null);
  const starToasts = [a, b].reduce((n, page) => n + page.toasts.filter((t) => t.options.type === "star").length, 0);
  assert.equal(starToasts, 1);
});

test("多标签页：无 Web Locks 时，后结算的标签页也不会重复发放或覆盖他页写入", async () => {
  const storage = createMemoryStorage();
  seedExpiredSession(storage);
  const a = loadPage(["js/focus.js"], { storage });
  const b = loadPage(["js/focus.js"], { storage });

  a.run("completeFocus()");
  await flush();
  a.run(`appData.mistakes.push(normalizeMistake({ title: "A 结算后记下的错题" })); saveData();`);

  b.run("completeFocus()");
  await flush();

  const data = JSON.parse(storage.getItem(KEY));
  assert.equal(data.stars, 11);
  assert.equal(data.mistakes.length, 1);
  assert.equal(b.toasts.some((t) => t.options.type === "star"), false);
});

test("过期状态：存储中会话已被暂停时，不按本页过期的「已到时」状态结算", async () => {
  const storage = createMemoryStorage();
  seedExpiredSession(storage);
  const stale = loadPage(["js/focus.js"], { storage });

  const other = loadApp({ storage });
  other.run(`appData.activeFocus.status = "paused"; appData.activeFocus.endsAt = null; appData.activeFocus.remainingMs = 600000; saveData();`);

  stale.run("completeFocus()");
  await flush();

  const data = JSON.parse(storage.getItem(KEY));
  assert.equal(data.stars, 10);
  assert.equal(data.activeFocus.status, "paused");
  assert.equal(stale.run("appData.activeFocus.status"), "paused");
});

test("过期状态：确认提前收卷期间该轮已在别处结算，则不再记录分钟", async () => {
  const storage = createMemoryStorage();
  const setup = loadApp({ storage });
  const startedAt = Date.now() - 10 * 60000;
  setup.run(`appData.activeFocus = normalizeActiveFocus({ id: "s10", duration: 25, status: "running", startedAt: ${startedAt}, endsAt: ${startedAt + 25 * 60000} }); saveData();`);

  const page = loadPage(["js/focus.js"], { storage });
  page.run(`confirmAction = function() {
    const other = JSON.parse(localStorage.getItem(STORAGE_KEY));
    other.activeFocus = null;
    other.totalMinutes = 10;
    other.focusSessions = 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(other));
    return Promise.resolve(true);
  };`);
  await page.run("finishFocusEarly()");

  const data = JSON.parse(storage.getItem(KEY));
  assert.equal(data.totalMinutes, 10);
  assert.equal(data.focusSessions, 1);
});

test("同一标签页：计时器在结算进行中重复触发，也只结算一次", async () => {
  const storage = createMemoryStorage();
  seedExpiredSession(storage);
  const page = loadPage(["js/focus.js"], { storage, locks: createSharedLocks() });
  page.run("completeFocus(); completeFocus(); restoreFocusSession();");
  await flush();
  assert.equal(JSON.parse(storage.getItem(KEY)).stars, 11);
});

test("新开的专注会记录会话 id 与当天日期", () => {
  const page = loadPage(["js/focus.js"], { storage: createMemoryStorage() });
  page.run("startFocus()");
  const session = page.run("appData.activeFocus");
  assert.match(session.id, /^[\w-]+$/);
  assert.equal(session.dayKey, dayKey());
});

/* ---------- 无 Web Locks 时的退化策略：结算归属 ---------- */

function seedOwnedSession(storage, ownerTab, endedAgoMs) {
  const endsAt = Date.now() - endedAgoMs;
  loadApp({ storage }).run(`
    appData.stars = 10;
    appData.activeFocus = normalizeActiveFocus({ id: "own1", duration: 25, status: "running", startedAt: ${endsAt - 25 * 60000}, endsAt: ${endsAt}, ownerTab: "${ownerTab}" });
    saveData();
  `);
}

test("结算归属：入座的标签页到点立即结算", async () => {
  const storage = createMemoryStorage();
  seedOwnedSession(storage, "tA", 100);
  const owner = loadPage(["js/focus.js"], { storage, sessionStorage: createMemoryStorage({ starryStudyRoom_tab: "tA" }) });
  owner.run("completeFocus()");
  await flush();
  assert.equal(JSON.parse(storage.getItem(KEY)).stars, 11);
});

test("结算归属：其他标签页在宽限期内不抢先结算，宽限期过后代为结算", async () => {
  const storage = createMemoryStorage();
  seedOwnedSession(storage, "tA", 1000);
  const other = loadPage(["js/focus.js"], { storage, sessionStorage: createMemoryStorage({ starryStudyRoom_tab: "tB" }) });
  other.run("completeFocus()");
  await flush();
  assert.equal(JSON.parse(storage.getItem(KEY)).stars, 10);
  assert.ok(JSON.parse(storage.getItem(KEY)).activeFocus);

  const storage2 = createMemoryStorage();
  seedOwnedSession(storage2, "tA", 6000);
  const late = loadPage(["js/focus.js"], { storage: storage2, sessionStorage: createMemoryStorage({ starryStudyRoom_tab: "tB" }) });
  late.run("completeFocus()");
  await flush();
  assert.equal(JSON.parse(storage2.getItem(KEY)).stars, 11);
});

test("结算归属：无 Web Locks 时两个标签页同时到点，只有入座页结算", async () => {
  const storage = createMemoryStorage();
  seedOwnedSession(storage, "tA", 50);
  const a = loadPage(["js/focus.js"], { storage, sessionStorage: createMemoryStorage({ starryStudyRoom_tab: "tA" }) });
  const b = loadPage(["js/focus.js"], { storage, sessionStorage: createMemoryStorage({ starryStudyRoom_tab: "tB" }) });
  b.run("completeFocus()");
  a.run("completeFocus()");
  await flush();
  const data = JSON.parse(storage.getItem(KEY));
  assert.equal(data.stars, 11);
  assert.equal(data.focusSessions, 1);
  assert.equal(b.toasts.filter((t) => t.options.type === "star").length, 0);
});

test("入座、继续时记录本标签页为结算归属", () => {
  const session = createMemoryStorage({ starryStudyRoom_tab: "tMine" });
  const page = loadPage(["js/focus.js"], { storage: createMemoryStorage(), sessionStorage: session });
  page.run("startFocus()");
  assert.equal(page.run("appData.activeFocus.ownerTab"), "tMine");
  page.run("pauseFocus(); appData.activeFocus.ownerTab = 'tOther'; saveData(); resumeFocus();");
  assert.equal(page.run("appData.activeFocus.ownerTab"), "tMine");
});

test("过期状态：会话已在其他标签页结束时，暂停 / 重置不会把它写回", async () => {
  const storage = createMemoryStorage();
  const stale = loadPage(["js/focus.js"], { storage });
  stale.run("startFocus()");

  const other = loadApp({ storage });
  other.run("appData.activeFocus = null; appData.totalMinutes = 25; saveData();");

  stale.run("pauseFocus()");
  assert.equal(JSON.parse(storage.getItem(KEY)).activeFocus, null);
  assert.equal(stale.run("appData.activeFocus"), null);
  assert.equal(JSON.parse(storage.getItem(KEY)).totalMinutes, 25);
});

test("入座：其他标签页已入座时不新开一轮，改为显示那一轮", () => {
  const storage = createMemoryStorage();
  const a = loadPage(["js/focus.js"], { storage });
  const b = loadPage(["js/focus.js"], { storage });
  a.run("startFocus()");
  const id = a.run("appData.activeFocus.id");
  b.run("startFocus()");
  assert.equal(b.run("appData.activeFocus.id"), id);
  assert.equal(JSON.parse(storage.getItem(KEY)).activeFocus.id, id);
});
