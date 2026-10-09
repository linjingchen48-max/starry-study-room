/*
  错题阁：记录错题、按错因筛选与搜索、重练点亮星辰（每题只奖励一次）。
*/

const mistakeView = {
  filter: "all",
  query: "",
  openIds: new Set()
};

const MISTAKE_FILTERS = [
  { key: "all", label: "全部" },
  { key: "pending", label: "待重练" },
  { key: "concept", label: "概念不清" },
  { key: "logic", label: "逻辑断层" },
  { key: "careless", label: "粗心失误" }
];

function renderMistakeSummary() {
  const counts = getMistakeCounts(appData.mistakes);
  document.getElementById("mistakeConceptCount").textContent = counts.concept;
  document.getElementById("mistakeLogicCount").textContent = counts.logic;
  document.getElementById("mistakeCarelessCount").textContent = counts.careless;
  document.getElementById("mistakeDiagnosis").textContent = getMistakeDiagnosis(appData.mistakes);
}

function renderMistakeFilters() {
  const pending = appData.mistakes.filter(function(item) {
    return !item.reviewed;
  }).length;
  const counts = getMistakeCounts(appData.mistakes);
  const total = appData.mistakes.length;

  document.getElementById("mistakeFilters").innerHTML = MISTAKE_FILTERS.map(function(f) {
    const count = f.key === "all" ? total : f.key === "pending" ? pending : counts[f.key];
    return (
      '<button type="button" class="chip" data-filter="' + f.key + '" aria-pressed="' + (mistakeView.filter === f.key) + '">' +
      f.label + '<span class="chip-count">' + count + "</span></button>"
    );
  }).join("");
}

function renderMistakeList() {
  const list = document.getElementById("mistakeList");
  const all = appData.mistakes;
  const items = filterMistakes(all, mistakeView.filter, mistakeView.query);

  document.getElementById("mistakeListMeta").textContent =
    all.length === 0 ? "" : items.length === all.length ? "共 " + all.length + " 道" : "显示 " + items.length + " / " + all.length;

  if (all.length === 0) {
    list.innerHTML =
      "<li>" +
      emptyState({
        icon: "book",
        title: "错题阁尚空",
        desc: "记录第一道错题，写清错误过程与正确思路，这里会自动生成错因档案。",
        action: "openMistakeForm",
        actionLabel: "记一道错题"
      }) +
      "</li>";
    return;
  }

  if (items.length === 0) {
    list.innerHTML =
      "<li>" +
      emptyState({
        icon: "search",
        title: "没有符合条件的错题",
        desc: "换个关键词，或清除筛选再看看。",
        action: "clearMistakeFilter",
        actionLabel: "清除筛选"
      }) +
      "</li>";
    return;
  }

  list.innerHTML = items
    .map(function(item) {
      const title = escapeHtml(item.title);
      const created = dateKeyFromISO(item.createdAt);
      return (
        '<li class="row mistake-row' + (item.reviewed ? " is-reviewed" : "") + '" data-mistake-id="' + escapeHtml(item.id) + '">' +
        '<details class="disclosure mistake-details"' + (mistakeView.openIds.has(item.id) ? " open" : "") + ">" +
        "<summary>" +
        '<span class="row-main">' +
        '<span class="row-title">' + title + "</span>" +
        '<span class="row-meta mistake-meta">' +
        '<span class="tag">' + MISTAKE_REASON_NAMES[item.reason] + "</span>" +
        (item.reviewed ? '<span class="tag tag-gold">已重练</span>' : '<span class="tag tag-dot tag-seal">待重练</span>') +
        (created ? "<span>" + formatDayLabel(created) + "</span>" : "") +
        "</span>" +
        "</span>" +
        icon("chevron", "icon icon-sm chevron") +
        "</summary>" +
        '<div class="mistake-body">' +
        '<p class="mistake-label">错误过程</p><p>' + (item.wrong ? escapeHtml(item.wrong) : '<span class="text-tertiary">未填写</span>') + "</p>" +
        '<p class="mistake-label">正确思路</p><p>' + (item.correct ? escapeHtml(item.correct) : '<span class="text-tertiary">未填写</span>') + "</p>" +
        '<div class="btn-row">' +
        (item.reviewed
          ? '<button type="button" class="btn btn-quiet btn-sm" data-mistake-action="review">取消重练标记</button>'
          : '<button type="button" class="btn btn-secondary btn-sm" data-mistake-action="review">' + icon("check", "icon icon-sm") + "已重练一遍</button>") +
        '<button type="button" class="btn btn-danger-quiet btn-sm" data-mistake-action="delete">' + icon("trash", "icon icon-sm") + "删除</button>" +
        "</div>" +
        "</div>" +
        "</details>" +
        "</li>"
      );
    })
    .join("");
}

function renderMistakes() {
  renderMistakeSummary();
  renderMistakeFilters();
  renderMistakeList();
}

