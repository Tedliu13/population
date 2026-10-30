import { messages, townNames } from "./i18n.js";
import { fitPopulationTrend } from "./history.js";
import { loadTopoGeometry, POPULATION_BREAKS, paletteColor, classColor } from "./topo-map.js";

const state = {
  language: readLanguage(),
  comparisonMode: "scenario",
  history: null,
  projectionView: null,
  selectedMethods: ["mixed:0.95", "mixed:0.9", "mixed:0.8", "linear", "exponential"],
  comparisonScenario: "ipcc|SSP4",
  geometry: null,
  trends: null,
  projections: {},
  selectedCode: null,
  selectedCountyCode: null,
  palette: "purpleMorandi",
  showTownNames: false,
  dragged: false,
  trendType: "mixed",
  dampingPhi: "0.9",
  mixedVariants: {},
  mapMetric: "population",
  sampleWindow: "18y_2008_2025",
  selectedScenarios: [],
  mapScenarioKey: null,
  year: "2025",
  availableYears: [],
  playTimer: null,
  hoverCode: null,
  lastPointer: null,
  transform: { scale: 1, tx: 0, ty: 0 },
};

const els = {
  paletteSelect: document.getElementById("paletteSelect"),
  showTownNamesCheck: document.getElementById("showTownNamesCheck"),
  scenarioTab: document.getElementById("scenarioTab"),
  methodTab: document.getElementById("methodTab"),
  historyTab: document.getElementById("historyTab"),
  historySummary: document.getElementById("historySummary"),
  mapMetricField: document.getElementById("mapMetricField"),
  mapScenarioField: document.getElementById("mapScenarioField"),
  mapMethodField: document.getElementById("mapMethodField"),
  mapMethodSelect: document.getElementById("mapMethodSelect"),
  trendTypeField: document.getElementById("trendTypeField"),
  comparisonScenarioField: document.getElementById("comparisonScenarioField"),
  comparisonScenarioSelect: document.getElementById("comparisonScenarioSelect"),
  scenarioGroup: document.getElementById("scenarioGroup"),
  methodGroup: document.getElementById("methodGroup"),
  methodChecklist: document.getElementById("methodChecklist"),
  languageSelect: document.getElementById("languageSelect"),
  trendTypeSelect: document.getElementById("trendTypeSelect"),
  mapMetricSelect: document.getElementById("mapMetricSelect"),
  sampleWindowSelect: document.getElementById("sampleWindowSelect"),
  scenarioChecklist: document.getElementById("scenarioChecklist"),
  mapScenarioSelect: document.getElementById("mapScenarioSelect"),
  yearRange: document.getElementById("yearRange"),
  yearValue: document.getElementById("yearValue"),
  playYearsBtn: document.getElementById("playYearsBtn"),
  mapTitle: document.getElementById("mapTitle"),
  chartTitle: document.getElementById("chartTitle"),
  chartSubtitle: document.getElementById("chartSubtitle"),
  townSummary: document.getElementById("townSummary"),
  legend: document.getElementById("legend"),
  mapSvg: document.getElementById("mapSvg"),
  mapViewport: document.getElementById("mapViewport"),
  countyLayer: document.getElementById("countyLayer"),
  townLayer: document.getElementById("townLayer"),
  labelLayer: document.getElementById("labelLayer"),
  tooltip: document.getElementById("tooltip"),
  chartSvg: document.getElementById("chartSvg"),
  downloadCsvBtn: document.getElementById("downloadCsvBtn"),
  mapContainer: document.getElementById("mapContainer"),
};

