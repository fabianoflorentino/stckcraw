const DATA_URL = "data/latest.json";
const SNAPSHOT_FALLBACK_URL = "https://stckcraw-dispatch.fabianoflorentino.workers.dev/snapshot";
const HISTORY_URL = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  ? "http://localhost:8787/history"
  : "https://stckcraw-dispatch.fabianoflorentino.workers.dev/history";
const SEARCH_URL = "https://brapi.dev/api/quote/list";
const SEARCH_TIMEOUT_MS = 350;
const SEARCH_LIMIT = 12;
const REFRESH_MS = 5 * 60 * 1000;
const SNAPSHOT_MAX_AGE_MS = 35 * 60 * 1000;

const LIVE_GROUPS = [
  { key: "acoes", label: "Ações", type: "stock", subType: "stock" },
  { key: "fii", label: "FIIs", type: "fund", subType: "fii" },
  { key: "fip", label: "FIPs", type: "fund", subType: "fip" },
  { key: "etf", label: "ETFs", type: "fund", subType: "etf" },
  { key: "bdr", label: "BDRs", type: "bdr" },
  { key: "unit", label: "Units", type: "stock", subType: "unit" },
];
const groupsEl = document.getElementById("groups");
const highlightsEl = document.getElementById("highlights");
const indicesEl = document.getElementById("indices");
const statusEl = document.getElementById("status");
const refreshEl = document.getElementById("refresh");
const toastEl = document.getElementById("toast");
const backToTopEl = document.getElementById("back-to-top");
const chartDialogEl = document.getElementById("index-chart");
const modeButtons = Array.from(document.querySelectorAll(".mode-button"));
const modeDescriptionEl = document.getElementById("mode-description");
const assetSearchEl = document.querySelector(".asset-search");
const searchToggleEl = document.getElementById("search-toggle");
const searchInputEl = document.getElementById("asset-search");
const searchResultsEl = document.getElementById("search-results");

const MODES = {
  highs: {
    topLabel: "Maior alta",
    coverage: "altas",
  },
  lows: {
    topLabel: "Maior queda",
    coverage: "baixas",
  },
};

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compact = new Intl.NumberFormat("pt-BR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const points = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const percent = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});

let loading = false;
let lastSnapshot = null;
let toastTimer = null;
let activeMode = "highs";
let activeChartKey = null;
let lastChartTrigger = null;
let chartCloseTimer = null;
let chartCloseHandler = null;
let chartClosing = false;
let searchTimer = null;
let searchController = null;
let searchItems = [];
let activeSearchIndex = -1;
const searchCache = new Map();
const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const COLLAPSED_KEY = "stckcraw:collapsed";
const collapsedGroups = loadCollapsedGroups();

function loadCollapsedGroups() {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    const keys = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(keys) ? keys : []);
  } catch {
    return new Set();
  }
}

function setCollapsed(key, collapsed) {
  if (collapsed) {
    collapsedGroups.add(key);
  } else {
    collapsedGroups.delete(key);
  }

  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedGroups]));
  } catch {
    // localStorage can be unavailable in private contexts.
  }
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return char;
    }
  });
}

function formatMoney(value) {
  return Number.isFinite(value) ? money.format(value) : "—";
}

function formatCompact(value) {
  return Number.isFinite(value) ? compact.format(value) : "—";
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${percent.format(value)}%` : "—";
}

function formatPoints(value) {
  return Number.isFinite(value) ? points.format(value) : "—";
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || "—";
  }
  return date.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatB3SessionDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(date);
  } catch {
    return date.toLocaleDateString("pt-BR");
  }
}

function formatIndexChartDate(value, timezone, withYear = false) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const options = {
    timeZone: timezone || "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
  };
  if (withYear) {
    options.year = "numeric";
  }

  try {
    return new Intl.DateTimeFormat("pt-BR", options).format(date);
  } catch {
    return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  }
}

function indexChartPoints(index) {
  const history = Array.isArray(index.history) ? index.history : [];
  return history
    .map((point) => ({
      date: new Date(point.date),
      close: Number(point.close),
    }))
    .filter((point) => (
      Number.isFinite(point.close)
      && point.close > 0
      && !Number.isNaN(point.date.getTime())
    ))
    .sort((a, b) => a.date - b.date);
}

function periodChange(points) {
  if (points.length < 2 || points[0].close <= 0) {
    return 0;
  }
  return (points[points.length - 1].close / points[0].close - 1) * 100;
}

function chartScale(points, width, height, padding) {
  const closes = points.map((point) => point.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const low = min === max ? min - 1 : min;
  const high = min === max ? max + 1 : max;
  const spread = high - low;
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  return {
    min,
    max,
    low,
    high,
    x: (index) => (
      padding.left
      + (points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth)
    ),
    y: (value) => padding.top + (1 - (value - low) / spread) * innerHeight,
  };
}

function buildSparkline(points, tone) {
  const width = 120;
  const height = 36;
  const padding = { top: 3, right: 2, bottom: 3, left: 2 };
  const scale = chartScale(points, width, height, padding);
  const baseline = height - padding.bottom;
  const line = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${scale.x(index).toFixed(2)},${scale.y(point.close).toFixed(2)}`)
    .join(" ");
  const area = `${line} L${scale.x(points.length - 1).toFixed(2)},${baseline} L${scale.x(0).toFixed(2)},${baseline} Z`;

  return `<svg class="index-spark-svg ${tone}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path class="spark-area" d="${area}"/><path class="spark-line" d="${line}"/></svg>`;
}

