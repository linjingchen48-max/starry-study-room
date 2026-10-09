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
let focusSettling = false;

function isFocusSessionActive() {
  return Boolean(appData.activeFocus);
}

function getSelectedDuration() {
  return appData.activeFocus ? appData.activeFocus.duration : appData.settings.focusDuration;
}

function getSessionRemainingMs(session, now = Date.now()) {
  if (session.status === "running") return Math.max(0, session.endsAt - now);
  return session.remainingMs;
}

function getSessionElapsedMinutes(session, now = Date.now()) {
  return Math.floor((session.duration * 60000 - getSessionRemainingMs(session, now)) / 60000);
}

function getFocusRemainingMs(now = Date.now()) {
  const session = appData.activeFocus;
  if (!session) return appData.settings.focusDuration * 60000;
  return getSessionRemainingMs(session, now);
}

function getFocusElapsedMinutes(now = Date.now()) {
  const session = appData.activeFocus;
  if (!session) return 0;
  return getSessionElapsedMinutes(session, now);
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
  if (appData.activeFocus) return findSessionTask(appData.activeFocus);
  return focusTargetId ? findTodayTask(focusTargetId) : null;
}

function renderFocusTaskOptions() {
  const select = document.getElementById("focusTaskSelect");
  const hint = document.getElementById("focusTaskHint");
  let tasks = getTasksFor().filter(function(task) {
    return !task.done;
  });

  const boundTask = appData.activeFocus ? findSessionTask(appData.activeFocus) : null;
  if (boundTask && !tasks.includes(boundTask)) tasks = [boundTask].concat(tasks);

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
  const ok = persistChange(function() {
    // 其他标签页可能已入座：同步后发现已有会话则放弃，改为显示那一轮
    if (appData.activeFocus) return false;
    const duration = appData.settings.focusDuration;
    appData.activeFocus = {
      id: createId(),
      dayKey: dateKey(),
      duration: duration,
      status: "running",
      startedAt: now,
      endsAt: now + duration * 60000,
      remainingMs: duration * 60000,
      taskId: focusTargetId,
      ownerTab: TAB_ID
    };
  });

  if (ok) {
    focusMessage = "";
    resetFocusNightSuppression();
  }
  applyTheme();
  restoreFocusSession();
  refreshAll();
}

/*
  修改进行中的会话前，先确认存储中的会话仍是本页看到的这一轮；
  已被其他标签页结束或替换时不写入，并按「已在其他标签页结束」处理。
*/
function updateFocusSession(sessionId, change) {
  let gone = false;
  const ok = persistChange(function() {
    const session = appData.activeFocus;
    if (!session || session.id !== sessionId) {
      gone = true;
      return false;
    }
    return change(session);
  });
  if (gone) onFocusSessionGone();
  return ok;
}

function pauseFocus() {
  const session = appData.activeFocus;
  if (!session || session.status !== "running") return;

  updateFocusSession(session.id, function(current) {
    if (current.status !== "running") return false;
    current.remainingMs = Math.max(0, current.endsAt - Date.now());
    current.endsAt = null;
    current.status = "paused";
  });
  restoreFocusSession();
  refreshAll();
}

function resumeFocus() {
  const session = appData.activeFocus;
  if (!session || session.status !== "paused") return;

  updateFocusSession(session.id, function(current) {
    if (current.status !== "paused") return false;
    current.endsAt = Date.now() + current.remainingMs;
    current.status = "running";
    current.ownerTab = TAB_ID;
  });
  restoreFocusSession();
  refreshAll();
}

function toggleFocus() {
  const session = appData.activeFocus;
  if (!session) startFocus();
  else if (session.status === "running") pauseFocus();
  else resumeFocus();
}

/* 会话已从数据中移除并保存后，收起计时相关的界面状态 */
function clearFocusUi(message) {
  focusMessage = message;
  stopTicker();
  releaseWakeLock();
  resetFocusNightSuppression();
  applyTheme();
  refreshAll();
}

async function resetFocus() {
  if (!appData.activeFocus) return;
  const sessionId = appData.activeFocus.id;

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

  const ok = updateFocusSession(sessionId, function() {
    appData.activeFocus = null;
  });
  if (ok) clearFocusUi("已重置。重新入座即可。");
}

/*
  结算在跨标签页锁内进行（不支持 Web Locks 时退化为直接执行）。
  persistChange 会先读取存储中的最新会话：已被其他标签页结算则放弃，避免重复发放星辰或用过期状态结算。
*/
function withFocusLock(fn) {
  const locks = typeof navigator !== "undefined" ? navigator.locks : null;
  const run = locks && typeof locks.request === "function"
    ? locks.request("starry-study-room-focus", function() {
        return fn();
      })
    : Promise.resolve().then(fn);

  return run.catch(function(error) {
    console.error("专注结算失败：", error);
  });
}

function onFocusSessionGone() {
  focusMessage = "本轮已在其他标签页结束。";
  restoreFocusSession();
  applyTheme();
  refreshAll();
}

