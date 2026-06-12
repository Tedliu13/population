const state = {
  geometry: null,
  trends: null,
  projections: {},
  selectedCode: null,
  trendType: "linear",
  mapMetric: "population",
  sampleWindow: "18y_2008_2025",
  selectedScenarios: [],
  mapScenarioKey: null,
  year: "2025",
  hoverCode: null,
  transform: { scale: 1, tx: 0, ty: 0 },
};

const els = {
  trendTypeSelect: document.getElementById("trendTypeSelect"),
  mapMetricSelect: document.getElementById("mapMetricSelect"),
  sampleWindowSelect: document.getElementById("sampleWindowSelect"),
  scenarioChecklist: document.getElementById("scenarioChecklist"),
  mapScenarioSelect: document.getElementById("mapScenarioSelect"),
  yearSelect: document.getElementById("yearSelect"),
  mapTitle: document.getElementById("mapTitle"),
  chartTitle: document.getElementById("chartTitle"),
  chartSubtitle: document.getElementById("chartSubtitle"),
  townSummary: document.getElementById("townSummary"),
  legend: document.getElementById("legend"),
  mapSvg: document.getElementById("mapSvg"),
  mapViewport: document.getElementById("mapViewport"),
  countyLayer: document.getElementById("countyLayer"),
  insetLayer: document.getElementById("insetLayer"),
  townLayer: document.getElementById("townLayer"),
  labelLayer: document.getElementById("labelLayer"),
  tooltip: document.getElementById("tooltip"),
  chartSvg: document.getElementById("chartSvg"),
  downloadCsvBtn: document.getElementById("downloadCsvBtn"),
  zoomInBtn: document.getElementById("zoomInBtn"),
  zoomOutBtn: document.getElementById("zoomOutBtn"),
  resetViewBtn: document.getElementById("resetViewBtn"),
  mapContainer: document.getElementById("mapContainer"),
};

const geometryTownIndex = new Map();
const projectionCodeIndex = {
  linear: new Map(),
  exponential: new Map(),
};
const townNodes = new Map();
const labelNodes = new Map();
const DEFAULT_SCENARIOS = [
  "ipcc|SSP1",
  "ipcc|SSP2",
  "ipcc|SSP3",
  "ipcc|SSP4",
  "ipcc|SSP5",
  "taiwan|低推估",
  "taiwan|中推估",
  "taiwan|高推估",
];
const SCENARIO_COLORS = ["#9d2e22", "#1f5bff", "#2f8f4e", "#a25ddc", "#d68b1f", "#006d77", "#bb3e03", "#6a4c93"];

function getScenarioLabel(source, scenario) {
  if (source === "ipcc") {
    return `IPCC-${scenario}`;
  }
  const taiwanLabelMap = {
    "低推估": "低發展",
    "中推估": "中發展",
    "高推估": "高發展",
  };
  return `國發會-${taiwanLabelMap[scenario] ?? scenario}`;
}

function listAvailableScenarios() {
  const proj = getProjectionConfig();
  const items = [];
  Object.entries(proj.sources).forEach(([source, sourceEntry]) => {
    const windowData = sourceEntry.windows[state.sampleWindow];
    if (!windowData) return;
    Object.keys(windowData.scenarios).forEach((scenario) => {
      items.push({
        key: `${source}|${scenario}`,
        source,
        scenario,
        label: getScenarioLabel(source, scenario),
      });
    });
  });
  return items;
}
async function loadJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  return res.json();
}

async function init() {
  const [geometry, trends, linear, exponential] = await Promise.all([
    loadJson("./data/geometry.json"),
    loadJson("./data/trends.json"),
    loadJson("./data/projections_linear.json"),
    loadJson("./data/projections_exponential.json"),
  ]);

  state.geometry = geometry;
  state.trends = trends;
  state.projections.linear = linear;
  state.projections.exponential = exponential;

  geometry.towns.forEach((town, idx) => {
    geometryTownIndex.set(town.code, idx);
  });
  linear.codes.forEach((code, idx) => projectionCodeIndex.linear.set(code, idx));
  exponential.codes.forEach((code, idx) => projectionCodeIndex.exponential.set(code, idx));

  configureBaseState();
  setupControls();
  buildMap();
  buildChartSkeleton();
  resetTransform();
  updateAll();
}

