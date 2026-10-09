/*
  数据层：读写 localStorage、v1 → v2 迁移（独立的 v2 键，见「持久化」）、刷新调度。
  不触碰 DOM，可在 Node 中直接测试（见 tests/）。

  v2 数据结构要点：
  - tasksByDay[YYYY-MM-DD]：每日御案，替代 v1 的全局 tasks
  - reviews[YYYY-MM-DD]：每日奏对，替代 v1 只有一份的 review
  - activeFocus：进行中的专注（按时间戳计时，刷新、锁屏不丢）
  - settings：外观与专注偏好
*/

const STORAGE_KEY = "starryStudyRoom_v2";
const LEGACY_STORAGE_KEY = "starryStudyRoom_v1";
const LEGACY_SEEN_KEY = "starryStudyRoom_v2_legacy_seen";
const THEME_HINT_KEY = "starryStudyRoom_theme";
const SCHEMA_VERSION = 2;

const PRACTICE_TYPES = ["calm", "discipline", "insight", "vision", "speech"];
const DISTRACTION_TYPES = ["hard", "phone", "tired", "start"];
const MISTAKE_REASONS = ["concept", "logic", "careless"];
const FOCUS_DURATIONS = [15, 25, 45, 60];
const THEME_PREFERENCES = ["auto", "day", "night"];

const DEFAULT_PRACTICE_TEXT = "今日修炼：说话前停一秒，不急着解释，不急着反驳。";

function createDefaultData() {
  return {
    schemaVersion: SCHEMA_VERSION,
    stars: 0,
    totalMinutes: 0,
    focusSessions: 0,
    seals: 0,
    currentPracticeType: "calm",
    currentPractice: DEFAULT_PRACTICE_TEXT,
    currentPracticeDone: false,
    practiceStats: { calm: 0, discipline: 0, insight: 0, vision: 0, speech: 0 },
    distractions: { hard: 0, phone: 0, tired: 0, start: 0 },
    mistakes: [],
    tasksByDay: {},
    reviews: {},
    dailyData: {},
    carryOverHandled: {},
    activeFocus: null,
    settings: { theme: "auto", focusNight: true, focusDuration: 25 }
  };
}

/* ---------- 工具 ---------- */

function dateKey(offset = 0, base = new Date()) {
  const date = new Date(base.getTime());
  date.setDate(date.getDate() + offset);

  return (
    date.getFullYear() +
    "-" +
    String(date.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getDate()).padStart(2, "0")
  );
}

function dateKeyFromISO(iso) {
  if (typeof iso !== "string" || !iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return dateKey(0, date);
}

function isDateKey(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function toText(value, maxLength = 2000) {
  if (value === null || value === undefined) return "";
  return String(value).slice(0, maxLength);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function createId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function safeId(value) {
  return typeof value === "string" && /^[\w-]{1,48}$/.test(value) ? value : createId();
}

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value).replace(/[&<>"']/g, function(ch) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
  });
}

/* ---------- 规范化 ---------- */

function normalizeTask(task) {
  if (!isPlainObject(task)) return null;
  const name = toText(task.name, 200).trim();
  if (!name) return null;

  return {
    id: safeId(task.id),
    name: name,
    goal: toText(task.goal, 200).trim(),
    done: task.done === true,
    createdAt: typeof task.createdAt === "string" ? task.createdAt : new Date().toISOString()
  };
}

function normalizeTaskList(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeTask).filter(Boolean);
}

function normalizeReview(review) {
  if (!isPlainObject(review)) return null;

  const entry = {
    done: toText(review.done).trim(),
    distraction: toText(review.distraction).trim(),
    restless: toText(review.restless).trim(),
    calm: toText(review.calm).trim(),
    tomorrow: toText(review.tomorrow).trim(),
    comment: toText(review.comment).trim(),
    updatedAt: typeof review.updatedAt === "string" ? review.updatedAt : ""
  };

  const hasContent = entry.done || entry.distraction || entry.restless || entry.calm || entry.tomorrow;
  return hasContent ? entry : null;
}

function normalizeMistake(item) {
  if (!isPlainObject(item)) return null;
  const title = toText(item.title, 200).trim();
  if (!title) return null;

  return {
    id: safeId(item.id),
    title: title,
    reason: MISTAKE_REASONS.includes(item.reason) ? item.reason : "concept",
    wrong: toText(item.wrong).trim(),
    correct: toText(item.correct).trim(),
    reviewed: item.reviewed === true,
    starRewarded: item.starRewarded === true,
    createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString()
  };
}

