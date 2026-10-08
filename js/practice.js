/*
  修炼：择一维、抽题、完成落印。同一道题完成一次后需换题再练，避免重复领印。
*/

function renderPractice() {
  const type = appData.currentPracticeType;
  const today = peekDay();

  document.getElementById("practiceSeals").textContent = toCount(appData.seals);
  document.getElementById("practiceToday").textContent = today.practice;

  const list = document.getElementById("dimensionList");
  list.innerHTML = PRACTICE_TYPES.map(function(key) {
    const dim = PRACTICE_DIMENSIONS[key];
    const selected = key === type;
    return (
      '<button type="button" class="dimension" role="radio" aria-checked="' + selected + '" tabindex="' + (selected ? 0 : -1) + '" data-type="' + key + '">' +
      '<span class="dimension-name">' + dim.label + "</span>" +
      '<span class="dimension-desc">' + dim.desc + "</span>" +
      '<span class="dimension-count num" aria-label="已修炼 ' + toCount(appData.practiceStats[key]) + ' 次">' + toCount(appData.practiceStats[key]) + "</span>" +
      "</button>"
    );
  }).join("");

  document.getElementById("practiceDimTag").textContent = PRACTICE_DIMENSIONS[type].label;
  document.getElementById("practiceText").textContent = appData.currentPractice;

  const done = appData.currentPracticeDone;
  const completeBtn = document.getElementById("practiceComplete");
  completeBtn.disabled = done;
  completeBtn.innerHTML = done ? icon("check") + "本题已领印" : icon("seal") + "完成修炼，领御印";

  document.getElementById("practiceDoneHint").hidden = !done;
  document.getElementById("practiceCard").classList.toggle("is-done", done);
}

function pickPractice(type) {
  if (!PRACTICE_DIMENSIONS[type]) return;

  appData.currentPracticeType = type;
  appData.currentPractice = drawPractice(type, appData.currentPractice);
  appData.currentPracticeDone = false;

  saveData();
  renderAllNow();
  flashElement(document.getElementById("practiceCard"));
}

function completePractice() {
  if (appData.currentPracticeDone) return;

  const type = appData.currentPracticeType;
  appData.seals += 1;
  appData.practiceStats[type] = toCount(appData.practiceStats[type]) + 1;
  ensureDay().practice += 1;
  appData.currentPracticeDone = true;

  commit();
  playSealStamp("御印");
  showToast("修炼完成，获得一枚御印。", { type: "seal" });
}

const dimensionList = document.getElementById("dimensionList");

dimensionList.addEventListener("click", function(event) {
  const button = event.target.closest("[data-type]");
  if (button) {
    pickPractice(button.dataset.type);
    const next = dimensionList.querySelector('[data-type="' + button.dataset.type + '"]');
    if (next) next.focus();
  }
});

dimensionList.addEventListener("keydown", function(event) {
  const keys = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
  if (!keys[event.key]) return;

  event.preventDefault();
  const index = PRACTICE_TYPES.indexOf(appData.currentPracticeType);
  const next = PRACTICE_TYPES[(index + keys[event.key] + PRACTICE_TYPES.length) % PRACTICE_TYPES.length];
  pickPractice(next);
  dimensionList.querySelector('[data-type="' + next + '"]').focus();
});

document.getElementById("practiceShuffle").addEventListener("click", function() {
  pickPractice(appData.currentPracticeType);
});

document.getElementById("practiceComplete").addEventListener("click", completePractice);

registerRenderer(renderPractice);
