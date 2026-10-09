const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, loadPage, createMemoryStorage, failingStorage } = require("./helpers.js");

const KEY = "starryStudyRoom_v2";
const PAGES = ["js/today.js", "js/focus.js", "js/practice.js", "js/mistakes.js", "js/settings.js"];

function lockedStorage() {
  return createMemoryStorage({ [KEY]: JSON.stringify({ schemaVersion: 3, stars: 5, future: true }) });
}

test("persistChange：只读保护时拒绝修改，通知原因，内存与存储都不变", () => {
  const storage = lockedStorage();
  const raw = storage.getItem(KEY);
  const app = loadApp({ storage });
  app.run("var __blocked = []; storageStatus.onPersistBlocked = function(r) { __blocked.push(r); };");

  assert.equal(app.run("persistChange(function() { appData.stars = 99; })"), false);
  assert.equal(app.run("appData.stars"), 5);
  assert.equal(app.run("__blocked.join()"), "readonly");
  assert.equal(storage.getItem(KEY), raw);
});

test("persistChange：写入失败时回滚内存并通知，不留下未保存的结果", () => {
  const storage = createMemoryStorage();
  const app = loadApp({ storage });
  app.run("persistChange(function() { appData.stars = 3; })");
  app.run("var __blocked = []; storageStatus.onPersistBlocked = function(r) { __blocked.push(r); };");

  failingStorage(storage, (key) => key === KEY);
  assert.equal(app.run(`persistChange(function() { appData.stars = 4; ensureTasksFor().push(normalizeTask({ name: "未保存" })); })`), false);
  assert.equal(app.run("appData.stars"), 3);
  assert.equal(app.run("getTasksFor().length"), 0);
  assert.equal(app.run("__blocked.join()"), "write-failed");
  assert.equal(app.run("storageStatus.writeError"), false);
});

test("persistChange：其他标签页已写入更新数据时，先同步再修改，不用过期副本覆盖", () => {
  const storage = createMemoryStorage();
  const a = loadApp({ storage });
  const b = loadApp({ storage });
  a.run(`persistChange(function() { ensureTasksFor().push(normalizeTask({ name: "A 的任务" })); })`);

  b.run(`persistChange(function() { ensureTasksFor().push(normalizeTask({ name: "B 的任务" })); })`);

  const names = JSON.parse(storage.getItem(KEY)).tasksByDay[a.run("dateKey()")].map((t) => t.name);
  assert.deepEqual(names, ["A 的任务", "B 的任务"]);
});

test("persistChange：mutate 返回 false 时放弃修改且不写入", () => {
  const storage = createMemoryStorage();
  const app = loadApp({ storage });
  app.run("saveData()");
  const before = storage.getItem(KEY);
  assert.equal(app.run("persistChange(function() { appData.stars = 9; return false; })"), false);
  assert.equal(app.run("appData.stars"), 0);
  assert.equal(storage.getItem(KEY), before);
});

test("persistPreference：只读时外观仅本页生效、提示一次、不写入", () => {
  const storage = lockedStorage();
  const raw = storage.getItem(KEY);
  const app = loadApp({ storage });
  app.run("var __blocked = []; storageStatus.onPersistBlocked = function(r) { __blocked.push(r); };");
  app.run(`persistPreference(function() { appData.settings.theme = "night"; })`);
  app.run(`persistPreference(function() { appData.settings.theme = "day"; })`);
  assert.equal(app.run("appData.settings.theme"), "day");
  assert.equal(app.run("__blocked.join()"), "readonly-preference");
  assert.equal(storage.getItem(KEY), raw);
});