function normalizeDay(day) {
  const source = isPlainObject(day) ? day : {};
  return {
    minutes: toCount(source.minutes),
    sessions: toCount(source.sessions),
    practice: toCount(source.practice),
    review: source.review === true
  };
}

function normalizeCounts(source, keys) {
  const result = {};
  const from = isPlainObject(source) ? source : {};
  keys.forEach(function(key) {
    result[key] = toCount(from[key]);
  });
  return result;
}

function normalizeActiveFocus(session) {
  if (!isPlainObject(session)) return null;

  const duration = toCount(session.duration);
  if (duration < 1 || duration > 240) return null;

  const status = session.status === "paused" ? "paused" : "running";
  const totalMs = duration * 60000;
  const remainingMs = Math.min(totalMs, Math.max(0, Number(session.remainingMs) || 0));
  const endsAt = Number(session.endsAt);

  if (status === "running" && !Number.isFinite(endsAt)) return null;

  const startedAt = Number(session.startedAt) || Date.now();

  return {
    // 缺省 id 由 startedAt 推导，保证多个标签页读到同一会话时得到同一个 id
    id: typeof session.id === "string" && /^[\w-]{1,48}$/.test(session.id) ? session.id : "s" + startedAt.toString(36),
    dayKey: isDateKey(session.dayKey) ? session.dayKey : dateKey(0, new Date(startedAt)),
    duration: duration,
    status: status,
    startedAt: startedAt,
    endsAt: status === "running" ? endsAt : null,
    remainingMs: status === "paused" ? remainingMs : totalMs,
    taskId: typeof session.taskId === "string" && /^[\w-]{0,48}$/.test(session.taskId) ? session.taskId : "",
    ownerTab: typeof session.ownerTab === "string" && /^[\w-]{1,48}$/.test(session.ownerTab) ? session.ownerTab : ""
  };
}

function normalizeSettings(settings) {
  const source = isPlainObject(settings) ? settings : {};
  const duration = Number(source.focusDuration);

  return {
    theme: THEME_PREFERENCES.includes(source.theme) ? source.theme : "auto",
    focusNight: source.focusNight !== false,
    focusDuration: FOCUS_DURATIONS.includes(duration) ? duration : 25
  };
}

/* ---------- 迁移 ---------- */

function migrateData(raw, todayKey = dateKey()) {
  const data = createDefaultData();
  if (!isPlainObject(raw)) return data;

  data.stars = toCount(raw.stars);
  data.totalMinutes = toCount(raw.totalMinutes);
  data.focusSessions = toCount(raw.focusSessions);
  data.seals = toCount(raw.seals);

  data.currentPracticeType = PRACTICE_TYPES.includes(raw.currentPracticeType)
    ? raw.currentPracticeType
    : "calm";
  data.currentPractice =
    typeof raw.currentPractice === "string" && raw.currentPractice.trim()
      ? raw.currentPractice
      : DEFAULT_PRACTICE_TEXT;
  data.currentPracticeDone = raw.currentPracticeDone === true;

  data.practiceStats = normalizeCounts(raw.practiceStats, PRACTICE_TYPES);
  data.distractions = normalizeCounts(raw.distractions, DISTRACTION_TYPES);

  data.mistakes = Array.isArray(raw.mistakes)
    ? raw.mistakes.map(normalizeMistake).filter(Boolean)
    : [];

  if (isPlainObject(raw.dailyData)) {
    Object.keys(raw.dailyData).forEach(function(key) {
      if (isDateKey(key)) data.dailyData[key] = normalizeDay(raw.dailyData[key]);
    });
  }

  if (isPlainObject(raw.tasksByDay)) {
    Object.keys(raw.tasksByDay).forEach(function(key) {
      if (!isDateKey(key)) return;
      const list = normalizeTaskList(raw.tasksByDay[key]);
      if (list.length) data.tasksByDay[key] = list;
    });
  }

  // v1 的 tasks 没有日期归属，用户认知里它们就是"当前任务"，统一并入今日
  const legacyTasks = normalizeTaskList(raw.tasks);
  if (legacyTasks.length) {
    data.tasksByDay[todayKey] = (data.tasksByDay[todayKey] || []).concat(legacyTasks);
  }

  if (isPlainObject(raw.reviews)) {
    Object.keys(raw.reviews).forEach(function(key) {
      if (!isDateKey(key)) return;
      const entry = normalizeReview(raw.reviews[key]);
      if (entry) data.reviews[key] = entry;
    });
  }

  const legacyReview = normalizeReview(raw.review);
  if (legacyReview) {
    const key = dateKeyFromISO(legacyReview.updatedAt) || todayKey;
    if (!data.reviews[key]) data.reviews[key] = legacyReview;
  }

  if (isPlainObject(raw.carryOverHandled)) {
    Object.keys(raw.carryOverHandled).forEach(function(key) {
      if (isDateKey(key) && raw.carryOverHandled[key] === true) data.carryOverHandled[key] = true;
    });
  }

  data.activeFocus = normalizeActiveFocus(raw.activeFocus);
  data.settings = normalizeSettings(raw.settings);

  return data;
}

