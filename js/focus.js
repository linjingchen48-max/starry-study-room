/*
  御书房：刻度计时盘、按时间戳计时（刷新、锁屏、切后台都不丢）、提前收卷、朕心浮动。
  星辰只为完整一轮点亮；提前收卷只记录实际分钟。
*/

const DIAL_RADIUS = 128;
const DIAL_CIRCUMFERENCE = 2 * Math.PI * DIAL_RADIUS;

let focusTicker = null;
let focusMessage = "";
let focusTargetId = "";
let wakeLock = null;

function isFocusSessionActive() {
  return Boolean(appData.activeFocus);
}

function getSelectedDuration() {
  return appData.activeFocus ? appData.activeFocus.duration : appData.settings.focusDuration;
}

function getFocusRemainingMs(now = Date.now()) {
  const session = appData.activeFocus;
  if (!session) return appData.settings.focusDuration * 60000;
  if (session.status === "running") return Math.max(0, session.endsAt - now);
  return session.remainingMs;
}

function getFocusElapsedMinutes(now = Date.now()) {
  const session = appData.activeFocus;
  if (!session) return 0;
  return Math.floor((session.duration * 60000 - getFocusRemainingMs(now)) / 60000);
}

function formatClock(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  return (
    String(Math.floor(totalSeconds / 60)).padStart(2, "0") + ":" + String(totalSeconds % 60).padStart(2, "0")
  );
}

/* ---------- 计时盘 ---------- */

function buildDial() {
  const ticks = document.getElementById("dialTicks");
  let html = "";

  for (let i = 0; i < 60; i++) {
    const major = i % 5 === 0;
    const angle = (i / 60) * Math.PI * 2 - Math.PI / 2;
    const r1 = major ? 106 : 110;
    const r2 = 116;
    html +=
      '<line class="dial-tick' + (major ? " is-major" : "") + '" x1="' + (150 + Math.cos(angle) * r1).toFixed(2) +
      '" y1="' + (150 + Math.sin(angle) * r1).toFixed(2) +
      '" x2="' + (150 + Math.cos(angle) * r2).toFixed(2) +
      '" y2="' + (150 + Math.sin(angle) * r2).toFixed(2) + '"></line>';
  }

  ticks.innerHTML = html;

  const progress = document.getElementById("dialProgress");
  progress.setAttribute("stroke-dasharray", DIAL_CIRCUMFERENCE.toFixed(2));
}

/* ---------- 渲染 ---------- */

function getFocusTargetTask() {
  const id = appData.activeFocus ? appData.activeFocus.taskId : focusTargetId;
  return id ? findTodayTask(id) : null;
}

function renderFocusTaskOptions() {
  const select = document.getElementById("focusTaskSelect");
  const hint = document.getElementById("focusTaskHint");
  const tasks = getTasksFor().filter(function(task) {
    return !task.done;
  });

  if (!appData.activeFocus && focusTargetId && !tasks.some(function(task) {
    return task.id === focusTargetId;
  })) {
    focusTargetId = "";
  }

  if (!appData.activeFocus && !focusTargetId && tasks.length) {
    focusTargetId = tasks[0].id;
  }

  const selected = appData.activeFocus ? appData.activeFocus.taskId : focusTargetId;

  select.innerHTML =
    '<option value="">不指定目标</option>' +
    tasks
      .map(function(task) {
        return '<option value="' + escapeHtml(task.id) + '"' + (task.id === selected ? " selected" : "") + ">" + escapeHtml(task.name) + "</option>";
      })
      .join("");

  select.disabled = isFocusSessionActive();
  hint.hidden = tasks.length > 0;
}

function renderFocusStatic() {
  const active = isFocusSessionActive();
  const duration = getSelectedDuration();

  document.querySelectorAll('input[name="focusDuration"]').forEach(function(input) {
    input.checked = Number(input.value) === duration;
    input.disabled = active;
  });

  document.getElementById("durationCaption").textContent = duration + " 分钟 · " + (FOCUS_DURATION_NAMES[duration] || "专注");

  renderFocusTaskOptions();

  const task = getFocusTargetTask();
  document.getElementById("focusTarget").textContent = task ? task.name : "未指定目标";

  updateFocusView();
}

