/*
  通用界面能力：图标、轻提示、确认框、落印动效、昼夜主题、路由。
*/

function icon(name, className = "icon") {
  return '<svg class="' + className + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
}

/* ---------- 轻提示 ---------- */

const TOAST_ICONS = {
  info: "info",
  success: "check",
  star: "star",
  seal: "seal",
  error: "alert"
};

function showToast(message, options = {}) {
  const region = document.getElementById("toastRegion");
  if (!region) return;

  const type = options.type || "info";
  const toast = document.createElement("div");
  toast.className = "toast toast-" + type;
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.innerHTML =
    icon(TOAST_ICONS[type] || "info", "icon toast-icon") +
    '<span class="toast-text">' + escapeHtml(message) + "</span>";

  let timer = null;

  function dismiss() {
    clearTimeout(timer);
    if (!toast.isConnected) return;
    toast.classList.add("is-leaving");
    setTimeout(function() {
      toast.remove();
    }, 220);
  }

  if (options.actionLabel && typeof options.onAction === "function") {
    const action = document.createElement("button");
    action.type = "button";
    action.className = "toast-action";
    action.textContent = options.actionLabel;
    action.addEventListener("click", function() {
      options.onAction();
      dismiss();
    });
    toast.appendChild(action);
  }

  while (region.children.length >= 3) {
    region.firstElementChild.remove();
  }

  region.appendChild(toast);

  const duration = options.duration || (options.actionLabel ? 6000 : 3200);
  timer = setTimeout(dismiss, duration);

  toast.addEventListener("mouseenter", function() {
    clearTimeout(timer);
  });
  toast.addEventListener("mouseleave", function() {
    timer = setTimeout(dismiss, 1800);
  });
}

/* ---------- 确认框 ---------- */

function confirmAction(options) {
  const dialog = document.getElementById("confirmDialog");

  if (!dialog || typeof dialog.showModal !== "function") {
    return Promise.resolve(window.confirm(options.title + "\n" + (options.body || "")));
  }

  document.getElementById("confirmTitle").textContent = options.title;
  document.getElementById("confirmBody").textContent = options.body || "";

  const okButton = document.getElementById("confirmOk");
  okButton.textContent = options.confirmLabel || "确定";
  okButton.className = "btn " + (options.danger ? "btn-danger" : "btn-primary");

  document.getElementById("confirmCancel").textContent = options.cancelLabel || "取消";

  return new Promise(function(resolve) {
    dialog.returnValue = "cancel";
    dialog.addEventListener(
      "close",
      function() {
        resolve(dialog.returnValue === "ok");
      },
      { once: true }
    );
    dialog.showModal();
    (options.danger ? document.getElementById("confirmCancel") : okButton).focus();
  });
}

/* ---------- 落印 ---------- */

function playSealStamp(text) {
  const layer = document.createElement("div");
  layer.className = "seal-stamp";
  layer.setAttribute("aria-hidden", "true");
  layer.innerHTML = '<div class="seal-stamp-mark">' + escapeHtml(text) + "</div>";
  document.body.appendChild(layer);
  setTimeout(function() {
    layer.remove();
  }, 950);
}

/* ---------- 昼夜 ---------- */

const systemDarkQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
let focusNightSuppressed = false;

function isFocusNightActive() {
  return (
    appData.settings.focusNight &&
    !focusNightSuppressed &&
    typeof isFocusSessionActive === "function" &&
    isFocusSessionActive()
  );
}

function getPreferredTheme() {
  const pref = appData.settings.theme;
  if (pref === "day" || pref === "night") return pref;
  return systemDarkQuery && systemDarkQuery.matches ? "night" : "day";
}

function resolveTheme() {
  return isFocusNightActive() ? "night" : getPreferredTheme();
}

