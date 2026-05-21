function dataDateKey(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return year + "-" + month + "-" + day;
}

function ensureDailyData(key = dataDateKey()) {
  if (!appData.dailyData) {
    appData.dailyData = {};
  }

  if (!appData.dailyData[key]) {
    appData.dailyData[key] = {
      minutes: 0,
      sessions: 0,
      practice: 0,
      review: false
    };
  }

  if (typeof appData.dailyData[key].minutes !== "number") {
    appData.dailyData[key].minutes = 0;
  }

  if (typeof appData.dailyData[key].sessions !== "number") {
    appData.dailyData[key].sessions = 0;
  }

  if (typeof appData.dailyData[key].practice !== "number") {
    appData.dailyData[key].practice = 0;
  }

  return appData.dailyData[key];
}

function getActiveDays() {
  if (!appData.dailyData) return 0;

  return Object.values(appData.dailyData).filter(function(day) {
    return day.minutes > 0 || day.sessions > 0 || day.practice > 0 || day.review;
  }).length;
}

function getTaskRate() {
  if (!appData.tasks || appData.tasks.length === 0) return 0;

  const doneCount = appData.tasks.filter(function(task) {
    return task.done;
  }).length;

  return Math.round((doneCount / appData.tasks.length) * 100);
}

function getDataComment(today, taskRate) {
  if (appData.totalMinutes === 0 && appData.stars === 0 && appData.seals === 0) {
    return "今日尚未入局。先完成一次 15 分钟轻量专注，点亮第一颗星。";
  }

  if (taskRate >= 80 && today.minutes >= 25 && today.practice >= 1) {
    return "今日表现甚稳：任务有推进，御书房有入座，人格修炼也未空过。此为成势之始。";
  }

  if (today.minutes >= 45) {
    return "今日专注时间已成规模。明日宜继续守住节奏，不贪多，不断线。";
  }

  if (taskRate > 0 && today.minutes === 0) {
    return "今日任务已有推进，但尚未形成完整专注记录。明日可先做一轮 15 分钟轻量启动。";
  }

  if (today.minutes > 0 && taskRate === 0) {
    return "今日已有专注，但任务尚未勾选完成。记得把实际完成的部分标记出来，让进度可见。";
  }

  if (appData.seals > 0) {
    return "今日修身未废。学习与心性同修，才是长期主义的底座。";
  }

  return "今日已有行动痕迹。真正要紧的是明日继续，不让星火断掉。";
}

function renderWeekBars() {
  const weekBars = document.getElementById("weekBars");

  if (!weekBars) return;

  let maxMinutes = 1;

  for (let i = -6; i <= 0; i++) {
    const key = dataDateKey(i);
    const day = appData.dailyData && appData.dailyData[key];
    const minutes = day && day.minutes ? day.minutes : 0;

    maxMinutes = Math.max(maxMinutes, minutes);
  }

  let html = "";

  for (let i = -6; i <= 0; i++) {
    const key = dataDateKey(i);
    const date = new Date();
    date.setDate(date.getDate() + i);

    const day = appData.dailyData && appData.dailyData[key];
    const minutes = day && day.minutes ? day.minutes : 0;

    const height = minutes === 0
      ? 6
      : Math.max(12, Math.round((minutes / maxMinutes) * 90));

    const label = (date.getMonth() + 1) + "/" + date.getDate();

    html += `
      <div class="bar-item">
        <div class="bar-minutes">${minutes}</div>
        <div class="bar-column" style="height: ${height}px;"></div>
        <div class="bar-label">${label}</div>
      </div>
    `;
  }

  weekBars.innerHTML = html;
}

function renderDataPanel() {
  const dataTaskRate = document.getElementById("dataTaskRate");

  if (!dataTaskRate) return;

  const today = ensureDailyData();
  const taskRate = getTaskRate();
  const avgSession = today.sessions === 0
    ? 0
    : Math.round(today.minutes / today.sessions);

  const totalScore = appData.stars + appData.seals + Math.floor(appData.totalMinutes / 25);

  document.getElementById("dataTaskRate").innerText = taskRate + "%";
  document.getElementById("dataTodayMinutes").innerText = today.minutes;
  document.getElementById("dataTodaySessions").innerText = today.sessions;
  document.getElementById("dataAvgSession").innerText = avgSession;
  document.getElementById("dataActiveDays").innerText = getActiveDays();
  document.getElementById("dataTotalScore").innerText = totalScore;

  document.getElementById("dataComment").innerText = getDataComment(today, taskRate);

  renderWeekBars();
  saveData();
}

ensureDailyData();
renderDataPanel();