/* ---------- 持久化 ---------- */

/*
  键分离：v2 只读写 STORAGE_KEY（starryStudyRoom_v2）。
  v1 的 starryStudyRoom_v1 只在 v2 键不存在时读取一次用于迁移，此后 v2 永不写入它：
  - 仍在运行的旧版页面（或长期未刷新的旧版 PWA）只会写自己的键，无法覆盖 v2 数据
  - v1 键原样保留，可作为迁移前数据的恢复来源，回退到旧版本时也仍可读
  迁移后旧版页面若又写入了 v1 键，会通过指纹（LEGACY_SEEN_KEY）发现并提示用户下载，但不自动合并。

  storageStatus.issue：
  - "corrupt"           原始数据无法解析，已另存到 backupKey，可继续使用
  - "corrupt-unsaved"   无法解析且另存失败：锁定写入，直到用户下载原始数据并明确放弃
  - "unsupported"       schemaVersion 来自更新版本或无法识别：只读，避免降级覆盖
  - "external-future"   运行中其他标签页写入了更新版本的数据：只读，需刷新
  - "legacy-corrupt"    待迁移的 v1 数据无法解析：v1 键保持原样，以空白档案运行
  - "legacy-changed"    迁移后旧版页面又写入了 v1 键：v2 数据未受影响，旧版写入可下载
  writeLocked 为 true 时 saveData() 一律不写入。rawSnapshot 是原始字符串，供用户下载恢复。
*/
const storageStatus = {
  available: true,
  issue: null,
  writeLocked: false,
  rawSnapshot: null,
  backupKey: null,
  writeError: false,
  onWriteError: null,
  onIssue: null,
  onPersistBlocked: null
};

/* 本页最近一次读到或写入的 v2 原文，用来判断其他标签页是否已写入更新的数据 */
let lastKnownRaw = null;

function getStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch (error) {
    return null;
  }
}

function readKey(storage, key) {
  try {
    return storage.getItem(key);
  } catch (error) {
    return null;
  }
}

function setStorageIssue(issue, details = {}) {
  storageStatus.issue = issue;
  if (details.lock) storageStatus.writeLocked = true;
  if (details.raw !== undefined) storageStatus.rawSnapshot = details.raw;
  if (details.backupKey !== undefined) storageStatus.backupKey = details.backupKey;
  if (typeof storageStatus.onIssue === "function") storageStatus.onIssue(issue);
}

/* "legacy"：v1（无 schemaVersion）；"current"：本版本；"unsupported"：更新版本或无法识别 */
function classifySchema(raw) {
  if (!isPlainObject(raw) || raw.schemaVersion === undefined) return "legacy";
  if (raw.schemaVersion === 1) return "legacy";
  if (raw.schemaVersion === SCHEMA_VERSION) return "current";
  return "unsupported";
}

/* 只有写入后能原样读回才算写入成功 */
function writeVerified(storage, key, value) {
  try {
    storage.setItem(key, value);
    return storage.getItem(key) === value;
  } catch (error) {
    return false;
  }
}

function parseObject(text) {
  try {
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : null;
  } catch (error) {
    return null;
  }
}

/* ---------- 旧版键指纹 ---------- */

/* 长度 + FNV-1a，足以判断旧版页面是否改写过 v1 键，不必再存一份全文 */
function fingerprint(text) {
  if (text === null || text === undefined) return "none";
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return text.length + ":" + hash.toString(16);
}

function markLegacySeen(storage = getStorage()) {
  if (!storage || storageStatus.writeLocked) return false;
  return writeVerified(storage, LEGACY_SEEN_KEY, fingerprint(readKey(storage, LEGACY_STORAGE_KEY)));
}

