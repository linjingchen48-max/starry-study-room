/*
  Service Worker 缓存名 = "starry-study-room-v<package 版本>-<预缓存资源内容哈希前 8 位>"。
  任一预缓存文件变动，缓存名必变，浏览器才会安装新 SW 并整组替换缓存。
  node scripts/sw-version.js --write  重新计算并写回 sw.js（npm run stamp）
*/

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SW_PATH = path.join(ROOT, "sw.js");

function getPrecacheFiles(swSource) {
  return [...swSource.matchAll(/"\.\/([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
}

function expectedCacheName() {
  const sw = fs.readFileSync(SW_PATH, "utf8");
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const hash = crypto.createHash("sha256");
  getPrecacheFiles(sw).forEach((file) => {
    hash.update(file + "\0");
    // 统一换行符，避免不同平台检出（CRLF / LF）得到不同哈希
    hash.update(fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n"));
  });
  return "starry-study-room-v" + pkg.version + "-" + hash.digest("hex").slice(0, 8);
}

function currentCacheName() {
  return (fs.readFileSync(SW_PATH, "utf8").match(/const CACHE_NAME = "([^"]+)"/) || [])[1];
}

if (require.main === module && process.argv.includes("--write")) {
  const name = expectedCacheName();
  const sw = fs.readFileSync(SW_PATH, "utf8").replace(/const CACHE_NAME = "[^"]+"/, 'const CACHE_NAME = "' + name + '"');
  fs.writeFileSync(SW_PATH, sw);
  console.log("CACHE_NAME = " + name);
}

module.exports = { expectedCacheName, currentCacheName, getPrecacheFiles };