function applyTheme() {
  const theme = resolveTheme();
  const root = document.documentElement;

  if (root.dataset.theme !== theme) {
    root.dataset.theme = theme;
  }

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "night" ? "#0d1015" : "#f4efe4");

  const toggle = document.getElementById("themeToggle");
  if (toggle) {
    const next = theme === "night" ? "昼" : "夜";
    toggle.setAttribute("aria-label", "切换到" + next + "境");
    toggle.setAttribute("title", "切换到" + next + "境（T）");
    toggle.innerHTML = icon(theme === "night" ? "sun" : "moon");
  }

  try {
    localStorage.setItem(THEME_HINT_KEY, theme);
  } catch (error) {
    // 主题提示只用于首屏防闪烁，写入失败无碍
  }
}

function toggleTheme() {
  const current = resolveTheme();
  const target = current === "night" ? "day" : "night";

  if (isFocusNightActive() && target === "day") {
    focusNightSuppressed = true;
  } else {
    appData.settings.theme = target;
    saveData();
  }

  applyTheme();
  refreshAll();
}

function resetFocusNightSuppression() {
  focusNightSuppressed = false;
}

if (systemDarkQuery) {
  systemDarkQuery.addEventListener("change", function() {
    applyTheme();
  });
}

/* ---------- 路由 ---------- */

const ROUTES = {
  today: { title: "今日" },
  focus: { title: "御书房" },
  practice: { title: "修炼" },
  mistakes: { title: "错题阁" },
  archive: { title: "档案" }
};

const ROUTE_ORDER = ["today", "focus", "practice", "mistakes", "archive"];

function getRouteFromHash() {
  const key = location.hash.replace(/^#\/?/, "").split(/[/?]/)[0];
  return ROUTES[key] ? key : "today";
}

let activeRoute = null;

function baseDocumentTitle() {
  return ROUTES[activeRoute || "today"].title + " · 星辰御书房";
}

function showRoute(route, options = {}) {
  if (!ROUTES[route]) route = "today";
  const changed = route !== activeRoute;
  activeRoute = route;

  document.querySelectorAll(".page").forEach(function(page) {
    const isActive = page.dataset.route === route;
    page.classList.toggle("is-active", isActive);
    page.hidden = !isActive;
  });

  document.querySelectorAll("[data-nav]").forEach(function(link) {
    if (link.dataset.nav === route) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });

  if (typeof updateFocusTitle === "function") {
    updateFocusTitle();
  } else {
    document.title = baseDocumentTitle();
  }

  if (changed && options.moveFocus) {
    window.scrollTo(0, 0);
    const heading = document.querySelector('.page[data-route="' + route + '"] .page-title');
    if (heading) heading.focus({ preventScroll: true });
  }
}

function navigate(route) {
  if (location.hash === "#" + route) {
    showRoute(route, { moveFocus: true });
  } else {
    location.hash = route;
  }
}

/* ---------- 交互小工具 ---------- */

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function setFieldError(input, message) {
  const hint = document.getElementById(input.id + "Error");
  if (message) {
    input.setAttribute("aria-invalid", "true");
    if (hint) {
      hint.textContent = message;
      hint.hidden = false;
    }
  } else {
    input.removeAttribute("aria-invalid");
    if (hint) hint.hidden = true;
  }
}

function flashElement(el) {
  if (!el) return;
  el.classList.remove("is-new");
  void el.offsetWidth;
  el.classList.add("is-new");
}

function emptyState(options) {
  return (
    '<div class="empty">' +
    icon(options.icon || "info") +
    '<p class="empty-title">' + escapeHtml(options.title) + "</p>" +
    (options.desc ? '<p class="empty-desc">' + escapeHtml(options.desc) + "</p>" : "") +
    (options.actionLabel
      ? '<button type="button" class="btn btn-secondary btn-sm" data-empty-action="' + escapeHtml(options.action) + '">' +
        escapeHtml(options.actionLabel) +
        "</button>"
      : "") +
    "</div>"
  );
}