/*
  迁移后旧版页面又写入了 v1 键时返回 true 并给出提示。
  只提示、不合并：旧版写入基于迁移前的数据，自动合并可能把已删除的记录带回来或重复计数。
*/
function checkLegacyChanges() {
  const storage = getStorage();
  if (!storage || storageStatus.issue) return false;

  const seen = readKey(storage, LEGACY_SEEN_KEY);
  const raw = readKey(storage, LEGACY_STORAGE_KEY);
  if (seen === null) {
    // 迁移时 v1 数据无法解析：提示保持到用户确认为止
    if (raw !== null && !parseObject(raw)) {
      setStorageIssue("legacy-corrupt", { raw: raw });
      return true;
    }
    markLegacySeen(storage);
    return false;
  }
  if (seen === fingerprint(raw) || raw === null) return false;

  setStorageIssue("legacy-changed", { raw: raw });
  return true;
}

/* 用户已下载或确认知晓旧版写入后调用，同一份旧版数据不再重复提示 */
function acknowledgeLegacyChanges() {
  markLegacySeen();
  if (storageStatus.issue === "legacy-changed" || storageStatus.issue === "legacy-corrupt") {
    storageStatus.issue = null;
  }
}

/* ---------- 读取 ---------- */

/* v2 键不存在时：从 v1 键迁移一次。v1 键只读，不修改也不删除 */
function loadFromLegacy(storage) {
  const legacy = readKey(storage, LEGACY_STORAGE_KEY);
  if (!legacy) {
    markLegacySeen(storage);
    return createDefaultData();
  }

  const parsed = parseObject(legacy);
  if (!parsed) {
    setStorageIssue("legacy-corrupt", { raw: legacy });
    return createDefaultData();
  }

  if (classifySchema(parsed) === "unsupported") {
    setStorageIssue("unsupported", { raw: legacy, lock: true });
    return migrateData(parsed);
  }

  const data = migrateData(parsed);
  const serialized = JSON.stringify(data);
  // 写入失败不影响本次使用：v1 键原样保留，下次打开会再次迁移
  if (writeVerified(storage, STORAGE_KEY, serialized)) {
    lastKnownRaw = serialized;
    markLegacySeen(storage);
  } else {
    console.warn("未能写入迁移后的数据，v1 原始数据保持不变");
  }
  return data;
}

function loadData() {
  const storage = getStorage();

  if (!storage) {
    storageStatus.available = false;
    return createDefaultData();
  }

  let saved = null;
  try {
    saved = storage.getItem(STORAGE_KEY);
  } catch (error) {
    storageStatus.available = false;
    return createDefaultData();
  }

  if (!saved) return loadFromLegacy(storage);

  const parsed = parseObject(saved);
  if (!parsed) {
    const backupKey = STORAGE_KEY + "_corrupt_" + Date.now();
    if (writeVerified(storage, backupKey, saved)) {
      setStorageIssue("corrupt", { raw: saved, backupKey: backupKey });
    } else {
      setStorageIssue("corrupt-unsaved", { raw: saved, lock: true });
    }
    return createDefaultData();
  }

  if (classifySchema(parsed) === "unsupported") {
    setStorageIssue("unsupported", { raw: saved, lock: true });
    return migrateData(parsed);
  }

  lastKnownRaw = saved;
  checkLegacyChanges();
  return migrateData(parsed);
}

/* ---------- 写入 ---------- */

function canPersist() {
  return storageStatus.available && !storageStatus.writeLocked;
}

function saveData(options = {}) {
  if (storageStatus.writeLocked) return false;

  const storage = getStorage();
  if (!storage) return false;

  try {
    const serialized = JSON.stringify(appData);
    storage.setItem(STORAGE_KEY, serialized);
    lastKnownRaw = serialized;
    storageStatus.writeError = false;
    return true;
  } catch (error) {
    console.error("保存失败：", error);
    if (!options.quiet && !storageStatus.writeError && typeof storageStatus.onWriteError === "function") {
      storageStatus.onWriteError(error);
    }
    storageStatus.writeError = true;
    return false;
  }
}

function notifyPersistBlocked(reason) {
  if (typeof storageStatus.onPersistBlocked === "function") storageStatus.onPersistBlocked(reason);
}

