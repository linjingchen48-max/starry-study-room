const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, createMemoryStorage, failingStorage } = require("./helpers.js");

const KEY = "starryStudyRoom_v2";
const LEGACY = "starryStudyRoom_v1";
const SEEN = "starryStudyRoom_v2_legacy_seen";

const v1Raw = JSON.stringify({ stars: 2, seals: 1, tasks: [{ name: "旧任务" }], review: { done: "旧复盘", updatedAt: "2026-01-05T12:00:00Z" } });

test("迁移：v1 数据迁入独立的 v2 键，v1 键原样保留", () => {
  const storage = createMemoryStorage({ [LEGACY]: v1Raw });
  const app = loadApp({ storage });

  assert.equal(app.run("appData.stars"), 2);
  assert.equal(storage.getItem(LEGACY), v1Raw);
  const stored = JSON.parse(storage.getItem(KEY));
  assert.equal(stored.schemaVersion, 2);
  assert.equal(stored.stars, 2);
  assert.ok(stored.reviews["2026-01-05"]);
  assert.equal(app.run("storageStatus.issue"), null);
});

test("迁移：本版本的任何写入都不会触碰 v1 键", () => {
  const storage = createMemoryStorage({ [LEGACY]: v1Raw });
  const app = loadApp({ storage });
  app.run(`persistChange(function() { appData.stars = 50; ensureTasksFor("2026-01-01").push(normalizeTask({ name: "新任务" })); })`);
  app.run("replaceAppData(createDefaultData())");
  app.run("syncFromStorage()");

  assert.equal(storage.getItem(LEGACY), v1Raw);
});

test("迁移：v2 键已存在时不再读取 v1 键（旧版页面后来写入的数据不会覆盖按日历史）", () => {
  const storage = createMemoryStorage({ [LEGACY]: v1Raw });
  const first = loadApp({ storage });
  first.run(`persistChange(function() { ensureTasksFor("2026-01-01").push(normalizeTask({ name: "历史任务" })); })`);

  // 仍开着的旧版页面用它内存里的旧数据整份写回 v1 键
  storage.setItem(LEGACY, JSON.stringify({ stars: 0, tasks: [{ name: "v1 任务" }] }));

  const reopened = loadApp({ storage });
  assert.equal(reopened.run(`getTasksFor("2026-01-01")[0].name`), "历史任务");
  assert.equal(reopened.run("appData.stars"), 2);
});

test("旧版写入检测：迁移后 v1 键被改写时提示 legacy-changed，可下载，确认后不再重复提示", () => {
  const storage = createMemoryStorage({ [LEGACY]: v1Raw });
  loadApp({ storage });
  const written = JSON.stringify({ stars: 3, tasks: [{ name: "旧版页面新写的" }] });
  storage.setItem(LEGACY, written);

  const app = loadApp({ storage });
  assert.equal(app.run("storageStatus.issue"), "legacy-changed");
  assert.equal(app.run("storageStatus.writeLocked"), false);
  assert.equal(app.run("storageStatus.rawSnapshot"), written);

  app.run("acknowledgeLegacyChanges()");
  assert.equal(app.run("storageStatus.issue"), null);
  assert.equal(storage.getItem(LEGACY), written);
  assert.equal(loadApp({ storage }).run("storageStatus.issue"), null);
});

test("旧版写入检测：运行中也能发现（storage 事件 / 切回前台时调用）", () => {
  const storage = createMemoryStorage();
  const app = loadApp({ storage });
  app.run("saveData()");
  assert.equal(app.run("checkLegacyChanges()"), false);

  storage.setItem(LEGACY, v1Raw);
  assert.equal(app.run("checkLegacyChanges()"), true);
  assert.equal(app.run("storageStatus.issue"), "legacy-changed");
});

