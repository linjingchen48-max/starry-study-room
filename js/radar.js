/*
  人格五维雷达：用 SVG 画出 practiceStats 的五轴平衡。
  维度：沉稳 / 自律 / 洞察 / 格局 / 言行。全 0 时仍绘制坐标轴；
  刻度取当前最大值与 3 的较大者，单次修炼也清晰可见。
*/

const RADAR_SIZE = 360;
const RADAR_CENTER = 180;
const RADAR_RADIUS = 112;
const RADAR_LEVELS = 3;
const RADAR_MIN_SCALE = 3;

function getRadarValues(stats) {
  const source = stats || {};
  return PRACTICE_TYPES.map(function(key) {
    return { key: key, label: PRACTICE_DIMENSIONS[key].label, value: toCount(source[key]) };
  });
}

function getRadarScale(values) {
  return Math.max(
    RADAR_MIN_SCALE,
    values.reduce(function(max, item) {
      return Math.max(max, item.value);
    }, 0)
  );
}

function radarPoint(index, ratio) {
  const angle = -Math.PI / 2 + index * ((Math.PI * 2) / PRACTICE_TYPES.length);
  return {
    x: RADAR_CENTER + Math.cos(angle) * RADAR_RADIUS * ratio,
    y: RADAR_CENTER + Math.sin(angle) * RADAR_RADIUS * ratio
  };
}

function formatRadarPoint(point) {
  return point.x.toFixed(1) + "," + point.y.toFixed(1);
}

function radarPolygon(ratio) {
  return PRACTICE_TYPES.map(function(_key, index) {
    return formatRadarPoint(radarPoint(index, ratio));
  }).join(" ");
}

function getRadarComment(values) {
  const total = values.reduce(function(sum, item) {
    return sum + item.value;
  }, 0);

  if (total === 0) return "五维尚未点亮。完成一次人格修炼后，对应轴会向外展开。";

  const max = Math.max.apply(null, values.map(function(item) {
    return item.value;
  }));
  const min = Math.min.apply(null, values.map(function(item) {
    return item.value;
  }));
  const leaders = values
    .filter(function(item) {
      return item.value === max;
    })
    .map(function(item) {
      return item.label;
    });

  if (min === 0) return "「" + leaders.join("、") + "」已有痕迹。其余维度仍待点亮，可抽一题补齐。";
  if (max - min <= 1) return "五维渐趋均衡。继续修炼，气象自开。";
  return "「" + leaders[0] + "」稍强。可兼顾其余四维，成均衡之势。";
}

function renderPracticeRadar() {
  const chart = document.getElementById("practiceRadar");
  if (!chart) return;

  const values = getRadarValues(appData.practiceStats);
  const scale = getRadarScale(values);
  const total = values.reduce(function(sum, item) {
    return sum + item.value;
  }, 0);

  let rings = "";
  for (let level = RADAR_LEVELS; level >= 1; level--) {
    rings += '<polygon class="radar-ring" points="' + radarPolygon(level / RADAR_LEVELS) + '"></polygon>';
  }

  let axes = "";
  let labels = "";
  let dots = "";
  const points = [];

  values.forEach(function(item, index) {
    const end = radarPoint(index, 1);
    const labelPos = radarPoint(index, 1.24);
    const dataPos = radarPoint(index, item.value / scale);
    const anchor = labelPos.x < RADAR_CENTER - 10 ? "end" : labelPos.x > RADAR_CENTER + 10 ? "start" : "middle";
    const dy = labelPos.y < RADAR_CENTER - 20 ? -4 : 14;

    points.push(formatRadarPoint(dataPos));

    axes +=
      '<line class="radar-axis" x1="' + RADAR_CENTER + '" y1="' + RADAR_CENTER +
      '" x2="' + end.x.toFixed(1) + '" y2="' + end.y.toFixed(1) + '"></line>';

    labels +=
      '<text class="radar-label" x="' + labelPos.x.toFixed(1) + '" y="' + labelPos.y.toFixed(1) +
      '" dy="' + dy + '" text-anchor="' + anchor + '">' + item.label +
      '<tspan class="radar-value" dx="6">' + item.value + "</tspan></text>";

    if (item.value > 0) {
      dots += '<circle class="radar-dot" cx="' + dataPos.x.toFixed(1) + '" cy="' + dataPos.y.toFixed(1) + '" r="4"></circle>';
    }
  });

  const shape = total === 0 ? "" : '<polygon class="radar-shape" points="' + points.join(" ") + '"></polygon>';

  const aria = values
    .map(function(item) {
      return item.label + item.value + "次";
    })
    .join("，");

  chart.innerHTML =
    '<svg viewBox="0 0 ' + RADAR_SIZE + " " + RADAR_SIZE + '" role="img" aria-label="人格五维雷达图：' + aria + '">' +
    rings + axes + shape + dots + labels +
    "</svg>";

  document.getElementById("radarComment").textContent = getRadarComment(values);
  document.getElementById("radarScale").textContent = "外圈 = " + scale + " 次";
}

registerRenderer(renderPracticeRadar);