/*
  所有会写入数据的用户操作都经由这里：
  1. 只读保护或存储不可用时直接拒绝，并通过 onPersistBlocked 告知用户
  2. 其他标签页写入过更新的数据时先同步，再在最新数据上修改（避免用过期副本覆盖）
  3. mutate() 返回 false 表示放弃本次修改（例如会话已在其他标签页结束），不写入
  4. 写入失败时把内存回滚到修改前，界面不会显示未保存的结果
  返回 true 才代表已保存，调用方只在此时给出成功提示。
*/
function persistChange(mutate, options = {}) {
  if (!canPersist()) {
    notifyPersistBlocked(storageStatus.available ? "readonly" : "unavailable");
    return false;
  }

  syncIfChanged();
  if (!canPersist()) {
    notifyPersistBlocked("readonly");
    return false;
  }

  const before = JSON.stringify(appData);
  if (mutate() === false) {
    appData = migrateData(JSON.parse(before));
    return false;
  }

  if (saveData({ quiet: true })) return true;

  appData = migrateData(JSON.parse(before));
  storageStatus.writeError = false;
  if (!options.quiet) notifyPersistBlocked("write-failed");
  return false;
}

/*
  外观偏好：只读保护时仍在本页生效（不影响数据安全），但不写入，并提示一次。
*/
let preferenceNoticeShown = false;
function persistPreference(mutate) {
  if (canPersist()) return persistChange(mutate);

  mutate();
  if (!preferenceNoticeShown) {
    preferenceNoticeShown = true;
    notifyPersistBlocked("readonly-preference");
  }
  return false;
}

/* 整体替换数据（导入、清空）：写入失败时回滚内存，本机存储保持原样 */
function replaceAppData(next) {
  if (storageStatus.writeLocked) return false;

  const previous = appData;
  appData = next;
  if (saveData({ quiet: true })) return true;

  appData = previous;
  return false;
}

/* 用户已下载原始数据并确认放弃后，才允许解除 corrupt-unsaved 的写入锁 */
function releaseCorruptLock() {
  if (storageStatus.issue !== "corrupt-unsaved") return false;

  storageStatus.writeLocked = false;
  if (saveData({ quiet: true })) {
    storageStatus.issue = null;
    return true;
  }
  storageStatus.writeLocked = true;
  return false;
}

/* ---------- 备份文件校验 ---------- */

const BACKUP_APP_NAME = "星辰御书房";
const BACKUP_MAX_BYTES = 5 * 1024 * 1024;
const BACKUP_SIGNATURE_KEYS = [
  "schemaVersion", "stars", "totalMinutes", "focusSessions", "seals", "practiceStats",
  "distractions", "tasks", "tasksByDay", "mistakes", "review", "reviews", "dailyData"
];
const BACKUP_FIELD_SHAPES = {
  tasks: "array",
  mistakes: "array",
  tasksByDay: "object",
  reviews: "object",
  review: "object",
  dailyData: "object",
  practiceStats: "object",
  distractions: "object",
  settings: "object",
  stars: "count",
  totalMinutes: "count",
  focusSessions: "count",
  seals: "count"
};

function matchesShape(value, shape) {
  if (value === null || value === undefined) return true;
  if (shape === "array") return Array.isArray(value);
  if (shape === "object") return isPlainObject(value);
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/* 返回 { ok: true, data, hasSettings } 或 { ok: false, error } */
function parseBackupText(text) {
  const fail = function(error) {
    return { ok: false, error: error };
  };

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return fail("文件不是有效的 JSON。");
  }
  if (!isPlainObject(parsed)) return fail("文件内容不是星辰御书房的备份。");

  let raw = parsed;
  if ("appName" in parsed || "data" in parsed) {
    if (parsed.appName !== BACKUP_APP_NAME || !isPlainObject(parsed.data)) {
      return fail("这不是星辰御书房导出的备份文件。");
    }
    if (parsed.schemaVersion !== undefined && classifySchema({ schemaVersion: parsed.schemaVersion }) === "unsupported") {
      return fail("这份备份来自更新的版本，请先刷新到最新版本再导入。");
    }
    raw = parsed.data;
  }

  if (classifySchema(raw) === "unsupported") {
    return fail("这份备份来自更新的版本或版本无法识别，当前版本无法安全导入。");
  }
  if (!BACKUP_SIGNATURE_KEYS.some(function(key) {
    return key in raw;
  })) {
    return fail("文件中没有可识别的星辰御书房数据。");
  }

  const badField = Object.keys(BACKUP_FIELD_SHAPES).find(function(key) {
    return !matchesShape(raw[key], BACKUP_FIELD_SHAPES[key]);
  });
  if (badField) return fail("备份中的「" + badField + "」字段格式不正确，文件可能已损坏。");

  return { ok: true, data: migrateData(raw), hasSettings: isPlainObject(raw.settings) };
}

/* ---------- 多标签页 ---------- */

