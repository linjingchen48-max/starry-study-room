/*
  数据层：读写 localStorage、v1 → v2 迁移、刷新调度。
  不触碰 DOM，可在 Node 中直接测试（见 tests/）。

  v2 数据结构要点：
  - tasksByDay[YYYY-MM-DD]：每日御案，替代 v1 的全局 tasks
  - reviews[YYYY-MM-DD]：每日奏对，替代 v1 只有一份的 review
  - activeFocus：进行中的专注（按时间戳计时，刷新、锁屏不丢）
  - settings：外观与专注偏好
*/

const STORAGE_KEY = "starryStudyRoom_v1";
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
    taskId: typeof session.taskId === "string" && /^[\w-]{0,48}$/.test(session.taskId) ? session.taskId : ""
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
  storageStatus.issue：
  - "corrupt"           原始数据无法解析，已另存到 backupKey，可继续使用
  - "corrupt-unsaved"   无法解析且另存失败：锁定写入，直到用户下载原始数据并明确放弃
  - "unsupported"       schemaVersion 来自更新版本或无法识别：只读，避免降级覆盖
  - "external-future"   运行中其他标签页写入了更新版本的数据：只读，需刷新
  - "external-legacy"   运行中旧版页面写入了 v1 数据：已用本页数据恢复，需关闭旧页面
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
  onIssue: null
};

const LEGACY_BACKUP_KEY = STORAGE_KEY + "_pre_v2_backup";

function getStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
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

/* 只有写入后能原样读回才算备份成功 */
function writeVerified(storage, key, value) {
  try {
    storage.setItem(key, value);
    return storage.getItem(key) === value;
  } catch (error) {
    return false;
  }
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

  if (!saved) return createDefaultData();

  let parsed;
  try {
    parsed = JSON.parse(saved);
  } catch (error) {
    parsed = undefined;
  }

  if (!isPlainObject(parsed)) {
    const backupKey = STORAGE_KEY + "_corrupt_" + Date.now();
    if (writeVerified(storage, backupKey, saved)) {
      setStorageIssue("corrupt", { raw: saved, backupKey: backupKey });
    } else {
      setStorageIssue("corrupt-unsaved", { raw: saved, lock: true });
    }
    return createDefaultData();
  }

  const schema = classifySchema(parsed);

  if (schema === "unsupported") {
    setStorageIssue("unsupported", { raw: saved, lock: true });
    return migrateData(parsed);
  }

  // 首次升级前保留一份 v1 原文；失败不阻塞（迁移不丢弃 v1 已有字段）
  if (schema === "legacy" && storage.getItem(LEGACY_BACKUP_KEY) === null) {
    if (!writeVerified(storage, LEGACY_BACKUP_KEY, saved)) console.warn("未能保留 v1 原始数据备份");
  }

  return migrateData(parsed);
}

function saveData(options = {}) {
  if (storageStatus.writeLocked) return false;

  const storage = getStorage();
  if (!storage) return false;

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(appData));
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
  用本机存储中的最新数据替换内存副本，供其他标签页写入后同步、以及结算前确认会话仍有效。
  返回 "synced" | "skipped" | "legacy" | "unsupported"。
  写入失败期间跳过同步，以免丢掉尚未写入的内存修改。
*/
function syncFromStorage() {
  if (storageStatus.writeLocked || storageStatus.writeError) return "skipped";

  const storage = getStorage();
  if (!storage) return "skipped";

  let saved = null;
  try {
    saved = storage.getItem(STORAGE_KEY);
  } catch (error) {
    return "skipped";
  }
  if (!saved) return "skipped";

  let parsed;
  try {
    parsed = JSON.parse(saved);
  } catch (error) {
    return "skipped";
  }
  if (!isPlainObject(parsed)) return "skipped";

  const schema = classifySchema(parsed);
  if (schema === "unsupported") {
    setStorageIssue("external-future", { raw: saved, lock: true });
    return "unsupported";
  }
  if (schema === "legacy") {
    // 旧版页面写入的 v1 数据会丢掉按日历史，立即用本页的 v2 数据恢复
    saveData();
    setStorageIssue("external-legacy", { raw: saved });
    return "legacy";
  }

  appData = migrateData(parsed);
  return "synced";
}

/* 结算前调用：只有存储中的进行中会话仍是这一轮时才可结算，防止多个标签页重复发放奖励 */
function claimFocusSession(sessionId) {
  syncFromStorage();
  return Boolean(appData.activeFocus && appData.activeFocus.id === sessionId);
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

function commit() {
  saveData();
  refreshAll();
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
