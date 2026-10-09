/*
  今日：概况、御案（每日任务）、昨日未完成移入、今日奏对。
*/

let reviewEditing = false;

/* ---------- 概况 ---------- */

function getTodayContext() {
  const key = dateKey();
  const tasks = getTasksFor(key);
  return {
    key: key,
    tasks: tasks,
    today: peekDay(key),
    taskRate: getTaskRate(tasks),
    hasReview: Boolean(appData.reviews[key])
  };
}

function renderTodayOverview() {
  const ctx = getTodayContext();
  const now = new Date();

  document.getElementById("todayDate").textContent = formatDateLong(now);
  document.getElementById("todayQuote").textContent = getDailyQuote(now);

  const state = getTodayState(ctx.today, ctx.taskRate);
  const stateEl = document.getElementById("todayState");
  stateEl.textContent = state;
  stateEl.className = "tag tag-dot " + (state === "未入座" ? "" : state === "已入局" ? "tag-gold" : "tag-success");

  document.getElementById("todayTaskRate").textContent = ctx.taskRate;
  document.getElementById("todayMinutes").textContent = ctx.today.minutes;
  document.getElementById("todayStars").textContent = toCount(appData.stars);
  document.getElementById("todaySeals").textContent = toCount(appData.seals);

  const next = getNextStep(ctx);
  document.getElementById("nextStepText").textContent = next.text;

  const action = document.getElementById("nextStepAction");
  if (next.action) {
    action.hidden = false;
    action.dataset.action = next.action;
    action.innerHTML = escapeHtml(next.label) + icon("arrow", "icon icon-sm");
  } else {
    action.hidden = true;
  }
}

function runNextStep(action) {
  if (action === "newTask" || action === "tasks") {
    const target = action === "newTask" ? document.getElementById("taskInput") : document.getElementById("tasksTitle");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.focus({ preventScroll: true });
    return;
  }
  if (action === "review") {
    openReviewEditor();
    return;
  }
  navigate(action);
}

/* ---------- 御案 ---------- */

function renderTaskList() {
  const list = document.getElementById("taskList");
  const tasks = getTasksFor();
  const doneCount = tasks.filter(function(task) {
    return task.done;
  }).length;

  document.getElementById("taskCountMeta").textContent = tasks.length ? doneCount + " / " + tasks.length + " 已完成" : "";

  if (tasks.length === 0) {
    list.innerHTML =
      "<li>" +
      emptyState({
        icon: "today",
        title: "今日尚未设定御案",
        desc: "写下最重要的一件学习任务，再给它一个心乱时也能守住的最低标准。"
      }) +
      "</li>";
    return;
  }

  list.innerHTML = tasks
    .map(function(task) {
      const name = escapeHtml(task.name);
      return (
        '<li class="row' + (task.done ? " is-done" : "") + '" data-task-id="' + escapeHtml(task.id) + '">' +
        '<button type="button" class="check" role="checkbox" aria-checked="' + task.done + '" aria-label="完成：' + name + '" data-task-action="toggle">' +
        '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-6.5"/></svg>' +
        "</button>" +
        '<div class="row-main">' +
        '<p class="row-title">' + name + "</p>" +
        '<p class="row-meta">' + (task.goal ? "最低标准：" + escapeHtml(task.goal) : "未写最低标准") + "</p>" +
        "</div>" +
        '<div class="row-actions">' +
        (task.done
          ? ""
          : '<button type="button" class="btn btn-icon btn-sm" data-task-action="focus" aria-label="以此入座：' + name + '" title="以此入座">' + icon("focus", "icon icon-sm") + "</button>") +
        '<button type="button" class="btn btn-icon btn-sm" data-task-action="delete" aria-label="删除：' + name + '" title="删除">' + icon("trash", "icon icon-sm") + "</button>" +
        "</div>" +
        "</li>"
      );
    })
    .join("");
}

function addTask(event) {
  event.preventDefault();

  const taskInput = document.getElementById("taskInput");
  const goalInput = document.getElementById("goalInput");
  const name = taskInput.value.trim();

  if (!name) {
    setFieldError(taskInput, "请先写下今日学习任务。");
    taskInput.focus();
    return;
  }

  setFieldError(taskInput, "");

  const task = normalizeTask({ name: name, goal: goalInput.value.trim(), done: false });
  const saved = persistChange(function() {
    ensureTasksFor().push(task);
  });
  // 未保存时保留输入内容，用户可稍后重试
  if (!saved) return;

  taskInput.value = "";
  goalInput.value = "";
  taskInput.focus();

  renderAllNow();
  flashElement(document.querySelector('[data-task-id="' + task.id + '"]'));
}