function updateFocusView() {
  const session = appData.activeFocus;
  const remaining = getFocusRemainingMs();
  const total = getSelectedDuration() * 60000;
  const ratio = session ? 1 - remaining / total : 0;

  document.getElementById("focusClock").textContent = formatClock(remaining);
  document.getElementById("dialProgress").setAttribute("stroke-dashoffset", (DIAL_CIRCUMFERENCE * (1 - ratio)).toFixed(2));

  const stage = document.getElementById("focusStage");
  stage.classList.toggle("is-running", Boolean(session && session.status === "running"));
  stage.classList.toggle("is-paused", Boolean(session && session.status === "paused"));

  const primary = document.getElementById("focusPrimary");
  if (!session) {
    primary.innerHTML = icon("play") + "<span>入座</span>";
    primary.setAttribute("aria-label", "入座，开始专注");
  } else if (session.status === "running") {
    primary.innerHTML = icon("pause") + "<span>暂停</span>";
    primary.setAttribute("aria-label", "暂停专注");
  } else {
    primary.innerHTML = icon("play") + "<span>继续</span>";
    primary.setAttribute("aria-label", "继续专注");
  }

  document.getElementById("focusReset").disabled = !session;
  document.getElementById("focusFinish").disabled = !session;

  let status = focusMessage || "尚未入座";
  if (session && session.status === "running") status = "御书房已入座。此刻只做眼前一件事。";
  if (session && session.status === "paused") status = "已暂停。可短歇，但不要离席太久。";

  const statusEl = document.getElementById("focusStatus");
  if (statusEl.textContent !== status) statusEl.textContent = status;

  updateFocusTitle();
}

function updateFocusTitle() {
  const session = appData.activeFocus;
  if (session) {
    const prefix = session.status === "paused" ? "已暂停 " : "";
    document.title = prefix + formatClock(getFocusRemainingMs()) + " · 御书房";
  } else {
    document.title = baseDocumentTitle();
  }
}

/* ---------- 计时 ---------- */

function startTicker() {
  stopTicker();
  focusTicker = setInterval(tick, 250);
}

function stopTicker() {
  clearInterval(focusTicker);
  focusTicker = null;
}

function tick() {
  const session = appData.activeFocus;
  if (!session || session.status !== "running") {
    stopTicker();
    return;
  }
  if (getFocusRemainingMs() <= 0) {
    completeFocus();
    return;
  }
  updateFocusView();
}

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator && document.visibilityState === "visible") {
      wakeLock = await navigator.wakeLock.request("screen");
    }
  } catch (error) {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(function() {});
    wakeLock = null;
  }
}

function setFocusTarget(id) {
  if (isFocusSessionActive()) return;
  focusTargetId = id || "";
  refreshAll();
}

function startFocus() {
  const now = Date.now();
  const duration = appData.settings.focusDuration;

  appData.activeFocus = {
    duration: duration,
    status: "running",
    startedAt: now,
    endsAt: now + duration * 60000,
    remainingMs: duration * 60000,
    taskId: focusTargetId
  };

  focusMessage = "";
  resetFocusNightSuppression();
  saveData();
  applyTheme();
  startTicker();
  requestWakeLock();
  refreshAll();
}

function pauseFocus() {
  const session = appData.activeFocus;
  if (!session || session.status !== "running") return;

  session.remainingMs = Math.max(0, session.endsAt - Date.now());
  session.endsAt = null;
  session.status = "paused";

  stopTicker();
  releaseWakeLock();
  commit();
}

function resumeFocus() {
  const session = appData.activeFocus;
  if (!session || session.status !== "paused") return;

  session.endsAt = Date.now() + session.remainingMs;
  session.status = "running";

  startTicker();
  requestWakeLock();
  commit();
}

function toggleFocus() {
  const session = appData.activeFocus;
  if (!session) startFocus();
  else if (session.status === "running") pauseFocus();
  else resumeFocus();
}

function endFocusSession(message) {
  appData.activeFocus = null;
  focusMessage = message;
  stopTicker();
  releaseWakeLock();
  resetFocusNightSuppression();
  saveData();
  applyTheme();
  refreshAll();
}

async function resetFocus() {
  if (!appData.activeFocus) return;

  const elapsed = getFocusElapsedMinutes();
  if (elapsed >= 1) {
    const ok = await confirmAction({
      title: "放弃本轮专注？",
      body: "已专注 " + elapsed + " 分钟，重置后不会被记录。若想保留这段时间，请选择「提前收卷」。",
      confirmLabel: "放弃本轮",
      danger: true
    });
    if (!ok) return;
  }

  endFocusSession("已重置。重新入座即可。");
}