function configureBaseState() {
  state.selectedCode = null;
  els.sampleWindowSelect.value = state.sampleWindow;
  els.trendTypeSelect.value = state.trendType;
  els.mapMetricSelect.value = state.mapMetric;
  const vb = state.geometry.viewBox;
  els.mapSvg.setAttribute("viewBox", `0 0 ${vb.width} ${vb.height}`);
  state.transform = { scale: 1, tx: 0, ty: 0 };
  syncScenarioOptions();
}

function setupControls() {
  els.trendTypeSelect.addEventListener("change", () => {
    state.trendType = els.trendTypeSelect.value;
    syncScenarioOptions();
    syncYearOptions();
    updateAll();
  });
  els.mapMetricSelect.addEventListener("change", () => {
    state.mapMetric = els.mapMetricSelect.value;
    syncYearOptions();
    updateAll();
  });
  els.sampleWindowSelect.addEventListener("change", () => {
    state.sampleWindow = els.sampleWindowSelect.value;
    syncScenarioOptions();
    syncYearOptions();
    updateAll();
  });
  els.mapScenarioSelect.addEventListener("change", () => {
    state.mapScenarioKey = els.mapScenarioSelect.value;
    syncYearOptions();
    updateAll();
  });
  els.yearSelect.addEventListener("change", () => {
    state.year = els.yearSelect.value;
    updateMap();
    updateChart();
  });
  els.downloadCsvBtn.addEventListener("click", downloadCurrentTownCsv);
  els.zoomInBtn.addEventListener("click", () => zoomBy(1.25));
  els.zoomOutBtn.addEventListener("click", () => zoomBy(0.8));
  els.resetViewBtn.addEventListener("click", resetTransform);
  syncYearOptions();
  setupPanZoom();
}

function getProjectionConfig() {
  return state.projections[state.trendType];
}

function getPrimaryScenarioKey() {
  return state.selectedScenarios[0];
}

function getMapScenarioKey() {
  return state.mapScenarioKey || getPrimaryScenarioKey();
}

function parseScenarioKey(key) {
  const [source, scenario] = key.split("|");
  return { source, scenario };
}

function getScenarioDataByKey(key = getMapScenarioKey()) {
  const proj = getProjectionConfig();
  const { source, scenario } = parseScenarioKey(key);
  return proj.sources[source].windows[state.sampleWindow].scenarios[scenario];
}

function getPrimaryScenarioLabel() {
  const key = getMapScenarioKey();
  if (!key) return "";
  const { source, scenario } = parseScenarioKey(key);
  return getScenarioLabel(source, scenario);
}

function getProjectionIndex(code) {
  return projectionCodeIndex[state.trendType].get(code);
}

function syncScenarioOptions() {
  const items = listAvailableScenarios();
  const availableKeys = new Set(items.map((item) => item.key));
  const previous = state.selectedScenarios.filter((key) => availableKeys.has(key));
  if (previous.length) {
    state.selectedScenarios = previous;
  } else {
    state.selectedScenarios = DEFAULT_SCENARIOS.filter((key) => availableKeys.has(key));
    if (!state.selectedScenarios.length && items.length) {
      state.selectedScenarios = [items[0].key];
    }
  }

  if (!state.mapScenarioKey || !availableKeys.has(state.mapScenarioKey)) {
    state.mapScenarioKey = state.selectedScenarios[0];
  }

  els.scenarioChecklist.innerHTML = "";
  items.forEach((item) => {
    const label = document.createElement("label");
    label.className = "scenario-check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = item.key;
    input.checked = state.selectedScenarios.includes(item.key);
    input.addEventListener("change", () => {
      const checked = [...els.scenarioChecklist.querySelectorAll("input:checked")].map((node) => node.value);
      if (!checked.length) {
        input.checked = true;
        return;
      }
      state.selectedScenarios = checked;
      syncMapScenarioSelect(items);
      syncYearOptions();
      updateAll();
    });
    const text = document.createElement("span");
    text.textContent = item.label;
    label.appendChild(input);
    label.appendChild(text);
    els.scenarioChecklist.appendChild(label);
  });

  syncMapScenarioSelect(items);
}