function toggleTask(id) {
  persistChange(function() {
    const task = findTodayTask(id);
    if (!task) return false;
    task.done = !task.done;
  });
  renderAllNow();

  const check = document.querySelector('[data-task-id="' + id + '"] .check');
  if (check) check.focus();
}

function deleteTask(id) {
  const key = dateKey();
  let removed = null;
  let index = -1;

  const saved = persistChange(function() {
    const tasks = ensureTasksFor(key);
    index = tasks.findIndex(function(task) {
      return task.id === id;
    });
    if (index === -1) return false;
    removed = tasks.splice(index, 1)[0];
  });
  refreshAll();
  if (!saved) return;

  showToast("已删除「" + removed.name + "」", {
    actionLabel: "撤销",
    onAction: function() {
      const restored = persistChange(function() {
        const tasks = ensureTasksFor(key);
        if (tasks.some(function(task) { return task.id === removed.id; })) return false;
        tasks.splice(Math.min(index, tasks.length), 0, removed);
      });
      if (restored) refreshAll();
    }
  });
}

function focusOnTask(id) {
  if (typeof setFocusTarget === "function") setFocusTarget(id);
  navigate("focus");
}

/* ---------- 昨日未完成 ---------- */

function findCarryOver(todayKey = dateKey()) {
  if (appData.carryOverHandled[todayKey]) return null;

  const pastKeys = Object.keys(appData.tasksByDay)
    .filter(function(key) {
      return key < todayKey;
    })
    .sort()
    .reverse();

  for (let i = 0; i < pastKeys.length; i++) {
    const pending = appData.tasksByDay[pastKeys[i]].filter(function(task) {
      return !task.done;
    });
    if (pending.length) return { key: pastKeys[i], tasks: pending };
    if (appData.tasksByDay[pastKeys[i]].length) return null;
  }

  return null;
}

function renderCarryOver() {
  const box = document.getElementById("carryOver");
  const carry = findCarryOver();

  if (!carry) {
    box.hidden = true;
    return;
  }

  box.hidden = false;
  document.getElementById("carryOverText").textContent =
    formatDayLabel(carry.key) + "尚有 " + carry.tasks.length + " 项未完成，要移入今日御案吗？";
}

function acceptCarryOver() {
  const todayKey = dateKey();
  let moved = 0;

  const saved = persistChange(function() {
    // 在最新数据上重新查找，避免与其他标签页重复移入
    const carry = findCarryOver(todayKey);
    if (!carry) return false;

    const ids = carry.tasks.map(function(task) {
      return task.id;
    });

    appData.tasksByDay[carry.key] = appData.tasksByDay[carry.key].filter(function(task) {
      return !ids.includes(task.id);
    });
    if (!appData.tasksByDay[carry.key].length) delete appData.tasksByDay[carry.key];

    const today = ensureTasksFor(todayKey);
    carry.tasks.forEach(function(task) {
      today.push(task);
    });

    appData.carryOverHandled[todayKey] = true;
    moved = carry.tasks.length;
  });
  refreshAll();
  if (saved) showToast("已移入 " + moved + " 项到今日御案。", { type: "success" });
}

function dismissCarryOver() {
  const key = dateKey();
  persistChange(function() {
    appData.carryOverHandled[key] = true;
  });
  refreshAll();
}

/* ---------- 奏对 ---------- */

function buildReviewFields() {
  const container = document.getElementById("reviewFields");
  container.innerHTML = REVIEW_QUESTIONS.map(function(q, index) {
    const id = "review-" + q.key;
    return (
      '<div class="field">' +
      '<label class="field-label" for="' + id + '"><span class="review-index">' + "一二三四五"[index] + "</span>" + escapeHtml(q.label) + "</label>" +
      '<textarea class="textarea" id="' + id + '" name="' + q.key + '" rows="2" placeholder="' + escapeHtml(q.placeholder) + '"></textarea>' +
      "</div>"
    );
  }).join("");
}