/*
  decide(current) 返回 { minutes, star } 表示按此结算，返回 null 表示暂不结算。
  outcome："settled" 已结算并保存 | "gone" 会话已不存在 | "pending" 暂不结算 | "blocked" 只读或写入失败
*/
function settleFocus(sessionId, decide) {
  let outcome = "blocked";
  let settled = null;

  const ok = persistChange(function() {
    const current = appData.activeFocus;
    if (!current || current.id !== sessionId) {
      outcome = "gone";
      return false;
    }
    const result = decide(current);
    if (!result) {
      outcome = "pending";
      return false;
    }
    settled = { session: Object.assign({}, current), minutes: result.minutes, star: result.star };
    creditFocus(current, result.minutes, result.star);
    appData.activeFocus = null;
    outcome = "settled";
  });

  if (outcome === "settled" && !ok) outcome = "blocked";
  return { outcome: outcome, settled: settled };
}

function announceCompletedFocus(session, options) {
  const task = findSessionTask(session);
  clearFocusUi("本轮专注完成。星辰已点亮。");

  if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate([60, 80, 60]);

  const message = options.whileAway
    ? "离开期间，本轮 " + session.duration + " 分钟专注已完成，星辰已点亮。"
    : "本轮专注完成，点亮一颗星辰。";

  if (task && !task.done) {
    const binding = { taskId: task.id, dayKey: session.dayKey };
    showToast(message, {
      type: "star",
      actionLabel: "勾选「" + (task.name.length > 6 ? task.name.slice(0, 6) + "…" : task.name) + "」",
      onAction: function() {
        const saved = persistChange(function() {
          const current = findSessionTask(binding);
          if (!current || current.done) return false;
          current.done = true;
        });
        if (saved) refreshAll();
      }
    });
  } else {
    showToast(message, { type: "star" });
  }
}

function completeFocus(options = {}) {
  const session = appData.activeFocus;
  if (!session || focusSettling) return;

  // 只读保护时不结算、不发放星辰；停表以免反复尝试
  if (!canPersist()) {
    stopTicker();
    releaseWakeLock();
    return;
  }
  // 到点后由入座的标签页结算；其他标签页等宽限期过后才代为结算
  if (!shouldSettleHere(session)) return;

  focusSettling = true;
  withFocusLock(function() {
    const result = settleFocus(session.id, function(current) {
      if (current.status !== "running" || getSessionRemainingMs(current) > 0) return null;
      if (!shouldSettleHere(current)) return null;
      return { minutes: current.duration, star: true };
    });

    if (result.outcome === "gone") {
      onFocusSessionGone();
    } else if (result.outcome === "settled") {
      announceCompletedFocus(result.settled.session, options);
    } else if (result.outcome === "blocked") {
      stopTicker();
      releaseWakeLock();
      refreshAll();
    } else {
      refreshAll();
    }
  }).then(function() {
    focusSettling = false;
    if (appData.activeFocus && appData.activeFocus.status === "running" && !focusTicker && canPersist()) {
      restoreFocusSession();
    }
  });
}

async function finishFocusEarly() {
  const session = appData.activeFocus;
  if (!session) return;

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

  if (!ok || focusSettling) return;

  focusSettling = true;
  await withFocusLock(function() {
    const result = settleFocus(session.id, function(current) {
      if (current.status === "running" && getSessionRemainingMs(current) <= 0) {
        return { minutes: current.duration, star: true };
      }
      const minutes = getSessionElapsedMinutes(current);
      return minutes >= 1 ? { minutes: minutes, star: false } : null;
    });

    if (result.outcome === "gone") {
      onFocusSessionGone();
    } else if (result.outcome === "pending") {
      showToast("未满 1 分钟，无可记录。若想重来，可直接重置。");
    } else if (result.outcome === "settled" && result.settled.star) {
      announceCompletedFocus(result.settled.session, {});
    } else if (result.outcome === "settled") {
      clearFocusUi("已收卷，记录 " + result.settled.minutes + " 分钟。");
      showToast("已收卷，记录 " + result.settled.minutes + " 分钟专注。", { type: "success" });
    }
  });
  focusSettling = false;
}

/* 启动、导入、其他标签页写入后调用：让计时器与存储中的会话一致 */
function restoreFocusSession() {
  const session = appData.activeFocus;

  if (!session || session.status !== "running") {
    stopTicker();
    releaseWakeLock();
    return;
  }

  if (getFocusRemainingMs() <= 0) {
    completeFocus({ whileAway: true });
  } else {
    if (!focusTicker) startTicker();
    requestWakeLock();
  }
}

/* ---------- 朕心浮动 ---------- */

function recordDistraction(type) {
  const info = DISTRACTIONS[type];
  if (!info) return;

  const advice = document.getElementById("adviceText");
  advice.textContent = info.advice;
  document.getElementById("adviceBox").classList.add("is-active");

  const saved = persistChange(function() {
    appData.distractions[type] = toCount(appData.distractions[type]) + 1;
  });
  if (!saved) return;
  refreshAll();

  showToast("已记入分心档案：" + info.label, {
    actionLabel: "撤销",
    onAction: function() {
      const undone = persistChange(function() {
        appData.distractions[type] = Math.max(0, toCount(appData.distractions[type]) - 1);
      });
      if (undone) refreshAll();
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
    const value = Number(input.value);
    const saved = persistChange(function() {
      if (appData.activeFocus) return false;
      appData.settings.focusDuration = value;
    });
    if (saved) focusMessage = "已切换为 " + value + " 分钟专注。";
    refreshAll();
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
