const STORAGE_KEY = "starryStudyRoom_v1";

const defaultData = {
  tasks: [],
  stars: 0,
  totalMinutes: 0,
  focusSessions: 0,
  seals: 0,
  currentPracticeType: "calm",
  currentPractice: "今日修炼：说话前停一秒，不急着解释，不急着反驳。",
  practiceStats: {
    calm: 0,
    discipline: 0,
    insight: 0,
    vision: 0,
    speech: 0
  },
  review: {
    done: "",
    distraction: "",
    restless: "",
    calm: "",
    tomorrow: "",
    comment: "",
    updatedAt: ""
  },
  dailyData: {}
};

let appData = loadData();

function loadData() {
  const saved = localStorage.getItem(STORAGE_KEY);

  if (!saved) {
    return { ...defaultData };
  }

  try {
    const parsed = JSON.parse(saved);

    return {
      ...defaultData,
      ...parsed,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      practiceStats: {
        ...defaultData.practiceStats,
        ...(parsed.practiceStats || {})
      },
      review: {
        ...defaultData.review,
        ...(parsed.review || {})
      },
      dailyData:
        parsed.dailyData && typeof parsed.dailyData === "object"
          ? parsed.dailyData
          : {}
    };
  } catch (error) {
    console.error("读取本地数据失败：", error);
    return { ...defaultData };
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
}

function safeClick(id, handler) {
  const el = document.getElementById(id);

  if (!el) {
    console.warn("没有找到按钮：" + id);
    return;
  }

  el.addEventListener("click", handler);
}

function safeChange(id, handler) {
  const el = document.getElementById(id);

  if (!el) {
    console.warn("没有找到选择框：" + id);
    return;
  }

  el.addEventListener("change", handler);
}

/* =========================
   页面切换
========================= */

function switchPage(pageId, title, clickedButton) {
  document.querySelectorAll(".page").forEach(function(page) {
    page.classList.remove("active");
  });

  const targetPage = document.getElementById(pageId);

  if (targetPage) {
    targetPage.classList.add("active");
  }

  document.querySelectorAll(".nav-btn").forEach(function(btn) {
    btn.classList.remove("active");
  });

  clickedButton.classList.add("active");

  const pageTitle = document.getElementById("pageTitle");

  if (pageTitle) {
    pageTitle.innerText = title;
  }
}

/* =========================
   今日御案任务
========================= */

function saveTask() {
  const taskInput = document.getElementById("taskInput");
  const goalInput = document.getElementById("goalInput");

  const taskName = taskInput.value.trim();
  const goal = goalInput.value.trim();

  if (!taskName) {
    alert("请先写下今日学习任务。");
    return;
  }

  appData.tasks.push({
    name: taskName,
    goal: goal,
    done: false,
    createdAt: new Date().toISOString()
  });

  taskInput.value = "";
  goalInput.value = "";

  saveData();
  renderTasks();

  if (typeof renderDataPanel === "function") {
    renderDataPanel();
  }
}

function renderTasks() {
  const taskList = document.getElementById("taskList");
  const taskCount = document.getElementById("taskCount");
  const archiveTaskCount = document.getElementById("archiveTaskCount");
  const archiveStars = document.getElementById("archiveStars");
  const archiveMinutes = document.getElementById("archiveMinutes");
  const archiveSeals = document.getElementById("archiveSeals");
  const currentFocusTask = document.getElementById("currentFocusTask");

  if (!taskList || !taskCount || !archiveTaskCount) {
    return;
  }

  taskCount.innerText = appData.tasks.length + " 项";
  archiveTaskCount.innerText = appData.tasks.length;

  if (archiveStars) {
    archiveStars.innerText = appData.stars;
  }

  if (archiveMinutes) {
    archiveMinutes.innerText = appData.totalMinutes;
  }

  if (archiveSeals) {
    archiveSeals.innerText = appData.seals;
  }

  if (appData.tasks.length === 0) {
    taskList.innerHTML = `<p class="muted">今日尚未设定御案。</p>`;

    if (currentFocusTask) {
      currentFocusTask.innerText = "当前目标：先从今日御案中选一件事开始。";
    }

    renderPractice();
    renderReview();

    if (typeof renderDataPanel === "function") {
      renderDataPanel();
    }

    return;
  }

  const firstTask =
    appData.tasks.find(function(task) {
      return !task.done;
    }) || appData.tasks[0];

  if (currentFocusTask) {
    currentFocusTask.innerText = "当前目标：" + firstTask.name;
  }

  taskList.innerHTML = appData.tasks
    .map(function(task, index) {
      const doneClass = task.done ? "done" : "";
      const doneText = task.done ? "已完成" : "标记完成";

      return `
        <div class="task-item ${doneClass}">
          <p class="task-name">${task.name}</p>
          <p class="task-goal">最低标准：${task.goal || "尚未填写"}</p>

          <div class="task-actions">
            <button class="task-small-btn done-btn" data-task-action="toggle" data-index="${index}">
              ${doneText}
            </button>

            <button class="task-small-btn" data-task-action="delete" data-index="${index}">
              删除
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  renderPractice();
  renderReview();

  if (typeof renderDataPanel === "function") {
    renderDataPanel();
  }
}

/* =========================
   康熙人格修炼
========================= */

const practiceTypeNames = {
  calm: "沉稳",
  discipline: "自律",
  insight: "洞察",
  vision: "格局",
  speech: "言行"
};

const practicePool = {
  calm: [
    "沉稳修炼：今天和别人说话时，语速放慢一点。回答前停一秒，不急着解释。",
    "沉稳修炼：遇到让你烦躁的事，先深呼吸三次，再决定要不要回应。",
    "沉稳修炼：今天不抢话，不急着证明自己，先听完对方说什么。"
  ],
  discipline: [
    "自律修炼：今天必须完成一个最低学习任务。不求完美，但不可空过。",
    "自律修炼：开始学习前，把桌面清空，只留下当前任务。",
    "自律修炼：今天先完成最小版本，再考虑加量。"
  ],
  insight: [
    "洞察修炼：今天遇到一件不舒服的事，写下表面原因、真正原因、我能控制的部分。",
    "洞察修炼：做错一道题时，不只改答案，还要写出错因。",
    "洞察修炼：看到一个热点或新闻时，问自己：谁受益？谁受损？根本矛盾是什么？"
  ],
  vision: [
    "格局修炼：今天不要被一句话影响一整天。先问自己：三年后这件事还重要吗？",
    "格局修炼：遇到小事不顺时，不立刻反应，先把注意力放回长期目标。",
    "格局修炼：今天减少无意义争辩，把精力留给真正能改变结果的事。"
  ],
  speech: [
    "言行修炼：今天说话少用“我觉得、好像、可能吧”，尽量说清事实和目的。",
    "言行修炼：请求别人帮忙时，先讲目的，再讲具体事项。",
    "言行修炼：今天不说过多解释性废话，表达简洁、有分寸。"
  ]
};

function renderPractice() {
  const practiceSeals = document.getElementById("practiceSeals");
  const currentPracticeType = document.getElementById("currentPracticeType");
  const practiceTaskText = document.getElementById("practiceTaskText");

  if (!practiceSeals || !currentPracticeType || !practiceTaskText) {
    return;
  }

  practiceSeals.innerText = appData.seals;
  currentPracticeType.innerText =
    practiceTypeNames[appData.currentPracticeType] || "沉稳";
  practiceTaskText.innerText = appData.currentPractice;
}

function pickPractice(type) {
  const list = practicePool[type];

  if (!list) return;

  const randomIndex = Math.floor(Math.random() * list.length);

  appData.currentPracticeType = type;
  appData.currentPractice = list[randomIndex];

  saveData();
  renderPractice();
}

function completePractice() {
  const type = appData.currentPracticeType || "calm";

  appData.seals += 1;

  if (!appData.practiceStats) {
    appData.practiceStats = { ...defaultData.practiceStats };
  }

  appData.practiceStats[type] += 1;

  if (typeof ensureDailyData === "function") {
    const today = ensureDailyData();
    today.practice += 1;
  }

  saveData();
  renderPractice();
  renderTasks();

  if (typeof renderDataPanel === "function") {
    renderDataPanel();
  }

  alert("修炼完成，获得一枚御印。");
}

/* =========================
   今日奏对
========================= */

function renderReview() {
  const reviewDone = document.getElementById("reviewDone");
  const reviewDistraction = document.getElementById("reviewDistraction");
  const reviewRestless = document.getElementById("reviewRestless");
  const reviewCalm = document.getElementById("reviewCalm");
  const reviewTomorrow = document.getElementById("reviewTomorrow");
  const royalComment = document.getElementById("royalComment");

  if (!reviewDone || !royalComment) {
    return;
  }

  reviewDone.value = appData.review.done || "";
  reviewDistraction.value = appData.review.distraction || "";
  reviewRestless.value = appData.review.restless || "";
  reviewCalm.value = appData.review.calm || "";
  reviewTomorrow.value = appData.review.tomorrow || "";

  royalComment.innerText = appData.review.comment || "尚未生成今日评语。";
}

function generateRoyalComment() {
  const done = appData.review.done.trim();
  const distraction = appData.review.distraction.trim();
  const restless = appData.review.restless.trim();
  const calm = appData.review.calm.trim();
  const tomorrow = appData.review.tomorrow.trim();

  const hasDeepReview =
    done.length >= 6 &&
    distraction.length >= 4 &&
    restless.length >= 4 &&
    calm.length >= 4 &&
    tomorrow.length >= 4;

  if (!done && !distraction && !restless && !calm && !tomorrow) {
    return "今日尚未奏对。先写下一句真实情况，也胜过完全空白。";
  }

  if (hasDeepReview && appData.totalMinutes >= 25 && appData.seals >= 1) {
    return "今日御批：你今日有学习、有修炼，也能回看自己的分心与浮躁，已不只是完成任务，而是在建立秩序。明日宜守住最低标准，先稳，再求多。";
  }

  if (appData.totalMinutes >= 45) {
    return "今日御批：你今日能久坐御书房，已有定力。只是专注之后仍需复盘，否则努力容易散成碎片。明日宜先做最重要的一件事。";
  }

  if (distraction || restless) {
    return "今日御批：你今日虽有分心与浮躁，但能把它写下来，便已不是被它牵着走。明日不必贪多，只需在分心出现时，把任务降到最小一步。";
  }

  if (done) {
    return "今日御批：今日已有所得，胜在未空过。真正的自律，不是情绪高涨时努力，而是心乱时仍能做一点。明日继续稳住节奏。";
  }

  return "今日御批：记录虽简，但已有自省之意。明日宜把目标写得更小、更具体，先入座，再谈效率。";
}

function saveReview() {
  const reviewDone = document.getElementById("reviewDone").value.trim();
  const reviewDistraction = document.getElementById("reviewDistraction").value.trim();
  const reviewRestless = document.getElementById("reviewRestless").value.trim();
  const reviewCalm = document.getElementById("reviewCalm").value.trim();
  const reviewTomorrow = document.getElementById("reviewTomorrow").value.trim();

  appData.review.done = reviewDone;
  appData.review.distraction = reviewDistraction;
  appData.review.restless = reviewRestless;
  appData.review.calm = reviewCalm;
  appData.review.tomorrow = reviewTomorrow;
  appData.review.updatedAt = new Date().toISOString();
  appData.review.comment = generateRoyalComment();

  if (typeof ensureDailyData === "function") {
    const today = ensureDailyData();
    today.review = true;
  }

  saveData();
  renderReview();

  if (typeof renderDataPanel === "function") {
    renderDataPanel();
  }

  alert("今日奏对已保存。御批已生成。");
}

/* =========================
   御书房计时器
========================= */

let focusDuration = 25;
let timeLeft = focusDuration * 60;
let timerInterval = null;

function updateTimerDisplay() {
  const timer = document.getElementById("timer");
  const progressBar = document.getElementById("progressBar");

  if (!timer || !progressBar) {
    return;
  }

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  timer.innerText =
    String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");

  const totalSeconds = focusDuration * 60;
  const usedSeconds = totalSeconds - timeLeft;
  const percent = Math.min(100, Math.max(0, (usedSeconds / totalSeconds) * 100));

  progressBar.style.width = percent + "%";
}

function changeFocusDuration() {
  const durationSelect = document.getElementById("durationSelect");

  if (!durationSelect) return;

  focusDuration = Number(durationSelect.value);
  timeLeft = focusDuration * 60;

  pauseFocus();
  updateTimerDisplay();

  const focusStatus = document.getElementById("focusStatus");

  if (focusStatus) {
    focusStatus.innerText = "已切换为 " + focusDuration + " 分钟专注。";
  }
}

function startFocus() {
  if (timerInterval) return;

  const focusStatus = document.getElementById("focusStatus");

  if (focusStatus) {
    focusStatus.innerText = "御书房已入座。此刻只做眼前一件事。";
  }

  timerInterval = setInterval(function() {
    if (timeLeft > 0) {
      timeLeft--;
      updateTimerDisplay();
    } else {
      completeFocus();
    }
  }, 1000);
}

function pauseFocus() {
  clearInterval(timerInterval);
  timerInterval = null;

  const focusStatus = document.getElementById("focusStatus");

  if (focusStatus) {
    focusStatus.innerText = "已暂停。可短歇，但不要离席太久。";
  }
}

function resetFocus() {
  pauseFocus();

  timeLeft = focusDuration * 60;
  updateTimerDisplay();

  const focusStatus = document.getElementById("focusStatus");

  if (focusStatus) {
    focusStatus.innerText = "已重置。重新入座即可。";
  }
}

function completeFocus() {
  pauseFocus();

  appData.stars += 1;
  appData.focusSessions += 1;
  appData.totalMinutes += focusDuration;

  if (typeof ensureDailyData === "function") {
    const today = ensureDailyData();
    today.minutes += focusDuration;
    today.sessions += 1;
  }

  saveData();
  renderTasks();

  if (typeof renderDataPanel === "function") {
    renderDataPanel();
  }

  timeLeft = focusDuration * 60;
  updateTimerDisplay();

  const focusStatus = document.getElementById("focusStatus");

  if (focusStatus) {
    focusStatus.innerText = "本轮专注完成。星辰已点亮。";
  }

  alert("本轮专注完成，星辰已点亮。");
}

/* =========================
   事件监听
========================= */

safeClick("saveTaskBtn", saveTask);

document.querySelectorAll(".nav-btn").forEach(function(button) {
  button.addEventListener("click", function() {
    const pageId = button.dataset.page;
    const title = button.dataset.title;

    switchPage(pageId, title, button);
  });
});

safeChange("durationSelect", changeFocusDuration);
safeClick("startFocusBtn", startFocus);
safeClick("pauseFocusBtn", pauseFocus);
safeClick("resetFocusBtn", resetFocus);
safeClick("completeFocusBtn", completeFocus);

document.querySelectorAll(".distraction-btn").forEach(function(button) {
  button.addEventListener("click", function() {
    const adviceText = document.getElementById("adviceText");

    if (adviceText) {
      adviceText.innerText = button.dataset.advice;
    }
  });
});

document.querySelectorAll(".practice-pick-btn").forEach(function(button) {
  button.addEventListener("click", function() {
    const type = button.dataset.type;
    pickPractice(type);
  });
});

safeClick("completePracticeBtn", completePractice);
safeClick("saveReviewBtn", saveReview);

document.addEventListener("click", function(event) {
  const button = event.target.closest("[data-task-action]");

  if (!button) return;

  const action = button.dataset.taskAction;
  const index = Number(button.dataset.index);

  if (!appData.tasks[index]) return;

  if (action === "toggle") {
    appData.tasks[index].done = !appData.tasks[index].done;
  }

  if (action === "delete") {
    appData.tasks.splice(index, 1);
  }

  saveData();
  renderTasks();

  if (typeof renderDataPanel === "function") {
    renderDataPanel();
  }
});

/* =========================
   初始化
========================= */

updateTimerDisplay();
renderTasks();

if (typeof renderDataPanel === "function") {
  renderDataPanel();
}