function syncMapScenarioSelect(items = listAvailableScenarios()) {
  const current = state.mapScenarioKey;
  els.mapScenarioSelect.innerHTML = "";
  items.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item.key;
    opt.textContent = item.label;
    if (item.key === current) opt.selected = true;
    els.mapScenarioSelect.appendChild(opt);
  });
}

function syncYearOptions() {
  const years = getScenarioDataByKey(getMapScenarioKey()).years;
  if (state.mapMetric === "changeFrom2025") {
    state.year = years[years.length - 1];
  } else if (!years.includes(state.year)) {
    state.year = years[0];
  }
  els.yearSelect.innerHTML = "";
  years.forEach((year) => {
    const opt = document.createElement("option");
    opt.value = year;
    opt.textContent = year;
    if (year === state.year) opt.selected = true;
    els.yearSelect.appendChild(opt);
  });
}

function buildMap() {
  buildCounties();
  buildInsets();
  const fragPaths = document.createDocumentFragment();
  const fragLabels = document.createDocumentFragment();

  state.geometry.towns.forEach((town) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", town.path);
    path.setAttribute("class", "town-path");
    path.dataset.code = town.code;
    path.addEventListener("mouseenter", (event) => showTooltip(event, town.code));
    path.addEventListener("mousemove", moveTooltip);
    path.addEventListener("mouseleave", hideTooltip);
    path.addEventListener("click", () => {
      state.selectedCode = state.selectedCode === town.code ? null : town.code;
      updateMap();
      updateChart();
    });
    fragPaths.appendChild(path);
    townNodes.set(town.code, path);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", town.labelX);
    label.setAttribute("y", town.labelY);
    label.setAttribute("class", "town-label");
    label.dataset.x = town.labelX;
    label.dataset.y = town.labelY;
    label.textContent = town.town;
    fragLabels.appendChild(label);
    labelNodes.set(town.code, label);
  });

  els.townLayer.appendChild(fragPaths);
  els.labelLayer.appendChild(fragLabels);
}

function buildCounties() {
  const frag = document.createDocumentFragment();
  (state.geometry.counties || []).forEach((county) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", county.path);
    path.setAttribute("class", "county-path");
    path.dataset.county = county.county;
    frag.appendChild(path);
  });
  els.countyLayer.appendChild(frag);
}

function buildInsets() {
  const frag = document.createDocumentFragment();
  const insetDefs = [
    { key: "matsu", label: "馬祖" },
    { key: "kinmen", label: "金門" },
  ];
  insetDefs.forEach(({ key, label }) => {
    const region = state.geometry.regions[key];
    if (!region) return;
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", region.x);
    rect.setAttribute("y", region.y);
    rect.setAttribute("width", region.width);
    rect.setAttribute("height", region.height);
    rect.setAttribute("class", "inset-frame");
    frag.appendChild(rect);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", region.x + region.width / 2);
    text.setAttribute("y", region.y - 10);
    text.setAttribute("class", "inset-title");
    text.textContent = label;
    frag.appendChild(text);
  });
  els.insetLayer.appendChild(frag);
}

function setupPanZoom() {
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startTx = 0;
  let startTy = 0;

  els.mapSvg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 0.89;
    zoomBy(factor, event.offsetX, event.offsetY);
  });

  els.mapSvg.addEventListener("click", (event) => {
    if (event.target === els.mapSvg || event.target === els.mapViewport || event.target === els.townLayer || event.target === els.countyLayer || event.target === els.labelLayer) {
      state.selectedCode = null;
      updateMap();
      updateChart();
    }
  });

  els.mapSvg.addEventListener("mousedown", (event) => {
    dragging = true;
    els.mapSvg.classList.add("dragging");
    startX = event.clientX;
    startY = event.clientY;
    startTx = state.transform.tx;
    startTy = state.transform.ty;
  });

  window.addEventListener("mousemove", (event) => {
    if (!dragging) return;
    state.transform.tx = startTx + (event.clientX - startX);
    state.transform.ty = startTy + (event.clientY - startY);
    applyTransform();
  });

  window.addEventListener("mouseup", () => {
    dragging = false;
    els.mapSvg.classList.remove("dragging");
  });
}

