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

  return {
    duration: duration,
    status: status,
    startedAt: Number(session.startedAt) || Date.now(),
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

const storageStatus = {
  available: true,
  loadError: false,
  writeError: false,
  onWriteError: null
};

function getStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch (error) {
    return null;
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

  try {
    return migrateData(JSON.parse(saved));
  } catch (error) {
    console.error("读取本地数据失败：", error);
    storageStatus.loadError = true;
    // 保留损坏的原始数据，避免下一次保存时被静默覆盖
    try {
      storage.setItem(STORAGE_KEY + "_corrupt_" + Date.now(), saved);
    } catch (backupError) {
      console.error(backupError);
    }
    return createDefaultData();
  }
}

function saveData() {
  const storage = getStorage();
  if (!storage) return false;

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(appData));
    storageStatus.writeError = false;
    return true;
  } catch (error) {
    console.error("保存失败：", error);
    if (!storageStatus.writeError && typeof storageStatus.onWriteError === "function") {
      storageStatus.onWriteError(error);
    }
    storageStatus.writeError = true;
    return false;
  }
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