function buildIndexChart(points, index, change) {
  const width = 640;
  const height = 300;
  const padding = { top: 22, right: 18, bottom: 38, left: 96 };
  const scale = chartScale(points, width, height, padding);
  const tone = changeTone(change);
  const baseline = height - padding.bottom;
  const line = points
    .map((point, pointIndex) => `${pointIndex === 0 ? "M" : "L"}${scale.x(pointIndex).toFixed(2)},${scale.y(point.close).toFixed(2)}`)
    .join(" ");
  const area = `${line} L${scale.x(points.length - 1).toFixed(2)},${baseline} L${scale.x(0).toFixed(2)},${baseline} Z`;

  const grid = [];
  for (let step = 0; step <= 4; step += 1) {
    const value = scale.low + ((scale.high - scale.low) * step) / 4;
    const y = scale.y(value);
    grid.push(
      `<line class="chart-grid" x1="${padding.left}" y1="${y.toFixed(2)}" x2="${(width - padding.right).toFixed(2)}" y2="${y.toFixed(2)}"/>`,
      `<text class="chart-axis-label" x="${(padding.left - 10).toFixed(2)}" y="${(y + 4).toFixed(2)}" text-anchor="end">${escapeHTML(formatPoints(value))}</text>`,
    );
  }

  const dateIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  const dateLabels = dateIndexes.map((pointIndex) => {
    const anchor = pointIndex === 0
      ? "start"
      : pointIndex === points.length - 1
        ? "end"
        : "middle";
    return `<text class="chart-axis-label chart-date-label" x="${scale.x(pointIndex).toFixed(2)}" y="${(height - 14).toFixed(2)}" text-anchor="${anchor}">${escapeHTML(formatIndexChartDate(points[pointIndex].date, index.timezone))}</text>`;
  });

  const lastIndex = points.length - 1;
  const lastPoint = points[lastIndex];
  const lastX = scale.x(lastIndex);
  const lastY = scale.y(lastPoint.close);
  const title = `Fechamentos diários de ${index.label || index.key} no último mês`;

  return `<svg class="index-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(title)}"><title>${escapeHTML(title)}</title>${grid.join("")}<path class="chart-area ${tone}" d="${area}"/><path class="chart-line ${tone}" d="${line}"/><circle class="chart-dot ${tone}" cx="${lastX.toFixed(2)}" cy="${lastY.toFixed(2)}" r="5"/>${dateLabels.join("")}</svg>`;
}

function chartStat(label, value, tone = "neutral") {
  const stat = document.createElement("div");
  stat.className = "chart-stat";

  const labelEl = document.createElement("span");
  labelEl.className = "chart-stat-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("strong");
  valueEl.className = `chart-stat-value ${tone}`;
  valueEl.textContent = value;

  stat.append(labelEl, valueEl);
  return stat;
}

function renderChart(index) {
  if (!chartDialogEl) {
    return;
  }

  const points = indexChartPoints(index);
  const hadFocus = chartDialogEl.contains(document.activeElement);
  const content = document.createElement("div");
  content.className = "chart-dialog-content";

  const head = document.createElement("div");
  head.className = "chart-dialog-head";

  const titleWrap = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "chart-eyebrow";
  eyebrow.textContent = "Histórico diário · 1 mês";

  const titleRow = document.createElement("div");
  titleRow.className = "chart-title-row";
  const title = document.createElement("h2");
  title.id = "index-chart-title";
  title.className = "chart-title";
  title.textContent = index.label || index.key;
  titleRow.appendChild(title);

  if (index.symbol) {
    const symbol = document.createElement("span");
    symbol.className = "chart-symbol";
    symbol.textContent = index.symbol;
    titleRow.appendChild(symbol);
  }

  titleWrap.append(eyebrow, titleRow);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "chart-close";
  closeButton.setAttribute("aria-label", "Fechar gráfico");
  closeButton.textContent = "×";
  closeButton.addEventListener("click", closeChart);

  head.append(titleWrap, closeButton);
  content.appendChild(head);

  if (index.loading) {
    const loading = document.createElement("p");
    loading.className = "chart-empty chart-loading";
    loading.textContent = "Carregando histórico diário…";
    content.appendChild(loading);
    chartDialogEl.replaceChildren(content);
    if (hadFocus) {
      chartDialogEl.querySelector(".chart-close")?.focus();
    }
    return;
  }

  if (points.length < 2) {
    const empty = document.createElement("p");
    empty.className = "chart-empty";
    empty.textContent = index.error
      ? `Dados indisponíveis: ${index.error}`
      : index.historyError
        ? `Histórico indisponível: ${index.historyError}`
        : "Histórico diário indisponível para este item.";
    content.appendChild(empty);
    chartDialogEl.replaceChildren(content);
    if (hadFocus) {
      chartDialogEl.querySelector(".chart-close")?.focus();
    }
    return;
  }

  const change = periodChange(points);
  const lastPoint = points[points.length - 1];
  const closes = points.map((point) => point.close);
  const summary = document.createElement("div");
  summary.className = "chart-summary";
  summary.append(
    chartStat("Último", formatPoints(index.price)),
    chartStat("Variação do dia", formatPercent(index.change), changeTone(index.change)),
    chartStat("No período", formatPercent(change), changeTone(change)),
    chartStat("Mínimo", formatPoints(Math.min(...closes))),
    chartStat("Máximo", formatPoints(Math.max(...closes))),
  );

  const canvas = document.createElement("div");
  canvas.className = "chart-canvas";
  canvas.innerHTML = buildIndexChart(points, index, change);

  const note = document.createElement("p");
  note.className = "chart-note";
  note.textContent = `Fechamentos diários · último ponto em ${formatIndexChartDate(lastPoint.date, index.timezone, true)} · Yahoo Finance`;

  content.append(summary, canvas, note);
  chartDialogEl.replaceChildren(content);
  if (hadFocus) {
    chartDialogEl.querySelector(".chart-close")?.focus();
  }
}

function clearChartCloseAnimation() {
  window.clearTimeout(chartCloseTimer);
  chartCloseTimer = null;
  if (chartCloseHandler) {
    chartDialogEl.removeEventListener("transitionend", chartCloseHandler);
    chartCloseHandler = null;
  }
}

function showChartModal() {
  if (!chartDialogEl) {
    return;
  }

  clearChartCloseAnimation();
  chartClosing = false;
  chartDialogEl.classList.remove("closing");

  if (chartDialogEl.open) {
    chartDialogEl.classList.remove("opening");
    return;
  }

  if (prefersReducedMotion) {
    if (typeof chartDialogEl.showModal === "function") {
      chartDialogEl.showModal();
    } else {
      chartDialogEl.setAttribute("open", "");
    }
    return;
  }

  chartDialogEl.classList.add("opening");
  if (typeof chartDialogEl.showModal === "function") {
    chartDialogEl.showModal();
  } else {
    chartDialogEl.setAttribute("open", "");
  }

  const reveal = () => chartDialogEl.classList.remove("opening");
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(() => window.requestAnimationFrame(reveal));
  } else {
    window.setTimeout(reveal, 20);
  }
}

function openChart(chart, trigger) {
  if (!chartDialogEl) {
    return;
  }

  activeChartKey = chart.key || chart.symbol || "";
  lastChartTrigger = trigger || null;
  renderChart(chart);
  showChartModal();
}