const geometryTownIndex = new Map();
const projectionCodeIndex = {
  mixed: new Map(),
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
const COMPARISON_METHODS = [
  { id: "mixed:0.95", model: "mixed", phi: "0.95", labelKey: "mixed095" },
  { id: "mixed:0.9", model: "mixed", phi: "0.9", labelKey: "mixed09" },
  { id: "mixed:0.8", model: "mixed", phi: "0.8", labelKey: "mixed08" },
  { id: "linear", model: "linear", labelKey: "linear" },
  { id: "exponential", model: "exponential", labelKey: "exponential" },
];

function readLanguage() {
  try { return localStorage.getItem("population-language") === "en" ? "en" : "zh"; }
  catch { return "zh"; }
}

function t(key, values = {}) {
  return (messages[state.language][key] ?? messages.zh[key] ?? key)
    .replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
}

function formatNumber(value) {
  return Math.round(value).toLocaleString(state.language === "en" ? "en-US" : "zh-TW");
}

function getTownLabel(town) {
  const names = townNames(town, state.language);
  return state.language === "en" ? `${names.town}, ${names.county}` : `${names.county} ${names.town}`;
}

function getCountyLabel(code) {
  const town = state.geometry.towns.find(item => item.code.startsWith(code));
  return town ? townNames(town, state.language).county : code;
}

function fitBounds(bounds, padding = 0.82) {
  const { width, height } = state.geometry.viewBox;
  const scale = Math.min(160, padding * Math.min(width / Math.max(bounds.width, 1), height / Math.max(bounds.height, 1)));
  state.transform = { scale, tx: width / 2 - (bounds.x + bounds.width / 2) * scale, ty: height / 2 - (bounds.y + bounds.height / 2) * scale };
  applyTransform();
}

function focusMap(countyCode, townCode = null) {
  state.selectedCountyCode = countyCode;
  state.selectedCode = townCode;
  hideTooltip();
  const scope = townCode ? state.geometry.towns.find(item => item.code === townCode)
    : state.geometry.counties.find(item => item.code === countyCode);
  if (scope) fitBounds(scope.bounds);
  else resetTransform();
  updateAll();
}

function getWindowLabel() {
  const [years, period] = state.sampleWindow.split("y_");
  return t("sampleWindow", { years, period: state.language === "en" ? period.replace("_", "–") : period });
}

function applyStaticTranslations() {
  document.documentElement.lang = state.language === "en" ? "en" : "zh-Hant";
  document.title = t("title");
  document.querySelectorAll("[data-i18n]").forEach(node => { node.textContent = t(node.dataset.i18n); });
  els.languageSelect.value = state.language;
  els.languageSelect.setAttribute("aria-label", t("language"));
  els.mapSvg.setAttribute("aria-label", t("mapAria"));
  els.chartSvg.setAttribute("aria-label", t("chartAria"));
  els.yearRange.setAttribute("aria-label", t("year"));
  els.mapScenarioSelect.setAttribute("aria-label", t("mapScenario"));
  els.mapMethodSelect.setAttribute("aria-label", t("trendType"));
  els.playYearsBtn.textContent = t(state.playTimer ? "stop" : "play");
}

function setLanguage(language) {
  if (!messages[language]) return;
  state.language = language;
  try { localStorage.setItem("population-language", language); } catch { /* Storage may be unavailable. */ }
  applyStaticTranslations();
  syncScenarioOptions();
  state.geometry.towns.forEach(town => {
    const label = labelNodes.get(town.code);
    if (label) label.textContent = townNames(town, state.language).town;
  });
  updateAll();
  if (state.hoverCode) els.tooltip.innerHTML = getTooltipContent(state.hoverCode);
}

function getTrendLabel() {
  return state.trendType === "mixed" ? `${t("mixed")} (φ=${state.dampingPhi})` : t(state.trendType);
}

function setDampingPhi(phi) {
  const variant = state.mixedVariants[phi];
  if (!variant || String(variant.dampingPhi) !== phi || !state.trends.mixedByPhi?.[phi]) {
    throw new Error(t("missingPhi", { phi }));
  }
  state.dampingPhi = phi;
  state.projections.mixed = variant;
  state.trends.values.mixed = state.trends.mixedByPhi[phi];
  projectionCodeIndex.mixed.clear();
  variant.codes.forEach((code, idx) => projectionCodeIndex.mixed.set(code, idx));
}

function getShareTrendLabel() {
  return t(state.trendType === "mixed" ? "mixedShareTrend" : "shareTrend");
}

function getScenarioLabel(source, scenario) {
  if (source === "ipcc") {
    return `IPCC-${scenario}`;
  }
  const taiwanLabelMap = {
    "低推估": "low",
    "中推估": "medium",
    "高推估": "high",
  };
  return taiwanLabelMap[scenario] ? t(taiwanLabelMap[scenario]) : scenario;
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
  applyStaticTranslations();
  const [geometry, trends, linear, exponential, mixed, mixed08, mixed095, history] = await Promise.all([
    loadJson("./data/town_metadata.json"),
    loadJson("./data/trends.json"),
    loadJson("./data/projections_linear.json"),
    loadJson("./data/projections_exponential.json"),
    loadJson("./data/projections_mixed.json"),
    loadJson("./data/projections_mixed_phi_0p8.json"),
    loadJson("./data/projections_mixed_phi_0p95.json"),
    loadJson("./data/history.json"),
  ]);

  state.geometry = await loadTopoGeometry(loadJson, geometry);
  state.trends = trends;
  state.history = history;
  const historyCodes = new Set(history.codes);
  if (state.geometry.towns.some(town => !historyCodes.has(town.code))) throw new Error("Missing historical township data");
  state.projections.linear = linear;
  state.projections.exponential = exponential;
  state.projections.mixed = mixed;
  state.mixedVariants = { "0.8": mixed08, "0.9": mixed, "0.95": mixed095 };
  setDampingPhi(state.dampingPhi);

  state.geometry.towns.forEach((town, idx) => {
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
  new ResizeObserver(resizeMapView).observe(els.mapContainer);
  resizeMapView();
  toggleYearPlayback();
}

function configureBaseState() {
  applyStaticTranslations();
  state.selectedCode = null;
  els.sampleWindowSelect.value = state.sampleWindow;
  els.trendTypeSelect.value = state.trendType === "mixed" ? `mixed:${state.dampingPhi}` : state.trendType;
  els.mapMetricSelect.value = state.mapMetric;
  const vb = state.geometry.viewBox;
  els.mapSvg.setAttribute("viewBox", `0 0 ${vb.width} ${vb.height}`);
  state.transform = { scale: 1, tx: 0, ty: 0 };
  syncScenarioOptions();
}

function setupControls() {
  els.showTownNamesCheck.checked = state.showTownNames;
  els.showTownNamesCheck.addEventListener("change", () => {
    state.showTownNames = els.showTownNamesCheck.checked;
    applyTransform();
  });
  els.paletteSelect.addEventListener("change", () => {
    state.palette = els.paletteSelect.value;
    updateAll();
  });
  els.scenarioTab.addEventListener("click", () => setComparisonMode("scenario"));
  els.methodTab.addEventListener("click", () => setComparisonMode("method"));
  els.historyTab.addEventListener("click", () => setComparisonMode("history"));
  els.comparisonScenarioSelect.addEventListener("change", () => {
    state.comparisonScenario = els.comparisonScenarioSelect.value;
    state.mapScenarioKey = state.comparisonScenario;
    syncScenarioOptions();
    syncYearOptions();
    updateAll();
  });
  els.languageSelect.addEventListener("change", () => setLanguage(els.languageSelect.value));
  els.trendTypeSelect.addEventListener("change", () => {
    const [trendType, phi] = els.trendTypeSelect.value.split(":");
    if (trendType === "mixed") setDampingPhi(phi);
    state.trendType = trendType;
    syncScenarioOptions();
    syncYearOptions();
    updateAll();
  });
  els.mapMethodSelect.addEventListener("change", () => {
    const [trendType, phi] = els.mapMethodSelect.value.split(":");
    if (trendType === "mixed") setDampingPhi(phi);
    state.trendType = trendType;
    syncYearOptions();
    updateAll();
  });
  els.mapMetricSelect.addEventListener("change", () => {
    const useLastYear = els.mapMetricSelect.value === "changeFrom2025" && state.mapMetric !== "changeFrom2025";
    state.mapMetric = els.mapMetricSelect.value;
    syncYearOptions({ useLastYear });
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
    state.comparisonScenario = state.mapScenarioKey;
    if (state.comparisonMode === "scenario") {
      state.selectedScenarios = [state.mapScenarioKey, ...state.selectedScenarios.filter(key => key !== state.mapScenarioKey)];
    }
    syncScenarioOptions();
    syncYearOptions();
    updateAll();
  });
  els.yearRange.addEventListener("input", () => {
    const years = state.availableYears;
    const idx = Number(els.yearRange.value);
    state.year = String(years[idx] ?? years[0] ?? state.year);
    syncYearDisplay();
    updateMap();
    updateChart();
  });
  els.playYearsBtn.addEventListener("click", toggleYearPlayback);
  els.downloadCsvBtn.addEventListener("click", downloadCurrentTownCsv);
  syncYearOptions();
  setupPanZoom();
}

function getProjectionConfig() {
  return state.projections[state.trendType];
}

function setComparisonMode(mode) {
  if (mode === "history" && state.comparisonMode !== "history") {
    state.projectionView = { metric: state.mapMetric, year: state.year };
    state.mapMetric = "population";
    state.year = "2025";
  } else if (mode !== "history" && state.comparisonMode === "history") {
    state.mapMetric = state.projectionView.metric;
    state.year = state.projectionView.year;
  }
  els.mapMetricSelect.value = state.mapMetric;
  state.comparisonMode = mode;
  if (mode === "method") {
    state.comparisonScenario = getMapScenarioKey();
  }
  syncScenarioOptions();
  syncYearOptions();
  updateAll();
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
  if (state.comparisonMode === "history") return state.history.codes.indexOf(code);
  return projectionCodeIndex[state.trendType].get(code);
}

function syncMethodChecklist() {
  els.methodChecklist.innerHTML = "";
  COMPARISON_METHODS.forEach(method => {
    const label = document.createElement("label");
    label.className = "scenario-check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = method.id;
    input.checked = state.selectedMethods.includes(method.id);
    input.addEventListener("change", () => {
      if (!input.checked && state.selectedMethods.length === 1 && state.selectedMethods.includes(method.id)) {
        input.checked = true;
        return;
      }
      const selected = new Set(state.selectedMethods);
      if (input.checked) selected.add(method.id);
      else selected.delete(method.id);
      state.selectedMethods = COMPARISON_METHODS.filter(item => selected.has(item.id)).map(item => item.id);
      updateChart();
    });
    const text = document.createElement("span");
    text.textContent = t(method.labelKey);
    label.appendChild(input);
    label.appendChild(text);
    els.methodChecklist.appendChild(label);
  });
}

function syncScenarioOptions() {
  syncMethodChecklist();
  const items = listAvailableScenarios();
  els.comparisonScenarioSelect.innerHTML = "";
  items.forEach(item => {
    const option = document.createElement("option");
    option.value = item.key;
    option.textContent = item.label;
    els.comparisonScenarioSelect.appendChild(option);
  });
  els.comparisonScenarioSelect.value = state.comparisonScenario;
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

function syncYearOptions({ useLastYear = false } = {}) {
  const years = state.comparisonMode === "history" ? getHistoricalYears() : getScenarioDataByKey(getMapScenarioKey()).years;
  state.availableYears = years.map(Number);
  if (useLastYear) {
    state.year = years[years.length - 1];
  } else if (!years.includes(state.year)) {
    state.year = years.reduce((nearest, year) => Math.abs(Number(year) - Number(state.year)) < Math.abs(Number(nearest) - Number(state.year)) ? year : nearest, years[0]);
  }
  els.yearRange.min = "0";
  els.yearRange.max = String(Math.max(0, years.length - 1));
  els.yearRange.step = "1";
  els.yearRange.value = String(Math.max(0, years.indexOf(state.year)));
  syncYearDisplay();
}

function syncYearDisplay() {
  els.yearValue.textContent = state.year;
  els.yearRange.disabled = state.mapMetric === "shareTrend" || state.availableYears.length <= 1;
}

function stopYearPlayback() {
  if (state.playTimer) {
    window.clearInterval(state.playTimer);
    state.playTimer = null;
  }
  els.playYearsBtn.textContent = t("play");
}

function toggleYearPlayback() {
  if (state.mapMetric === "shareTrend" || state.availableYears.length <= 1) return;
  if (state.playTimer) {
    stopYearPlayback();
    return;
  }
  els.playYearsBtn.textContent = t("stop");
  state.playTimer = window.setInterval(() => {
    const years = state.availableYears;
    const currentIdx = years.indexOf(Number(state.year));
    const nextIdx = currentIdx >= years.length - 1 ? 0 : currentIdx + 1;
    state.year = String(years[nextIdx]);
    els.yearRange.value = String(nextIdx);
    syncYearDisplay();
    updateMap();
    updateChart();
  }, 900);
}

function buildMap() {
  buildCounties();
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
    path.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.dragged) return;
      if (state.selectedCountyCode !== town.code.slice(0, 5)) focusMap(town.code.slice(0, 5));
      else if (state.selectedCode === town.code) focusMap(state.selectedCountyCode);
      else focusMap(town.code.slice(0, 5), town.code);
    });
    fragPaths.appendChild(path);
    townNodes.set(town.code, path);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", town.labelX);
    label.setAttribute("y", town.labelY);
    label.setAttribute("class", "town-label");
    label.dataset.x = town.labelX;
    label.dataset.y = town.labelY;
    label.textContent = townNames(town, state.language).town;
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
    path.dataset.code = county.code;
    frag.appendChild(path);
  });
  els.countyLayer.appendChild(frag);
}

