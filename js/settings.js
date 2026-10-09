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

function getWriteBlockedMessage() {
  return storageStatus.writeLocked ? "本机数据当前为只读保护状态，请先按页面顶部提示处理。" : "";
}

async function importAppDataFromFile(file) {
  const blocked = getWriteBlockedMessage();
  if (blocked) {
    showToast("未导入：" + blocked, { type: "error" });
    return;
  }
  if (file.size > BACKUP_MAX_BYTES) {
    showToast("导入失败：文件超过 5 MB，不像是星辰御书房的备份。", { type: "error" });
    return;
  }

  const button = document.getElementById("importDataBtn");
  button.disabled = true;
  button.lastChild.textContent = "正在读取…";

  try {
    let text;
    try {
      text = await readFileAsText(file);
    } catch (error) {
      showToast("导入失败：无法读取文件。", { type: "error" });
      return;
    }

    const result = parseBackupText(text);
    if (!result.ok) {
      showToast("导入失败：" + result.error + "当前数据未改动。", { type: "error", duration: 8000 });
      return;
    }

    const ok = await confirmAction({
      title: "导入这份备份？",
      body: "当前设备上的数据会被备份内容覆盖。建议先导出一份当前数据。",
      confirmLabel: "导入并覆盖",
      danger: true
    });
    if (!ok) return;

    const next = result.data;
    if (!result.hasSettings) next.settings = appData.settings;

    if (!replaceAppData(next)) {
      showToast(
        "导入失败：无法写入本机存储（可能空间不足或处于无痕模式）。当前数据未改动。",
        { type: "error", duration: 8000 }
      );
      return;
    }

    applyTheme();
    if (typeof restoreFocusSession === "function") restoreFocusSession();
    renderAllNow();
    renderSettings();
    showToast("数据导入成功。", { type: "success" });
  } finally {
    button.disabled = false;
    button.lastChild.textContent = "导入备份";
  }
}

async function clearAllAppData() {
  const blocked = getWriteBlockedMessage();
  if (blocked) {
    showToast("未清空：" + blocked, { type: "error" });
    return;
  }

  const ok = await confirmAction({
    title: "清空全部数据？",
    body: "御案、星辰、御印、奏对、错题和统计都会被删除，且无法撤销。外观设置会保留。建议先导出备份。",
    confirmLabel: "清空数据",
    danger: true
  });
  if (!ok) return;

  const next = createDefaultData();
  next.settings = appData.settings;

  if (!replaceAppData(next)) {
    showToast("清空失败：无法写入本机存储。当前数据未改动。", { type: "error", duration: 8000 });
    return;
  }

  if (typeof restoreFocusSession === "function") restoreFocusSession();
  applyTheme();
  renderAllNow();
  renderSettings();
  showToast("数据已清空。");
}

/* ---------- 存储异常 ---------- */

const STORAGE_ALERTS = {
  corrupt: {
    title: "本地数据无法读取",
    text: function() {
      return "原有数据已损坏，已原样另存为「" + storageStatus.backupKey + "」，当前以空白档案运行。可下载原始数据，修复后再导入。";
    },
    actions: ["download-raw", "dismiss"]
  },
  "corrupt-unsaved": {
    title: "本地数据无法读取，且未能另存",
    text: "为保住原有数据，本页已停止保存，新的记录不会写入。请先下载原始数据，再决定是否放弃它重新开始。",
    actions: ["download-raw", "release"]
  },
  unsupported: {
    title: "数据来自更新的版本",
    text: "本机数据由更新版本写入或版本无法识别。为避免旧版本覆盖，本页为只读：可以浏览，但不会保存任何更改。请刷新以获取最新版本。",
    actions: ["reload", "download-raw"]
  },
  "external-future": {
    title: "其他标签页正在使用更新版本",
    text: "为避免新旧版本互相覆盖，本页已停止保存。请刷新本页以使用最新版本。",
    actions: ["reload"]
  },
  "external-legacy": {
    title: "检测到旧版页面在写入数据",
    text: "另一个标签页仍在运行旧版本，它的写入会丢失按日历史。本页已用最新数据恢复，请关闭或刷新旧版标签页。",
    actions: ["dismiss"]
  }
};

const STORAGE_ALERT_ACTIONS = {
  "download-raw": { label: "下载原始数据", cls: "btn btn-secondary btn-sm" },
  release: { label: "放弃原始数据并重新开始", cls: "btn btn-danger-quiet btn-sm" },
  reload: { label: "刷新页面", cls: "btn btn-primary btn-sm" },
  dismiss: { label: "知道了", cls: "btn btn-quiet btn-sm" }
};

function renderStorageAlert() {
  const box = document.getElementById("storageAlert");
  const alert = STORAGE_ALERTS[storageStatus.issue];
  box.hidden = !alert;
  if (!alert) return;

  document.getElementById("storageAlertTitle").textContent = alert.title;
  document.getElementById("storageAlertText").textContent = typeof alert.text === "function" ? alert.text() : alert.text;
  document.getElementById("storageAlertActions").innerHTML = alert.actions
    .filter(function(action) {
      return action !== "download-raw" || storageStatus.rawSnapshot !== null;
    })
    .map(function(action) {
      const info = STORAGE_ALERT_ACTIONS[action];
      return '<button type="button" class="' + info.cls + '" data-storage-action="' + action + '">' + info.label + "</button>";
    })
    .join("");
}

function downloadRawSnapshot() {
  const raw = storageStatus.rawSnapshot;
  if (raw === null) return;

  const blob = new Blob([raw], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "starry-study-room-raw-" + Date.now() + ".txt";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(function() {
    URL.revokeObjectURL(url);
  }, 1000);
}

async function releaseStorageLock() {
  const ok = await confirmAction({
    title: "放弃原始数据？",
    body: "原有数据会被当前的空白档案覆盖。若尚未下载原始数据，它将永久丢失。",
    confirmLabel: "放弃并重新开始",
    danger: true
  });
  if (!ok) return;

  if (!releaseCorruptLock()) {
    showToast("仍无法写入本机存储，可能空间不足。原始数据未被覆盖。", { type: "error", duration: 8000 });
  }
  renderStorageAlert();
}

document.getElementById("storageAlertActions").addEventListener("click", function(event) {
  const button = event.target.closest("[data-storage-action]");
  if (!button) return;

  const action = button.dataset.storageAction;
  if (action === "download-raw") downloadRawSnapshot();
  if (action === "release") releaseStorageLock();
  if (action === "reload") location.reload();
  if (action === "dismiss") {
    storageStatus.issue = null;
    renderStorageAlert();
  }
});

storageStatus.onIssue = renderStorageAlert;

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
