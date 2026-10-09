/*
  档案：成长阶位、星辰星图、学习数据、分心档案、奏对录。
  人格五维雷达见 radar.js。
*/

const STAR_MAP_CAPACITY = 30;
const STAR_MAP_POINTS = buildStarMapPoints();

function seededRandom(seed) {
  let t = seed;
  return function() {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/* 三行蛇形排布，点亮顺序即连线顺序，形成一条逐渐延伸的星轨 */
function buildStarMapPoints() {
  const random = seededRandom(1661);
  const points = [];

  for (let i = 0; i < STAR_MAP_CAPACITY; i++) {
    const row = Math.floor(i / 10);
    const step = i % 10;
    const col = row % 2 === 0 ? step : 9 - step;
    points.push({
      x: 22 + col * 31.5 + (random() - 0.5) * 14,
      y: 30 + row * 58 + (random() - 0.5) * 30,
      r: 1.6 + random() * 1.4
    });
  }

  return points;
}

/* ---------- 成长 ---------- */

function renderGrowth() {
  const score = getGrowthScore(appData);
  const level = getGrowthLevel(score);

  document.getElementById("growthLevelName").textContent = level.current.name;
  document.getElementById("growthLevelDesc").textContent = level.current.desc;
  document.getElementById("growthScore").textContent = score;
  document.getElementById("growthProgressBar").style.width = level.progress + "%";
  document.getElementById("growthProgress").setAttribute("aria-valuenow", String(level.progress));
  document.getElementById("growthNextText").textContent = level.next
    ? "距离下一阶位「" + level.next.name + "」还差 " + (level.next.score - score) + " 成长值。"
    : "已达最高阶位：成局。接下来要做的是守成。";

  document.getElementById("growthStreak").textContent = getStreak(appData.dailyData);
  document.getElementById("growthActiveDays").textContent = getActiveDays(appData.dailyData);
  document.getElementById("growthFocusRounds").textContent = toCount(appData.focusSessions);

  const ladder = document.getElementById("growthLadder");
  ladder.innerHTML = GROWTH_LEVELS.map(function(item) {
    const reached = score >= item.score;
    const current = item === level.current;
    return (
      '<li class="ladder-step' + (reached ? " is-reached" : "") + (current ? " is-current" : "") + '"' +
      (current ? ' aria-current="step"' : "") + ">" +
      '<span class="ladder-name">' + item.name + "</span>" +
      '<span class="ladder-score num">' + item.score + "</span>" +
      "</li>"
    );
  }).join("");

  const badges = getGrowthBadges(appData);
  document.getElementById("badgeMeta").textContent =
    badges.filter(function(b) {
      return b.unlocked;
    }).length + " / " + badges.length;

  document.getElementById("growthBadges").innerHTML = badges
    .map(function(badge) {
      return (
        '<li class="badge' + (badge.unlocked ? " is-unlocked" : "") + '">' +
        '<span class="badge-seal" aria-hidden="true">' + badge.title.slice(0, 2) + "</span>" +
        '<span class="badge-body">' +
        '<span class="badge-title">' + badge.title + '<span class="visually-hidden">' + (badge.unlocked ? "，已解锁" : "，未解锁") + "</span></span>" +
        '<span class="badge-desc">' + badge.desc + "</span>" +
        "</span>" +
        "</li>"
      );
    })
    .join("");
}

/* ---------- 星图 ---------- */

function renderStarMap() {
  const stars = toCount(appData.stars);
  const lit = Math.min(stars, STAR_MAP_CAPACITY);
  const stage = getStarMapStage(stars);

  document.getElementById("starMapTitle").textContent = stage.title;
  document.getElementById("starMapComment").textContent = stage.comment;
  document.getElementById("starMapCount").textContent = stars;
  document.getElementById("starMapCapacity").textContent =
    stars > STAR_MAP_CAPACITY ? "已满一图" : "/ " + STAR_MAP_CAPACITY;

  const litPoints = STAR_MAP_POINTS.slice(0, lit);
  const path = litPoints.length > 1
    ? '<polyline class="star-trail" points="' +
      litPoints
        .map(function(p) {
          return p.x.toFixed(1) + "," + p.y.toFixed(1);
        })
        .join(" ") +
      '"></polyline>'
    : "";

  const nodes = STAR_MAP_POINTS.map(function(p, i) {
    const isLit = i < lit;
    const isLatest = isLit && i === lit - 1;
    return (
      (isLatest ? '<circle class="star-halo" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="9"></circle>' : "") +
      '<circle class="star-node' + (isLit ? " is-lit" : "") + '" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) +
      '" r="' + (isLit ? p.r + 1 : 2).toFixed(1) + '"></circle>'
    );
  }).join("");

  document.getElementById("starMap").innerHTML =
    '<svg viewBox="0 0 330 180" role="img" aria-label="星辰星图：已点亮 ' + stars + " 颗，共 " + STAR_MAP_CAPACITY + ' 个星位">' +
    path + nodes +
    "</svg>";
}

/* ---------- 学习数据 ---------- */

function renderStudyData() {
  const key = dateKey();
  const today = peekDay(key);
  const taskRate = getTaskRate(getTasksFor(key));
  const avg = today.sessions === 0 ? 0 : Math.round(today.minutes / today.sessions);

  document.getElementById("dataTaskRate").textContent = taskRate;
  document.getElementById("dataTodayMinutes").textContent = today.minutes;
  document.getElementById("dataTodaySessions").textContent = today.sessions;
  document.getElementById("dataAvgSession").textContent = avg;
  document.getElementById("dataTotalMinutes").textContent = toCount(appData.totalMinutes);
  document.getElementById("dataTotalScore").textContent = getDataScore(appData);
  document.getElementById("dataComment").textContent = getDataComment(appData, today, taskRate);

  const days = [];
  let max = 0;
  for (let i = -6; i <= 0; i++) {
    const k = dateKey(i);
    const minutes = peekDay(k).minutes;
    max = Math.max(max, minutes);
    days.push({ key: k, minutes: minutes, isToday: i === 0 });
  }

  const weekTotal = days.reduce(function(sum, d) {
    return sum + d.minutes;
  }, 0);
  document.getElementById("weekMeta").textContent = "合计 " + weekTotal + " 分钟";

  document.getElementById("weekBars").innerHTML = days
    .map(function(d) {
      const parts = d.key.split("-");
      const height = d.minutes === 0 ? 0 : Math.max(6, Math.round((d.minutes / max) * 100));
      return (
        '<li class="week-bar' + (d.isToday ? " is-today" : "") + '">' +
        '<span class="week-value num">' + (d.minutes || "") + "</span>" +
        '<span class="week-track"><span class="week-fill" style="height:' + height + '%"></span></span>' +
        '<span class="week-label">' + (d.isToday ? "今日" : Number(parts[1]) + "/" + Number(parts[2])) + "</span>" +
        '<span class="visually-hidden">' + d.minutes + " 分钟</span>" +
        "</li>"
      );
    })
    .join("");
}

/* ---------- 分心 ---------- */

function renderDistractionArchive() {
  const counts = appData.distractions;
  const max = Math.max(1, ...DISTRACTION_TYPES.map(function(t) {
    return toCount(counts[t]);
  }));
  const main = getMainDistraction(counts);

  document.getElementById("distractionBars").innerHTML = DISTRACTION_TYPES.map(function(type) {
    const value = toCount(counts[type]);
    return (
      '<li class="hbar' + (type === main ? " is-main" : "") + '">' +
      '<span class="hbar-label">' + DISTRACTIONS[type].label + "</span>" +
      '<span class="hbar-track"><span class="hbar-fill" style="width:' + Math.round((value / max) * 100) + '%"></span></span>' +
      '<span class="hbar-value num">' + value + "</span>" +
      "</li>"
    );
  }).join("");

  document.getElementById("distractionMainReason").textContent = main
    ? "当前最常见分心原因：" + DISTRACTIONS[main].label
    : "暂无分心记录";
  document.getElementById("distractionSuggestion").textContent = main
    ? DISTRACTIONS[main].suggestion
    : "在御书房点选「朕心浮动」的原因后，这里会分析你最容易被什么打断。";
}

/* ---------- 奏对录 ---------- */

let reviewHistorySignature = null;

function renderReviewHistory() {
  const list = document.getElementById("reviewHistory");
  const keys = Object.keys(appData.reviews).sort().reverse();

  // 内容未变时不重绘，保留用户展开的条目
  const signature = keys.map(function(key) {
    return key + appData.reviews[key].updatedAt;
  }).join("|") + dateKey();
  if (signature === reviewHistorySignature) return;
  reviewHistorySignature = signature;

  document.getElementById("reviewHistoryMeta").textContent = keys.length ? "共 " + keys.length + " 篇" : "";

  if (keys.length === 0) {
    list.innerHTML =
      "<li>" +
      emptyState({
        icon: "brush",
        title: "尚无奏对",
        desc: "每日晚间在「今日」写下奏对，这里会按日期收录，并保留当日御批。"
      }) +
      "</li>";
    return;
  }

  list.innerHTML = keys
    .slice(0, 60)
    .map(function(key) {
      const entry = appData.reviews[key];
      return (
        '<li class="row review-row">' +
        '<details class="disclosure review-details">' +
        "<summary>" +
        '<span class="review-date">' + formatDayLabel(key) + '<span class="text-tertiary num"> ' + key + "</span></span>" +
        '<span class="review-snippet">' + escapeHtml(entry.comment) + "</span>" +
        icon("chevron", "icon icon-sm chevron") +
        "</summary>" +
        '<dl class="review-qa">' +
        REVIEW_QUESTIONS.map(function(q) {
          return entry[q.key]
            ? "<dt>" + escapeHtml(q.label) + "</dt><dd>" + escapeHtml(entry[q.key]) + "</dd>"
            : "";
        }).join("") +
        "</dl>" +
        "</details>" +
        "</li>"
      );
    })
    .join("");
}

registerRenderer(renderGrowth);
registerRenderer(renderStarMap);
registerRenderer(renderStudyData);
registerRenderer(renderDistractionArchive);
registerRenderer(renderReviewHistory);