function closeChart() {
  if (!chartDialogEl?.open || chartClosing) {
    return;
  }

  clearChartCloseAnimation();
  const finish = () => {
    if (!chartClosing) {
      return;
    }
    clearChartCloseAnimation();
    chartClosing = false;
    chartDialogEl.classList.remove("closing");
    if (typeof chartDialogEl.close === "function") {
      chartDialogEl.close();
    } else {
      chartDialogEl.removeAttribute("open");
    }
  };

  chartClosing = true;

  if (prefersReducedMotion) {
    finish();
    return;
  }

  chartDialogEl.classList.add("closing");
  chartCloseHandler = (event) => {
    if (event.target === chartDialogEl && event.propertyName === "opacity") {
      finish();
    }
  };
  chartDialogEl.addEventListener("transitionend", chartCloseHandler);
  chartCloseTimer = window.setTimeout(finish, 500);
}

function assetTypeLabel(asset) {
  const type = String(asset.type || "").toLowerCase();
  const subType = String(asset.subType || "").toLowerCase();
  if (subType === "fii") return "FII";
  if (subType === "fip") return "FIP";
  if (subType === "etf") return "ETF";
  if (subType === "unit") return "Unit";
  if (type === "bdr") return "BDR";
  if (type === "fund") return "Fundo";
  return "Ação";
}

function searchResultItem(asset) {
  const symbol = String(asset.stock || "").trim().toUpperCase();
  return {
    key: `asset:${symbol}`,
    symbol,
    name: String(asset.name || "").trim(),
    price: Number(asset.close) || 0,
    change: Number(asset.change) || 0,
    type: assetTypeLabel(asset),
    history: [],
  };
}

function findSnapshotHistory(symbol) {
  for (const groups of [lastSnapshot?.groups, lastSnapshot?.lows]) {
    for (const group of Array.isArray(groups) ? groups : []) {
      const item = (group.items || []).find((entry) => entry.symbol === symbol);
      if (item && Array.isArray(item.history) && item.history.length >= 2) {
        return item.history;
      }
    }
  }
  return null;
}

async function fetchAssetHistory(symbol) {
  const response = await fetch(`${HISTORY_URL}?symbol=${encodeURIComponent(symbol)}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload.points)) {
    throw new Error("resposta inesperada");
  }
  return payload.points;
}

async function openSearchAsset(item, trigger) {
  const chart = {
    key: item.key,
    label: item.symbol,
    symbol: item.name,
    price: item.price,
    change: item.change,
    timezone: "America/Sao_Paulo",
    history: findSnapshotHistory(item.symbol) || [],
  };

  if (chart.history.length >= 2) {
    openChart(chart, trigger);
    return;
  }

  activeChartKey = chart.key;
  lastChartTrigger = trigger || null;
  renderChart({ ...chart, loading: true });
  showChartModal();

  try {
    const history = await fetchAssetHistory(item.symbol);
    if (activeChartKey !== chart.key) {
      return;
    }
    chart.history = history;
    renderChart(chart);
  } catch (error) {
    if (activeChartKey === chart.key) {
      renderChart({ ...chart, historyError: error.message });
    }
  }
}

function hideSearchResults() {
  searchResultsEl.hidden = true;
  searchInputEl.setAttribute("aria-expanded", "false");
  searchInputEl.removeAttribute("aria-activedescendant");
  activeSearchIndex = -1;
}

function showSearchResults() {
  searchResultsEl.hidden = false;
  searchInputEl.setAttribute("aria-expanded", "true");
}

function openSearch() {
  if (!assetSearchEl) {
    return;
  }

  assetSearchEl.classList.add("open");
  searchToggleEl?.setAttribute("aria-expanded", "true");
  window.setTimeout(() => searchInputEl?.focus(), 30);

  if (searchItems.length > 0) {
    showSearchResults();
  } else if (searchInputEl?.value.trim().length >= 2) {
    scheduleSearch(searchInputEl.value);
  }
}

function closeSearch() {
  assetSearchEl?.classList.remove("open");
  searchToggleEl?.setAttribute("aria-expanded", "false");
  hideSearchResults();
}

function setActiveSearchIndex(index) {
  const options = Array.from(searchResultsEl.querySelectorAll(".search-result"));
  activeSearchIndex = index;
  options.forEach((option, position) => {
    const active = position === index;
    option.classList.toggle("active", active);
    option.setAttribute("aria-selected", String(active));
  });

  if (index >= 0 && options[index]) {
    searchInputEl.setAttribute("aria-activedescendant", options[index].id);
    options[index].scrollIntoView({ block: "nearest" });
  } else {
    searchInputEl.removeAttribute("aria-activedescendant");
  }
}

function showSearchMessage(message) {
  searchItems = [];
  activeSearchIndex = -1;
  const empty = document.createElement("p");
  empty.className = "search-empty";
  empty.textContent = message;
  searchResultsEl.replaceChildren(empty);
  showSearchResults();
}

function renderSearchResults(items, query) {
  searchItems = items;
  activeSearchIndex = -1;
  searchResultsEl.replaceChildren();

  if (items.length === 0) {
    showSearchMessage(`Nenhum ativo encontrado para “${query}”.`);
    return;
  }

  items.forEach((item, index) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "search-result";
    option.id = `search-option-${index}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    option.innerHTML = `
      <span class="search-result-main">
        <span class="search-result-symbol">${escapeHTML(item.symbol)}</span>
        <span class="search-result-name" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</span>
        <span class="search-result-type">${escapeHTML(item.type)}</span>
      </span>
      <span class="search-result-side">
        <strong class="search-result-price">${escapeHTML(formatMoney(item.price))}</strong>
        <span class="search-result-change ${changeTone(item.change)}">${escapeHTML(formatPercent(item.change))}</span>
      </span>`;
    option.addEventListener("click", () => selectSearchResult(item));
    searchResultsEl.appendChild(option);
  });

  showSearchResults();
  searchInputEl.removeAttribute("aria-activedescendant");
}