function setupPanZoom() {
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startTx = 0;
  let startTy = 0;

  els.mapSvg.addEventListener("wheel", (event) => {
    event.preventDefault();
    state.lastPointer = { x: event.clientX, y: event.clientY };
    const factor = event.deltaY < 0 ? 1.12 : 0.89;
    zoomBy(factor, event.clientX, event.clientY);
  }, { passive: false });

  els.mapSvg.addEventListener("mousemove", (event) => {
    state.lastPointer = { x: event.clientX, y: event.clientY };
  });

  els.mapSvg.addEventListener("click", (event) => {
    if (event.target === els.mapSvg || event.target === els.mapViewport || event.target === els.townLayer || event.target === els.countyLayer || event.target === els.labelLayer) {
      if (state.dragged) return;
      focusMap(state.selectedCode ? state.selectedCountyCode : null);
    }
  });

  els.mapSvg.addEventListener("mousedown", (event) => {
    dragging = true;
    state.dragged = false;
    els.mapSvg.classList.add("dragging");
    const start = mapPoint(event.clientX, event.clientY);
    startX = start.x;
    startY = start.y;
    startTx = state.transform.tx;
    startTy = state.transform.ty;
  });

  window.addEventListener("mousemove", (event) => {
    if (!dragging) return;
    const point = mapPoint(event.clientX, event.clientY);
    if (Math.hypot(point.x - startX, point.y - startY) > 3) state.dragged = true;
    state.transform.tx = startTx + (point.x - startX);
    state.transform.ty = startTy + (point.y - startY);
    applyTransform();
  });

  window.addEventListener("mouseup", () => {
    dragging = false;
    els.mapSvg.classList.remove("dragging");
  });
}

