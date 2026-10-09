/*
  未提交输入的草稿：御案、奏对、错题表单的内容随输入存入 sessionStorage（仅本标签页），
  刷新、版本更新后重新载入、浏览器回收后台标签页时都能恢复。提交成功后表单清空，草稿随之清空。
*/

const DRAFT_KEY = "starryStudyRoom_drafts";
const DRAFT_TASK_FIELDS = ["taskInput", "goalInput"];
const DRAFT_MISTAKE_FIELDS = ["mistakeTitle", "mistakeWrong", "mistakeCorrect"];

function getReviewDraftFields() {
  return REVIEW_QUESTIONS.map(function(q) {
    return "review-" + q.key;
  });
}

function readFieldValues(ids) {
  const values = {};
  ids.forEach(function(id) {
    const el = document.getElementById(id);
    if (el && el.value.trim()) values[id] = el.value;
  });
  return values;
}

function collectDrafts() {
  const fields = Object.assign({}, readFieldValues(DRAFT_TASK_FIELDS), readFieldValues(DRAFT_MISTAKE_FIELDS));
  const draft = { fields: fields };

  // 奏对只在编辑中才算草稿；未编辑时输入框内是已呈内容的副本
  if (reviewEditing) {
    draft.review = readFieldValues(getReviewDraftFields());
    draft.reviewDay = dateKey();
  }
  if (fields.mistakeTitle || fields.mistakeWrong || fields.mistakeCorrect) {
    draft.mistakeReason = document.getElementById("mistakeReason").value;
  }
  return draft;
}

function hasDraftContent(draft) {
  return Boolean(draft && (Object.keys(draft.fields || {}).length || draft.review));
}

function saveDrafts() {
  try {
    const draft = collectDrafts();
    if (hasDraftContent(draft)) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else sessionStorage.removeItem(DRAFT_KEY);
    return true;
  } catch (error) {
    return false;
  }
}

function readDrafts() {
  try {
    const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY));
    return isPlainObject(draft) ? draft : null;
  } catch (error) {
    return null;
  }
}

function fillFields(values) {
  let filled = false;
  Object.keys(values || {}).forEach(function(id) {
    const el = document.getElementById(id);
    if (el && typeof values[id] === "string" && !el.value) {
      el.value = values[id];
      filled = true;
    }
  });
  return filled;
}

/* 启动时调用；返回是否恢复了内容 */
function restoreDrafts() {
  const draft = readDrafts();
  if (!hasDraftContent(draft)) return false;

  const fields = isPlainObject(draft.fields) ? draft.fields : {};
  let restored = fillFields(fields);

  if (fields.mistakeTitle || fields.mistakeWrong || fields.mistakeCorrect) {
    if (MISTAKE_REASONS.includes(draft.mistakeReason)) document.getElementById("mistakeReason").value = draft.mistakeReason;
    document.getElementById("mistakeFormDetails").open = true;
  }

  // 跨日后不恢复奏对草稿，以免写进新一天
  if (isPlainObject(draft.review) && draft.reviewDay === dateKey()) {
    const entry = appData.reviews[draft.reviewDay] || {};
    reviewEditing = true;
    REVIEW_QUESTIONS.forEach(function(q) {
      const id = "review-" + q.key;
      document.getElementById(id).value = typeof draft.review[id] === "string" ? draft.review[id] : entry[q.key] || "";
    });
    renderReview();
    restored = true;
  }

  return restored;
}

["input", "change"].forEach(function(type) {
  document.addEventListener(type, function(event) {
    if (event.target && event.target.closest && event.target.closest("#taskForm, #reviewForm, #mistakeForm")) saveDrafts();
  });
});

// 提交、取消后表单状态才更新，稍后再存
["submit", "click"].forEach(function(type) {
  document.addEventListener(type, function() {
    setTimeout(saveDrafts, 0);
  });
});

window.addEventListener("pagehide", saveDrafts);
document.addEventListener("visibilitychange", function() {
  if (document.visibilityState === "hidden") saveDrafts();
});
