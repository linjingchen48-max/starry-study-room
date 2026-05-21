function growthDateKey(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return year + "-" + month + "-" + day;
}

function isGrowthDayActive(day) {
  if (!day) return false;

  return (
    day.minutes > 0 ||
    day.sessions > 0 ||
    day.practice > 0 ||
    day.review === true
  );
}

function getGrowthActiveDays() {
  if (!appData.dailyData) return 0;

  return Object.values(appData.dailyData).filter(function(day) {
    return isGrowthDayActive(day);
  }).length;
}

function getGrowthStreak() {
  if (!appData.dailyData) return 0;

  let streak = 0;

  for (let i = 0; i < 365; i++) {
    const key = growthDateKey(-i);
    const day = appData.dailyData[key];

    if (isGrowthDayActive(day)) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

function getGrowthScore() {
  const stars = Number(appData.stars) || 0;
  const seals = Number(appData.seals) || 0;
  const minutes = Number(appData.totalMinutes) || 0;
  const activeDays = getGrowthActiveDays();

  return stars * 5 + seals * 6 + Math.floor(minutes / 25) * 4 + activeDays * 8;
}

const growthLevels = [
  {
    name: "入书房",
    score: 0,
    desc: "心志初萌，先建立秩序。"
  },
  {
    name: "稳心",
    score: 40,
    desc: "能克制分心冲动，开始形成稳定节奏。"
  },
  {
    name: "持恒",
    score: 90,
    desc: "学习与修炼开始连续，能在低状态时仍做一点。"
  },
  {
    name: "明察",
    score: 150,
    desc: "能看见错因、分心原因和情绪波动的根本。"
  },
  {
    name: "有度",
    score: 230,
    desc: "进退有节，不因一时得失破坏整体节奏。"
  },
  {
    name: "成局",
    score: 330,
    desc: "自律、沉稳与长期主义开始合成稳定人格系统。"
  }
];

function getGrowthLevel(score) {
  let current = growthLevels[0];
  let next = null;

  for (let i = 0; i < growthLevels.length; i++) {
    if (score >= growthLevels[i].score) {
      current = growthLevels[i];
      next = growthLevels[i + 1] || null;
    }
  }

  return {
    current: current,
    next: next
  };
}

function getGrowthBadges() {
  const streak = getGrowthStreak();
  const stars = Number(appData.stars) || 0;
  const seals = Number(appData.seals) || 0;
  const minutes = Number(appData.totalMinutes) || 0;
  const activeDays = getGrowthActiveDays();

  return [
    {
      title: "七日星轨",
      desc: "连续活跃 7 天，说明你已经开始建立最初的节奏。",
      unlocked: streak >= 7
    },
    {
      title: "初成沉稳",
      desc: "获得 7 枚御印，说明你已经开始认真训练心性。",
      unlocked: seals >= 7
    },
    {
      title: "星辰初明",
      desc: "点亮 10 颗星辰，说明你已经完成多轮专注。",
      unlocked: stars >= 10
    },
    {
      title: "百分钟入定",
      desc: "累计专注 100 分钟，说明你已经不是只停留在想法阶段。",
      unlocked: minutes >= 100
    },
    {
      title: "持恒之印",
      desc: "总活跃 14 天，说明你的系统开始有长期痕迹。",
      unlocked: activeDays >= 14
    }
  ];
}

function renderGrowthPanel() {
  const levelName = document.getElementById("growthLevelName");

  if (!levelName) return;

  const score = getGrowthScore();
  const levelInfo = getGrowthLevel(score);
  const current = levelInfo.current;
  const next = levelInfo.next;

  const streak = getGrowthStreak();
  const activeDays = getGrowthActiveDays();
  const focusRounds = Number(appData.focusSessions) || 0;

  document.getElementById("growthLevelName").innerText = current.name;
  document.getElementById("growthLevelDesc").innerText = current.desc;
  document.getElementById("growthScore").innerText = score;
  document.getElementById("growthStreak").innerText = streak;
  document.getElementById("growthActiveDays").innerText = activeDays;
  document.getElementById("growthFocusRounds").innerText = focusRounds;

  const progressBar = document.getElementById("growthProgressBar");
  const nextText = document.getElementById("growthNextText");

  if (!next) {
    progressBar.style.width = "100%";
    nextText.innerText = "已达最高阶位：成局。接下来要做的是守成。";
  } else {
    const currentScore = current.score;
    const nextScore = next.score;
    const progress = Math.round(
      ((score - currentScore) / (nextScore - currentScore)) * 100
    );

    progressBar.style.width = Math.max(0, Math.min(100, progress)) + "%";
    nextText.innerText =
      "距离下一阶位「" + next.name + "」还差 " + (next.score - score) + " 成长值。";
  }

  const badges = getGrowthBadges();
  const badgeBox = document.getElementById("growthBadges");

  badgeBox.innerHTML = badges.map(function(badge) {
    const className = badge.unlocked ? "growth-badge unlocked" : "growth-badge";
    const state = badge.unlocked ? "已解锁" : "未解锁";

    return `
      <div class="${className}">
        <p class="growth-badge-title">${badge.title} · ${state}</p>
        <p class="growth-badge-desc">${badge.desc}</p>
      </div>
    `;
  }).join("");
}

/*
  把 data.js 的 renderDataPanel 包一层：
  以后只要学习数据刷新，成长等级也会自动刷新。
*/
if (typeof renderDataPanel === "function") {
  const oldRenderDataPanel = renderDataPanel;

  renderDataPanel = function() {
    oldRenderDataPanel();
    renderGrowthPanel();
  };
}

renderGrowthPanel();