function mapPoint(clientX, clientY) {
  return new DOMPoint(clientX, clientY).matrixTransform(els.mapSvg.getScreenCTM().inverse());
}

function zoomBy(factor, clientX, clientY) {
  const oldScale = state.transform.scale;
  const minScale = 0.15;
  const newScale = Math.max(minScale, Math.min(160, oldScale * factor));
  const svgRect = els.mapSvg.getBoundingClientRect();
  const { x: px, y: py } = mapPoint(clientX ?? svgRect.left + svgRect.width / 2, clientY ?? svgRect.top + svgRect.height / 2);
  state.transform.tx = px - ((px - state.transform.tx) * newScale) / oldScale;
  state.transform.ty = py - ((py - state.transform.ty) * newScale) / oldScale;
  state.transform.scale = newScale;
  applyTransform();
}

function resetTransform() {
  fitBounds(state.geometry.defaultBounds, 0.94);
}

function resizeMapView() {
  const width = els.mapContainer.clientWidth, height = els.mapContainer.clientHeight;
  if (!width || !height) return;
  state.geometry.viewBox = { width, height };
  els.mapSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const scope = state.selectedCode ? state.geometry.towns.find(town => town.code === state.selectedCode)
    : state.geometry.counties.find(county => county.code === state.selectedCountyCode);
  if (scope) fitBounds(scope.bounds);
  else resetTransform();
}

