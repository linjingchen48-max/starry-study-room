const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, createMemoryStorage, failingStorage } = require("./helpers.js");

const KEY = "starryStudyRoom_v2";

test("损坏数据：另存成功时可继续使用，原文完整保留在备份键", () => {
  const storage = createMemoryStorage({ [KEY]: "{broken" });
  const app = loadApp({ storage });

  assert.equal(app.run("storageStatus.issue"), "corrupt");
  assert.equal(app.run("storageStatus.writeLocked"), false);
  const backupKey = app.run("storageStatus.backupKey");
  assert.equal(storage.getItem(backupKey), "{broken");
  assert.equal(app.run("storageStatus.rawSnapshot"), "{broken");
  assert.equal(app.run("saveData()"), true);
});

test("损坏数据：另存失败时锁定写入，任何保存都不会覆盖原始数据", () => {
  const storage = failingStorage(createMemoryStorage({ [KEY]: "{broken" }), (key) => key.includes("_corrupt_"));
  const app = loadApp({ storage });

  assert.equal(app.run("storageStatus.issue"), "corrupt-unsaved");
  assert.equal(app.run("storageStatus.writeLocked"), true);
  assert.equal(app.run("storageStatus.rawSnapshot"), "{broken");

  assert.equal(app.run("saveData()"), false);
  assert.equal(app.run("persistChange(function() { appData.stars = 3; })"), false);
  assert.equal(app.run(`replaceAppData(createDefaultData())`), false);
  assert.equal(storage.getItem(KEY), "{broken");
});

test("损坏数据：备份写入后读不回（静默丢失）也视为失败", () => {
  const storage = createMemoryStorage({ [KEY]: "{broken" });
  const setItem = storage.setItem;
  storage.setItem = function(key, value) {
    if (!key.includes("_corrupt_")) setItem.call(storage, key, value);
  };
  const app = loadApp({ storage });
  assert.equal(app.run("storageStatus.issue"), "corrupt-unsaved");
  assert.equal(app.run("saveData()"), false);
  assert.equal(storage.getItem(KEY), "{broken");
});

test("损坏数据：合法 JSON 但不是对象（null、数组、数字）同样按损坏处理", () => {
  ["null", "[]", "42", '"text"'].forEach((raw) => {
    const storage = createMemoryStorage({ [KEY]: raw });
    const app = loadApp({ storage });
    assert.equal(app.run("storageStatus.issue"), "corrupt", raw);
    const backupKey = app.run("storageStatus.backupKey");
    assert.equal(storage.getItem(backupKey), raw);
  });
});

test("损坏数据：用户确认放弃后才解除锁定；仍写不进去时保持锁定", () => {
  const storage = failingStorage(createMemoryStorage({ [KEY]: "{broken" }), (key) => key.includes("_corrupt_") || key === KEY);
  const app = loadApp({ storage });

  assert.equal(app.run("releaseCorruptLock()"), false);
  assert.equal(app.run("storageStatus.writeLocked"), true);
  assert.equal(storage.getItem(KEY), "{broken");

  storage.failWrites = false;
  assert.equal(app.run("releaseCorruptLock()"), true);
  assert.equal(app.run("storageStatus.writeLocked"), false);
  assert.equal(app.run("storageStatus.issue"), null);
  assert.equal(JSON.parse(storage.getItem(KEY)).schemaVersion, 2);
});

test("未来 schemaVersion：只读加载，保存不会降级覆盖未知字段", () => {
  const raw = JSON.stringify({ schemaVersion: 3, stars: 5, newFeature: { keep: true } });
  const storage = createMemoryStorage({ [KEY]: raw });
  const app = loadApp({ storage });

  assert.equal(app.run("storageStatus.issue"), "unsupported");
  assert.equal(app.run("storageStatus.writeLocked"), true);
  assert.equal(app.run("appData.stars"), 5);
  assert.equal(app.run("persistChange(function() { appData.stars = 6; })"), false);
  assert.equal(app.run("saveData()"), false);
  assert.equal(storage.getItem(KEY), raw);
});

test("无法识别的 schemaVersion（字符串、0、小数）同样只读", () => {
  ['"2"', "0", "2.5", "-1", "null"].forEach((version) => {
    const raw = '{"schemaVersion":' + version + ',"stars":1}';
    const storage = createMemoryStorage({ [KEY]: raw });
    const app = loadApp({ storage });
    assert.equal(app.run("storageStatus.writeLocked"), true, version);
    app.run("saveData()");
    assert.equal(storage.getItem(KEY), raw, version);
  });
});

test("存储写入失败：saveData 返回 false，只提示一次，恢复后清除错误状态", () => {
  const storage = failingStorage(createMemoryStorage(), (key) => key === KEY);
  const app = loadApp({ storage });
  app.run("var __errors = 0; storageStatus.onWriteError = function() { __errors += 1; };");

  assert.equal(app.run("saveData()"), false);
  assert.equal(app.run("saveData()"), false);
  assert.equal(app.run("__errors"), 1);
  assert.equal(app.run("storageStatus.writeError"), true);

  storage.failWrites = false;
  assert.equal(app.run("saveData()"), true);
  assert.equal(app.run("storageStatus.writeError"), false);
});

test("replaceAppData：写入失败时内存与本机存储都回滚到原数据", () => {
  const storage = createMemoryStorage();
  const app = loadApp({ storage });
  app.run("appData.stars = 7; saveData();");
  const before = storage.getItem(KEY);

  failingStorage(storage, (key) => key === KEY);
  assert.equal(app.run("var next = createDefaultData(); next.stars = 99; replaceAppData(next)"), false);
  assert.equal(app.run("appData.stars"), 7);
  assert.equal(storage.getItem(KEY), before);

  storage.failWrites = false;
  assert.equal(app.run("replaceAppData(next)"), true);
  assert.equal(app.run("appData.stars"), 99);
  assert.equal(JSON.parse(storage.getItem(KEY)).stars, 99);
});

test("多标签页：其他标签页写入的数据会被同步", () => {
  const storage = createMemoryStorage();
  const a = loadApp({ storage });
  const b = loadApp({ storage });
  a.run("appData.stars = 4; saveData();");
  assert.equal(b.run("syncFromStorage()"), "synced");
  assert.equal(b.run("appData.stars"), 4);
});

test("多标签页：其他标签页写入更新版本数据后，本页停止写入", () => {
  const storage = createMemoryStorage();
  const app = loadApp({ storage });
  const future = JSON.stringify({ schemaVersion: 3, stars: 1 });
  storage.setItem(KEY, future);

  assert.equal(app.run("syncFromStorage()"), "unsupported");
  assert.equal(app.run("storageStatus.writeLocked"), true);
  app.run("saveData()");
  assert.equal(storage.getItem(KEY), future);
});

test("多标签页：写入失败期间不从存储同步，避免丢掉尚未写入的修改", () => {
  const storage = failingStorage(createMemoryStorage(), (key) => key === KEY);
  const app = loadApp({ storage });
  app.run("appData.stars = 5; saveData();");
  assert.equal(app.run("syncFromStorage()"), "skipped");
  assert.equal(app.run("appData.stars"), 5);
});