/* 只读保护下逐一触发会写入数据的操作：都不应保存，也不应出现成功提示 */
test("只读保护：各页面的写入操作都被拦截，不出现成功 / 奖励提示", async () => {
  const storage = lockedStorage();
  const raw = storage.getItem(KEY);
  const page = loadPage(PAGES, { storage });
  page.run(`
    document.getElementById("taskInput").value = "只读时新建";
    document.getElementById("mistakeTitle").value = "只读时错题";
    REVIEW_QUESTIONS.forEach(function(q) { document.getElementById("review-" + q.key).value = "内容"; });
  `);
  const event = "({ preventDefault() {}, target: { reset() {} } })";

  page.run(`addTask(${event})`);
  page.run(`saveReview(${event})`);
  page.run(`saveMistake(${event})`);
  page.run(`completePractice()`);
  page.run(`pickPractice("speech")`);
  page.run(`startFocus()`);
  page.run(`recordDistraction("phone")`);
  page.run(`dismissCarryOver()`);

  assert.equal(storage.getItem(KEY), raw);
  assert.equal(page.run("appData.stars"), 5);
  assert.equal(page.run("appData.activeFocus"), null);
  assert.equal(page.run("getTasksFor().length"), 0);
  assert.equal(page.run("appData.mistakes.length"), 0);
  assert.equal(page.run("toCount(appData.seals)"), 0);

  const success = page.toasts.filter((t) => ["success", "seal", "star"].includes(t.options.type));
  assert.deepEqual(success, []);
  assert.ok(page.toasts.filter((t) => t.options.type === "error").length >= 6);
  // 未保存时保留用户输入
  assert.equal(page.run(`document.getElementById("taskInput").value`), "只读时新建");
  assert.equal(page.run("reviewEditing"), false);
});

test("只读保护：进行中的专注到点后不结算、不发放星辰", async () => {
  const startedAt = Date.now() - 26 * 60000;
  const storage = createMemoryStorage({
    [KEY]: JSON.stringify({ schemaVersion: 3, stars: 5, activeFocus: { id: "s1", duration: 25, status: "running", startedAt, endsAt: startedAt + 1500000 } })
  });
  const raw = storage.getItem(KEY);
  const page = loadPage(PAGES, { storage });
  page.run("restoreFocusSession(); completeFocus();");
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(storage.getItem(KEY), raw);
  assert.equal(page.toasts.filter((t) => t.options.type === "star").length, 0);
});

test("写入失败：练习与错题重练不提示成功，内存回滚", () => {
  const storage = createMemoryStorage();
  const page = loadPage(PAGES, { storage });
  page.run(`persistChange(function() { appData.mistakes.push(normalizeMistake({ id: "m1", title: "题" })); })`);
  failingStorage(storage, (key) => key === KEY);

  page.run("completePractice()");
  page.run(`toggleMistakeReview("m1")`);

  assert.equal(page.run("toCount(appData.seals)"), 0);
  assert.equal(page.run("appData.currentPracticeDone"), false);
  assert.equal(page.run("appData.mistakes[0].reviewed"), false);
  assert.equal(page.run("toCount(appData.stars)"), 0);
  assert.deepEqual(page.toasts.filter((t) => t.options.type !== "error"), []);
});

test("多标签页：同一道修炼题在两个标签页各点一次，只领一枚御印", () => {
  const storage = createMemoryStorage();
  const a = loadPage(PAGES, { storage });
  const b = loadPage(PAGES, { storage });
  a.run("completePractice()");
  b.run("completePractice()");
  assert.equal(JSON.parse(storage.getItem(KEY)).seals, 1);
  assert.equal(b.toasts.filter((t) => t.options.type === "seal").length, 0);
});

test("只读保护：导出时给出本机原始数据，而不是降级解析后的内容", () => {
  const storage = lockedStorage();
  const page = loadPage(PAGES, { storage });
  page.run(`var __blobs = []; Blob = function(parts, opts) { __blobs.push({ parts: parts, type: opts && opts.type }); };`);
  page.run("exportAppData()");
  assert.equal(page.run("__blobs[0].parts[0]"), storage.getItem(KEY));
  assert.equal(page.run("__blobs[0].type"), "application/json");
});
