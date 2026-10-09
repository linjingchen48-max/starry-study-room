/*
  启动：路由、键盘快捷键、跨日刷新、多标签页同步、存储异常提示、草稿恢复、Service Worker 更新。
*/

storageStatus.onWriteError = function() {
  showToast("无法保存到本机存储，可能是空间不足或处于无痕模式。请尽快导出备份。", { type: "error", duration: 8000 });
};

/* ---------- 路由 ---------- */

window.addEventListener("hashchange", function() {
  showRoute(getRouteFromHash(), { moveFocus: true });
});

/* ---------- 顶栏 ---------- */

const topbar = document.getElementById("topbar");
window.addEventListener(
  "scroll",
  function() {
    topbar.classList.toggle("is-scrolled", window.scrollY > 4);
  },
  { passive: true }
);

document.getElementById("themeToggle").addEventListener("click", toggleTheme);

/* ---------- 快捷键 ---------- */

document.addEventListener("keydown", function(event) {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
  if (isTypingTarget(event.target)) return;
  if (document.querySelector("dialog[open]")) return;

  const key = event.key;

  if (key >= "1" && key <= "5") {
    event.preventDefault();
    navigate(ROUTE_ORDER[Number(key) - 1]);
    return;
  }

  if (key === "t" || key === "T") {
    event.preventDefault();
    toggleTheme();
    return;
  }

  if (key === " " && activeRoute === "focus") {
    if (event.target.closest && event.target.closest("button, a, summary, [role='radio']")) return;
    event.preventDefault();
    toggleFocus();
    return;
  }

  if ((key === "n" || key === "N") && activeRoute === "today") {
    event.preventDefault();
    document.getElementById("taskInput").focus();
    return;
  }

  if (key === "/") {
    event.preventDefault();
    if (activeRoute !== "mistakes") navigate("mistakes");
    requestAnimationFrame(function() {
      document.getElementById("mistakeSearch").focus();
    });
  }
});

/* ---------- 多标签页 ---------- */

function applySyncedData() {
  restoreFocusSession();
  applyTheme();
  renderAllNow();
}

window.addEventListener("storage", function(event) {
  if (event.storageArea !== localStorage) return;
  if (event.key === LEGACY_STORAGE_KEY) {
    checkLegacyChanges();
    return;
  }
  if (event.key === STORAGE_KEY && syncFromStorage() === "synced") applySyncedData();
});

/*
  切回前台、从往返缓存恢复、从冻结中恢复时，storage 事件可能已错过：主动与存储对齐。
*/
function resyncWithStorage() {
  if (syncIfChanged() === "synced") applySyncedData();
  checkLegacyChanges();
}

document.addEventListener("visibilitychange", function() {
  if (document.visibilityState === "visible") resyncWithStorage();
});
window.addEventListener("pageshow", function(event) {
  if (event.persisted) resyncWithStorage();
});
document.addEventListener("resume", resyncWithStorage);

/* ---------- 跨日 ---------- */

let currentDayKey = dateKey();
setInterval(function() {
  const key = dateKey();
  if (key !== currentDayKey) {
    currentDayKey = key;
    refreshAll();
  }
}, 60000);

/* ---------- Service Worker ---------- */

/*
  更新流程：只有点了「刷新」的标签页会重新载入（先保存草稿）；
  其他标签页在新版本接管后只提示，不强制刷新，避免丢失正在填写的内容。
*/
let updateRequestedHere = false;

function reloadKeepingDrafts() {
  saveDrafts();
  location.reload();
}

function promptUpdate(worker) {
  showToast("新版本已就绪。未提交的输入会保留。", {
    actionLabel: "刷新",
    duration: 15000,
    onAction: function() {
      updateRequestedHere = true;
      saveDrafts();
      worker.postMessage({ type: "SKIP_WAITING" });
    }
  });
}

function promptReloadAfterUpdate() {
  showToast("新版本已在其他标签页启用。未提交的输入会保留。", {
    actionLabel: "刷新",
    duration: 30000,
    onAction: reloadKeepingDrafts
  });
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", function() {
    navigator.serviceWorker
      .register("./sw.js")
      .then(function(registration) {
        if (registration.waiting && navigator.serviceWorker.controller) promptUpdate(registration.waiting);

        // 长时间不关的标签页（尤其是安装到桌面的应用）也能发现新版本
        const checkForUpdate = function() {
          registration.update().catch(function() {});
        };
        setInterval(checkForUpdate, 60 * 60 * 1000);
        document.addEventListener("visibilitychange", function() {
          if (document.visibilityState === "visible") checkForUpdate();
        });

        registration.addEventListener("updatefound", function() {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", function() {
            if (worker.state === "installed" && navigator.serviceWorker.controller) promptUpdate(worker);
          });
        });
      })
      .catch(function(error) {
        console.warn("Service Worker 注册失败：", error);
      });

    // 首次安装时 clients.claim() 也会触发 controllerchange，此时页面本就是新版本，无需刷新
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", function() {
      if (!hadController || reloading) return;
      if (!updateRequestedHere) {
        promptReloadAfterUpdate();
        return;
      }
      reloading = true;
      reloadKeepingDrafts();
    });
  });
}

/* ---------- 启动 ---------- */

applyTheme();
showRoute(getRouteFromHash());
renderAllNow();
renderStorageAlert();
restoreFocusSession();
if (restoreDrafts()) showToast("已恢复上次未提交的输入。");
document.documentElement.classList.add("is-ready");

if (!storageStatus.available) {
  showToast("当前浏览器无法使用本机存储，数据不会被保存。", { type: "error", duration: 8000 });
}