function zoomBy(factor, clientX = els.mapContainer.clientWidth / 2, clientY = els.mapContainer.clientHeight / 2) {
  const oldScale = state.transform.scale;
  const minScale = 0.55;
  const newScale = Math.max(minScale, Math.min(12, oldScale * factor));
  const svgRect = els.mapSvg.getBoundingClientRect();
  const px = clientX - svgRect.left;
  const py = clientY - svgRect.top;
  state.transform.tx = px - ((px - state.transform.tx) * newScale) / oldScale;
  state.transform.ty = py - ((py - state.transform.ty) * newScale) / oldScale;
  state.transform.scale = newScale;
  applyTransform();
}

function resetTransform() {
  state.transform = { scale: 1, tx: 0, ty: 0 };
  applyTransform();
}

function applyTransform() {
  const { scale, tx, ty } = state.transform;
  els.mapViewport.setAttribute("transform", `translate(${tx} ${ty}) scale(${scale})`);
  const showLabels = scale >= 2.25;
  labelNodes.forEach((node) => {
    node.classList.toggle("visible", showLabels);
    const x = Number(node.dataset.x || 0);
    const y = Number(node.dataset.y || 0);
    node.setAttribute("transform", `translate(${x} ${y}) scale(${1 / scale}) translate(${-x} ${-y})`);
  });
}

function buildChartSkeleton() {
  els.chartSvg.setAttribute("viewBox", "0 0 860 540");
}

function updateAll() {
  els.yearSelect.disabled = state.mapMetric === "shareTrend";
  updateLegend();
  updateMap();
  updateChart();
}

function updateLegend() {
  if (state.mapMetric === "shareTrend") {
    const min = state.trends.sharedRange.min;
    const max = state.trends.sharedRange.max;
    els.legend.innerHTML = `
      <div class="legend-item"><div class="swatch" style="background:#1f5bff"></div><span>下降趨勢 ${min.toFixed(6)}</span></div>
      <div class="legend-item"><div class="swatch" style="background:#f7f6f2"></div><span>接近 0</span></div>
      <div class="legend-item"><div class="swatch" style="background:#c9372c"></div><span>上升趨勢 ${max.toFixed(6)}</span></div>
    `;
  } else if (state.mapMetric === "population") {
    const range = getProjectionConfig().populationRange;
    els.legend.innerHTML = `
      <div class="legend-item"><div class="swatch" style="background:#fff3c8"></div><span>較低人口 ${Math.round(range.min).toLocaleString()}</span></div>
      <div class="legend-item"><div class="swatch" style="background:#d6632a"></div><span>較高人口 ${Math.round(range.max).toLocaleString()}</span></div>
    `;
  } else {
    const maxChange = getGlobalPopulationChangeAbsMax();
    els.legend.innerHTML = `
      <div class="legend-item"><div class="swatch" style="background:#1f5bff"></div><span>減少 ${Math.round(-maxChange).toLocaleString()}</span></div>
      <div class="legend-item"><div class="swatch" style="background:#f7f6f2"></div><span>接近 0</span></div>
      <div class="legend-item"><div class="swatch" style="background:#c9372c"></div><span>增加 ${Math.round(maxChange).toLocaleString()}</span></div>
    `;
  }
}

function getCurrentPopulationMap() {
  const scenarioData = getScenarioDataByKey(getMapScenarioKey());
  return scenarioData.populations[state.year];
}

