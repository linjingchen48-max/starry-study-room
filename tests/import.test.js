const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, loadPage, createMemoryStorage, failingStorage, flush } = require("./helpers.js");

const KEY = "starryStudyRoom_v2";

function parse(text) {
  return loadApp().run(`parseBackupText(${JSON.stringify(text)})`);
}

test("parseBackupText：拒绝非 JSON、非对象与无关 JSON", () => {
  assert.equal(parse("not json").ok, false);
  assert.equal(parse("[]").ok, false);
  assert.equal(parse("null").ok, false);
  assert.equal(parse('{"hello":"world"}').ok, false);
  assert.equal(parse('{"name":"package","version":"1.0.0"}').ok, false);
});

test("parseBackupText：拒绝其他应用或缺少 data 的导出包", () => {
  assert.equal(parse(JSON.stringify({ appName: "别的应用", data: { stars: 1 } })).ok, false);
  assert.equal(parse(JSON.stringify({ appName: "星辰御书房" })).ok, false);
  assert.equal(parse(JSON.stringify({ appName: "星辰御书房", data: [] })).ok, false);
});

test("parseBackupText：拒绝更新版本或无法识别版本的备份", () => {
  assert.equal(parse(JSON.stringify({ appName: "星辰御书房", schemaVersion: 3, data: { stars: 1 } })).ok, false);
  assert.equal(parse(JSON.stringify({ appName: "星辰御书房", data: { schemaVersion: 9, stars: 1 } })).ok, false);
  assert.equal(parse(JSON.stringify({ schemaVersion: "2", stars: 1 })).ok, false);
});

test("parseBackupText：字段类型不符时拒绝，而不是悄悄清空", () => {
  assert.equal(parse(JSON.stringify({ stars: "很多" })).ok, false);
  assert.equal(parse(JSON.stringify({ stars: -1 })).ok, false);
  assert.equal(parse(JSON.stringify({ tasks: "x" })).ok, false);
  assert.equal(parse(JSON.stringify({ mistakes: {} })).ok, false);
  assert.equal(parse(JSON.stringify({ tasksByDay: [] })).ok, false);
});

test("parseBackupText：接受 v1 导出包、v1 原始数据与 v2 导出包", () => {
  const v1Envelope = parse(JSON.stringify({ appName: "星辰御书房", version: "v10-storage", data: { stars: 3, tasks: [{ name: "旧" }] } }));
  assert.equal(v1Envelope.ok, true);
  assert.equal(v1Envelope.data.stars, 3);
  assert.equal(v1Envelope.hasSettings, false);

  assert.equal(parse(JSON.stringify({ stars: 1, review: null, tasks: [] })).ok, true);

  const app = loadApp();
  app.run(`appData.stars = 8; appData.settings.theme = "night"; ensureTasksFor("2026-03-01").push(normalizeTask({ name: "历史" }));`);
  const exported = app.run(`JSON.stringify({ appName: "星辰御书房", version: "v2-daily", schemaVersion: SCHEMA_VERSION, data: appData })`);
  const v2 = app.run(`parseBackupText(${JSON.stringify(exported)})`);
  assert.equal(v2.ok, true);
  assert.equal(v2.hasSettings, true);
  assert.equal(v2.data.stars, 8);
  assert.equal(v2.data.tasksByDay["2026-03-01"][0].name, "历史");
});

function file(text) {
  return `({ size: ${Buffer.byteLength(text)}, text: ${JSON.stringify(text)} })`;
}

function seeded(storage) {
  const page = loadPage(["js/settings.js"], { storage });
  page.run("appData.stars = 12; saveData();");
  return page;
}

test("导入：非法备份不弹确认、不覆盖现有数据", async () => {
  const storage = createMemoryStorage();
  const page = seeded(storage);
  const before = storage.getItem(KEY);

  await page.run(`importAppDataFromFile(${file('{"hello":"world"}')})`);
  assert.equal(page.state.confirmCalls, 0);
  assert.equal(page.run("appData.stars"), 12);
  assert.equal(storage.getItem(KEY), before);
  assert.equal(page.toasts.at(-1).options.type, "error");
});

test("导入：存储空间不足时回滚，不提示成功", async () => {
  const storage = createMemoryStorage();
  const page = seeded(storage);
  const before = storage.getItem(KEY);
  failingStorage(storage, (key) => key === KEY);

  await page.run(`importAppDataFromFile(${file(JSON.stringify({ appName: "星辰御书房", data: { stars: 99 } }))})`);
  await flush();
  assert.equal(page.state.confirmCalls, 1);
  assert.equal(page.run("appData.stars"), 12);
  assert.equal(storage.getItem(KEY), before);
  assert.ok(page.toasts.every((t) => t.options.type !== "success"));
  assert.match(page.toasts.at(-1).message, /导入失败/);
});

test("导入：成功写入后才提示成功，未带设置的旧备份保留当前外观", async () => {
  const storage = createMemoryStorage();
  const page = seeded(storage);
  page.run(`appData.settings.theme = "night"; saveData();`);

  await page.run(`importAppDataFromFile(${file(JSON.stringify({ appName: "星辰御书房", version: "v10-storage", data: { stars: 4 } }))})`);
  const stored = JSON.parse(storage.getItem(KEY));
  assert.equal(stored.stars, 4);
  assert.equal(stored.settings.theme, "night");
  assert.equal(page.toasts.at(-1).options.type, "success");
});

test("导入：取消确认时不改动数据", async () => {
  const storage = createMemoryStorage();
  const page = seeded(storage);
  page.state.confirmResult = false;
  await page.run(`importAppDataFromFile(${file(JSON.stringify({ stars: 1 }))})`);
  assert.equal(JSON.parse(storage.getItem(KEY)).stars, 12);
});

test("导入：超过 5 MB 的文件直接拒绝", async () => {
  const page = seeded(createMemoryStorage());
  await page.run(`importAppDataFromFile({ size: 6 * 1024 * 1024, text: "{}" })`);
  assert.equal(page.state.confirmCalls, 0);
  assert.equal(page.run("appData.stars"), 12);
});

test("导入与清空：只读保护期间拒绝执行，原始数据不被覆盖", async () => {
  const storage = failingStorage(createMemoryStorage({ [KEY]: "{broken" }), (key) => key.includes("_corrupt_"));
  const page = loadPage(["js/settings.js"], { storage });
  assert.equal(page.run("storageStatus.writeLocked"), true);

  await page.run(`importAppDataFromFile(${file(JSON.stringify({ stars: 1 }))})`);
  await page.run("clearAllAppData()");
  assert.equal(page.state.confirmCalls, 0);
  assert.equal(storage.getItem(KEY), "{broken");
});

test("清空：写入失败时回滚，不提示已清空", async () => {
  const storage = createMemoryStorage();
  const page = seeded(storage);
  failingStorage(storage, (key) => key === KEY);

  await page.run("clearAllAppData()");
  assert.equal(page.run("appData.stars"), 12);
  assert.equal(JSON.parse(storage.getItem(KEY)).stars, 12);
  assert.match(page.toasts.at(-1).message, /清空失败/);
});
