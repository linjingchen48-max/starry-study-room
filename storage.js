function getStorageSummaryText() {
  const tasks = appData.tasks ? appData.tasks.length : 0;
  const stars = Number(appData.stars) || 0;
  const seals = Number(appData.seals) || 0;
  const minutes = Number(appData.totalMinutes) || 0;
  const sessions = Number(appData.focusSessions) || 0;

  const reviewSaved =
    appData.review &&
    (
      appData.review.done ||
      appData.review.distraction ||
      appData.review.restless ||
      appData.review.calm ||
      appData.review.tomorrow
    );

  return (
    "任务：" + tasks + " 项\n" +
    "星辰：" + stars + " 颗\n" +
    "御印：" + seals + " 枚\n" +
    "累计专注：" + minutes + " 分钟\n" +
    "专注轮数：" + sessions + " 轮\n" +
    "今日奏对：" + (reviewSaved ? "已保存" : "未保存")
  );
}

function renderStorageInfo() {
  const storageInfo = document.getElementById("storageInfo");

  if (!storageInfo) return;

  storageInfo.innerText = getStorageSummaryText();
}

function exportAppData() {
  const now = new Date();
  const stamp =
    now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0") +
    "-" +
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0");

  const exportData = {
    appName: "星辰御书房",
    version: "v10-storage",
    exportedAt: now.toISOString(),
    data: appData
  };

  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = "starry-study-room-backup-" + stamp + ".json";
  link.click();

  URL.revokeObjectURL(url);

  alert("数据已导出。请妥善保存这个 JSON 文件。");
}

function importAppDataFromFile(file) {
  const reader = new FileReader();

  reader.onload = function(event) {
    try {
      const imported = JSON.parse(event.target.result);

      const importedData = imported.data || imported;

      if (!importedData || typeof importedData !== "object") {
        alert("导入失败：文件格式不正确。");
        return;
      }

      const ok = confirm("确定要导入这份数据吗？当前数据会被覆盖。");

      if (!ok) return;

      appData = {
        ...defaultData,
        ...importedData,
        tasks: Array.isArray(importedData.tasks) ? importedData.tasks : [],
        practiceStats: {
          ...defaultData.practiceStats,
          ...(importedData.practiceStats || {})
        },
        review: {
          ...defaultData.review,
          ...(importedData.review || {})
        },
        dailyData:
          importedData.dailyData && typeof importedData.dailyData === "object"
            ? importedData.dailyData
            : {}
      };

      saveData();

      if (typeof renderTasks === "function") renderTasks();
      if (typeof renderDataPanel === "function") renderDataPanel();
      if (typeof renderDistractionPanel === "function") renderDistractionPanel();
      if (typeof renderGrowthPanel === "function") renderGrowthPanel();
      if (typeof renderStarMap === "function") renderStarMap();
      if (typeof renderDashboard === "function") renderDashboard();

      renderStorageInfo();

      alert("数据导入成功。");
    } catch (error) {
      console.error(error);
      alert("导入失败：JSON 文件无法读取。");
    }
  };

  reader.readAsText(file);
}

function clearAllAppData() {
  const ok = confirm("确定要清空全部数据吗？这个操作不能撤销。建议先导出备份。");

  if (!ok) return;

  localStorage.removeItem(STORAGE_KEY);

  appData = {
    ...defaultData,
    tasks: [],
    dailyData: {},
    review: {
      ...defaultData.review
    },
    practiceStats: {
      ...defaultData.practiceStats
    }
  };

  saveData();

  if (typeof renderTasks === "function") renderTasks();
  if (typeof renderDataPanel === "function") renderDataPanel();
  if (typeof renderDistractionPanel === "function") renderDistractionPanel();
  if (typeof renderGrowthPanel === "function") renderGrowthPanel();
  if (typeof renderStarMap === "function") renderStarMap();
  if (typeof renderPracticeRadar === "function") renderPracticeRadar();
  if (typeof renderDashboard === "function") renderDashboard();

  renderStorageInfo();

  alert("数据已清空。");
}

document.getElementById("exportDataBtn")?.addEventListener("click", exportAppData);

document.getElementById("importDataBtn")?.addEventListener("click", function() {
  document.getElementById("importDataInput").click();
});

document.getElementById("importDataInput")?.addEventListener("change", function(event) {
  const file = event.target.files[0];

  if (!file) return;

  importAppDataFromFile(file);

  event.target.value = "";
});

document.getElementById("clearAllDataBtn")?.addEventListener("click", clearAllAppData);

/*
  包装 renderDataPanel：
  数据变化时，数据管理状态也自动刷新。
*/
if (typeof renderDataPanel === "function") {
  const oldRenderDataPanelForStorage = renderDataPanel;

  renderDataPanel = function() {
    oldRenderDataPanelForStorage();
    renderStorageInfo();
  };
}

renderStorageInfo();