async function runSearch(query) {
  const cacheKey = query.toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached) {
    if (query.toLowerCase() === searchInputEl.value.trim().toLowerCase()) {
      renderSearchResults(cached, query);
    }
    return;
  }

  if (typeof AbortController === "function") {
    searchController?.abort();
    searchController = new AbortController();
  }
  showSearchMessage("Buscando ativos…");

  try {
    const params = new URLSearchParams({
      search: query,
      limit: String(SEARCH_LIMIT),
    });
    const response = await fetch(`${SEARCH_URL}?${params}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: searchController?.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const assets = (Array.isArray(payload.stocks) ? payload.stocks : [])
      .filter((asset) => !String(asset.stock || "").toUpperCase().endsWith("F"))
      .slice(0, 8)
      .map((asset) => searchResultItem(asset));

    if (searchCache.size > 40) {
      searchCache.delete(searchCache.keys().next().value);
    }
    searchCache.set(cacheKey, assets);

    if (query.toLowerCase() !== searchInputEl.value.trim().toLowerCase()) {
      return;
    }
    renderSearchResults(assets, query);
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }
    if (query.toLowerCase() === searchInputEl.value.trim().toLowerCase()) {
      showSearchMessage(`Busca indisponível: ${error.message}`);
    }
  }
}

function scheduleSearch(rawQuery) {
  const query = rawQuery.trim().replace(/\s+/g, " ");
  window.clearTimeout(searchTimer);
  searchController?.abort();

  if (query.length < 2) {
    searchItems = [];
    hideSearchResults();
    return;
  }

  searchTimer = window.setTimeout(() => {
    void runSearch(query);
  }, SEARCH_TIMEOUT_MS);
}

function selectSearchResult(item) {
  hideSearchResults();
  searchInputEl.blur();
  void openSearchAsset(item, searchInputEl);
}

function relativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) {
    return "agora";
  }
  if (minutes < 60) {
    return `há ${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  return `há ${hours} h`;
}

function changeTone(value) {
  if (!Number.isFinite(value) || value === 0) {
    return "neutral";
  }
  return value > 0 ? "positive" : "negative";
}

function setLoading(isLoading) {
  loading = isLoading;
  refreshEl.disabled = isLoading;
  refreshEl.classList.toggle("loading", isLoading);
  refreshEl.querySelector(".button-label").textContent = isLoading
    ? "Atualizando…"
    : "Atualizar";
  groupsEl.setAttribute("aria-busy", String(isLoading));
}

function showToast(message, tone) {
  window.clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.className = `toast show ${tone}`;
  toastTimer = window.setTimeout(() => {
    toastEl.className = "toast";
  }, 3400);
}

function updateStatus(snapshot) {
  const generated = snapshot.generatedAt;
  const relative = relativeTime(generated);
  const b3Note = snapshot.b3Closed && snapshot.b3AsOf
    ? ` · B3 fechada · último pregão ${formatB3SessionDate(snapshot.b3AsOf)}`
    : "";
  statusEl.textContent = `Atualizado ${formatDate(generated)}${relative ? ` · ${relative}` : ""}${b3Note}`;
  statusEl.classList.remove("error");
}

function highlightCard(label, value, meta, tone) {
  const card = document.createElement("article");
  card.className = "highlight";
  card.innerHTML = `
    <span class="highlight-label">${escapeHTML(label)}</span>
    <strong class="highlight-value ${tone}">${escapeHTML(value)}</strong>
    <span class="highlight-meta">${escapeHTML(meta)}</span>`;
  return card;
}

function formatIndexTime(index) {
  const date = new Date(index.asOf);
  if (Number.isNaN(date.getTime())) {
    return "último dado indisponível";
  }

  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: index.timezone || "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  } catch {
    return formatDate(index.asOf);
  }
}

function renderIndexCard(index, position) {
  const card = document.createElement("article");
  card.className = "index-card";
  card.style.setProperty("--i", String(position));
  card.dataset.indexKey = index.key || "";
  if (index.error) {
    card.classList.add("error");
  }

  const tone = index.error ? "neutral" : changeTone(index.change);
  const value = index.error ? "—" : formatPoints(index.price);
  const change = index.error ? "indisponível" : formatPercent(index.change);
  const meta = index.error || formatIndexTime(index);
  const chartPoints = indexChartPoints(index);

  card.innerHTML = `
    <div class="index-head">
      <span class="index-label">${escapeHTML(index.label || index.key)}</span>
      <span class="index-symbol">${escapeHTML(index.symbol || "")}</span>
    </div>
    <strong class="index-value">${escapeHTML(value)}</strong>
    <span class="index-change ${tone}">${escapeHTML(change)}</span>
    <span class="index-meta" title="${escapeHTML(meta)}">${escapeHTML(meta)}</span>`;

  if (!index.error && chartPoints.length >= 2) {
    const spark = document.createElement("div");
    spark.className = "index-spark";
    spark.innerHTML = buildSparkline(chartPoints, changeTone(periodChange(chartPoints)));
    card.appendChild(spark);
    card.classList.add("interactive");
    card.tabIndex = 0;
    card.title = "Clique para ver o gráfico diário";
    card.setAttribute("role", "button");
    card.setAttribute("aria-haspopup", "dialog");
    card.setAttribute("aria-label", `Abrir gráfico diário de ${index.label || index.key}`);
    card.addEventListener("click", () => openChart(index, card));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openChart(index, card);
      }
    });
  }

  return card;
}

function renderIndices(indices) {
  if (!Array.isArray(indices) || indices.length === 0) {
    indicesEl.replaceChildren();
    indicesEl.hidden = true;
    return;
  }

  indicesEl.hidden = false;
  indicesEl.replaceChildren(...indices.map((index, position) => renderIndexCard(index, position)));
}

function renderHighlights(groups, mode) {
  const items = [];
  for (const group of groups) {
    for (const item of group.items || []) {
      items.push({ ...item, group: group.label || group.key });
    }
  }

  let topChange = null;
  let topVolume = null;
  for (const item of items) {
    if (!topChange) {
      topChange = item;
    } else if (mode === "lows" ? item.change < topChange.change : item.change > topChange.change) {
      topChange = item;
    }
    if (!topVolume || item.financialVolume > topVolume.financialVolume) {
      topVolume = item;
    }
  }

  const config = MODES[mode] || MODES.highs;

  highlightsEl.replaceChildren(
    highlightCard(
      config.topLabel,
      topChange ? topChange.symbol : "—",
      topChange
        ? `${topChange.group} · ${formatPercent(topChange.change)}`
        : "sem dados",
      topChange ? changeTone(topChange.change) : "neutral",
    ),
    highlightCard(
      "Maior volume",
      topVolume ? topVolume.symbol : "—",
      topVolume
        ? `${topVolume.group} · ${formatCompact(topVolume.financialVolume)}`
        : "sem dados",
      "neutral",
    ),
    highlightCard(
      "Cobertura",
      `${items.length} ativos`,
      `${groups.length} grupos · top 10 ${config.coverage} ${lastSnapshot?.b3Closed ? "do último pregão" : "do dia"}`,
      "neutral",
    ),
  );
}

