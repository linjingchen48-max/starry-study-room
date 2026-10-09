/*
  业务规则与文案：成长值、阶位、徽章、御批、分心建议、修炼题库、错因诊断。
  纯函数，不读写 DOM。
*/

/* ---------- 统计 ---------- */

function isDayActive(day) {
  if (!day) return false;
  return day.minutes > 0 || day.sessions > 0 || day.practice > 0 || day.review === true;
}

function getActiveDays(dailyData) {
  return Object.values(dailyData || {}).filter(isDayActive).length;
}

function getStreak(dailyData, today = new Date()) {
  let streak = 0;

  for (let i = 0; i < 365; i++) {
    if (isDayActive((dailyData || {})[dateKey(-i, today)])) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

function getTaskRate(tasks) {
  if (!tasks || tasks.length === 0) return 0;
  const doneCount = tasks.filter(function(task) {
    return task.done;
  }).length;
  return Math.round((doneCount / tasks.length) * 100);
}

function getGrowthScore(data) {
  return (
    toCount(data.stars) * 5 +
    toCount(data.seals) * 6 +
    Math.floor(toCount(data.totalMinutes) / 25) * 4 +
    getActiveDays(data.dailyData) * 8
  );
}

function getDataScore(data) {
  return toCount(data.stars) + toCount(data.seals) + Math.floor(toCount(data.totalMinutes) / 25);
}

/* ---------- 成长阶位 ---------- */

const GROWTH_LEVELS = [
  { name: "入书房", score: 0, desc: "心志初萌，先建立秩序。" },
  { name: "稳心", score: 40, desc: "能克制分心冲动，开始形成稳定节奏。" },
  { name: "持恒", score: 90, desc: "学习与修炼开始连续，能在低状态时仍做一点。" },
  { name: "明察", score: 150, desc: "能看见错因、分心原因和情绪波动的根本。" },
  { name: "有度", score: 230, desc: "进退有节，不因一时得失破坏整体节奏。" },
  { name: "成局", score: 330, desc: "自律、沉稳与长期主义开始合成稳定人格系统。" }
];

function getGrowthLevel(score) {
  let current = GROWTH_LEVELS[0];
  let next = null;

  for (let i = 0; i < GROWTH_LEVELS.length; i++) {
    if (score >= GROWTH_LEVELS[i].score) {
      current = GROWTH_LEVELS[i];
      next = GROWTH_LEVELS[i + 1] || null;
    }
  }

  const progress = next
    ? Math.max(0, Math.min(100, Math.round(((score - current.score) / (next.score - current.score)) * 100)))
    : 100;

  return { current: current, next: next, progress: progress };
}

function getGrowthBadges(data) {
  const streak = getStreak(data.dailyData);
  const activeDays = getActiveDays(data.dailyData);

  return [
    { title: "七日星轨", desc: "连续活跃 7 天，说明你已经开始建立最初的节奏。", unlocked: streak >= 7 },
    { title: "初成沉稳", desc: "获得 7 枚御印，说明你已经开始认真训练心性。", unlocked: toCount(data.seals) >= 7 },
    { title: "星辰初明", desc: "点亮 10 颗星辰，说明你已经完成多轮专注。", unlocked: toCount(data.stars) >= 10 },
    { title: "百分钟入定", desc: "累计专注 100 分钟，说明你已经不是只停留在想法阶段。", unlocked: toCount(data.totalMinutes) >= 100 },
    { title: "持恒之印", desc: "总活跃 14 天，说明你的系统开始有长期痕迹。", unlocked: activeDays >= 14 }
  ];
}

/* ---------- 星图 ---------- */

function getStarMapStage(stars) {
  if (stars >= 30) return { title: "群星成图", comment: "星图已成规模。你不是偶尔努力，而是在逐渐形成稳定的自律系统。" };
  if (stars >= 20) return { title: "星河渐起", comment: "星辰已经连成一片。继续保持，真正的改变来自稳定重复。" };
  if (stars >= 10) return { title: "星轨初成", comment: "你已经点亮了第一段星轨。现在要做的是不要断线。" };
  if (stars >= 1) return { title: "星辰初明", comment: "第一颗星已经亮起。不要小看它，这是系统开始运转的信号。" };
  return { title: "星辰未明", comment: "先完成一次专注，点亮第一颗星。" };
}

/* ---------- 今日 ---------- */

const DAILY_QUOTES = [
  "人贵有恒，事贵有序。今日不求尽善，但求不废。",
  "看事不要先看热闹，要先看根本。",
  "心浮时不决策，气盛时不争辩。",
  "先入座，再谈效率。",
  "真正的自律，是心乱时仍能做一点。",
  "今日只做眼前一事，事有次第，心自安定。"
];

function getDailyQuote(date = new Date()) {
  return DAILY_QUOTES[date.getDate() % DAILY_QUOTES.length];
}

function getTodayState(today, taskRate) {
  if (today.minutes >= 25 && taskRate >= 50) return "已入局";
  if (today.minutes > 0) return "已入座";
  if (taskRate > 0) return "已启动";
  return "未入座";
}

function getNextStep(context) {
  const tasks = context.tasks;
  const today = context.today;
  const taskRate = context.taskRate;
  const hasReview = context.hasReview;

  if (tasks.length === 0) {
    return { text: "先写下今日最重要的一件学习任务。不要写太多，先让系统开始运转。", action: "newTask", label: "写下御案" };
  }
  if (taskRate === 0 && today.minutes === 0) {
    return { text: "现在进入御书房，先做一轮 15 分钟轻量专注。只要开始，就已经胜过空想。", action: "focus", label: "进入御书房" };
  }
  if (taskRate > 0 && today.minutes === 0) {
    return { text: "任务已有推进，但还没有专注记录。建议补一轮御书房，让进度更稳定。", action: "focus", label: "进入御书房" };
  }
  if (today.minutes > 0 && taskRate < 50) {
    return { text: "今日已有专注，下一步把一个任务标记完成，让成果可见。", action: "tasks", label: "查看御案" };
  }
  if (today.minutes >= 25 && today.practice === 0) {
    return { text: "今日学习已入座，可以去人格修炼页完成一次修炼，补上心性训练。", action: "practice", label: "去修炼" };
  }
  if (today.minutes >= 25 && taskRate >= 50 && !hasReview) {
    return { text: "今日节奏不错。晚上记得完成今日奏对，把经验沉淀下来。", action: "review", label: "写奏对" };
  }
  return { text: "继续保持。今日不求尽善，但求不废。", action: null, label: "" };
}

/* ---------- 学习数据评语 ---------- */

function getDataComment(data, today, taskRate) {
  if (toCount(data.totalMinutes) === 0 && toCount(data.stars) === 0 && toCount(data.seals) === 0) {
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
  if (toCount(data.seals) > 0) {
    return "今日修身未废。学习与心性同修，才是长期主义的底座。";
  }
  return "今日已有行动痕迹。真正要紧的是明日继续，不让星火断掉。";
}

/* ---------- 奏对与御批 ---------- */

const REVIEW_QUESTIONS = [
  { key: "done", label: "今日完成了什么？", placeholder: "例如：完成数学极限 3 道，背了 30 个单词。" },
  { key: "distraction", label: "今日为何分心？", placeholder: "例如：题太难、想刷手机、情绪不好、太累。" },
  { key: "restless", label: "今日哪一刻最浮躁？", placeholder: "例如：做题卡住的时候，或者刚开始学习前。" },
  { key: "calm", label: "今日有没有做到「沉稳」？", placeholder: "例如：有/没有。具体是哪一件事？" },
  { key: "tomorrow", label: "明日最该改进的一件事是什么？", placeholder: "例如：明天先做最难的一题，不先刷手机。" }
];

function generateRoyalComment(review, today) {
  const done = review.done || "";
  const distraction = review.distraction || "";
  const restless = review.restless || "";
  const calm = review.calm || "";
  const tomorrow = review.tomorrow || "";

  const hasDeepReview =
    done.length >= 6 &&
    distraction.length >= 4 &&
    restless.length >= 4 &&
    calm.length >= 4 &&
    tomorrow.length >= 4;

  if (!done && !distraction && !restless && !calm && !tomorrow) {
    return "今日尚未奏对。先写下一句真实情况，也胜过完全空白。";
  }
  if (hasDeepReview && today.minutes >= 25 && today.practice >= 1) {
    return "你今日有学习、有修炼，也能回看自己的分心与浮躁，已不只是完成任务，而是在建立秩序。明日宜守住最低标准，先稳，再求多。";
  }
  if (today.minutes >= 45) {
    return "你今日能久坐御书房，已有定力。只是专注之后仍需复盘，否则努力容易散成碎片。明日宜先做最重要的一件事。";
  }
  if (distraction || restless) {
    return "你今日虽有分心与浮躁，但能把它写下来，便已不是被它牵着走。明日不必贪多，只需在分心出现时，把任务降到最小一步。";
  }
  if (done) {
    return "今日已有所得，胜在未空过。真正的自律，不是情绪高涨时努力，而是心乱时仍能做一点。明日继续稳住节奏。";
  }
  return "记录虽简，但已有自省之意。明日宜把目标写得更小、更具体，先入座，再谈效率。";
}

/* ---------- 专注 ---------- */

const FOCUS_DURATION_NAMES = {
  15: "轻量启动",
  25: "标准专注",
  45: "深度学习",
  60: "长时修炼"
};

/* ---------- 分心 ---------- */

const DISTRACTIONS = {
  hard: {
    label: "太难了",
    advice: "先别急着做出来，只做第一步：读题、圈条件、判断题型。",
    suggestion: "你的主要阻力是任务难度带来的逃避感。建议把任务拆成“只读题、只圈条件、只判断题型”三个极小步骤，不要求一开始就做出来。"
  },
  phone: {
    label: "想刷手机",
    advice: "再坚持 5 分钟。5 分钟后再决定要不要休息。",
    suggestion: "你的主要阻力是即时满足。建议使用“再坚持 5 分钟”策略，把刷手机从立刻执行改成延迟执行。"
  },
  tired: {
    label: "太累了",
    advice: "把任务降级。现在只做低强度复习，不做高难题。",
    suggestion: "你的主要阻力是精力不足。建议把高难学习改成低强度复习，比如整理错题、看笔记、背公式，不要硬扛。"
  },
  start: {
    label: "不会开始",
    advice: "不要想完整计划。现在只写下第一步要做什么。",
    suggestion: "你的主要阻力是启动困难。建议每次学习前只写一个动作：打开书、写标题、抄第一行题目。先动起来，再谈效率。"
  }
};

function getMainDistraction(distractions) {
  let maxType = null;
  let maxValue = 0;

  DISTRACTION_TYPES.forEach(function(type) {
    const value = toCount((distractions || {})[type]);
    if (value > maxValue) {
      maxType = type;
      maxValue = value;
    }
  });

  return maxType;
}

/* ---------- 修炼 ---------- */

const PRACTICE_DIMENSIONS = {
  calm: { label: "沉稳", desc: "表情管理、语速控制、遇事不慌。" },
  discipline: { label: "自律", desc: "学习打卡、最低标准、持续完成。" },
  insight: { label: "洞察", desc: "看本质、找原因、识别结构。" },
  vision: { label: "格局", desc: "不被小事牵着走，训练长远视角。" },
  speech: { label: "言行", desc: "少废话、有分寸、有气场。" }
};

const PRACTICE_POOL = {
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

function drawPractice(type, current, random = Math.random) {
  const list = PRACTICE_POOL[type];
  if (!list || list.length === 0) return current;

  const candidates = list.length > 1
    ? list.filter(function(text) {
      return text !== current;
    })
    : list;

  return candidates[Math.floor(random() * candidates.length)];
}

/* ---------- 错题 ---------- */

const MISTAKE_REASON_NAMES = {
  concept: "概念不清",
  logic: "逻辑断层",
  careless: "粗心失误"
};

function getMistakeCounts(mistakes) {
  const counts = { concept: 0, logic: 0, careless: 0 };
  (mistakes || []).forEach(function(item) {
    if (counts[item.reason] !== undefined) counts[item.reason] += 1;
  });
  return counts;
}

function getMistakeDiagnosis(mistakes) {
  const counts = getMistakeCounts(mistakes);
  let mainReason = null;
  let maxCount = 0;

  MISTAKE_REASONS.forEach(function(reason) {
    if (counts[reason] > maxCount) {
      mainReason = reason;
      maxCount = counts[reason];
    }
  });

  if (!mainReason) return "暂无错题记录。先记录一道错题，就能开始看见自己的薄弱点。";
  if (mainReason === "concept") {
    return "当前主要错因是：概念不清。建议你先不要急着刷题，把定义、公式、适用条件重新抄一遍，再做一题同类题。";
  }
  if (mainReason === "logic") {
    return "当前主要错因是：逻辑断层。说明你不是完全不会，而是步骤衔接不稳。建议每道题写出“为什么下一步这样做”。";
  }
  return "当前主要错因是：粗心失误。建议你建立检查顺序：先看符号，再看条件，再看计算。粗心不是性格，是流程没固定。";
}

function filterMistakes(mistakes, filter, query) {
  const q = String(query || "").trim().toLowerCase();

  return (mistakes || []).filter(function(item) {
    if (filter === "pending" && item.reviewed) return false;
    if (MISTAKE_REASONS.includes(filter) && item.reason !== filter) return false;
    if (!q) return true;
    return (item.title + "\n" + item.wrong + "\n" + item.correct).toLowerCase().includes(q);
  });
}

/* ---------- 日期文案 ---------- */

const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];

function formatDateLong(date = new Date()) {
  return (
    date.getFullYear() + "年" + (date.getMonth() + 1) + "月" + date.getDate() + "日 · 星期" + WEEKDAY_NAMES[date.getDay()]
  );
}

function formatDayLabel(key, todayKey = dateKey()) {
  if (key === todayKey) return "今日";
  if (key === dateKey(-1)) return "昨日";
  const parts = key.split("-");
  return Number(parts[1]) + "月" + Number(parts[2]) + "日";
}

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
}
