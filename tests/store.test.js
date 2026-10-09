const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, createMemoryStorage } = require("./helpers");

const TODAY = "2026-10-08";

test("createDefaultData 每次返回独立的嵌套对象", () => {
  const app = loadApp();
  const shared = app.run(`
    const a = createDefaultData();
    const b = createDefaultData();
    a.practiceStats.calm = 9;
    a.mistakes.push(1);
    [b.practiceStats.calm, b.mistakes.length, a.settings === b.settings]
  `);
  assert.deepEqual(Array.from(shared), [0, 0, false]);
});

test("v1 数据迁移：任务并入今日，奏对按保存日期归档", () => {
  const app = loadApp();
  app.context.legacy = {
    tasks: [
      { name: "数学极限 5 道", goal: "认真 2 道", done: true, createdAt: "2026-09-01T08:00:00.000Z" },
      { name: "  ", goal: "" },
      { name: "背单词" }
    ],
    stars: 7,
    seals: "3",
    totalMinutes: 175,
    focusSessions: 7,
    practiceStats: { calm: 2, speech: 1, bogus: 5 },
    distractions: { phone: 4 },
    review: { done: "完成 3 道", comment: "御批", updatedAt: "2026-09-20T13:00:00.000Z" },
    dailyData: { "2026-09-20": { minutes: 50, sessions: 2, practice: 1, review: true }, "bad-key": {} },
    mistakes: [{ title: "0/0 型", reason: "logic", reviewed: true, starRewarded: true }]
  };

  const data = app.run(`migrateData(legacy, "${TODAY}")`);

  assert.equal(data.schemaVersion, 2);
  assert.equal(data.tasksByDay[TODAY].length, 2);
  assert.equal(data.tasksByDay[TODAY][0].name, "数学极限 5 道");
  assert.equal(data.tasksByDay[TODAY][0].done, true);
  assert.ok(data.tasksByDay[TODAY][0].id);
  assert.equal(data.tasks, undefined);
  assert.equal(data.review, undefined);

  const reviewKey = app.run(`dateKeyFromISO("2026-09-20T13:00:00.000Z")`);
  assert.equal(data.reviews[reviewKey].done, "完成 3 道");

  assert.equal(data.stars, 7);
  assert.equal(data.seals, 3);
  assert.deepEqual({ ...data.practiceStats }, { calm: 2, discipline: 0, insight: 0, vision: 0, speech: 1 });
  assert.equal(data.distractions.phone, 4);
  assert.deepEqual(Object.keys(data.dailyData), ["2026-09-20"]);
  assert.equal(data.mistakes[0].reason, "logic");
  assert.equal(data.mistakes[0].starRewarded, true);
  assert.equal(data.settings.theme, "auto");
});

test("迁移会清洗不安全的 id 与异常数值", () => {
  const app = loadApp();
  app.context.raw = {
    tasksByDay: { [TODAY]: [{ id: '"><img src=x onerror=alert(1)>', name: "x" }] },
    stars: -5,
    totalMinutes: "abc",
    activeFocus: { duration: 25, status: "running", endsAt: "soon" },
    settings: { theme: "neon", focusDuration: 33 }
  };

  const data = app.run(`migrateData(raw, "${TODAY}")`);
  assert.match(data.tasksByDay[TODAY][0].id, /^[\w-]+$/);
  assert.equal(data.stars, 0);
  assert.equal(data.totalMinutes, 0);
  assert.equal(data.activeFocus, null);
  assert.equal(data.settings.theme, "auto");
  assert.equal(data.settings.focusDuration, 25);
});

test("v2 数据迁移是幂等的", () => {
  const app = loadApp();
  const once = app.run(`
    const first = migrateData({ tasks: [{ name: "A" }], reviews: { "${TODAY}": { done: "x" } } }, "${TODAY}");
    JSON.stringify(migrateData(JSON.parse(JSON.stringify(first)), "${TODAY}")) === JSON.stringify(first)
  `);
  assert.equal(once, true);
});

test("进行中的专注可以保存与恢复", () => {
  const app = loadApp();
  const session = app.run(`normalizeActiveFocus({ duration: 25, status: "paused", remainingMs: 600000, taskId: "abc" })`);
  assert.equal(session.status, "paused");
  assert.equal(session.remainingMs, 600000);
  assert.equal(session.endsAt, null);
  assert.equal(session.taskId, "abc");
});

test("损坏的本地数据会被另存，不会被静默覆盖", () => {
  const storage = createMemoryStorage({ starryStudyRoom_v1: "{not json" });
  const app = loadApp({ storage });
  assert.equal(app.run("storageStatus.issue"), "corrupt");
  assert.equal(app.run("storageStatus.writeLocked"), false);
  const backups = Object.keys(storage.data).filter((k) => k.startsWith("starryStudyRoom_v1_corrupt_"));
  assert.equal(backups.length, 1);
  assert.equal(storage.data[backups[0]], "{not json");
});

test("首次启动读取到的是独立的默认数据", () => {
  const app = loadApp();
  const leaked = app.run(`
    appData.practiceStats.calm += 1;
    ensureTasksFor("${TODAY}").push({ name: "x" });
    createDefaultData().practiceStats.calm
  `);
  assert.equal(leaked, 0);
});

test("escapeHtml 转义所有 HTML 特殊字符", () => {
  const app = loadApp();
  assert.equal(app.run(`escapeHtml('<b a="1">\\'&')`), "&lt;b a=&quot;1&quot;&gt;&#39;&amp;");
  assert.equal(app.run("escapeHtml(null)"), "");
});