function assetChart(item) {
  return {
    key: `asset:${item.symbol}`,
    label: item.symbol,
    symbol: item.name || "",
    price: item.price,
    change: item.change,
    timezone: "America/Sao_Paulo",
    history: item.history,
  };
}

function findChartRecord(key) {
  const indexRecord = (lastSnapshot?.indices || []).find((item) => item.key === key);
  if (indexRecord) {
    return indexRecord;
  }
  if (!key.startsWith("asset:")) {
    return null;
  }

  const symbol = key.slice("asset:".length);
  for (const groups of [lastSnapshot?.groups, lastSnapshot?.lows]) {
    for (const group of Array.isArray(groups) ? groups : []) {
      const item = (group.items || []).find((entry) => entry.symbol === symbol);
      if (item) {
        return assetChart(item);
      }
    }
  }
  return null;
}

function refreshActiveChart() {
  if (!chartDialogEl?.open || !activeChartKey) {
    return;
  }

  const chart = findChartRecord(activeChartKey);
  if (chart) {
    renderChart(chart);
  }
}

function buildTable(items) {
  const maxAbs = items.reduce(
    (max, item) => Math.max(max, Math.abs(item.change)),
    0,
  );

  const table = document.createElement("table");
  table.className = "group-table";

  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th>#</th>
      <th>Ativo</th>
      <th>Gráfico</th>
      <th>Último</th>
      <th>Var. dia</th>
      <th>Volume (R$)</th>
      <th>Market cap</th>
      <th>Setor</th>
    </tr>`;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const item of items) {
    const tone = changeTone(item.change);
    const rankClass = item.rank <= 3 ? ` rank-${item.rank}` : "";
    const barWidth = maxAbs
      ? Math.max(4, Math.min(100, (Math.abs(item.change) / maxAbs) * 100))
      : 0;
    const sector = item.sector || "—";
    const chartPoints = indexChartPoints(item);
    const chartButton = chartPoints.length >= 2
      ? `<button type="button" class="spark-button" data-chart-key="asset:${escapeHTML(item.symbol)}" aria-label="Abrir gráfico diário de ${escapeHTML(item.symbol)}" title="Ver gráfico diário">${buildSparkline(chartPoints, changeTone(periodChange(chartPoints)))}</button>`
      : '<span class="chart-na">—</span>';

    const row = document.createElement("tr");
    row.className = "asset-row";
    row.title = chartPoints.length >= 2
      ? "Clique para ver o gráfico diário"
      : "Histórico diário indisponível para este ativo";
    row.innerHTML = `
      <td><span class="rank${rankClass}">${escapeHTML(item.rank)}</span></td>
      <td>
        <span class="symbol">${escapeHTML(item.symbol)}</span>
        <span class="asset-name" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</span>
      </td>
      <td class="chart-cell">${chartButton}</td>
      <td>${formatMoney(item.price)}</td>
      <td class="change-cell">
        <span class="change ${tone}">${formatPercent(item.change)}</span>
        <span class="bar" aria-hidden="true"><span class="bar-fill ${tone}" style="width:${barWidth.toFixed(1)}%"></span></span>
      </td>
      <td>${formatCompact(item.financialVolume)}</td>
      <td>${formatCompact(item.marketCap)}</td>
      <td class="sector" title="${escapeHTML(sector)}">${escapeHTML(sector)}</td>`;

    const chartButtonEl = row.querySelector(".spark-button");
    if (chartButtonEl) {
      chartButtonEl.addEventListener("click", () => openChart(assetChart(item), chartButtonEl));
    }
    const chartTrigger = chartButtonEl || row;
    row.addEventListener("click", (event) => {
      if (event.target.closest(".spark-button")) {
        return;
      }
      openChart(assetChart(item), chartTrigger);
    });

    tbody.appendChild(row);
  }
  table.appendChild(tbody);

  return table;
}

function renderGroup(group, index) {
  const section = document.createElement("section");
  section.className = "group";
  section.style.setProperty("--i", String(index));

  const items = Array.isArray(group.items) ? group.items : [];
  const leader = items[0];
  const label = group.label || group.key;
  const collapsed = collapsedGroups.has(group.key);
  const bodyId = `group-body-${group.key}`;

  if (collapsed) {
    section.classList.add("collapsed");
  }

  const head = document.createElement("button");
  head.type = "button";
  head.className = "group-head";
  head.setAttribute("aria-controls", bodyId);
  head.setAttribute("aria-expanded", String(!collapsed));
  head.setAttribute("aria-label", `${collapsed ? "Expandir" : "Recolher"} ${label} (${items.length} ativos)`);
  head.innerHTML = `
    <span class="group-title">${escapeHTML(label)}</span>
    <span class="group-count">${items.length} ativos</span>
    <span class="scroll-hint">deslize a tabela →</span>`;

  if (leader) {
    const leaderEl = document.createElement("span");
    leaderEl.className = "group-leader";
    leaderEl.innerHTML = `#1 <strong>${escapeHTML(leader.symbol)}</strong> ${formatPercent(leader.change)}`;
    head.appendChild(leaderEl);
  }

  const chevron = document.createElement("span");
  chevron.className = "group-toggle";
  chevron.setAttribute("aria-hidden", "true");
  chevron.innerHTML = '<span class="chevron"></span>';
  head.appendChild(chevron);

  const body = document.createElement("div");
  body.className = "group-body";
  body.id = bodyId;
  body.setAttribute("aria-hidden", String(collapsed));

  const inner = document.createElement("div");
  inner.className = "group-body-inner";
  body.appendChild(inner);

  head.addEventListener("click", () => {
    const isCollapsed = section.classList.toggle("collapsed");
    head.setAttribute("aria-expanded", String(!isCollapsed));
    head.setAttribute("aria-label", `${isCollapsed ? "Expandir" : "Recolher"} ${label} (${items.length} ativos)`);
    body.setAttribute("aria-hidden", String(isCollapsed));
    setCollapsed(group.key, isCollapsed);
  });

  if (group.error) {
    const message = document.createElement("p");
    message.className = "error";
    message.textContent = group.error;
    inner.appendChild(message);
  } else if (items.length === 0) {
    const message = document.createElement("p");
    message.className = "empty";
    message.textContent = "Sem dados para este filtro.";
    inner.appendChild(message);
  } else {
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    wrap.appendChild(buildTable(items));
    inner.appendChild(wrap);
  }

  section.appendChild(head);
  section.appendChild(body);

  return section;
}

function renderFatal(message) {
  const box = document.createElement("p");
  box.className = "error";
  box.textContent = message;
  groupsEl.replaceChildren(box);
}

