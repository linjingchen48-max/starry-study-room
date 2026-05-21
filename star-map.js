function getStarMapStage(stars) {
  if (stars >= 30) {
    return {
      title: "群星成图",
      comment: "星图已成规模。你不是偶尔努力，而是在逐渐形成稳定的自律系统。"
    };
  }

  if (stars >= 20) {
    return {
      title: "星河渐起",
      comment: "星辰已经连成一片。继续保持，真正的改变来自稳定重复。"
    };
  }

  if (stars >= 10) {
    return {
      title: "星轨初成",
      comment: "你已经点亮了第一段星轨。现在要做的是不要断线。"
    };
  }

  if (stars >= 1) {
    return {
      title: "星辰初明",
      comment: "第一颗星已经亮起。不要小看它，这是系统开始运转的信号。"
    };
  }

  return {
    title: "星辰未明",
    comment: "先完成一次专注，点亮第一颗星。"
  };
}

function renderStarMap() {
  const grid = document.getElementById("starMapGrid");

  if (!grid) return;

  const stars = Number(appData.stars) || 0;
  const maxStars = 30;
  const litStars = Math.min(stars, maxStars);
  const stage = getStarMapStage(stars);

  document.getElementById("starMapTitle").innerText = stage.title;
  document.getElementById("starMapCount").innerText = stars;
  document.getElementById("starMapComment").innerText = stage.comment;

  let html = "";

  for (let i = 1; i <= maxStars; i++) {
    const className = i <= litStars ? "star-node lit" : "star-node";
    html += `<div class="${className}">★</div>`;
  }

  grid.innerHTML = html;
}

/*
  继续包一层 renderDataPanel：
  以后星辰变化时，星图也跟着刷新。
*/
if (typeof renderDataPanel === "function") {
  const oldRenderDataPanelForStarMap = renderDataPanel;

  renderDataPanel = function() {
    oldRenderDataPanelForStarMap();
    renderStarMap();
  };
}

renderStarMap();