test("迁移：v1 数据无法解析时不改动 v1 键、不锁定，提示保持到用户确认", () => {
  const storage = createMemoryStorage({ [LEGACY]: "{broken" });
  const app = loadApp({ storage });
  assert.equal(app.run("storageStatus.issue"), "legacy-corrupt");
  assert.equal(app.run("storageStatus.writeLocked"), false);
  assert.equal(app.run("storageStatus.rawSnapshot"), "{broken");

  assert.equal(app.run("persistChange(function() { appData.stars = 1; })"), true);
  assert.equal(storage.getItem(LEGACY), "{broken");

  assert.equal(loadApp({ storage }).run("storageStatus.issue"), "legacy-corrupt");
  app.run("acknowledgeLegacyChanges()");
  assert.equal(loadApp({ storage }).run("storageStatus.issue"), null);
});

test("迁移：v1 键中是更新版本的数据时只读，不写入 v2 键", () => {
  const future = JSON.stringify({ schemaVersion: 3, stars: 8 });
  const storage = createMemoryStorage({ [LEGACY]: future });
  const app = loadApp({ storage });
  assert.equal(app.run("storageStatus.issue"), "unsupported");
  assert.equal(app.run("storageStatus.writeLocked"), true);
  assert.equal(storage.getItem(KEY), null);
  assert.equal(storage.getItem(LEGACY), future);
});

test("迁移：预览版写在 v1 键里的 v2 数据（schemaVersion 2）被完整接管", () => {
  const preview = JSON.stringify({ schemaVersion: 2, stars: 4, tasksByDay: { "2026-02-01": [{ id: "a", name: "预览版任务" }] } });
  const storage = createMemoryStorage({ [LEGACY]: preview });
  const app = loadApp({ storage });
  assert.equal(app.run(`getTasksFor("2026-02-01")[0].name`), "预览版任务");
  assert.equal(JSON.parse(storage.getItem(KEY)).stars, 4);
});

test("迁移：写入 v2 键失败时照常使用，v1 键不变，下次打开会再次迁移", () => {
  const storage = failingStorage(createMemoryStorage({ [LEGACY]: v1Raw }), (key) => key === KEY);
  const app = loadApp({ storage });
  assert.equal(app.run("appData.stars"), 2);
  assert.equal(storage.getItem(KEY), null);
  assert.equal(storage.getItem(LEGACY), v1Raw);

  storage.failWrites = false;
  loadApp({ storage });
  assert.equal(JSON.parse(storage.getItem(KEY)).stars, 2);
});

test("迁移：已有的 v1 升级备份键保持原样，不再新建", () => {
  const storage = createMemoryStorage({ [LEGACY]: v1Raw, starryStudyRoom_v1_pre_v2_backup: "旧备份" });
  loadApp({ storage });
  assert.equal(storage.getItem("starryStudyRoom_v1_pre_v2_backup"), "旧备份");

  const fresh = createMemoryStorage({ [LEGACY]: v1Raw });
  loadApp({ storage: fresh });
  assert.equal(fresh.getItem("starryStudyRoom_v1_pre_v2_backup"), null);
});

test("全新用户：没有 v1 数据时记录指纹；保存过之后旧版页面写入同样能被发现", () => {
  const storage = createMemoryStorage();
  loadApp({ storage }).run("persistChange(function() { appData.stars = 1; })");
  assert.equal(storage.getItem(SEEN), "none");
  storage.setItem(LEGACY, v1Raw);
  const app = loadApp({ storage });
  assert.equal(app.run("storageStatus.issue"), "legacy-changed");
  assert.equal(app.run("appData.stars"), 1);
});

test("全新用户：从未保存过时，旧版页面后写入的数据会被正常迁移", () => {
  const storage = createMemoryStorage();
  loadApp({ storage });
  storage.setItem(LEGACY, v1Raw);
  const app = loadApp({ storage });
  assert.equal(app.run("appData.stars"), 2);
  assert.equal(app.run("storageStatus.issue"), null);
});
