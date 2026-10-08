/*
  设置：外观、入座即入夜、数据备份（导出 / 导入 / 清空）、快捷键说明。
  所有数据只在本机；导入兼容 v1 与 v2 备份。
*/

const EXPORT_VERSION = "v2-daily";

function getStorageSummary() {
  const taskDays = Object.keys(appData.tasksByDay).length;
  const taskTotal = Object.values(appData.tasksByDay).reduce(function(sum, list) {
    return sum + list.length;
  }, 0);

  return [
    ["御案", taskTotal + " 项 · " + taskDays + " 天"],
    ["星辰", toCount(appData.stars) + " 颗"],
    ["御印", toCount(appData.seals) + " 枚"],
    ["累计专注", toCount(appData.totalMinutes) + " 分钟 · " + toCount(appData.focusSessions) + " 轮"],
    ["奏对", Object.keys(appData.reviews).length + " 篇"],
    ["错题", appData.mistakes.length + " 道"]
  ];
}

function renderSettings() {
  document.querySelectorAll('input[name="themePref"]').forEach(function(input) {
    input.checked = input.value === appData.settings.theme;
  });

  document.getElementById("focusNightSwitch").setAttribute("aria-checked", String(appData.settings.focusNight));

  document.getElementById("storageInfo").innerHTML = getStorageSummary()
    .map(function(pair) {
      return "<div><dt>" + pair[0] + "</dt><dd class=\"num\">" + pair[1] + "</dd></div>";
    })
    .join("");
}

function openSettings() {
  renderSettings();
  document.getElementById("settingsDialog").showModal();
}

function exportAppData() {
  const now = new Date();
  const stamp =
    dateKey(0, now).replace(/-/g, "") +
    "-" +
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0");

  const payload = {
    appName: "星辰御书房",
    version: EXPORT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    data: appData
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "starry-study-room-backup-" + stamp + ".json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(function() {
    URL.revokeObjectURL(url);
  }, 1000);

  showToast("备份已导出，请妥善保存这个 JSON 文件。", { type: "success" });
}

function readFileAsText(file) {
  return new Promise(function(resolve, reject) {
    const reader = new FileReader();
    reader.onload = function() {
      resolve(reader.result);
    };
    reader.onerror = function() {
      reject(reader.error);
    };
    reader.readAsText(file);
  });
}

async function importAppDataFromFile(file) {
  const button = document.getElementById("importDataBtn");
  button.disabled = true;
  button.lastChild.textContent = "正在读取…";

  try {
    const text = await readFileAsText(file);
    const parsed = JSON.parse(text);
    const raw = parsed && isPlainObject(parsed.data) ? parsed.data : parsed;

    if (!isPlainObject(raw)) {
      showToast("导入失败：文件格式不正确。", { type: "error" });
      return;
    }

    const ok = await confirmAction({
      title: "导入这份备份？",
      body: "当前设备上的数据会被备份内容覆盖。建议先导出一份当前数据。",
      confirmLabel: "导入并覆盖",
      danger: true
    });
    if (!ok) return;

    const settings = appData.settings;
    appData = migrateData(raw);
    if (!isPlainObject(raw.settings)) appData.settings = settings;

    saveData();
    applyTheme();
    if (typeof restoreFocusSession === "function") restoreFocusSession();
    renderAllNow();
    renderSettings();
    showToast("数据导入成功。", { type: "success" });
  } catch (error) {
    showToast("导入失败：JSON 文件无法读取。", { type: "error" });
  } finally {
    button.disabled = false;
    button.lastChild.textContent = "导入备份";
  }
}

async function clearAllAppData() {
  const ok = await confirmAction({
    title: "清空全部数据？",
    body: "御案、星辰、御印、奏对、错题和统计都会被删除，且无法撤销。外观设置会保留。建议先导出备份。",
    confirmLabel: "清空数据",
    danger: true
  });
  if (!ok) return;

  const settings = appData.settings;
  appData = createDefaultData();
  appData.settings = settings;

  if (typeof stopTicker === "function") stopTicker();
  saveData();
  applyTheme();
  renderAllNow();
  renderSettings();
  showToast("数据已清空。");
}

document.getElementById("settingsBtn").addEventListener("click", openSettings);

document.getElementById("settingsDialog").addEventListener("click", function(event) {
  if (event.target === event.currentTarget || event.target.closest("[data-close]")) {
    event.currentTarget.close();
  }
});

document.querySelectorAll('input[name="themePref"]').forEach(function(input) {
  input.addEventListener("change", function() {
    appData.settings.theme = input.value;
    resetFocusNightSuppression();
    saveData();
    applyTheme();
  });
});

document.getElementById("focusNightSwitch").addEventListener("click", function(event) {
  appData.settings.focusNight = !appData.settings.focusNight;
  event.currentTarget.setAttribute("aria-checked", String(appData.settings.focusNight));
  saveData();
  applyTheme();
});

document.getElementById("exportDataBtn").addEventListener("click", exportAppData);

document.getElementById("importDataBtn").addEventListener("click", function() {
  document.getElementById("importDataInput").click();
});

document.getElementById("importDataInput").addEventListener("change", function(event) {
  const file = event.target.files[0];
  if (file) importAppDataFromFile(file);
  event.target.value = "";
});

document.getElementById("clearAllDataBtn").addEventListener("click", clearAllAppData);

registerRenderer(function() {
  if (document.getElementById("settingsDialog").open) renderSettings();
});
