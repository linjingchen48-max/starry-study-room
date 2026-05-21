function ensureDistractionData() {
  if (!appData.distractions) {
    appData.distractions = {
      hard: 0,
      phone: 0,
      tired: 0,
      start: 0
    };
  }

  if (typeof appData.distractions.hard !== "number") appData.distractions.hard = 0;
  if (typeof appData.distractions.phone !== "number") appData.distractions.phone = 0;
  if (typeof appData.distractions.tired !== "number") appData.distractions.tired = 0;
  if (typeof appData.distractions.start !== "number") appData.distractions.start = 0;

  return appData.distractions;
}

function getDistractionLabel(type) {
  const labels = {
    hard: "太难了",
    phone: "想刷手机",
    tired: "太累了",
    start: "不会开始"
  };

  return labels[type] || "未知原因";
}

function getDistractionSuggestion(type) {
  const suggestions = {
    hard: "你的主要阻力是任务难度带来的逃避感。建议把任务拆成“只读题、只圈条件、只判断题型”三个极小步骤，不要求一开始就做出来。",
    phone: "你的主要阻力是即时满足。建议使用“再坚持 5 分钟”策略，把刷手机从立刻执行改成延迟执行。",
    tired: "你的主要阻力是精力不足。建议把高难学习改成低强度复习，比如整理错题、看笔记、背公式，不要硬扛。",
    start: "你的主要阻力是启动困难。建议每次学习前只写一个动作：打开书、写标题、抄第一行题目。先动起来，再谈效率。"
  };

  return suggestions[type] || "继续观察你的分心模式，先记录，不急着责备自己。";
}

function getMainDistractionType(distractions) {
  const entries = Object.entries(distractions);

  let maxType = null;
  let maxValue = 0;

  entries.forEach(function(entry) {
    const type = entry[0];
    const value = entry[1];

    if (value > maxValue) {
      maxType = type;
      maxValue = value;
    }
  });

  return maxValue === 0 ? null : maxType;
}

function renderDistractionPanel() {
  const hardEl = document.getElementById("distractionHard");

  if (!hardEl) return;

  const distractions = ensureDistractionData();

  document.getElementById("distractionHard").innerText = distractions.hard;
  document.getElementById("distractionPhone").innerText = distractions.phone;
  document.getElementById("distractionTired").innerText = distractions.tired;
  document.getElementById("distractionStart").innerText = distractions.start;

  const mainType = getMainDistractionType(distractions);
  const mainReason = document.getElementById("distractionMainReason");
  const suggestion = document.getElementById("distractionSuggestion");

  if (!mainType) {
    mainReason.innerText = "暂无分心记录。";
    suggestion.innerText = "先完成一次御书房专注，再观察你的分心模式。";
    return;
  }

  mainReason.innerText = "当前最常见分心原因：" + getDistractionLabel(mainType);
  suggestion.innerText = getDistractionSuggestion(mainType);
}

function recordDistraction(type) {
  const distractions = ensureDistractionData();

  if (!distractions[type] && distractions[type] !== 0) {
    distractions[type] = 0;
  }

  distractions[type] += 1;

  saveData();
  renderDistractionPanel();
}

document.querySelectorAll(".distraction-btn").forEach(function(button) {
  button.addEventListener("click", function() {
    const type = button.dataset.distraction;

    if (!type) return;

    recordDistraction(type);
  });
});

ensureDistractionData();
renderDistractionPanel();