function renderActiveGroups() {
  if (!lastSnapshot) {
    return;
  }

  const groups = activeMode === "lows"
    ? (Array.isArray(lastSnapshot.lows) ? lastSnapshot.lows : [])
    : (Array.isArray(lastSnapshot.groups) ? lastSnapshot.groups : []);

  groupsEl.replaceChildren();

  if (groups.length === 0) {
    const message = document.createElement("p");
    message.className = "empty";
    message.textContent = activeMode === "lows"
      ? "Ainda não há dados de baixas. Aguarde a próxima atualização."
      : "Sem dados para exibir.";
    groupsEl.appendChild(message);
  } else {
    groups.forEach((group, index) => {
      groupsEl.appendChild(renderGroup(group, index));
    });
  }

  renderHighlights(groups, activeMode);
  modeDescriptionEl.textContent = modeDescription(activeMode);
}

function modeDescription(mode) {
  const config = MODES[mode] || MODES.highs;
  const period = lastSnapshot?.b3Closed ? "do último pregão" : "do dia";
  return `Top 10 maiores ${config.coverage} ${period}`;
}

function setMode(mode) {
  if (!MODES[mode] || mode === activeMode) {
    return;
  }

  activeMode = mode;
  for (const button of modeButtons) {
    const isActive = button.dataset.mode === mode;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  }
  renderActiveGroups();
}

function render(snapshot) {
  lastSnapshot = snapshot;
  renderIndices(snapshot.indices || []);
  renderActiveGroups();
  updateStatus(snapshot);
  refreshActiveChart();
}

function isSnapshotStale(snapshot) {
  const generated = new Date(snapshot?.generatedAt).getTime();
  if (!Number.isFinite(generated)) {
    return true;
  }
  return Date.now() - generated > SNAPSHOT_MAX_AGE_MS;
}

async function fetchSnapshotURL(url) {
  const response = await fetch(`${url}?t=${Date.now()}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchSnapshot() {
  let local = null;

  try {
    local = await fetchSnapshotURL(DATA_URL);
  } catch {
    local = null;
  }

  if (local && !isSnapshotStale(local)) {
    return local;
  }

  try {
    const proxied = await fetchSnapshotURL(SNAPSHOT_FALLBACK_URL);
    if (!local) {
      return proxied;
    }

    const localTime = new Date(local.generatedAt).getTime();
    const proxiedTime = new Date(proxied.generatedAt).getTime();
    if (Number.isFinite(proxiedTime) && (!Number.isFinite(localTime) || proxiedTime > localTime)) {
      return proxied;
    }
  } catch {
    // keep the local snapshot; the caller falls back to live brapi if needed
  }

  if (local) {
    return local;
  }

  throw new Error("snapshot unavailable");
}


async function fetchGroupLive(group, sortOrder) {
  const params = new URLSearchParams({
    sortBy: "change",
    sortOrder,
    limit: "50",
    type: group.type,
  });
  if (group.subType) {
    params.set("subType", group.subType);
  }

  const response = await fetch(`https://brapi.dev/api/quote/list?${params}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload.stocks)) {
    throw new Error("resposta inesperada da brapi");
  }

  const items = [];
  for (const asset of payload.stocks) {
    const symbol = String(asset.stock || "");
    if (symbol.toUpperCase().endsWith("F")) {
      continue;
    }

    const price = Number(asset.close) || 0;
    const quantity = Number(asset.volume) || 0;

    items.push({
      rank: items.length + 1,
      symbol,
      name: asset.name || "",
      price,
      change: Number(asset.change) || 0,
      financialVolume: Math.round(price * quantity * 100) / 100,
      marketCap: asset.market_cap ?? undefined,
      sector: asset.sector || "",
    });

    if (items.length === 10) {
      break;
    }
  }

  return items;
}

function historyBySymbol(groups) {
  const histories = new Map();
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const item of group.items || []) {
      if (Array.isArray(item.history) && item.history.length > 0) {
        histories.set(item.symbol, item.history);
      }
    }
  }
  return histories;
}

function applyHistories(items, histories) {
  if (histories.size === 0) {
    return items;
  }
  return items.map((item) => {
    if (Array.isArray(item.history) && item.history.length > 0) {
      return item;
    }
    const history = histories.get(item.symbol);
    return history ? { ...item, history } : item;
  });
}

async function fetchLiveSnapshot(previousIndices = [], previousSnapshot = null) {
  const groups = [];
  const lows = [];
  const previousHighHistories = historyBySymbol(previousSnapshot?.groups);
  const previousLowHistories = historyBySymbol(previousSnapshot?.lows);
  let failures = 0;

  for (const group of LIVE_GROUPS) {
    let highItems = [];
    let lowItems = [];
    let highError = "";
    let lowError = "";

    try {
      highItems = await fetchGroupLive(group, "desc");
    } catch (error) {
      highError = error.message;
      failures += 1;
    }

    try {
      lowItems = await fetchGroupLive(group, "asc");
    } catch (error) {
      lowError = error.message;
      failures += 1;
    }

    groups.push({
      key: group.key,
      label: group.label,
      items: applyHistories(highItems, previousHighHistories),
      error: highError || undefined,
    });
    lows.push({
      key: group.key,
      label: group.label,
      items: applyHistories(lowItems, previousLowHistories),
      error: lowError || undefined,
    });
  }

  if (failures === LIVE_GROUPS.length * 2) {
    throw new Error("brapi indisponível no momento");
  }

  return {
    generatedAt: new Date().toISOString(),
    source: "brapi.dev (browser)",
    limit: 10,
    groups,
    lows,
    indices: previousIndices,
    b3AsOf: previousSnapshot?.b3AsOf,
    b3Closed: previousSnapshot?.b3Closed,
  };
}