function updateMap() {
  const trendLabel = state.trendType === "linear" ? "線性" : "指數";
  const windowLabel = state.sampleWindow.replace("y_", " 年樣本 ");
  let metricLabel = "平均人口占比變化量";
  if (state.mapMetric === "population") {
    metricLabel = `${state.year} 人口數`;
  } else if (state.mapMetric === "changeFrom2025") {
    metricLabel = `${state.year} 相對2025年人口改變量`;
  }
  els.mapTitle.textContent = `各鄉鎮區 ${metricLabel}｜${getPrimaryScenarioLabel()}｜${windowLabel}｜${trendLabel}`;

  const trendValues = state.trends.values[state.trendType][state.sampleWindow];
  const populationValues = state.mapMetric === "population" ? getCurrentPopulationMap() : null;
  const changeValues = state.mapMetric === "changeFrom2025"
    ? getCurrentPopulationMap().map((value, idx) => value - getScenarioDataByKey(getMapScenarioKey()).populations["2025"][idx])
    : null;
  const popRange = getProjectionConfig().populationRange;
  const maxChange = getGlobalPopulationChangeAbsMax();

  state.geometry.towns.forEach((town) => {
    const node = townNodes.get(town.code);
    const projectionIdx = getProjectionIndex(town.code);
    let fill = "#efebe3";
    if (state.mapMetric === "shareTrend") {
      const value = trendValues[town.code] ?? 0;
      fill = interpolateDiverging(value, state.trends.sharedRange.min, state.trends.sharedRange.max);
    } else if (changeValues && projectionIdx !== undefined) {
      fill = interpolateDiverging(changeValues[projectionIdx], -maxChange, maxChange);
    } else if (populationValues && projectionIdx !== undefined) {
      fill = interpolateSequential(populationValues[projectionIdx], popRange.min, popRange.max);
    }
    node.setAttribute("fill", fill);
    node.classList.toggle("selected", town.code === state.selectedCode);
  });
}

function getGlobalPopulationChangeAbsMax() {
  const proj = getProjectionConfig();
  let absMax = 0;
  Object.values(proj.sources).forEach((sourceEntry) => {
    Object.values(sourceEntry.windows).forEach((windowEntry) => {
      Object.values(windowEntry.scenarios).forEach((scenarioEntry) => {
        const baseline = scenarioEntry.populations["2025"];
        scenarioEntry.years.forEach((year) => {
          const values = scenarioEntry.populations[year];
          values.forEach((value, idx) => {
            absMax = Math.max(absMax, Math.abs(value - baseline[idx]));
          });
        });
      });
    });
  });
  return absMax || 1;
}