/*
  标签页标识存于 sessionStorage：刷新后不变，各标签页互不相同（「复制标签页」会复制 sessionStorage，两页同号）。
  专注会话记录入座 / 继续时的标签页，计时到点后由它结算；其他标签页只在宽限期后代为结算。
*/
const TAB_ID_KEY = "starryStudyRoom_tab";
const FOCUS_SETTLE_GRACE_MS = 5000;
const TAB_ID = (function() {
  try {
    const existing = sessionStorage.getItem(TAB_ID_KEY);
    if (existing && /^[\w-]{1,48}$/.test(existing)) return existing;
    const id = "t" + createId();
    sessionStorage.setItem(TAB_ID_KEY, id);
    return id;
  } catch (error) {
    return "t" + createId();
  }
})();

/* 到点后是否由本页结算：本页入座、会话无归属，或归属页超过宽限期仍未结算（已关闭或被冻结） */
function shouldSettleHere(session, now = Date.now()) {
  if (!session || session.status !== "running") return false;
  if (!session.ownerTab || session.ownerTab === TAB_ID) return true;
  return now >= session.endsAt + FOCUS_SETTLE_GRACE_MS;
}

/*
  用本机存储中的最新数据替换内存副本，供其他标签页写入后同步、以及写入前确认基于最新数据。
  返回 "synced" | "skipped" | "unsupported"。
  写入失败期间跳过同步，以免丢掉尚未写入的内存修改。
*/
function syncFromStorage() {
  if (storageStatus.writeLocked || storageStatus.writeError) return "skipped";

  const storage = getStorage();
  if (!storage) return "skipped";

  const saved = readKey(storage, STORAGE_KEY);
  if (!saved) return "skipped";

  const parsed = parseObject(saved);
  if (!parsed) return "skipped";

  if (classifySchema(parsed) === "unsupported") {
    setStorageIssue("external-future", { raw: saved, lock: true });
    return "unsupported";
  }

  appData = migrateData(parsed);
  lastKnownRaw = saved;
  return "synced";
}

/* 只有存储中的原文与本页最后一次读写的不同（其他标签页写过）时才同步 */
function syncIfChanged() {
  const storage = getStorage();
  if (!storage) return "skipped";
  const saved = readKey(storage, STORAGE_KEY);
  if (saved === lastKnownRaw) return "unchanged";
  return syncFromStorage();
}
let appData = loadData();

/* ---------- 刷新调度 ---------- */

const renderers = [];
let renderQueued = false;

function registerRenderer(fn) {
  renderers.push(fn);
}

function renderAllNow() {
  renderQueued = false;
  renderers.forEach(function(fn) {
    try {
      fn();
    } catch (error) {
      console.error("渲染失败：", error);
    }
  });
}

function refreshAll() {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(renderAllNow);
}

/* ---------- 读取助手 ---------- */

function ensureDay(key = dateKey()) {
  if (!appData.dailyData[key]) {
    appData.dailyData[key] = normalizeDay(null);
  }
  return appData.dailyData[key];
}

function peekDay(key = dateKey()) {
  return appData.dailyData[key] || normalizeDay(null);
}

function getTasksFor(key = dateKey()) {
  return appData.tasksByDay[key] || [];
}

function ensureTasksFor(key = dateKey()) {
  if (!appData.tasksByDay[key]) appData.tasksByDay[key] = [];
  return appData.tasksByDay[key];
}

function findTodayTask(id) {
  return getTasksFor().find(function(task) {
    return task.id === id;
  }) || null;
}

/* 绑定的御案先在入座当天查找；若已被结转到今日，再查今日 */
function findSessionTask(session, todayKey = dateKey()) {
  if (!session || !session.taskId) return null;
  const keys = session.dayKey === todayKey ? [todayKey] : [session.dayKey, todayKey];

  for (let i = 0; i < keys.length; i++) {
    const task = getTasksFor(keys[i]).find(function(item) {
      return item.id === session.taskId;
    });
    if (task) return task;
  }
  return null;
}

/*
  跨日归属：一轮专注的分钟、轮数（及星辰所在的日统计）记在「入座当天」(session.dayKey)，
  与绑定御案的日期一致；跨过午夜或离开数日后才结算，也不会改记到结算日。
*/
function creditFocus(session, minutes, lightStar) {
  const day = ensureDay(session.dayKey || dateKey());
  appData.totalMinutes += minutes;
  appData.focusSessions += 1;
  day.minutes += minutes;
  day.sessions += 1;
  if (lightStar) appData.stars += 1;
}
