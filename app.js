const state = {
  geometry: null,
  trends: null,
  projections: {},
  selectedCode: null,
  trendType: "linear",
  mapMetric: "population",
  sampleWindow: "18y_2008_2025",
  source: "taiwan",
  scenario: null,
  year: "2025",
  hoverCode: null,
  transform: { scale: 1, tx: 0, ty: 0 },
};

const els = {
  trendTypeSelect: document.getElementById("trendTypeSelect"),
  mapMetricSelect: document.getElementById("mapMetricSelect"),
  sampleWindowSelect: document.getElementById("sampleWindowSelect"),
  sourceSelect: document.getElementById("sourceSelect"),
  scenarioSelect: document.getElementById("scenarioSelect"),
  yearSelect: document.getElementById("yearSelect"),
  mapTitle: document.getElementById("mapTitle"),
  chartTitle: document.getElementById("chartTitle"),
  chartSubtitle: document.getElementById("chartSubtitle"),
  townSummary: document.getElementById("townSummary"),
  legend: document.getElementById("legend"),
  mapSvg: document.getElementById("mapSvg"),
  mapViewport: document.getElementById("mapViewport"),
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

const townIndex = new Map();
const townNodes = new Map();
const labelNodes = new Map();

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
    townIndex.set(town.code, idx);
  });

  configureBaseState();
  setupControls();
  buildMap();
  buildChartSkeleton();
  updateAll();
}

function configureBaseState() {
  state.selectedCode = state.geometry.towns[0]?.code ?? null;
  els.sampleWindowSelect.value = state.sampleWindow;
  els.trendTypeSelect.value = state.trendType;
  els.mapMetricSelect.value = state.mapMetric;
  els.sourceSelect.value = state.source;
  const vb = state.geometry.viewBox;
  els.mapSvg.setAttribute("viewBox", `0 0 ${vb.width} ${vb.height}`);
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
    updateAll();
  });
  els.sampleWindowSelect.addEventListener("change", () => {
    state.sampleWindow = els.sampleWindowSelect.value;
    syncScenarioOptions();
    syncYearOptions();
    updateAll();
  });
  els.sourceSelect.addEventListener("change", () => {
    state.source = els.sourceSelect.value;
    syncScenarioOptions();
    syncYearOptions();
    updateAll();
  });
  els.scenarioSelect.addEventListener("change", () => {
    state.scenario = els.scenarioSelect.value;
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

  syncScenarioOptions();
  syncYearOptions();
  setupPanZoom();
}

function getProjectionConfig() {
  return state.projections[state.trendType];
}

function getScenarioData() {
  const proj = getProjectionConfig();
  return proj.sources[state.source].windows[state.sampleWindow].scenarios[state.scenario];
}

function syncScenarioOptions() {
  const proj = getProjectionConfig();
  const windowData = proj.sources[state.source].windows[state.sampleWindow];
  const scenarios = Object.keys(windowData.scenarios);
  const previous = scenarios.includes(state.scenario) ? state.scenario : scenarios[0];
  state.scenario = previous;
  els.scenarioSelect.innerHTML = "";
  scenarios.forEach((scenario) => {
    const opt = document.createElement("option");
    opt.value = scenario;
    opt.textContent = scenario;
    if (scenario === state.scenario) opt.selected = true;
    els.scenarioSelect.appendChild(opt);
  });
}

function syncYearOptions() {
  const years = getScenarioData().years;
  if (!years.includes(state.year)) {
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
      state.selectedCode = town.code;
      updateMap();
      updateChart();
    });
    fragPaths.appendChild(path);
    townNodes.set(town.code, path);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", town.labelX);
    label.setAttribute("y", town.labelY);
    label.setAttribute("class", "town-label");
    label.textContent = town.town;
    fragLabels.appendChild(label);
    labelNodes.set(town.code, label);
  });

  els.townLayer.appendChild(fragPaths);
  els.labelLayer.appendChild(fragLabels);
  applyTransform();
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
  const newScale = Math.max(1, Math.min(12, oldScale * factor));
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
  labelNodes.forEach((node) => node.classList.toggle("visible", showLabels));
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
  } else {
    const range = getProjectionConfig().populationRange;
    els.legend.innerHTML = `
      <div class="legend-item"><div class="swatch" style="background:#fff3c8"></div><span>較低人口 ${Math.round(range.min).toLocaleString()}</span></div>
      <div class="legend-item"><div class="swatch" style="background:#d6632a"></div><span>較高人口 ${Math.round(range.max).toLocaleString()}</span></div>
    `;
  }
}

function getCurrentPopulationMap() {
  const scenarioData = getScenarioData();
  return scenarioData.populations[state.year];
}

function updateMap() {
  const titleParts = [];
  titleParts.push(state.trendType === "linear" ? "線性" : "指數");
  titleParts.push(state.sampleWindow.replace("y_", " 年樣本 "));
  if (state.mapMetric === "shareTrend") {
    titleParts.push("平均人口占比變化量");
  } else {
    titleParts.push(`${state.source.toUpperCase()} ${state.scenario} ${state.year} 人口數`);
  }
  els.mapTitle.textContent = titleParts.join("｜");

  const trendValues = state.trends.values[state.trendType][state.sampleWindow];
  const populationValues = state.mapMetric === "population" ? getCurrentPopulationMap() : null;
  const popRange = getProjectionConfig().populationRange;

  state.geometry.towns.forEach((town, idx) => {
    const node = townNodes.get(town.code);
    let fill = "#efebe3";
    if (state.mapMetric === "shareTrend") {
      const value = trendValues[town.code] ?? 0;
      fill = interpolateDiverging(value, state.trends.sharedRange.min, state.trends.sharedRange.max);
    } else if (populationValues) {
      fill = interpolateSequential(populationValues[idx], popRange.min, popRange.max);
    }
    node.setAttribute("fill", fill);
    node.classList.toggle("selected", town.code === state.selectedCode);
  });
}