function updateChart() {
  const town = state.geometry.towns.find((item) => item.code === state.selectedCode);
  const seriesList = state.selectedScenarios.map((key, idx) => {
    const { source, scenario } = parseScenarioKey(key);
    const scenarioData = getScenarioDataByKey(key);
    const years = scenarioData.years.map(Number);
    let values;
    let trendValue = 1;
    let baselinePopulation = 0;
    if (town) {
      const projectionIdx = getProjectionIndex(town.code);
      trendValue = state.trends.values[state.trendType][state.sampleWindow][town.code] ?? 0;
      baselinePopulation = scenarioData.populations["2025"][projectionIdx];
      values = state.mapMetric === "shareTrend"
        ? years.map(() => trendValue)
        : state.mapMetric === "changeFrom2025"
          ? years.map((year) => scenarioData.populations[String(year)][projectionIdx] - baselinePopulation)
          : years.map((year) => scenarioData.populations[String(year)][projectionIdx]);
    } else {
      const yearlyTotals = years.map((year) =>
        scenarioData.populations[String(year)].reduce((sum, value) => sum + value, 0)
      );
      baselinePopulation = yearlyTotals[0];
      values = state.mapMetric === "shareTrend"
        ? years.map(() => 1)
        : state.mapMetric === "changeFrom2025"
          ? yearlyTotals.map((value) => value - baselinePopulation)
          : yearlyTotals;
    }
    return {
      key,
      source,
      scenario,
      label: getScenarioLabel(source, scenario),
      years,
      values,
      trendValue,
      baselinePopulation,
      color: SCENARIO_COLORS[idx % SCENARIO_COLORS.length],
    };
  });
  const primarySeries = seriesList[0];
  if (!primarySeries) {
    renderEmptyChart("無可用情境");
    return;
  }

  if (town) {
    els.chartTitle.textContent = `${town.county} ${town.town}`;
  } else {
    els.chartTitle.textContent = "全台";
  }

  els.chartSubtitle.textContent = `${state.trendType === "linear" ? "線性" : "指數"}｜${seriesList.map((series) => series.label).join("、")}｜${state.sampleWindow}`;
  els.downloadCsvBtn.disabled = false;

  renderChart(seriesList);

  if (!town) {
    if (state.mapMetric === "shareTrend") {
      els.townSummary.textContent = "總人口占比固定為 1。此模式下各年份顯示相同值，表示全體鄉鎮總和。";
    } else if (state.mapMetric === "changeFrom2025") {
      els.townSummary.textContent = `主情境 ${primarySeries.label}：2025 基期總人口 ${Math.round(primarySeries.baselinePopulation).toLocaleString()} 人；目前年份 ${state.year} 相對2025年總人口改變量 ${Math.round(primarySeries.values[primarySeries.years.indexOf(Number(state.year))]).toLocaleString()} 人。`;
    } else {
      els.townSummary.textContent = `主情境 ${primarySeries.label}：2025 基期總人口 ${Math.round(primarySeries.baselinePopulation).toLocaleString()} 人；目前年份 ${state.year} 總人口 ${Math.round(primarySeries.values[primarySeries.years.indexOf(Number(state.year))]).toLocaleString()} 人。`;
    }
  } else if (state.mapMetric === "shareTrend") {
    els.townSummary.textContent = `主情境 ${primarySeries.label}：平均人口占比變化量 ${primarySeries.trendValue.toFixed(8)}。此模式下各年份顯示相同值，僅作為該條件下的趨勢指標。`;
  } else if (state.mapMetric === "changeFrom2025") {
    els.townSummary.textContent = `主情境 ${primarySeries.label}：2025 基期人口 ${Math.round(primarySeries.baselinePopulation).toLocaleString()} 人；目前年份 ${state.year} 相對2025年人口改變量 ${Math.round(primarySeries.values[primarySeries.years.indexOf(Number(state.year))]).toLocaleString()} 人；平均人口占比變化量 ${primarySeries.trendValue.toFixed(8)}。`;
  } else {
    els.townSummary.textContent = `主情境 ${primarySeries.label}：2025 基期人口 ${Math.round(primarySeries.values[0]).toLocaleString()} 人；目前年份 ${state.year} 人口 ${Math.round(primarySeries.values[primarySeries.years.indexOf(Number(state.year))]).toLocaleString()} 人；平均人口占比變化量 ${primarySeries.trendValue.toFixed(8)}。`;
  }
}

function renderEmptyChart(message) {
  els.chartSvg.innerHTML = `<text x="430" y="270" text-anchor="middle" class="empty-state">${message}</text>`;
  els.downloadCsvBtn.disabled = true;
  els.townSummary.textContent = "";
}