function openMistakeForm() {
  const details = document.getElementById("mistakeFormDetails");
  details.open = true;
  details.scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById("mistakeTitle").focus({ preventScroll: true });
}

function clearMistakeFilter() {
  mistakeView.filter = "all";
  mistakeView.query = "";
  document.getElementById("mistakeSearch").value = "";
  renderMistakes();
}

function saveMistake(event) {
  event.preventDefault();

  const titleInput = document.getElementById("mistakeTitle");
  const title = titleInput.value.trim();

  if (!title) {
    setFieldError(titleInput, "请先写下错题名称。");
    titleInput.focus();
    return;
  }
  setFieldError(titleInput, "");

  const item = normalizeMistake({
    title: title,
    reason: document.getElementById("mistakeReason").value,
    wrong: document.getElementById("mistakeWrong").value,
    correct: document.getElementById("mistakeCorrect").value
  });

  const saved = persistChange(function() {
    appData.mistakes.unshift(item);
  });
  // 未保存时保留表单内容，用户可稍后重试
  if (!saved) return;

  event.target.reset();

  if (mistakeView.filter !== "all" && mistakeView.filter !== "pending" && mistakeView.filter !== item.reason) {
    mistakeView.filter = "all";
  }

  renderAllNow();
  flashElement(document.querySelector('[data-mistake-id="' + item.id + '"]'));
  showToast("已收入错题阁。", { type: "success" });
}

function toggleMistakeReview(id) {
  let outcome = "";
  let before = 0;

  const saved = persistChange(function() {
    const item = appData.mistakes.find(function(m) {
      return m.id === id;
    });
    if (!item) return false;

    if (item.reviewed) {
      item.reviewed = false;
      outcome = "unmarked";
      return;
    }

    item.reviewed = true;
    if (!item.starRewarded) {
      before = toCount(appData.stars);
      appData.stars = before + 1;
      item.starRewarded = true;
      outcome = "star";
      return;
    }
    outcome = "marked";
  });
  refreshAll();
  if (!saved) return;

  if (outcome === "unmarked") showToast("已取消重练标记。已获得的星辰不会扣除。");
  if (outcome === "star") showToast("错题已重练，点亮一颗星辰。星辰 " + before + " → " + appData.stars, { type: "star" });
  if (outcome === "marked") showToast("已标记重练。此题的星辰此前已点亮过。", { type: "success" });
}

function deleteMistake(id) {
  let index = -1;
  let removed = null;

  const saved = persistChange(function() {
    index = appData.mistakes.findIndex(function(m) {
      return m.id === id;
    });
    if (index === -1) return false;
    removed = appData.mistakes.splice(index, 1)[0];
  });
  refreshAll();
  if (!saved) return;

  showToast("已删除「" + removed.title + "」", {
    actionLabel: "撤销",
    onAction: function() {
      const restored = persistChange(function() {
        if (appData.mistakes.some(function(m) { return m.id === removed.id; })) return false;
        appData.mistakes.splice(Math.min(index, appData.mistakes.length), 0, removed);
      });
      if (restored) refreshAll();
    }
  });
}

document.getElementById("mistakeForm").addEventListener("submit", saveMistake);

document.getElementById("mistakeTitle").addEventListener("input", function(event) {
  if (event.target.value.trim()) setFieldError(event.target, "");
});

document.getElementById("mistakeFilters").addEventListener("click", function(event) {
  const chip = event.target.closest("[data-filter]");
  if (!chip) return;
  mistakeView.filter = chip.dataset.filter;
  renderMistakes();
  const active = document.querySelector('#mistakeFilters [data-filter="' + mistakeView.filter + '"]');
  if (active) active.focus();
});

document.getElementById("mistakeSearch").addEventListener("input", function(event) {
  mistakeView.query = event.target.value;
  renderMistakeList();
});

document.getElementById("mistakeList").addEventListener(
  "toggle",
  function(event) {
    const row = event.target.closest && event.target.closest("[data-mistake-id]");
    if (!row) return;
    if (event.target.open) mistakeView.openIds.add(row.dataset.mistakeId);
    else mistakeView.openIds.delete(row.dataset.mistakeId);
  },
  true
);

document.getElementById("mistakeList").addEventListener("click", function(event) {
  const empty = event.target.closest("[data-empty-action]");
  if (empty) {
    if (empty.dataset.emptyAction === "openMistakeForm") openMistakeForm();
    if (empty.dataset.emptyAction === "clearMistakeFilter") clearMistakeFilter();
    return;
  }

  const button = event.target.closest("[data-mistake-action]");
  if (!button) return;
  const row = button.closest("[data-mistake-id]");
  const id = row.dataset.mistakeId;

  if (button.dataset.mistakeAction === "review") toggleMistakeReview(id);
  if (button.dataset.mistakeAction === "delete") deleteMistake(id);
});

registerRenderer(renderMistakes);