function updateChart() {
  const town = state.geometry.towns.find((item) => item.code === state.selectedCode);
  if (!town) {
    renderEmptyChart("請點選左側鄉鎮區");
    return;
  }

  const scenarioData = getScenarioData();
  const years = scenarioData.years.map(Number);
  const idx = townIndex.get(town.code);
  const values = years.map((year) => scenarioData.populations[String(year)][idx]);

  els.chartTitle.textContent = `${town.county} ${town.town}`;
  els.chartSubtitle.textContent = `${state.trendType === "linear" ? "線性" : "指數"}｜${state.source.toUpperCase()}｜${state.scenario}｜${state.sampleWindow}`;
  els.downloadCsvBtn.disabled = false;

  renderChart(years, values);

  const trendValue = state.trends.values[state.trendType][state.sampleWindow][town.code];
  els.townSummary.textContent = `2025 基期人口 ${Math.round(values[0]).toLocaleString()} 人；目前年份 ${state.year} 人口 ${Math.round(values[years.indexOf(Number(state.year))]).toLocaleString()} 人；平均人口占比變化量 ${trendValue.toFixed(8)}。`;
}

function renderEmptyChart(message) {
  els.chartSvg.innerHTML = `<text x="430" y="270" text-anchor="middle" class="empty-state">${message}</text>`;
  els.downloadCsvBtn.disabled = true;
  els.townSummary.textContent = "";
}

function renderChart(years, values) {
  const width = 860;
  const height = 540;
  const margin = { top: 24, right: 24, bottom: 54, left: 76 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const minY = Math.min(...values);
  const maxY = Math.max(...values);
  const yPad = Math.max((maxY - minY) * 0.1, 1);
  const yMin = minY - yPad;
  const yMax = maxY + yPad;

  const xScale = (year) => margin.left + ((year - years[0]) / (years[years.length - 1] - years[0] || 1)) * innerW;
  const yScale = (value) => margin.top + innerH - ((value - yMin) / (yMax - yMin || 1)) * innerH;
  const polyline = years.map((year, i) => `${xScale(year)},${yScale(values[i])}`).join(" ");

  const yTicks = 5;
  const xTicks = years;
  const svgParts = [];
  svgParts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>`);

  for (let i = 0; i <= yTicks; i += 1) {
    const value = yMin + ((yMax - yMin) / yTicks) * i;
    const y = yScale(value);
    svgParts.push(`<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="#e4ddd1" stroke-dasharray="4 4"></line>`);
    svgParts.push(`<text x="${margin.left - 12}" y="${y + 5}" text-anchor="end" fill="#6c6258" font-size="12">${Math.round(value).toLocaleString()}</text>`);
  }

  xTicks.forEach((year) => {
    const x = xScale(year);
    svgParts.push(`<line x1="${x}" y1="${margin.top}" x2="${x}" y2="${height - margin.bottom}" stroke="#f0ebe2"></line>`);
    svgParts.push(`<text x="${x}" y="${height - margin.bottom + 24}" text-anchor="middle" fill="#6c6258" font-size="12">${year}</text>`);
  });

  svgParts.push(`<line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="#6e6255"></line>`);
  svgParts.push(`<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" stroke="#6e6255"></line>`);
  svgParts.push(`<polyline fill="none" stroke="#9d2e22" stroke-width="3" points="${polyline}"></polyline>`);

  years.forEach((year, i) => {
    const x = xScale(year);
    const y = yScale(values[i]);
    const selected = String(year) === state.year;
    svgParts.push(`
      <g class="chart-point" data-year="${year}" data-value="${values[i]}">
        <circle cx="${x}" cy="${y}" r="${selected ? 7 : 5}" fill="${selected ? "#c9372c" : "#ffffff"}" stroke="#9d2e22" stroke-width="2"></circle>
        <circle cx="${x}" cy="${y}" r="14" fill="transparent"></circle>
      </g>
    `);
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
      const value = Math.round(Number(node.dataset.value)).toLocaleString();
      node.setAttribute("opacity", "0.9");
      els.chartSubtitle.textContent = `${state.trendType === "linear" ? "線性" : "指數"}｜${state.source.toUpperCase()}｜${state.scenario}｜${state.sampleWindow}｜${year}：${value} 人`;
    });
    node.addEventListener("mouseleave", () => {
      els.chartSubtitle.textContent = `${state.trendType === "linear" ? "線性" : "指數"}｜${state.source.toUpperCase()}｜${state.scenario}｜${state.sampleWindow}`;
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
  const idx = townIndex.get(code);
  const pop = getCurrentPopulationMap()[idx];
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
  const town = state.geometry.towns.find((item) => item.code === state.selectedCode);
  if (!town) return;
  const scenarioData = getScenarioData();
  const idx = townIndex.get(town.code);
  const rows = scenarioData.years.map((year) => ({
    year,
    population: Math.round(scenarioData.populations[String(year)][idx]),
  }));
  const csv = [
    ["TOWNCODE", "COUNTYNAME", "TOWNNAME", "trend_type", "sample_window", "source", "scenario", "year", "population"].join(","),
    ...rows.map((row) => [
      town.code,
      town.county,
      town.town,
      state.trendType,
      state.sampleWindow,
      state.source,
      state.scenario,
      row.year,
      row.population,
    ].join(",")),
  ].join("\n");

  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${town.code}_${state.trendType}_${state.sampleWindow}_${state.source}_${state.scenario}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

init().catch((error) => {
  console.error(error);
  document.body.innerHTML = `<pre style="padding:24px;color:#7a2018;">載入失敗：${error.message}</pre>`;
});
