function dashboardDateText() {
  const date = new Date();
  const weekNames = ["日", "一", "二", "三", "四", "五", "六"];

  return (
    date.getFullYear() +
    "年" +
    (date.getMonth() + 1) +
    "月" +
    date.getDate() +
    "日 · 星期" +
    weekNames[date.getDay()]
  );
}

function getDashboardQuote() {
  const quotes = [
    "人贵有恒，事贵有序。今日不求尽善，但求不废。",
    "看事不要先看热闹，要先看根本。",
    "心浮时不决策，气盛时不争辩。",
    "先入座，再谈效率。",
    "真正的自律，是心乱时仍能做一点。",
    "今日只做眼前一事，事有次第，心自安定。"
  ];

  const day = new Date().getDate();
  return quotes[day % quotes.length];
}

function getDashboardTaskRate() {
  if (!appData.tasks || appData.tasks.length === 0) return 0;

  const doneCount = appData.tasks.filter(function(task) {
    return task.done;
  }).length;

  return Math.round((doneCount / appData.tasks.length) * 100);
}

function getDashboardSuggestion(today, taskRate) {
  const tasks = appData.tasks || [];

  if (tasks.length === 0) {
    return "先写下今日最重要的一件学习任务。不要写太多，先让系统开始运转。";
  }

  if (taskRate === 0 && today.minutes === 0) {
    return "现在进入御书房，先做一轮 15 分钟轻量专注。只要开始，就已经胜过空想。";
  }

  if (taskRate > 0 && today.minutes === 0) {
    return "任务已有推进，但还没有专注记录。建议补一轮御书房，让进度更稳定。";
  }

  if (today.minutes > 0 && taskRate < 50) {
    return "今日已有专注，下一步把一个任务标记完成，让成果可见。";
  }

  if (today.minutes >= 25 && appData.seals === 0) {
    return "今日学习已入座，可以去人格修炼页完成一次修炼，补上心性训练。";
  }

  if (today.minutes >= 25 && taskRate >= 50 && appData.seals > 0) {
    return "今日节奏不错。晚上记得完成今日奏对，把经验沉淀下来。";
  }

  return "继续保持。今日不求尽善，但求不废。";
}

function getDashboardState(today, taskRate) {
  if (today.minutes >= 25 && taskRate >= 50) return "已入局";
  if (today.minutes > 0) return "已入座";
  if (taskRate > 0) return "已启动";
  return "未入座";
}

function renderDashboard() {
  const dashboardDate = document.getElementById("dashboardDate");

  if (!dashboardDate) return;

  let today = { minutes: 0, sessions: 0, practice: 0, review: false };

  if (typeof ensureDailyData === "function") {
    today = ensureDailyData();
  }

  const taskRate = getDashboardTaskRate();

  document.getElementById("dashboardDate").innerText = dashboardDateText();
  document.getElementById("dashboardQuote").innerText = getDashboardQuote();

  document.getElementById("dashboardTaskRate").innerText = taskRate + "%";
  document.getElementById("dashboardMinutes").innerText = today.minutes || 0;
  document.getElementById("dashboardStars").innerText = Number(appData.stars) || 0;
  document.getElementById("dashboardSeals").innerText = Number(appData.seals) || 0;

  document.getElementById("dashboardState").innerText = getDashboardState(today, taskRate);
  document.getElementById("dashboardSuggestion").innerText =
    getDashboardSuggestion(today, taskRate);

  saveData();
}

/*
  包装 renderDataPanel：
  只要数据面板刷新，首页仪表盘也刷新。
*/
if (typeof renderDataPanel === "function") {
  const oldRenderDataPanelForDashboard = renderDataPanel;

  renderDataPanel = function() {
    oldRenderDataPanelForDashboard();
    renderDashboard();
  };
}

renderDashboard();