async function load({ manual = false, forceLive = false } = {}) {
  if (loading) {
    return;
  }

  setLoading(true);
  statusEl.textContent = manual || forceLive ? "Buscando atualização…" : "Carregando…";
  statusEl.classList.remove("error");

  try {
    let snapshot = null;

    if (!forceLive) {
      try {
        snapshot = await fetchSnapshot();
      } catch {
        snapshot = null;
      }
    }

    let live = false;
    if (!snapshot || forceLive || isSnapshotStale(snapshot)) {
      try {
        const previous = snapshot || lastSnapshot;
        const previousIndices = previous?.indices || [];
        snapshot = await fetchLiveSnapshot(previousIndices, previous);
        live = true;
      } catch (error) {
        if (!snapshot) {
          throw error;
        }
        showToast("Não foi possível atualizar agora; exibindo o último snapshot.", "error");
      }
    }

    render(snapshot);

    if (manual) {
      showToast(
        live ? "Dados atualizados direto da brapi." : "Dados recarregados com sucesso.",
        "success",
      );
    }
  } catch (error) {
    statusEl.textContent = `Falha ao carregar: ${error.message}`;
    statusEl.classList.add("error");
    showToast(`Falha ao atualizar: ${error.message}`, "error");

    if (!lastSnapshot) {
      renderFatal("Não foi possível carregar os dados. Tente novamente em instantes.");
    }
  } finally {
    setLoading(false);
  }
}

refreshEl.addEventListener("click", () => {
  void load({ manual: true, forceLive: true });
});

if (searchInputEl) {
  searchToggleEl?.addEventListener("click", () => {
    if (assetSearchEl?.classList.contains("open")) {
      closeSearch();
      searchToggleEl.focus();
      return;
    }
    openSearch();
  });

  searchInputEl.addEventListener("input", () => {
    scheduleSearch(searchInputEl.value);
  });

  searchInputEl.addEventListener("focus", () => {
    if (searchItems.length > 0) {
      showSearchResults();
    }
  });

  searchInputEl.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      if (searchItems.length === 0) {
        return;
      }
      event.preventDefault();
      setActiveSearchIndex((activeSearchIndex + 1) % searchItems.length);
      return;
    }

    if (event.key === "ArrowUp") {
      if (searchItems.length === 0) {
        return;
      }
      event.preventDefault();
      const previous = activeSearchIndex <= 0 ? searchItems.length - 1 : activeSearchIndex - 1;
      setActiveSearchIndex(previous);
      return;
    }

    if (event.key === "Enter") {
      if (searchItems.length === 0) {
        return;
      }
      event.preventDefault();
      const index = activeSearchIndex >= 0 ? activeSearchIndex : 0;
      selectSearchResult(searchItems[index]);
      return;
    }

    if (event.key === "Escape") {
      if (!searchResultsEl.hidden) {
        hideSearchResults();
        return;
      }
      closeSearch();
      searchToggleEl?.focus();
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (!assetSearchEl?.contains(event.target)) {
      closeSearch();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const target = event.target;
    if (target instanceof HTMLElement
      && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
      return;
    }
    event.preventDefault();
    openSearch();
  });
}

for (const button of modeButtons) {
  button.addEventListener("click", () => {
    setMode(button.dataset.mode);
  });
}

if (chartDialogEl) {
  chartDialogEl.addEventListener("click", (event) => {
    if (event.target === chartDialogEl) {
      closeChart();
    }
  });

  chartDialogEl.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeChart();
  });

  chartDialogEl.addEventListener("close", () => {
    const closedKey = activeChartKey;
    activeChartKey = null;

    const trigger = lastChartTrigger?.isConnected
      ? lastChartTrigger
      : Array.from(document.querySelectorAll("[data-index-key], [data-chart-key]"))
        .find((element) => (
          element.dataset.indexKey === closedKey
          || element.dataset.chartKey === closedKey
        ));
    trigger?.focus();
    lastChartTrigger = null;
  });
}

function initReveal() {
  const elements = Array.from(document.querySelectorAll(".reveal, .reveal-right"));
  if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    elements.forEach((element) => element.classList.add("visible"));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) {
        continue;
      }
      entry.target.classList.add("visible");
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.08, rootMargin: "0px 0px -40px 0px" });

  elements.forEach((element) => observer.observe(element));
}

function initMarketParticles() {
  const canvas = document.getElementById("market-particles");
  if (!canvas || prefersReducedMotion) {
    return;
  }

  let context = null;
  try {
    context = canvas.getContext("2d");
  } catch {
    return;
  }
  if (!context) {
    return;
  }

  const glyphs = "0123456789$%+-▲▼";
  const particles = [];
  let width = 0;
  let height = 0;
  let isVisible = true;

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(([entry]) => {
      isVisible = entry.isIntersecting;
    }, { rootMargin: "80px" });
    observer.observe(canvas);
  }

  function makeParticle(resetY = false) {
    return {
      x: Math.random() * width,
      y: resetY ? -12 : Math.random() * height,
      glyph: glyphs[Math.floor(Math.random() * glyphs.length)],
      speed: 0.25 + Math.random() * 0.6,
      drift: (Math.random() - 0.5) * 0.12,
      opacity: 0.04 + Math.random() * 0.1,
      size: 9 + Math.floor(Math.random() * 5),
      timer: 0,
      interval: 70 + Math.floor(Math.random() * 160),
      green: Math.random() > 0.82,
    };
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    particles.length = 0;
    const count = Math.min(58, Math.max(22, Math.round(width / 24)));
    for (let i = 0; i < count; i += 1) {
      particles.push(makeParticle());
    }
  }

  function animate() {
    window.requestAnimationFrame(animate);
    if (document.hidden || !isVisible || width === 0) {
      return;
    }

    context.clearRect(0, 0, width, height);
    for (const particle of particles) {
      particle.y += particle.speed;
      particle.x += particle.drift;
      particle.timer += 1;

      if (particle.timer >= particle.interval) {
        particle.glyph = glyphs[Math.floor(Math.random() * glyphs.length)];
        particle.timer = 0;
      }
      if (particle.y > height + 12) {
        particle.y = -12;
        particle.x = Math.random() * width;
      }
      if (particle.x < -20) {
        particle.x = width + 20;
      } else if (particle.x > width + 20) {
        particle.x = -20;
      }

      context.globalAlpha = particle.opacity;
      context.fillStyle = particle.green ? "#3ddc97" : "#59a8ff";
      context.font = `${particle.size}px "JetBrains Mono", monospace`;
      context.fillText(particle.glyph, particle.x, particle.y);
    }
    context.globalAlpha = 1;
  }

  if (typeof window.requestAnimationFrame !== "function") {
    return;
  }

  resize();
  window.addEventListener("resize", resize, { passive: true });
  window.requestAnimationFrame(animate);
}