function applyTransform() {
  const { scale, tx, ty } = state.transform;
  els.mapViewport.setAttribute("transform", `translate(${tx} ${ty}) scale(${scale})`);
  labelNodes.forEach((node, code) => {
    const inScope = !state.selectedCountyCode || code?.startsWith(state.selectedCountyCode);
    node.classList.toggle("visible", state.showTownNames && inScope && (!state.selectedCode || code === state.selectedCode));
    const x = Number(node.dataset.x || 0);
    const y = Number(node.dataset.y || 0);
    node.setAttribute("transform", `translate(${x} ${y}) scale(${1 / scale}) translate(${-x} ${-y})`);
  });
}

function buildChartSkeleton() {
  els.chartSvg.setAttribute("viewBox", "0 0 860 540");
}

function updateAll() {
  const methodComparison = state.comparisonMode === "method";
  const historical = state.comparisonMode === "history";
  els.historyTab.setAttribute("aria-selected", String(historical));
  els.historySummary.hidden = !historical;
  els.mapMetricField.hidden = historical;
  els.mapScenarioField.hidden = historical || methodComparison;
  els.mapMethodField.hidden = !methodComparison;
  const methodValue = state.trendType === "mixed" ? `mixed:${state.dampingPhi}` : state.trendType;
  els.mapMethodSelect.value = methodValue;
  els.trendTypeSelect.value = methodValue;
  els.trendTypeField.hidden = methodComparison || historical;
  els.scenarioGroup.hidden = methodComparison || historical;
  els.methodGroup.hidden = !methodComparison;
  els.comparisonScenarioField.hidden = !methodComparison;
  els.scenarioTab.setAttribute("aria-selected", String(state.comparisonMode === "scenario"));
  els.methodTab.setAttribute("aria-selected", String(methodComparison));
  els.mapMetricSelect.querySelector('option[value="shareTrend"]').textContent = getShareTrendLabel();
  if (state.mapMetric === "shareTrend" || state.availableYears.length <= 1) {
    stopYearPlayback();
  }
  syncYearDisplay();
  updateLegend();
  updateMap();
  updateChart();
}

function updateLegend() {
  const { breaks, colors } = getMapColorScale();
  const format = value => state.mapMetric === "shareTrend" ? value.toExponential(1) : formatNumber(value);
  els.legend.innerHTML = `<div class="legend-discrete-ramp">${colors.map(color => `<span style="background:${color}"></span>`).join("")}</div>
    <div class="legend-breaks">${breaks.map((value, i) => `<span style="left:${i / (breaks.length - 1) * 100}%">${format(value)}</span>`).join("")}</div>
    ${state.mapMetric === "population" ? `<div class="legend-zero"><span></span>${t("zeroPopulation")}</div>` : ""}`;
}

function getMapColorScale() {
  const breaks = [...POPULATION_BREAKS];
  if (state.mapMetric === "population") {
    breaks[breaks.length - 1] = Math.max(600000, Math.ceil(getPopulationRangeForCurrentScenario().max / 100000) * 100000);
  } else {
    const max = state.mapMetric === "shareTrend"
      ? Math.max(Math.abs(state.trends.sharedRange.min), Math.abs(state.trends.sharedRange.max))
      : getGlobalPopulationChangeAbsMax();
    for (let i = 0; i < breaks.length; i++) breaks[i] = -max + 2 * max * i / (breaks.length - 1);
  }
  const colors = breaks.slice(1).map((_, i) => paletteColor(state.palette, i / (breaks.length - 2)));
  return { breaks, colors };
}

function getCurrentPopulationMap() {
  if (state.comparisonMode === "history") return state.history.populations[state.year];
  const scenarioData = getScenarioDataByKey(getMapScenarioKey());
  return scenarioData.populations[state.year];
}

function getPopulationRangeForCurrentScenario() {
  const scenarioData = state.comparisonMode === "history"
    ? { years: getHistoricalYears(), populations: state.history.populations } : getScenarioDataByKey(getMapScenarioKey());
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  scenarioData.years.forEach((year) => {
    const values = scenarioData.populations[year] || [];
    values.forEach((value) => {
      min = Math.min(min, value);
      max = Math.max(max, value);
    });
  });

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 1 };
  }
  return { min, max };
}

