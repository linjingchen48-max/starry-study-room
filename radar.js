/*
  档案页「人格五维雷达」：用 SVG 画出 practiceStats 的五轴平衡。
  维度：沉稳 / 自律 / 洞察 / 格局 / 言行。全 0 时仍绘制坐标轴。
*/

const RADAR_AXES = [
  { key: "calm", label: "沉稳" },
  { key: "discipline", label: "自律" },
  { key: "insight", label: "洞察" },
  { key: "vision", label: "格局" },
  { key: "speech", label: "言行" }
];

const RADAR_SIZE = 360;
const RADAR_CENTER = 180;
const RADAR_RADIUS = 108;
const RADAR_LEVELS = 4;
const RADAR_MIN_SCALE = 3;

function getRadarValues(stats) {
  const source = stats || {};

  return RADAR_AXES.map(function(axis) {
    const raw = Number(source[axis.key]);

    return {
      key: axis.key,
      label: axis.label,
      value: Number.isFinite(raw) && raw > 0 ? raw : 0
    };
  });
}

function getRadarScale(values) {
  let max = 0;

  for (let i = 0; i < values.length; i++) {
    if (values[i].value > max) {
      max = values[i].value;
    }
  }

  return Math.max(max, RADAR_MIN_SCALE);
}

function radarPoint(index, ratio) {
  const angle = -Math.PI / 2 + index * ((Math.PI * 2) / RADAR_AXES.length);

  return {
    x: RADAR_CENTER + Math.cos(angle) * RADAR_RADIUS * ratio,
    y: RADAR_CENTER + Math.sin(angle) * RADAR_RADIUS * ratio
  };
}

function formatRadarPoint(point) {
  return point.x.toFixed(1) + "," + point.y.toFixed(1);
}

function radarPolygon(ratio) {
  return RADAR_AXES.map(function(_axis, index) {
    return formatRadarPoint(radarPoint(index, ratio));
  }).join(" ");
}

function radarLabelAnchor(point) {
  if (point.x < RADAR_CENTER - 10) return "end";
  if (point.x > RADAR_CENTER + 10) return "start";
  return "middle";
}

function getRadarComment(values) {
  const total = values.reduce(function(sum, item) {
    return sum + item.value;
  }, 0);

  if (total === 0) {
    return "五维尚未点亮。完成一次人格修炼后，对应轴会向外展开。";
  }

  let maxVal = 0;
  let minVal = values[0].value;

  for (let i = 0; i < values.length; i++) {
    if (values[i].value > maxVal) maxVal = values[i].value;
    if (values[i].value < minVal) minVal = values[i].value;
  }

  const leaders = values
    .filter(function(item) {
      return item.value === maxVal;
    })
    .map(function(item) {
      return item.label;
    });

  if (minVal === 0) {
    return "「" + leaders.join("、") + "」已有痕迹。其余维度仍待点亮，可抽一题补齐。";
  }

  if (maxVal - minVal <= 1) {
    return "五维渐趋均衡。继续修炼，气象自开。";
  }

  return "「" + leaders[0] + "」稍强。可兼顾其余四维，成均衡之势。";
}

function renderPracticeRadar() {
  const chart = document.getElementById("practiceRadar");
  const legend = document.getElementById("radarLegend");
  const comment = document.getElementById("radarComment");

  if (!chart) return;

  const stats = (typeof appData !== "undefined" && appData.practiceStats)
    ? appData.practiceStats
    : {};
  const values = getRadarValues(stats);
  const scale = getRadarScale(values);
  const total = values.reduce(function(sum, item) {
    return sum + item.value;
  }, 0);

  let rings = "";
  for (let level = RADAR_LEVELS; level >= 1; level--) {
    rings += '<polygon class="radar-ring" points="' +
      radarPolygon(level / RADAR_LEVELS) +
      '"></polygon>';
  }

  let axes = "";
  let labels = "";
  let dots = "";
  const dataPoints = [];

  values.forEach(function(item, index) {
    const end = radarPoint(index, 1);
    const labelPos = radarPoint(index, 1.28);
    const dataPos = radarPoint(index, item.value / scale);

    dataPoints.push(formatRadarPoint(dataPos));

    axes += '<line class="radar-axis" x1="' + RADAR_CENTER +
      '" y1="' + RADAR_CENTER +
      '" x2="' + end.x.toFixed(1) +
      '" y2="' + end.y.toFixed(1) +
      '"></line>';

    const dy = labelPos.y < RADAR_CENTER - 8 ? "-2" : "14";

    labels += '<text class="radar-label" x="' + labelPos.x.toFixed(1) +
      '" y="' + labelPos.y.toFixed(1) +
      '" dy="' + dy +
      '" text-anchor="' + radarLabelAnchor(labelPos) +
      '">' + item.label + "</text>";

    if (item.value > 0) {
      dots += '<circle class="radar-dot" cx="' + dataPos.x.toFixed(1) +
        '" cy="' + dataPos.y.toFixed(1) +
        '" r="4.5"></circle>';
    }
  });

  const dataShape = total === 0
    ? ""
    : '<polygon class="radar-shape" points="' + dataPoints.join(" ") + '"></polygon>';

  const aria = values.map(function(item) {
    return item.label + item.value + "次";
  }).join("，");

  chart.innerHTML =
    '<svg viewBox="0 0 ' + RADAR_SIZE + " " + RADAR_SIZE +
    '" role="img" aria-label="人格五维雷达图：' + aria + '">' +
    '<circle class="radar-core" cx="' + RADAR_CENTER + '" cy="' + RADAR_CENTER + '" r="' + RADAR_RADIUS + '"></circle>' +
    rings +
    axes +
    dataShape +
    dots +
    labels +
    "</svg>";

  if (legend) {
    legend.innerHTML = values.map(function(item) {
      return '<div class="radar-legend-item">' +
        "<span>" + item.label + "</span>" +
        "<strong>" + item.value + "</strong>" +
        "</div>";
    }).join("");
  }

  if (comment) {
    comment.innerText = getRadarComment(values);
  }
}

/*
  继续包一层 renderDataPanel：
  修炼完成、导入数据时，雷达图跟着刷新。
*/
if (typeof renderDataPanel === "function") {
  const oldRenderDataPanelForRadar = renderDataPanel;

  renderDataPanel = function() {
    oldRenderDataPanelForRadar();
    renderPracticeRadar();
  };
}

renderPracticeRadar();