function renderReview() {
  const key = dateKey();
  const entry = appData.reviews[key];
  const form = document.getElementById("reviewForm");
  const summary = document.getElementById("reviewSummary");

  document.getElementById("reviewMeta").textContent = entry
    ? "已呈 " + formatTime(entry.updatedAt)
    : new Date().getHours() >= 18
      ? "宜在此时"
      : "宜在晚间";

  form.hidden = !reviewEditing;
  summary.hidden = reviewEditing;

  if (reviewEditing) return;

  if (entry) {
    summary.innerHTML =
      '<div class="callout callout-seal royal-comment">' +
      '<p class="callout-title">今日御批</p>' +
      '<p class="royal-comment-text">' + escapeHtml(entry.comment) + "</p>" +
      "</div>" +
      '<div class="btn-row review-actions">' +
      '<button type="button" class="btn btn-quiet btn-sm" data-review-action="edit">' + icon("brush", "icon icon-sm") + "修改奏对</button>" +
      "</div>";
  } else {
    summary.innerHTML =
      '<div class="review-intro">' +
      '<p class="text-secondary">不只是记录今天，而是看清今天。五个问题，写得简单也可以，关键是诚实。</p>' +
      '<button type="button" class="btn btn-secondary" data-review-action="edit">' + icon("brush") + "开始奏对</button>" +
      "</div>";
  }
}

function openReviewEditor() {
  const entry = appData.reviews[dateKey()] || {};
  reviewEditing = true;

  REVIEW_QUESTIONS.forEach(function(q) {
    document.getElementById("review-" + q.key).value = entry[q.key] || "";
  });
  document.getElementById("reviewError").hidden = true;

  renderReview();

  const section = document.getElementById("reviewSection");
  section.scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById("review-done").focus({ preventScroll: true });
}

function closeReviewEditor() {
  reviewEditing = false;
  renderReview();
}

function saveReview(event) {
  event.preventDefault();

  const entry = {};
  REVIEW_QUESTIONS.forEach(function(q) {
    entry[q.key] = document.getElementById("review-" + q.key).value.trim();
  });

  const hasContent = REVIEW_QUESTIONS.some(function(q) {
    return entry[q.key];
  });

  if (!hasContent) {
    const error = document.getElementById("reviewError");
    error.hidden = false;
    document.getElementById("review-done").focus();
    return;
  }

  const key = dateKey();
  const saved = persistChange(function() {
    const today = ensureDay(key);
    entry.comment = generateRoyalComment(entry, today);
    entry.updatedAt = new Date().toISOString();
    appData.reviews[key] = entry;
    today.review = true;
  });
  // 未保存时保持编辑状态，填写内容不丢
  if (!saved) return;

  reviewEditing = false;
  refreshAll();
  playSealStamp("御批");
  showToast("奏对已呈上，御批已生成。", { type: "seal" });
}

/* ---------- 事件 ---------- */

document.getElementById("taskForm").addEventListener("submit", addTask);

document.getElementById("taskInput").addEventListener("input", function(event) {
  if (event.target.value.trim()) setFieldError(event.target, "");
});

document.getElementById("taskList").addEventListener("click", function(event) {
  const button = event.target.closest("[data-task-action]");
  if (!button) return;
  const row = button.closest("[data-task-id]");
  if (!row) return;

  const id = row.dataset.taskId;
  const action = button.dataset.taskAction;

  if (action === "toggle") toggleTask(id);
  if (action === "delete") deleteTask(id);
  if (action === "focus") focusOnTask(id);
});

document.getElementById("nextStepAction").addEventListener("click", function(event) {
  runNextStep(event.currentTarget.dataset.action);
});

document.getElementById("carryOverAccept").addEventListener("click", acceptCarryOver);
document.getElementById("carryOverDismiss").addEventListener("click", dismissCarryOver);

document.getElementById("reviewSummary").addEventListener("click", function(event) {
  if (event.target.closest('[data-review-action="edit"]')) openReviewEditor();
});

document.getElementById("reviewForm").addEventListener("submit", saveReview);
document.getElementById("reviewCancel").addEventListener("click", closeReviewEditor);

buildReviewFields();

registerRenderer(renderTodayOverview);
registerRenderer(renderCarryOver);
registerRenderer(renderTaskList);
registerRenderer(renderReview);
