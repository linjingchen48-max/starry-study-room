/*
  轻量静态检查（无依赖）：
  1. 所有 JS 语法可解析
  2. index.html 引用的 CSS/JS 与 sw.js 预缓存列表一致且文件存在
  3. JS 中 getElementById 的 id 都能在 index.html 找到
  4. sw.js 的 CACHE_NAME 与 package 版本、预缓存资源内容一致（见 sw-version.js）
*/

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const problems = [];

const jsFiles = ["sw.js"]
  .concat(fs.readdirSync(path.join(ROOT, "scripts")).map((f) => "scripts/" + f))
  .concat(fs.readdirSync(path.join(ROOT, "js")).map((f) => "js/" + f))
  .concat(fs.readdirSync(path.join(ROOT, "tests")).filter((f) => f.endsWith(".js")).map((f) => "tests/" + f))
  .concat(fs.readdirSync(path.join(ROOT, "tests/browser")).filter((f) => f.endsWith(".js")).map((f) => "tests/browser/" + f));

jsFiles.forEach((file) => {
  try {
    execFileSync(process.execPath, ["--check", path.join(ROOT, file)], { stdio: "pipe" });
  } catch (error) {
    problems.push("语法错误 " + file + "\n" + error.stderr.toString());
  }
});

const html = read("index.html");
const referenced = [...html.matchAll(/(?:href|src)="((?:css|js)\/[^"]+)"/g)].map((m) => m[1]);
const precached = [...read("sw.js").matchAll(/"\.\/((?:css|js)\/[^"]+)"/g)].map((m) => m[1]);

referenced.forEach((file) => {
  if (!fs.existsSync(path.join(ROOT, file))) problems.push("index.html 引用的文件不存在：" + file);
  if (!precached.includes(file)) problems.push("sw.js 未预缓存：" + file);
});
precached.forEach((file) => {
  if (!referenced.includes(file)) problems.push("sw.js 预缓存了未被引用的文件：" + file);
});

const { expectedCacheName, currentCacheName, getPrecacheFiles } = require("./sw-version.js");
getPrecacheFiles(read("sw.js")).forEach((file) => {
  if (!fs.existsSync(path.join(ROOT, file))) problems.push("sw.js 预缓存的文件不存在：" + file);
});
if (!problems.length && currentCacheName() !== expectedCacheName()) {
  problems.push("sw.js 的 CACHE_NAME 已过期（" + currentCacheName() + " → " + expectedCacheName() + "）。预缓存资源有改动，请运行 npm run stamp");
}

// 由 JS 运行时生成的 id（奏对问题由 REVIEW_QUESTIONS 生成）
const DYNAMIC_IDS = ["review-done", "review-distraction", "review-restless", "review-calm", "review-tomorrow"];

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]).concat(DYNAMIC_IDS));
fs.readdirSync(path.join(ROOT, "js")).forEach((file) => {
  const source = read("js/" + file);
  [...source.matchAll(/getElementById\("([^"]+)"\)/g)].forEach((m) => {
    if (!htmlIds.has(m[1])) problems.push("js/" + file + " 引用了不存在的 #" + m[1]);
  });
});

const duplicateIds = [...html.matchAll(/\bid="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((id, i, all) => all.indexOf(id) !== i);
duplicateIds.forEach((id) => problems.push("index.html 存在重复 id：" + id));

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}

console.log("检查通过：" + jsFiles.length + " 个脚本、" + referenced.length + " 个资源引用、" + htmlIds.size + " 个 id");