function recordFocus(minutes, lightStar) {
  const today = ensureDay();
  appData.totalMinutes += minutes;
  appData.focusSessions += 1;
  today.minutes += minutes;
  today.sessions += 1;
  if (lightStar) appData.stars += 1;
}

function completeFocus(options = {}) {
  const session = appData.activeFocus;
  if (!session) return;

  const task = session.taskId ? findTodayTask(session.taskId) : null;
  recordFocus(session.duration, true);
  endFocusSession("本轮专注完成。星辰已点亮。");

  if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate([60, 80, 60]);

  const message = options.whileAway
    ? "离开期间，本轮 " + session.duration + " 分钟专注已完成，星辰已点亮。"
    : "本轮专注完成，点亮一颗星辰。";

  if (task && !task.done) {
    showToast(message, {
      type: "star",
      actionLabel: "勾选「" + (task.name.length > 6 ? task.name.slice(0, 6) + "…" : task.name) + "」",
      onAction: function() {
        task.done = true;
        commit();
      }
    });
  } else {
    showToast(message, { type: "star" });
  }
}

async function finishFocusEarly() {
  const session = appData.activeFocus;
  if (!session) return;

  const wasRunning = session.status === "running";
  const elapsed = getFocusElapsedMinutes();

  if (elapsed < 1) {
    showToast("未满 1 分钟，无可记录。若想重来，可直接重置。");
    return;
  }

  const ok = await confirmAction({
    title: "提前收卷？",
    body: "将记录 " + elapsed + " 分钟专注。星辰只为完整一轮点亮，本轮不会点亮星辰。",
    confirmLabel: "收卷"
  });

  if (!ok || !appData.activeFocus) return;
  if (wasRunning && appData.activeFocus.status === "running" && getFocusRemainingMs() <= 0) {
    completeFocus();
    return;
  }

  recordFocus(elapsed, false);
  endFocusSession("已收卷，记录 " + elapsed + " 分钟。");
  showToast("已收卷，记录 " + elapsed + " 分钟专注。", { type: "success" });
}

function restoreFocusSession() {
  const session = appData.activeFocus;
  if (!session) return;

  if (session.status === "running") {
    if (getFocusRemainingMs() <= 0) {
      completeFocus({ whileAway: true });
    } else {
      startTicker();
      requestWakeLock();
    }
  }
}

/* ---------- 朕心浮动 ---------- */

function recordDistraction(type) {
  const info = DISTRACTIONS[type];
  if (!info) return;

  appData.distractions[type] = toCount(appData.distractions[type]) + 1;
  commit();

  const advice = document.getElementById("adviceText");
  advice.textContent = info.advice;
  document.getElementById("adviceBox").classList.add("is-active");

  showToast("已记入分心档案：" + info.label, {
    actionLabel: "撤销",
    onAction: function() {
      appData.distractions[type] = Math.max(0, toCount(appData.distractions[type]) - 1);
      commit();
    }
  });
}

/* ---------- 事件 ---------- */

document.getElementById("focusPrimary").addEventListener("click", toggleFocus);
document.getElementById("focusReset").addEventListener("click", resetFocus);
document.getElementById("focusFinish").addEventListener("click", finishFocusEarly);

document.querySelectorAll('input[name="focusDuration"]').forEach(function(input) {
  input.addEventListener("change", function() {
    if (isFocusSessionActive()) return;
    appData.settings.focusDuration = Number(input.value);
    focusMessage = "已切换为 " + input.value + " 分钟专注。";
    commit();
  });
});

document.getElementById("focusTaskSelect").addEventListener("change", function(event) {
  setFocusTarget(event.target.value);
});

document.getElementById("distractionChips").addEventListener("click", function(event) {
  const chip = event.target.closest("[data-distraction]");
  if (chip) recordDistraction(chip.dataset.distraction);
});

document.addEventListener("visibilitychange", function() {
  if (document.visibilityState !== "visible") return;
  const session = appData.activeFocus;
  if (session && session.status === "running") {
    tick();
    if (appData.activeFocus) requestWakeLock();
  }
});

buildDial();
registerRenderer(renderFocusStatic);