function updateMap() {
  const scopeLabel = state.selectedCode ? getTownLabel(state.geometry.towns.find(town => town.code === state.selectedCode))
    : state.selectedCountyCode ? getCountyLabel(state.selectedCountyCode) : t(state.language === "en" ? "national" : "allTaiwan");
  els.mapTitle.textContent = state.language === "en" ? `${scopeLabel} ${t("populationShort")}` : `${scopeLabel}人口`;
  if (state.comparisonMode === "history") els.mapTitle.textContent = `${scopeLabel} ${t("historicalPopulation")}`;

  const trendValues = state.trends.values[state.trendType][state.sampleWindow];
  const populationValues = state.mapMetric === "population" ? getCurrentPopulationMap() : null;
  const changeValues = state.mapMetric === "changeFrom2025"
    ? getCurrentPopulationMap().map((value, idx) => value - getScenarioDataByKey(getMapScenarioKey()).populations["2025"][idx])
    : null;
  const { breaks, colors } = getMapColorScale();

  state.geometry.towns.forEach((town) => {
    const node = townNodes.get(town.code);
    const projectionIdx = getProjectionIndex(town.code);
    let fill = "#efebe3";
    if (state.mapMetric === "shareTrend") {
      const value = trendValues[town.code] ?? 0;
      fill = classColor(value, breaks, colors);
    } else if (changeValues && projectionIdx !== undefined) {
      fill = classColor(changeValues[projectionIdx], breaks, colors);
    } else if (populationValues && projectionIdx !== undefined) {
      fill = populationValues[projectionIdx] === 0 ? "#ffffff" : classColor(populationValues[projectionIdx], breaks, colors);
    }
    node.setAttribute("fill", fill);
    node.classList.toggle("selected", town.code === state.selectedCode);
    node.style.display = state.selectedCode ? (town.code === state.selectedCode ? "" : "none")
      : state.selectedCountyCode && !town.code.startsWith(state.selectedCountyCode) ? "none" : "";
  });
  els.countyLayer.querySelectorAll(".county-path").forEach(node => {
    node.style.display = state.selectedCode || (state.selectedCountyCode && node.dataset.code !== state.selectedCountyCode) ? "none" : "";
  });
  if (state.hoverCode) {
    els.tooltip.innerHTML = getTooltipContent(state.hoverCode);
  }
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

function getHistoricalYears() {
  const [, start, end] = state.sampleWindow.split("_");
  return state.history.years.filter(year => Number(year) >= Number(start) && Number(year) <= Number(end));
}

function buildHistoricalSeries() {
  const years = getHistoricalYears().map(Number);
  const indices = state.history.codes.flatMap((code, index) =>
    state.selectedCode ? (code === state.selectedCode ? [index] : [])
      : !state.selectedCountyCode || code.startsWith(state.selectedCountyCode) ? [index] : []);
  if (!indices.length) throw new Error("No historical observations for selected area");
  const values = years.map(year => indices.reduce((sum, index) => sum + state.history.populations[year][index], 0));
  return { years, values, ...fitPopulationTrend(years, values), label: t("observedPopulation"), color: "#006d77",
    baselinePopulation: values[0], trendValue: 0 };
}

function downloadHistoryCsv() {
  const series = buildHistoricalSeries();
  const town = state.geometry.towns.find(item => item.code === state.selectedCode);
  const label = town ? `${town.county}_${town.town}` : state.selectedCountyCode
    ? state.geometry.towns.find(item => item.code.startsWith(state.selectedCountyCode)).county : "全台";
  const rows = [["area_code", "area_name", "sample_window", "year", "population", "fitted_population", "slope_people_per_year", "r_squared"],
    ...series.years.map((year, i) => [state.selectedCode || state.selectedCountyCode || "TOTAL", label, state.sampleWindow,
      year, series.values[i], series.fitted[i], series.slope, series.rSquared ?? ""] )];
  const blob = new Blob(["\ufeff" + rows.map(row => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${label}_history_${state.sampleWindow}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildChartSeries() {
  if (state.comparisonMode === "history") return [buildHistoricalSeries()];
  const town = state.geometry.towns.find((item) => item.code === state.selectedCode);
  const entries = state.comparisonMode === "method"
    ? COMPARISON_METHODS.filter(method => state.selectedMethods.includes(method.id))
      .map(method => ({ ...method, key: state.comparisonScenario }))
    : state.selectedScenarios.map(key => ({ key, model: state.trendType, phi: state.dampingPhi }));
  return entries.map(({key, model, phi, id}, idx) => {
    const { source, scenario } = parseScenarioKey(key);
    const projection = model === "mixed" ? state.mixedVariants[phi] : state.projections[model];
    const scenarioData = projection.sources[source].windows[state.sampleWindow].scenarios[scenario];
    const years = scenarioData.years.map(Number);
    let values;
    let trendValue = 1;
    let baselinePopulation = 0;
    if (town) {
      const projectionIdx = projection.codes.indexOf(town.code);
      const trends = model === "mixed" ? state.trends.mixedByPhi[phi] : state.trends.values[model];
      trendValue = trends[state.sampleWindow][town.code] ?? 0;
      baselinePopulation = scenarioData.populations["2025"][projectionIdx];
      values = state.mapMetric === "shareTrend"
        ? years.map(() => trendValue)
        : state.mapMetric === "changeFrom2025"
          ? years.map((year) => scenarioData.populations[String(year)][projectionIdx] - baselinePopulation)
          : years.map((year) => scenarioData.populations[String(year)][projectionIdx]);
    } else {
      const indices = state.selectedCountyCode
        ? projection.codes.flatMap((code, index) => code.startsWith(state.selectedCountyCode) ? [index] : [])
        : projection.codes.map((_, index) => index);
      const yearlyTotals = years.map((year) =>
        indices.reduce((sum, index) => sum + scenarioData.populations[String(year)][index], 0)
      );
      if (state.selectedCountyCode) {
        const trends = model === "mixed" ? state.trends.mixedByPhi[phi] : state.trends.values[model];
        trendValue = indices.reduce((sum, index) => sum + (trends[state.sampleWindow][projection.codes[index]] ?? 0), 0);
      }
      baselinePopulation = yearlyTotals[0];
      values = state.mapMetric === "shareTrend"
        ? years.map(() => trendValue)
        : state.mapMetric === "changeFrom2025"
          ? yearlyTotals.map((value) => value - baselinePopulation)
          : yearlyTotals;
    }
    return {
      key,
      source,
      scenario,
      model,
      phi: model === "mixed" ? phi : "",
      selectedMethod: town && model === "mixed" ? projection.selection[state.sampleWindow][town.code] : "",
      label: state.comparisonMode === "method"
        ? (model === "mixed" ? `${t("mixed")} (φ=${phi})` : t(model))
        : getScenarioLabel(source, scenario),
      years,
      values,
      trendValue,
      baselinePopulation,
      color: SCENARIO_COLORS[(state.comparisonMode === "method" ? COMPARISON_METHODS.findIndex(method => method.id === id) : DEFAULT_SCENARIOS.indexOf(key)) % SCENARIO_COLORS.length],
    };
  });
}

function updateChart() {
  const town = state.geometry.towns.find((item) => item.code === state.selectedCode);
  const seriesList = buildChartSeries();
  const primarySeries = seriesList[0];
  if (!primarySeries) {
    renderEmptyChart(t("noScenarios"));
    return;
  }

  if (town) {
    els.chartTitle.textContent = getTownLabel(town);
  } else {
    els.chartTitle.textContent = state.selectedCountyCode ? getCountyLabel(state.selectedCountyCode) : t("allTaiwan");
  }

  els.chartSubtitle.textContent = state.comparisonMode === "method"
    ? `${t("methodComparison")}｜${getScenarioLabel(primarySeries.source, primarySeries.scenario)}｜${getWindowLabel()}`
    : `${getTrendLabel()}｜${seriesList.map((series) => series.label).join(state.language === "en" ? ", " : "、")}｜${getWindowLabel()}`;
  els.downloadCsvBtn.disabled = false;

  renderChart(seriesList);
  if (state.comparisonMode === "history") {
    const slope = primarySeries.slope.toLocaleString(state.language === "en" ? "en-US" : "zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "always" });
    els.historySummary.textContent = t("historicalSlope", { start: primarySeries.years[0], end: primarySeries.years.at(-1), slope,
      rSquared: primarySeries.rSquared === null ? "N/A" : primarySeries.rSquared.toFixed(4) });
    if (town) {
      const selectedMethod = state.mixedVariants[state.dampingPhi]?.selection?.[state.sampleWindow]?.[town.code];
      const methodKey = { fixed_share: "fixedShareMethod", damped_log_share: "dampedShareMethod" }[selectedMethod] ?? "unavailableMethod";
      els.historySummary.textContent += "\n" + t("historicalMethod", { phi: state.dampingPhi, method: t(methodKey) });
    }
    return;
  }

  const currentValue = primarySeries.values[primarySeries.years.indexOf(Number(state.year))];
  const summaryValues = { scenario: state.comparisonMode === "method" ? `${getScenarioLabel(primarySeries.source, primarySeries.scenario)} / ${primarySeries.label}` : primarySeries.label, base: formatNumber(primarySeries.baselinePopulation),
    year: state.year, value: Number.isFinite(currentValue) ? formatNumber(currentValue) : "—",
    metric: getShareTrendLabel(), trend: primarySeries.trendValue.toFixed(8) };
  const summaryKey = !town && !state.selectedCountyCode
    ? (state.mapMetric === "shareTrend" ? "totalShareSummary" : state.mapMetric === "changeFrom2025" ? "totalChangeSummary" : "totalPopulationSummary")
    : (state.mapMetric === "shareTrend" ? "shareSummary" : state.mapMetric === "changeFrom2025" ? "changeSummary" : "populationSummary");
  els.townSummary.textContent = t(summaryKey, summaryValues);
  if (town && primarySeries.model === "mixed") {
    const method = primarySeries.selectedMethod;
    els.townSummary.textContent += t("methodSummary", { method: t(method === "fixed_share" ? "fixedWeight" : "dampedWeight") });
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
  const flatValues = seriesList.flatMap((series) => [...series.values, ...(series.fitted || [])]);
  const minY = Math.min(...flatValues);
  const maxY = Math.max(...flatValues);
  const yPad = Math.max((maxY - minY) * 0.1, 1);
  const yMin = minY - yPad;
  const yMax = maxY + yPad;

  const xScale = (year) => margin.left + ((year - years[0]) / (years[years.length - 1] - years[0] || 1)) * innerW;
  const yScale = (value) => margin.top + innerH - ((value - yMin) / (yMax - yMin || 1)) * innerH;
  const valueFormatter = state.mapMetric === "shareTrend"
    ? (value) => Number(value).toFixed(8)
    : formatNumber;

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
    const polyline = series.years.map((year, i) => `${xScale(year)},${yScale((series.fitted || series.values)[i])}`).join(" ");
    svgParts.push(`<polyline class="${series.fitted ? "historical-trend" : "projection-line"}" fill="none" stroke="${series.fitted ? "#b54c2f" : series.color}" stroke-width="${seriesIdx === 0 ? 3.2 : 2.4}" points="${polyline}"></polyline>`);
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

  const legendSeries = state.comparisonMode === "history"
    ? [{ label: t("observedPopulation"), color: "#006d77", marker: true }, { label: t("fittedTrend"), color: "#b54c2f" }] : seriesList;
  legendSeries.forEach((series, idx) => {
    const isIpcc = series.source === "ipcc";
    const groupIndex = isIpcc
      ? seriesList.filter((item, i) => i <= idx && item.source === "ipcc").length - 1
      : seriesList.filter((item, i) => i <= idx && item.source === "taiwan").length - 1;
    const singleLegend = state.comparisonMode !== "scenario";
    const legendBaseX = singleLegend ? width - margin.right - 180 : isIpcc ? width - margin.right - 250 : width - margin.right - 120;
    const legendY = margin.top + 8 + (singleLegend ? idx : groupIndex) * 20;
    svgParts.push(series.marker ? `<circle cx="${legendBaseX + 12}" cy="${legendY}" r="4.5" fill="white" stroke="${series.color}" stroke-width="2"/>` : `<line x1="${legendBaseX}" y1="${legendY}" x2="${legendBaseX + 24}" y2="${legendY}" stroke="${series.color}" stroke-width="3"></line>`);
    svgParts.push(`<text x="${legendBaseX + 32}" y="${legendY + 4}" fill="#6c6258" font-size="12">${series.label}</text>`);
  });

  els.chartSvg.innerHTML = svgParts.join("");
  els.chartSvg.querySelectorAll(".chart-point").forEach((node) => {
    node.style.cursor = "pointer";
    node.addEventListener("click", () => {
      state.year = node.dataset.year;
      els.yearRange.value = String(Math.max(0, state.availableYears.indexOf(Number(state.year))));
      syncYearDisplay();
      updateMap();
      updateChart();
    });
    node.addEventListener("mouseenter", () => {
      const year = node.dataset.year;
      const value = valueFormatter(Number(node.dataset.value));
      const label = node.dataset.seriesLabel;
      node.setAttribute("opacity", "0.9");
      els.chartSubtitle.textContent = state.mapMetric === "shareTrend"
        ? `${getTrendLabel()}｜${label}｜${getWindowLabel()}｜${year}: ${value}`
        : `${getTrendLabel()}｜${label}｜${getWindowLabel()}｜${year}: ${t("peopleValue", { value })}`;
    });
    node.addEventListener("mouseleave", () => {
      els.chartSubtitle.textContent = `${getTrendLabel()}｜${seriesList.map((series) => series.label).join(state.language === "en" ? ", " : "、")}｜${getWindowLabel()}`;
    });
  });
}

function getTooltipContent(code) {
  const town = state.geometry.towns.find((item) => item.code === code);
  if (!town) return "";
  if (state.mapMetric === "shareTrend") {
    const value = state.trends.values[state.trendType][state.sampleWindow][code] ?? 0;
    return `${getTownLabel(town)}<br>${getShareTrendLabel()}: ${value.toFixed(8)}`;
  }
  const idx = getProjectionIndex(code);
  const pop = getCurrentPopulationMap()[idx];
  if (state.mapMetric === "changeFrom2025") {
    const base = getScenarioDataByKey().populations["2025"][idx];
    const diff = pop - base;
    return `${getTownLabel(town)}<br>${state.year} ${t("change")}: ${formatNumber(diff)}`;
  }
  return `${getTownLabel(town)}<br>${state.year} ${t("populationShort")}: ${formatNumber(pop)}`;
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
  if (state.comparisonMode === "history") { downloadHistoryCsv(); return; }
  const town = state.geometry.towns.find((item) => item.code === state.selectedCode);
  const seriesList = buildChartSeries();

  const csvRows = [];
  const names = town ? townNames(town, state.language) : state.selectedCountyCode
    ? { county: getCountyLabel(state.selectedCountyCode), town: t("countyTotal") }
    : { county: t("national"), town: t("allTaiwan") };
  seriesList.forEach((series) => {
    series.years.forEach((year, idx) => {
      csvRows.push([
        town?.code ?? state.selectedCountyCode ?? "TOTAL",
        names.county,
        names.town,
        series.model,
        state.mapMetric,
        state.sampleWindow,
        series.source,
        series.scenario,
        getScenarioLabel(series.source, series.scenario),
        year,
        state.mapMetric === "shareTrend" ? Number(series.values[idx]).toFixed(8) : Math.round(series.values[idx]),
        series.selectedMethod,
        state.mapMetric === "shareTrend" && town && series.model === "mixed" ? "2025-2030" : "",
        series.phi,
      ]);
    });
  });

  const csv = [
    ["TOWNCODE", "COUNTYNAME", "TOWNNAME", "trend_type", "map_metric", "sample_window", "source", "scenario", "scenario_label", "year", "value", "selected_method", "share_trend_period", "damping_phi"].join(","),
    ...csvRows.map((row) => row.map(csvCell).join(",")),
  ].join("\n");

  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const fileLabel = town || state.selectedCountyCode ? `${names.county}_${names.town}` : t("allTaiwan");
  const typeLabel = state.trendType === "mixed" ? `mixed_phi_${state.dampingPhi.replace(".", "p")}` : state.trendType;
  const comparisonLabel = state.comparisonMode === "method" ? `method_comparison_${state.comparisonScenario.replace("|", "_")}` : typeLabel;
  link.download = `${fileLabel}_${comparisonLabel}_${state.sampleWindow}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

init().catch((error) => {
  console.error(error);
  document.body.textContent = t("loadFailed", { message: error.message });
});