function renderChart(seriesList) {
  const width = 860;
  const height = 540;
  const margin = { top: 24, right: 24, bottom: 54, left: 76 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const years = [...new Set(seriesList.flatMap((series) => series.years))].sort((a, b) => a - b);
  const flatValues = seriesList.flatMap((series) => series.values);
  const minY = Math.min(...flatValues);
  const maxY = Math.max(...flatValues);
  const yPad = Math.max((maxY - minY) * 0.1, 1);
  const yMin = minY - yPad;
  const yMax = maxY + yPad;

  const xScale = (year) => margin.left + ((year - years[0]) / (years[years.length - 1] - years[0] || 1)) * innerW;
  const yScale = (value) => margin.top + innerH - ((value - yMin) / (yMax - yMin || 1)) * innerH;
  const valueFormatter = state.mapMetric === "shareTrend"
    ? (value) => Number(value).toFixed(8)
    : (value) => Math.round(value).toLocaleString();

  const yTicks = 5;
  const xTicks = years;
  const svgParts = [];
  svgParts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>`);

  for (let i = 0; i <= yTicks; i += 1) {
    const value = yMin + ((yMax - yMin) / yTicks) * i;
    const y = yScale(value);
    svgParts.push(`<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="#e4ddd1" stroke-dasharray="4 4"></line>`);
    svgParts.push(`<text x="${margin.left - 12}" y="${y + 5}" text-anchor="end" fill="#6c6258" font-size="12">${valueFormatter(value)}</text>`);
  }

  xTicks.forEach((year) => {
    const x = xScale(year);
    svgParts.push(`<line x1="${x}" y1="${margin.top}" x2="${x}" y2="${height - margin.bottom}" stroke="#f0ebe2"></line>`);
    svgParts.push(`<text x="${x}" y="${height - margin.bottom + 24}" text-anchor="middle" fill="#6c6258" font-size="12">${year}</text>`);
  });

  svgParts.push(`<line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="#6e6255"></line>`);
  svgParts.push(`<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" stroke="#6e6255"></line>`);

  seriesList.forEach((series, seriesIdx) => {
    const polyline = series.years.map((year, i) => `${xScale(year)},${yScale(series.values[i])}`).join(" ");
    svgParts.push(`<polyline fill="none" stroke="${series.color}" stroke-width="${seriesIdx === 0 ? 3.2 : 2.4}" points="${polyline}"></polyline>`);
    series.years.forEach((year, i) => {
      const x = xScale(year);
      const y = yScale(series.values[i]);
      const selected = String(year) === state.year;
      svgParts.push(`
        <g class="chart-point" data-year="${year}" data-value="${series.values[i]}" data-series-label="${series.label}">
          <circle cx="${x}" cy="${y}" r="${selected && seriesIdx === 0 ? 7 : 4.5}" fill="${selected && seriesIdx === 0 ? series.color : "#ffffff"}" stroke="${series.color}" stroke-width="2"></circle>
          <circle cx="${x}" cy="${y}" r="12" fill="transparent"></circle>
        </g>
      `);
    });
  });

  seriesList.forEach((series, idx) => {
    const isIpcc = series.source === "ipcc";
    const groupIndex = isIpcc
      ? seriesList.filter((item, i) => i <= idx && item.source === "ipcc").length - 1
      : seriesList.filter((item, i) => i <= idx && item.source === "taiwan").length - 1;
    const legendBaseX = isIpcc ? width - margin.right - 250 : width - margin.right - 120;
    const legendY = margin.top + 8 + groupIndex * 20;
    svgParts.push(`<line x1="${legendBaseX}" y1="${legendY}" x2="${legendBaseX + 24}" y2="${legendY}" stroke="${series.color}" stroke-width="3"></line>`);
    svgParts.push(`<text x="${legendBaseX + 32}" y="${legendY + 4}" fill="#6c6258" font-size="12">${series.label}</text>`);
  });

  els.chartSvg.innerHTML = svgParts.join("");
  els.chartSvg.querySelectorAll(".chart-point").forEach((node) => {
    node.style.cursor = "pointer";
    node.addEventListener("click", () => {
      state.year = node.dataset.year;
      els.yearSelect.value = state.year;
      updateMap();
      updateChart();
    });
    node.addEventListener("mouseenter", () => {
      const year = node.dataset.year;
      const value = valueFormatter(Number(node.dataset.value));
      const label = node.dataset.seriesLabel;
      node.setAttribute("opacity", "0.9");
      els.chartSubtitle.textContent = state.mapMetric === "shareTrend"
        ? `${state.trendType === "linear" ? "線性" : "指數"}｜${label}｜${state.sampleWindow}｜${year}：${value}`
        : state.mapMetric === "changeFrom2025"
          ? `${state.trendType === "linear" ? "線性" : "指數"}｜${label}｜${state.sampleWindow}｜${year}：${value} 人`
          : `${state.trendType === "linear" ? "線性" : "指數"}｜${label}｜${state.sampleWindow}｜${year}：${value} 人`;
    });
    node.addEventListener("mouseleave", () => {
      els.chartSubtitle.textContent = `${state.trendType === "linear" ? "線性" : "指數"}｜${seriesList.map((series) => series.label).join("、")}｜${state.sampleWindow}`;
    });
  });
}

function interpolateSequential(value, min, max) {
  const t = clamp((value - min) / (max - min || 1), 0, 1);
  return mixColor([255, 243, 200], [198, 49, 29], t);
}

function interpolateDiverging(value, min, max) {
  const absMax = Math.max(Math.abs(min), Math.abs(max));
  if (value >= 0) {
    return mixColor([248, 243, 238], [198, 49, 29], clamp(value / absMax, 0, 1));
  }
  return mixColor([248, 243, 238], [30, 84, 190], clamp(Math.abs(value) / absMax, 0, 1));
}

function mixColor(a, b, t) {
  const c = a.map((channel, i) => Math.round(channel + (b[i] - channel) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getTooltipContent(code) {
  const town = state.geometry.towns.find((item) => item.code === code);
  if (!town) return "";
  if (state.mapMetric === "shareTrend") {
    const value = state.trends.values[state.trendType][state.sampleWindow][code] ?? 0;
    return `${town.county} ${town.town}<br>平均人口占比變化量：${value.toFixed(8)}`;
  }
  const idx = getProjectionIndex(code);
  const pop = getCurrentPopulationMap()[idx];
  if (state.mapMetric === "changeFrom2025") {
    const base = getScenarioDataByKey().populations["2025"][idx];
    const diff = pop - base;
    return `${town.county} ${town.town}<br>${state.year} 相對2025年人口改變量：${Math.round(diff).toLocaleString()}`;
  }
  return `${town.county} ${town.town}<br>${state.year} 人口：${Math.round(pop).toLocaleString()}`;
}

function showTooltip(event, code) {
  state.hoverCode = code;
  const node = townNodes.get(code);
  node.classList.add("hovered");
  els.tooltip.classList.remove("hidden");
  els.tooltip.innerHTML = getTooltipContent(code);
  moveTooltip(event);
}

function moveTooltip(event) {
  els.tooltip.style.left = `${event.clientX - els.mapContainer.getBoundingClientRect().left}px`;
  els.tooltip.style.top = `${event.clientY - els.mapContainer.getBoundingClientRect().top}px`;
}

function hideTooltip() {
  if (state.hoverCode) {
    const node = townNodes.get(state.hoverCode);
    node?.classList.remove("hovered");
  }
  state.hoverCode = null;
  els.tooltip.classList.add("hidden");
}

function downloadCurrentTownCsv() {
  const scenarioData = getScenarioDataByKey();
  const town = state.geometry.towns.find((item) => item.code === state.selectedCode);
  const { source, scenario } = parseScenarioKey(getMapScenarioKey());
  let trendValue = 1;
  let baselinePopulation;
  let rows;

  if (town) {
    const idx = getProjectionIndex(town.code);
    trendValue = state.trends.values[state.trendType][state.sampleWindow][town.code] ?? 0;
    baselinePopulation = scenarioData.populations["2025"][idx];
    rows = scenarioData.years.map((year) => ({
      year,
      value: state.mapMetric === "shareTrend"
        ? trendValue
        : state.mapMetric === "changeFrom2025"
          ? Math.round(scenarioData.populations[String(year)][idx] - baselinePopulation)
          : Math.round(scenarioData.populations[String(year)][idx]),
    }));
  } else {
    const totals = Object.fromEntries(
      scenarioData.years.map((year) => [
        year,
        scenarioData.populations[String(year)].reduce((sum, value) => sum + value, 0),
      ])
    );
    baselinePopulation = totals["2025"];
    rows = scenarioData.years.map((year) => ({
      year,
      value: state.mapMetric === "shareTrend"
        ? 1
        : state.mapMetric === "changeFrom2025"
          ? Math.round(totals[year] - baselinePopulation)
          : Math.round(totals[year]),
    }));
  }
  const csv = [
    ["TOWNCODE", "COUNTYNAME", "TOWNNAME", "trend_type", "map_metric", "sample_window", "source", "scenario", "year", "value"].join(","),
    ...rows.map((row) => [
      town?.code ?? "TOTAL",
      town?.county ?? "全國",
      town?.town ?? "全台",
      state.trendType,
      state.mapMetric,
      state.sampleWindow,
      source,
      scenario,
      row.year,
      state.mapMetric === "shareTrend" ? row.value.toFixed(8) : row.value,
    ].join(",")),
  ].join("\n");

  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${town?.code ?? "TOTAL"}_${state.trendType}_${state.sampleWindow}_${source}_${scenario}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

init().catch((error) => {
  console.error(error);
  document.body.innerHTML = `<pre style="padding:24px;color:#7a2018;">載入失敗：${error.message}</pre>`;
});
