function ensureMistakeData() {
  if (!appData.mistakes) {
    appData.mistakes = [];
  }

  if (!Array.isArray(appData.mistakes)) {
    appData.mistakes = [];
  }

  return appData.mistakes;
}

function getMistakeReasonName(reason) {
  const names = {
    concept: "概念不清",
    logic: "逻辑断层",
    careless: "粗心失误"
  };

  return names[reason] || "未知错因";
}

function getMistakeCounts() {
  const mistakes = ensureMistakeData();

  return {
    concept: mistakes.filter(function(item) {
      return item.reason === "concept";
    }).length,

    logic: mistakes.filter(function(item) {
      return item.reason === "logic";
    }).length,

    careless: mistakes.filter(function(item) {
      return item.reason === "careless";
    }).length
  };
}

function getMainMistakeReason(counts) {
  let mainReason = null;
  let maxCount = 0;

  Object.entries(counts).forEach(function(entry) {
    const reason = entry[0];
    const count = entry[1];

    if (count > maxCount) {
      mainReason = reason;
      maxCount = count;
    }
  });

  return maxCount === 0 ? null : mainReason;
}

function getMistakeDiagnosis() {
  const counts = getMistakeCounts();
  const mainReason = getMainMistakeReason(counts);

  if (!mainReason) {
    return "暂无错题记录。先记录一道错题，就能开始看见自己的薄弱点。";
  }

  if (mainReason === "concept") {
    return "当前主要错因是：概念不清。建议你先不要急着刷题，把定义、公式、适用条件重新抄一遍，再做一题同类题。";
  }

  if (mainReason === "logic") {
    return "当前主要错因是：逻辑断层。说明你不是完全不会，而是步骤衔接不稳。建议每道题写出“为什么下一步这样做”。";
  }

  if (mainReason === "careless") {
    return "当前主要错因是：粗心失误。建议你建立检查顺序：先看符号，再看条件，再看计算。粗心不是性格，是流程没固定。";
  }

  return "继续记录错题。错因越清楚，进步越具体。";
}

function renderMistakePanel() {
  const mistakeList = document.getElementById("mistakeList");

  if (!mistakeList) return;

  const mistakes = ensureMistakeData();
  const counts = getMistakeCounts();

  document.getElementById("mistakeConceptCount").innerText = counts.concept;
  document.getElementById("mistakeLogicCount").innerText = counts.logic;
  document.getElementById("mistakeCarelessCount").innerText = counts.careless;
  document.getElementById("mistakeDiagnosis").innerText = getMistakeDiagnosis();

  if (mistakes.length === 0) {
    mistakeList.innerHTML = `<p class="muted">暂无错题。记录第一道错题后，这里会自动生成错因档案。</p>`;
    return;
  }

  mistakeList.innerHTML = mistakes.map(function(item, index) {
    const reviewedClass = item.reviewed ? "reviewed" : "";
    const reviewedText = item.reviewed ? "已重练" : "标记已重练";

    return `
      <div class="mistake-item ${reviewedClass}">
        <p class="mistake-title">${item.title}</p>
        <p class="mistake-meta">错因：${getMistakeReasonName(item.reason)}</p>

        <p class="mistake-text"><strong>错误过程：</strong>${item.wrong || "未填写"}</p>
        <p class="mistake-text"><strong>正确思路：</strong>${item.correct || "未填写"}</p>

        <div class="mistake-actions">
          <button class="mistake-small-btn review-btn" data-mistake-action="review" data-index="${index}">
            ${reviewedText}
          </button>

          <button class="mistake-small-btn" data-mistake-action="delete" data-index="${index}">
            删除
          </button>
        </div>
      </div>
    `;
  }).join("");
}

function saveMistake() {
  const titleInput = document.getElementById("mistakeTitle");
  const reasonSelect = document.getElementById("mistakeReason");
  const wrongInput = document.getElementById("mistakeWrong");
  const correctInput = document.getElementById("mistakeCorrect");

  const title = titleInput.value.trim();
  const reason = reasonSelect.value;
  const wrong = wrongInput.value.trim();
  const correct = correctInput.value.trim();

  if (!title) {
    alert("请先写下错题名称。");
    return;
  }

  const mistakes = ensureMistakeData();

  mistakes.unshift({
    title: title,
    reason: reason,
    wrong: wrong,
    correct: correct,
    reviewed: false,
    starRewarded: false,
    createdAt: new Date().toISOString()
  });

  titleInput.value = "";
  wrongInput.value = "";
  correctInput.value = "";

  saveData();
  renderMistakePanel();

  alert("已收入错题阁。");
}

function refreshAllPanels() {
  saveData();

  renderMistakePanel();

  if (typeof renderTasks === "function") {
    renderTasks();
  }

  if (typeof renderDataPanel === "function") {
    renderDataPanel();
  }

  const archiveStars = document.getElementById("archiveStars");
  if (archiveStars) {
    archiveStars.innerText = appData.stars;
  }
}

document.getElementById("saveMistakeBtn")?.addEventListener("click", saveMistake);

document.addEventListener("click", function(event) {
  const button = event.target.closest("[data-mistake-action]");

  if (!button) return;

  const action = button.dataset.mistakeAction;
  const index = Number(button.dataset.index);

  const mistakes = ensureMistakeData();

  if (!mistakes[index]) return;

  if (action === "review") {
    const item = mistakes[index];

    // 如果已经重练过，再点就只切换状态，不重复奖励
    if (!item.reviewed) {
      item.reviewed = true;

      // 只有第一次从未重练变成已重练，才加星
      if (!item.starRewarded) {
        const beforeStars = Number(appData.stars) || 0;

        appData.stars = beforeStars + 1;
        item.starRewarded = true;

        refreshAllPanels();

        alert("错题已重练，点亮一颗星辰。\n星辰：" + beforeStars + " → " + appData.stars);
        return;
      }
    } else {
      item.reviewed = false;
      refreshAllPanels();
      alert("已取消重练标记。注意：已获得的星辰不会扣除。");
      return;
    }
  }

  if (action === "delete") {
    mistakes.splice(index, 1);
    refreshAllPanels();
    return;
  }
});

ensureMistakeData();
renderMistakePanel();