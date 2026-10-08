const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp } = require("./helpers");

test("成长值与阶位进度", () => {
  const app = loadApp();
  const score = app.run(`getGrowthScore({ stars: 4, seals: 2, totalMinutes: 100, dailyData: { "2026-10-01": { minutes: 25 } } })`);
  assert.equal(score, 4 * 5 + 2 * 6 + 4 * 4 + 8);

  const level = app.run("getGrowthLevel(65)");
  assert.equal(level.current.name, "稳心");
  assert.equal(level.next.name, "持恒");
  assert.equal(level.progress, 50);

  const top = app.run("getGrowthLevel(999)");
  assert.equal(top.next, null);
  assert.equal(top.progress, 100);
});

test("连续活跃天数从今天往回数，遇到空白即停", () => {
  const app = loadApp();
  const streak = app.run(`
    const base = new Date(2026, 9, 8);
    getStreak({
      [dateKey(0, base)]: { minutes: 10 },
      [dateKey(-1, base)]: { review: true },
      [dateKey(-3, base)]: { practice: 1 }
    }, base)
  `);
  assert.equal(streak, 2);
});

test("御批依据当日数据，而不是累计总数", () => {
  const app = loadApp();
  const deep = { done: "完成数学三道题", distraction: "想刷手机", restless: "卡题时候", calm: "做到了吧", tomorrow: "先做难题" };
  app.context.deep = deep;

  const strong = app.run("generateRoyalComment(deep, { minutes: 30, practice: 1 })");
  assert.match(strong, /有学习、有修炼/);

  const weak = app.run("generateRoyalComment(deep, { minutes: 0, practice: 0 })");
  assert.match(weak, /分心与浮躁/);

  assert.match(app.run("generateRoyalComment({}, { minutes: 0, practice: 0 })"), /尚未奏对/);
});

test("下一步建议指向可执行的操作", () => {
  const app = loadApp();
  const empty = app.run(`getNextStep({ tasks: [], today: { minutes: 0, practice: 0 }, taskRate: 0, hasReview: false })`);
  assert.equal(empty.action, "newTask");

  const needPractice = app.run(`getNextStep({ tasks: [{ done: true }, { done: false }], today: { minutes: 30, practice: 0 }, taskRate: 50, hasReview: false })`);
  assert.equal(needPractice.action, "practice");

  const needReview = app.run(`getNextStep({ tasks: [{ done: true }], today: { minutes: 30, practice: 1 }, taskRate: 100, hasReview: false })`);
  assert.equal(needReview.action, "review");
});

test("换题时不会抽到同一道", () => {
  const app = loadApp();
  const result = app.run(`
    const current = PRACTICE_POOL.calm[0];
    Array.from({ length: 30 }, () => drawPractice("calm", current)).every((t) => t !== current)
  `);
  assert.equal(result, true);
});

test("错题筛选与搜索", () => {
  const app = loadApp();
  app.context.items = [
    { title: "极限 0/0", reason: "concept", wrong: "", correct: "洛必达", reviewed: false },
    { title: "积分换元", reason: "logic", wrong: "忘记换上下限", correct: "", reviewed: true },
    { title: "符号写错", reason: "careless", wrong: "", correct: "", reviewed: false }
  ];

  assert.equal(app.run(`filterMistakes(items, "all", "").length`), 3);
  assert.equal(app.run(`filterMistakes(items, "pending", "").length`), 2);
  assert.equal(app.run(`filterMistakes(items, "logic", "").length`), 1);
  assert.equal(app.run(`filterMistakes(items, "all", "洛必达")[0].title`), "极限 0/0");
  assert.equal(app.run(`filterMistakes(items, "careless", "极限").length`), 0);
});

test("雷达刻度：不低于 3，否则跟随最大值", () => {
  const app = loadApp();
  assert.equal(app.run("getRadarScale(getRadarValues({}))"), 3);
  assert.equal(app.run("getRadarScale(getRadarValues({ calm: 1 }))"), 3);
  assert.equal(app.run("getRadarScale(getRadarValues({ calm: 2, speech: 8 }))"), 8);
  assert.deepEqual(
    Array.from(app.run("getRadarValues({ calm: 1 })").map((v) => v.label)),
    ["沉稳", "自律", "洞察", "格局", "言行"]
  );
});

test("主要分心原因", () => {
  const app = loadApp();
  assert.equal(app.run("getMainDistraction({ hard: 1, phone: 3 })"), "phone");
  assert.equal(app.run("getMainDistraction({})"), null);
});