function initMarketBackdrop() {
  const canvas = document.getElementById("market-backdrop");
  if (!canvas || prefersReducedMotion || typeof window.requestAnimationFrame !== "function") {
    return;
  }

  let context = null;
  try {
    context = canvas.getContext("2d");
  } catch {
    return;
  }
  if (!context) {
    return;
  }

  const step = 18;
  const candleStep = 24;
  let width = 0;
  let height = 0;
  let layers = [];
  let candles = null;

  function nextValue(previous, volatility = 0.55) {
    return Math.max(-1.35, Math.min(1.35, previous + (Math.random() - 0.5) * volatility));
  }

  function makeSeries(length) {
    let value = 0;
    const values = [];
    for (let i = 0; i < length; i += 1) {
      value = nextValue(value);
      values.push(value);
    }
    return values;
  }

  function makeChart(index) {
    const colors = ["89, 168, 255", "61, 220, 151", "89, 168, 255", "139, 92, 246"];
    const labels = ["IBOV", "S&P 500", "STOXX 50", "SSE"];
    return {
      baseY: height * (0.2 + index * 0.18),
      amplitude: Math.min(54, height * 0.075),
      offset: Math.random() * step,
      speed: 0.12 + index * 0.035,
      color: colors[index % colors.length],
      label: labels[index % labels.length],
      alpha: 0.075,
      values: makeSeries(Math.ceil(width / step) + 4),
    };
  }

  function makeCandle(previous = 0) {
    const open = previous;
    const close = nextValue(open, 0.7);
    return {
      open,
      close,
      high: Math.max(open, close) + Math.random() * 0.35,
      low: Math.min(open, close) - Math.random() * 0.35,
    };
  }

  function makeCandles() {
    if (width < 700) {
      return null;
    }

    let previous = 0;
    const values = [];
    const count = Math.ceil(width / candleStep) + 4;
    for (let i = 0; i < count; i += 1) {
      const candle = makeCandle(previous);
      previous = candle.close;
      values.push(candle);
    }
    return {
      baseY: height * 0.84,
      amplitude: Math.min(52, height * 0.065),
      offset: 0,
      speed: 0.18,
      values,
    };
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    const chartCount = width < 700 ? 2 : 4;
    layers = [];
    for (let i = 0; i < chartCount; i += 1) {
      layers.push(makeChart(i));
    }
    candles = makeCandles();
  }

  function drawGrid() {
    const gap = width < 700 ? 48 : 72;
    context.beginPath();
    for (let x = 0; x <= width; x += gap) {
      context.moveTo(x, 0);
      context.lineTo(x, height);
    }
    for (let y = 0; y <= height; y += gap) {
      context.moveTo(0, y);
      context.lineTo(width, y);
    }
    context.lineWidth = 1;
    context.strokeStyle = "rgba(143, 162, 194, 0.03)";
    context.stroke();
  }

  function drawChart(layer) {
    layer.offset += layer.speed;
    while (layer.offset >= step) {
      layer.offset -= step;
      layer.values.shift();
      layer.values.push(nextValue(layer.values[layer.values.length - 1]));
    }

    const startX = -layer.offset;
    const bottom = layer.baseY + layer.amplitude;
    const points = layer.values.map((value, index) => ({
      x: startX + index * step,
      y: layer.baseY - value * layer.amplitude,
    }));

    context.beginPath();
    for (let i = 0; i < points.length; i += 1) {
      if (i === 0) {
        context.moveTo(points[i].x, points[i].y);
      } else {
        context.lineTo(points[i].x, points[i].y);
      }
    }
    context.lineWidth = 1;
    context.strokeStyle = `rgba(${layer.color}, ${layer.alpha})`;
    context.stroke();

    context.beginPath();
    context.moveTo(points[0].x, bottom);
    for (const point of points) {
      context.lineTo(point.x, point.y);
    }
    context.lineTo(points[points.length - 1].x, bottom);
    context.closePath();
    context.fillStyle = `rgba(${layer.color}, 0.018)`;
    context.fill();

    context.beginPath();
    const last = points[points.length - 1];
    context.arc(last.x, last.y, 2.5, 0, Math.PI * 2);
    context.fillStyle = `rgba(${layer.color}, 0.16)`;
    context.fill();

    context.fillStyle = `rgba(${layer.color}, 0.09)`;
    context.font = '9px "JetBrains Mono", monospace';
    context.fillText(layer.label, 18, layer.baseY - layer.amplitude - 8);
  }

  function drawCandles() {
    if (!candles) {
      return;
    }

    candles.offset += candles.speed;
    while (candles.offset >= candleStep) {
      candles.offset -= candleStep;
      candles.values.shift();
      candles.values.push(makeCandle(candles.values[candles.values.length - 1].close));
    }

    const startX = -candles.offset;
    const bodyWidth = 6;

    for (let i = 0; i < candles.values.length; i += 1) {
      const candle = candles.values[i];
      const x = startX + i * candleStep;
      if (x < -candleStep || x > width + candleStep) {
        continue;
      }

      const openY = candles.baseY - candle.open * candles.amplitude;
      const closeY = candles.baseY - candle.close * candles.amplitude;
      const highY = candles.baseY - candle.high * candles.amplitude;
      const lowY = candles.baseY - candle.low * candles.amplitude;
      const rgb = candle.close >= candle.open ? "61, 220, 151" : "255, 107, 107";

      context.beginPath();
      context.moveTo(x, highY);
      context.lineTo(x, lowY);
      context.lineWidth = 1;
      context.strokeStyle = `rgba(${rgb}, 0.085)`;
      context.stroke();

      const top = Math.min(openY, closeY);
      const bodyHeight = Math.max(2, Math.abs(closeY - openY));
      context.fillStyle = `rgba(${rgb}, 0.055)`;
      context.fillRect(x - bodyWidth / 2, top, bodyWidth, bodyHeight);
    }

  }

  function animate() {
    window.requestAnimationFrame(animate);
    if (document.hidden || width === 0) {
      return;
    }

    context.clearRect(0, 0, width, height);
    drawGrid();
    for (const layer of layers) {
      drawChart(layer);
    }
    drawCandles();
  }

  resize();
  window.addEventListener("resize", resize, { passive: true });
  window.requestAnimationFrame(animate);
}

function updateBackToTop() {
  const visible = window.scrollY > 500;
  backToTopEl.classList.toggle("show", visible);
  backToTopEl.tabIndex = visible ? 0 : -1;
}

backToTopEl.addEventListener("click", () => {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
});

window.addEventListener("scroll", updateBackToTop, { passive: true });
updateBackToTop();

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void load();
  }
});

window.setInterval(() => {
  void load();
}, REFRESH_MS);

window.setInterval(() => {
  if (lastSnapshot) {
    updateStatus(lastSnapshot);
  }
}, 60_000);

initReveal();
initMarketParticles();
initMarketBackdrop();
void load();
