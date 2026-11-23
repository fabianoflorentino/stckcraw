const DATA_URL = "data/latest.json";
const SNAPSHOT_FALLBACK_URL = "https://stckcraw-dispatch.fabianoflorentino.workers.dev/snapshot";
const HISTORY_URL = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  ? "http://localhost:8787/history"
  : "https://stckcraw-dispatch.fabianoflorentino.workers.dev/history";
const QUOTE_URL = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  ? "http://localhost:8787/quote"
  : "https://stckcraw-dispatch.fabianoflorentino.workers.dev/quote";
const SEARCH_URL = "https://brapi.dev/api/quote/list";
const SEARCH_TIMEOUT_MS = 350;
const SEARCH_LIMIT = 12;
const REFRESH_MS = 5 * 60 * 1000;
const SNAPSHOT_MAX_AGE_MS = 35 * 60 * 1000;
const STABLE_CHANGE_THRESHOLD = 0.1;
const WALLET_KEY = "stckcraw:wallet";
const MODE_KEY = "stckcraw:mode";
const LANG_KEY = "stckcraw:lang";
const I18N = window.STCKCRAWL_I18N || { "pt-BR": {} };
const WALLET_QUOTE_MS = 5 * 60 * 1000;
const WALLET_SYMBOL_PATTERN = /^[A-Z0-9]{4,12}$/;

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
const modeSwitchEl = document.querySelector(".mode-switch");
const langToggleEl = document.getElementById("lang-toggle");
const modeDescriptionEl = document.getElementById("mode-description");
const assetSearchEl = document.querySelector(".asset-search");
const searchToggleEl = document.getElementById("search-toggle");
const searchInputEl = document.getElementById("asset-search");
const searchResultsEl = document.getElementById("search-results");
const tickerStripEl = document.getElementById("ticker-strip");
const walletEl = document.getElementById("wallet");
const walletSummaryEl = document.getElementById("wallet-summary");
const walletStatusEl = document.getElementById("wallet-status");
const walletTableWrapEl = document.getElementById("wallet-table-wrap");
const walletEmptyEl = document.getElementById("wallet-empty");
const walletAddFormEl = document.getElementById("wallet-add-form");
const walletAddInputEl = document.getElementById("wallet-add-input");
const walletExportEl = document.getElementById("wallet-export");
const walletImportEl = document.getElementById("wallet-import");
const walletLinkEl = document.getElementById("wallet-link");
const walletFileEl = document.getElementById("wallet-file");
const walletEditDialogEl = document.getElementById("wallet-edit");
const walletEditFormEl = document.getElementById("wallet-edit-form");
const walletEditTitleEl = document.getElementById("wallet-edit-title");
const walletEditSymbolEl = document.getElementById("wallet-edit-symbol");
const walletEditQuantityEl = document.getElementById("wallet-edit-quantity");
const walletEditAverageEl = document.getElementById("wallet-edit-average");
const walletEditErrorEl = document.getElementById("wallet-edit-error");
const walletEditCloseEl = document.getElementById("wallet-edit-close");
const walletEditCancelEl = document.getElementById("wallet-edit-cancel");
const walletSuggestionsEl = document.getElementById("wallet-suggestions");

const MODES = {
  highs: {
    topKey: "highlightGain",
    descToday: "modeDescGainersToday",
    descLast: "modeDescGainersLast",
  },
  lows: {
    topKey: "highlightLoss",
    descToday: "modeDescLosersToday",
    descLast: "modeDescLosersLast",
  },
  wallet: {
    topKey: "",
    descToday: "",
    descLast: "",
  },
};

let currentLang = detectLanguage();
let currentLocale = currentLang;
let money;
let usd;
let compact;
let points;
let quantity;
let percent;

function detectLanguage() {
  try {
    const saved = window.localStorage.getItem(LANG_KEY);
    if (saved === "pt-BR" || saved === "en-US") {
      return saved;
    }
  } catch {
    // Storage may be unavailable in private mode.
  }
  return "pt-BR";
}

function buildFormatters() {
  money = new Intl.NumberFormat(currentLocale, {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  usd = new Intl.NumberFormat(currentLocale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  compact = new Intl.NumberFormat(currentLocale, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  points = new Intl.NumberFormat(currentLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  quantity = new Intl.NumberFormat(currentLocale, {
    maximumFractionDigits: 8,
  });
  percent = new Intl.NumberFormat(currentLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
  });
}

buildFormatters();

function t(key, vars) {
  const dict = I18N[currentLang] || I18N["pt-BR"] || {};
  let text = dict[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

function saveLanguage() {
  try {
    window.localStorage.setItem(LANG_KEY, currentLang);
  } catch {
    // Storage may be unavailable in private mode.
  }
}

function applyStaticTranslations() {
  document.documentElement.lang = currentLocale;
  document.title = t("metaTitle");

  const metaDescription = document.getElementById("meta-description");
  if (metaDescription) {
    metaDescription.setAttribute("content", t("metaDescription"));
  }

  for (const node of document.querySelectorAll("[data-i18n]")) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of document.querySelectorAll("[data-i18n-html]")) {
    node.innerHTML = t(node.dataset.i18nHtml);
  }
  for (const node of document.querySelectorAll("[data-i18n-placeholder]")) {
    node.setAttribute("placeholder", t(node.dataset.i18nPlaceholder));
  }
  for (const node of document.querySelectorAll("[data-i18n-aria]")) {
    node.setAttribute("aria-label", t(node.dataset.i18nAria));
  }
  for (const node of document.querySelectorAll("[data-i18n-title]")) {
    node.setAttribute("title", t(node.dataset.i18nTitle));
  }

  if (langToggleEl) {
    const isPortuguese = currentLang === "pt-BR";
    langToggleEl.dataset.lang = isPortuguese ? "pt-br" : "en";
    langToggleEl.setAttribute("aria-checked", String(isPortuguese));
    langToggleEl.setAttribute("aria-label", t("language"));
  }
}

function setLanguage(lang) {
  const next = lang === "en-US" ? "en-US" : "pt-BR";
  if (next === currentLang) {
    return;
  }

  currentLang = next;
  currentLocale = next;
  saveLanguage();
  buildFormatters();
  applyStaticTranslations();
  setLoading(loading);

  searchItems = [];
  activeSearchIndex = -1;
  searchCache.clear();
  hideSearchResults();
  walletSearchItems = [];
  walletSearchIndex = -1;
  walletSearchCache.clear();
  hideWalletSuggestions();
  setWalletStatus("");

  if (lastSnapshot) {
    renderIndices(lastSnapshot.indices || []);
    renderActiveGroups();
    updateStatus(lastSnapshot);
  } else {
    statusEl.textContent = t("statusLoading");
    modeDescriptionEl.textContent = modeDescription(activeMode);
    if (activeMode === "wallet") {
      renderActiveGroups();
    }
  }

  if (chartDialogEl?.open && activeChartData) {
    renderChart(activeChartData);
  }
}

let loading = false;
let lastSnapshot = null;
let toastTimer = null;
let activeMode = "highs";
let activeChartKey = null;
let activeChartData = null;
let lastChartTrigger = null;
let chartCloseTimer = null;
let chartCloseHandler = null;
let chartClosing = false;
let searchTimer = null;
let searchController = null;
let searchItems = [];
let activeSearchIndex = -1;
const searchCache = new Map();
let wallet = [];
let walletEditSymbol = "";
const walletQuotes = new Map();
const walletQuoteRequests = new Map();
let walletSearchTimer = null;
let walletSearchController = null;
let walletSearchItems = [];
let walletSearchIndex = -1;
const walletSearchCache = new Map();
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

function formatQuotePrice(index) {
  if (!Number.isFinite(index.price)) {
    return "—";
  }

  if (index.currency === "BRL") {
    return money.format(index.price);
  }
  if (index.currency === "USD") {
    return usd.format(index.price);
  }

  return points.format(index.price);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || "—";
  }
  return date.toLocaleString(currentLocale, {
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
    return new Intl.DateTimeFormat(currentLocale, {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(date);
  } catch {
    return date.toLocaleDateString(currentLocale);
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
    return new Intl.DateTimeFormat(currentLocale, options).format(date);
  } catch {
    return date.toLocaleDateString(currentLocale, { day: "2-digit", month: "2-digit" });
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

const CHART_WIDTH = 640;
const CHART_HEIGHT = 300;
const CHART_PADDING = { top: 22, right: 18, bottom: 38, left: 96 };

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
  const width = CHART_WIDTH;
  const height = CHART_HEIGHT;
  const padding = CHART_PADDING;
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
  const chartName = INDEX_LABEL_KEYS[index.key] ? indexLabel(index) : (index.label || index.key);
  const title = t("chartAriaTitle", { name: chartName });

  return `<svg class="index-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(title)}"><title>${escapeHTML(title)}</title>${grid.join("")}<path class="chart-area ${tone}" d="${area}"/><path class="chart-line ${tone}" d="${line}"/><circle class="chart-dot ${tone}" cx="${lastX.toFixed(2)}" cy="${lastY.toFixed(2)}" r="5"/>${dateLabels.join("")}</svg>`;
}

function setupChartHover(canvas, points, index) {
  const svg = canvas.querySelector(".index-chart-svg");
  if (!svg || points.length < 2) {
    return;
  }

  const scale = chartScale(points, CHART_WIDTH, CHART_HEIGHT, CHART_PADDING);
  const overlay = document.createElement("div");
  overlay.className = "chart-hover";
  overlay.setAttribute("aria-hidden", "true");

  const line = document.createElement("span");
  line.className = "chart-hover-line";

  const dot = document.createElement("span");
  dot.className = "chart-hover-dot";

  const tooltip = document.createElement("div");
  tooltip.className = "chart-hover-tooltip";
  const dateEl = document.createElement("span");
  dateEl.className = "chart-hover-date";
  const valueEl = document.createElement("strong");
  valueEl.className = "chart-hover-value";
  const changeEl = document.createElement("span");
  changeEl.className = "chart-hover-change";
  tooltip.append(dateEl, valueEl, changeEl);

  overlay.append(line, dot, tooltip);
  canvas.appendChild(overlay);

  const hide = () => {
    overlay.classList.remove("is-active");
  };

  const show = (event) => {
    const svgRect = svg.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    if (svgRect.width === 0 || svgRect.height === 0 || overlayRect.width === 0) {
      return;
    }

    const scaleX = svgRect.width / CHART_WIDTH;
    const scaleY = svgRect.height / CHART_HEIGHT;
    const plotLeft = CHART_PADDING.left * scaleX;
    const plotRight = (CHART_WIDTH - CHART_PADDING.right) * scaleX;
    const pointerX = event.clientX - svgRect.left;
    if (pointerX < plotLeft || pointerX > plotRight) {
      hide();
      return;
    }

    const ratio = (pointerX - plotLeft) / (plotRight - plotLeft);
    const position = ratio * (points.length - 1);
    const lowerIndex = Math.max(0, Math.min(points.length - 1, Math.floor(position)));
    const upperIndex = Math.min(points.length - 1, lowerIndex + 1);
    const fraction = position - lowerIndex;
    const lower = points[lowerIndex];
    const upper = points[upperIndex];
    const close = lower.close + (upper.close - lower.close) * fraction;
    const change = (close / points[0].close - 1) * 100;
    const tone = changeTone(change);
    const nearest = points[Math.round(position)] || lower;
    const dotX = svgRect.left - overlayRect.left + pointerX;
    const dotY = svgRect.top - overlayRect.top + scale.y(close) * scaleY;
    const plotTop = svgRect.top - overlayRect.top + CHART_PADDING.top * scaleY;
    const plotBottom = svgRect.top - overlayRect.top + (CHART_HEIGHT - CHART_PADDING.bottom) * scaleY;

    line.style.left = `${dotX}px`;
    line.style.top = `${plotTop}px`;
    line.style.height = `${Math.max(0, plotBottom - plotTop)}px`;

    dot.className = `chart-hover-dot ${tone}`;
    dot.style.left = `${dotX}px`;
    dot.style.top = `${dotY}px`;

    dateEl.textContent = formatIndexChartDate(nearest.date, index.timezone);
    valueEl.textContent = formatPoints(close);
    changeEl.textContent = formatPercent(change);
    changeEl.className = `chart-hover-change ${tone}`;

    overlay.classList.add("is-active");

    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;
    let left = dotX + 12;
    let top = dotY - tooltipHeight - 12;
    if (left + tooltipWidth > overlayRect.width - 6) {
      left = dotX - tooltipWidth - 12;
    }
    if (top < 6) {
      top = dotY + 12;
    }
    if (top + tooltipHeight > overlayRect.height - 6) {
      top = overlayRect.height - tooltipHeight - 6;
    }
    tooltip.style.left = `${Math.max(6, left)}px`;
    tooltip.style.top = `${Math.max(6, top)}px`;
  };

  svg.addEventListener("pointermove", show);
  svg.addEventListener("pointerdown", show);
  svg.addEventListener("pointerleave", hide);
  svg.addEventListener("pointercancel", hide);
  svg.addEventListener("pointerup", (event) => {
    if (event.pointerType !== "mouse") {
      hide();
    }
  });
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

  activeChartData = index;
  const points = indexChartPoints(index);
  const hadFocus = chartDialogEl.contains(document.activeElement);
  const content = document.createElement("div");
  content.className = "chart-dialog-content";

  const head = document.createElement("div");
  head.className = "chart-dialog-head";

  const titleWrap = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "chart-eyebrow";
  eyebrow.textContent = t("chartEyebrow");

  const titleRow = document.createElement("div");
  titleRow.className = "chart-title-row";
  const title = document.createElement("h2");
  title.id = "index-chart-title";
  title.className = "chart-title";
  title.textContent = INDEX_LABEL_KEYS[index.key] ? indexLabel(index) : (index.label || index.key);
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
  closeButton.setAttribute("aria-label", t("chartClose"));
  closeButton.textContent = "×";
  closeButton.addEventListener("click", closeChart);

  const actions = document.createElement("div");
  actions.className = "chart-actions";

  const assetSymbol = String(index.key || "").startsWith("asset:")
    ? normalizeWalletSymbol(index.key.slice("asset:".length))
    : "";
  if (isValidWalletSymbol(assetSymbol)) {
    const assetName = index.symbol || index.label || assetSymbol;
    const star = document.createElement("button");
    star.type = "button";
    star.className = "wallet-star chart-star";
    star.dataset.symbol = assetSymbol;
    star.dataset.name = assetName;
    updateWalletStar(star, assetSymbol);
    star.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleWallet(assetSymbol, assetName);
    });
    actions.appendChild(star);
  }

  actions.appendChild(closeButton);
  head.append(titleWrap, actions);
  content.appendChild(head);

  if (index.loading) {
    const loading = document.createElement("p");
    loading.className = "chart-empty chart-loading";
    loading.textContent = t("chartLoading");
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
      ? t("chartDataUnavailable", { error: index.error })
      : index.historyError
        ? t("chartHistoryUnavailable", { error: index.historyError })
        : t("chartNoHistory");
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
    chartStat(t("chartLast"), formatPoints(index.price)),
    chartStat(t("chartDayChange"), formatPercent(index.change), changeTone(index.change)),
    chartStat(t("chartPeriodChange"), formatPercent(change), changeTone(change)),
    chartStat(t("chartMin"), formatPoints(Math.min(...closes))),
    chartStat(t("chartMax"), formatPoints(Math.max(...closes))),
  );

  const canvas = document.createElement("div");
  canvas.className = "chart-canvas";
  canvas.innerHTML = buildIndexChart(points, index, change);
  setupChartHover(canvas, points, index);

  const note = document.createElement("p");
  note.className = "chart-note";
  note.textContent = t("chartNote", { date: formatIndexChartDate(lastPoint.date, index.timezone, true) });

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

const GROUP_LABEL_KEYS = {
  acoes: "groupStocks",
  fii: "groupREITs",
  fip: "groupFIPs",
  etf: "groupETFs",
  bdr: "groupBDRs",
  unit: "groupUnits",
};

const INDEX_LABEL_KEYS = {
  ibovespa: "indexIbovespa",
  nasdaq: "indexNasdaq",
  stoxx50: "indexStoxx",
  shanghai: "indexShanghai",
  dolar: "indexDollar",
  euro: "indexEuro",
  ouro: "indexGold",
  brent: "indexBrent",
  bitcoin: "indexBitcoin",
  sp500: "indexSp500",
};

function groupLabel(group) {
  const key = GROUP_LABEL_KEYS[group?.key];
  return key ? t(key) : (group?.label || group?.key || "");
}

function indexLabel(index) {
  const key = INDEX_LABEL_KEYS[index?.key];
  return key ? t(key) : (index?.label || index?.key || "");
}

function assetTypeLabel(asset) {
  const type = String(asset.type || "").toLowerCase();
  const subType = String(asset.subType || "").toLowerCase();
  if (subType === "fii") return t("typeREIT");
  if (subType === "fip") return t("typeFIP");
  if (subType === "etf") return t("typeETF");
  if (subType === "unit") return t("typeUnit");
  if (type === "bdr") return t("typeBDR");
  if (type === "fund") return t("typeFund");
  return t("typeStock");
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
    throw new Error(t("unexpectedResponse"));
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
    showSearchMessage(t("searchEmpty", { query }));
    return;
  }

  items.forEach((item, index) => {
    const option = document.createElement("div");
    option.className = "search-result";
    option.id = `search-option-${index}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    option.innerHTML = `
      ${walletStarMarkup(item.symbol, item.name, "search-result-star")}
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
    const star = option.querySelector(".search-result-star");
    star?.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleWallet(item.symbol, item.name);
    });
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
  showSearchMessage(t("searchingAssets"));

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
      showSearchMessage(t("searchUnavailable", { error: error.message }));
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
    return t("justNow");
  }
  const relative = new Intl.RelativeTimeFormat(currentLocale, { numeric: "auto" });
  if (minutes < 60) {
    return relative.format(-minutes, "minute");
  }
  const hours = Math.floor(minutes / 60);
  return relative.format(-hours, "hour");
}

function changeTone(value) {
  if (!Number.isFinite(value) || value === 0) {
    return "neutral";
  }
  return value > 0 ? "positive" : "negative";
}

function quoteTone(value) {
  if (!Number.isFinite(value)) {
    return "neutral";
  }
  return Math.abs(value) < STABLE_CHANGE_THRESHOLD ? "flat" : changeTone(value);
}

function setLoading(isLoading) {
  loading = isLoading;
  refreshEl.disabled = isLoading;
  refreshEl.classList.toggle("loading", isLoading);
  refreshEl.querySelector(".button-label").textContent = isLoading
    ? t("refreshingLabel")
    : t("refresh");
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
  let text = t("statusUpdated", { time: formatDate(generated) });
  if (relative) {
    text += ` · ${relative}`;
  }
  if (snapshot.b3Closed && snapshot.b3AsOf) {
    text += t("statusB3Closed", { date: formatB3SessionDate(snapshot.b3AsOf) });
  }
  statusEl.textContent = text;
  statusEl.classList.remove("error");
}

function highlightCard(label, value, meta, tone, options = {}) {
  const card = document.createElement("article");
  card.className = "highlight";
  card.innerHTML = `
    <span class="highlight-label">${escapeHTML(label)}</span>
    <strong class="highlight-value ${tone}">${escapeHTML(value)}</strong>
    <span class="highlight-meta">${escapeHTML(meta)}</span>`;

  if (options.onClick) {
    card.classList.add("interactive");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-haspopup", options.haspopup || "false");
    card.setAttribute("aria-label", options.ariaLabel || `${label}: ${value}`);
    card.title = options.title || "";
    if (options.action) {
      card.dataset.action = options.action;
    }
    if (options.chartKey) {
      card.dataset.chartKey = options.chartKey;
    }
    card.addEventListener("click", () => options.onClick(card));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        options.onClick(card);
      }
    });
  }

  return card;
}

function formatIndexTime(index) {
  const date = new Date(index.asOf);
  if (Number.isNaN(date.getTime())) {
    return t("lastDataUnavailable");
  }

  try {
    return new Intl.DateTimeFormat(currentLocale, {
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
  const label = indexLabel(index);
  const value = index.error ? "—" : formatPoints(index.price);
  const change = index.error ? t("indexUnavailable") : formatPercent(index.change);
  const meta = index.error || formatIndexTime(index);
  const chartPoints = indexChartPoints(index);

  card.innerHTML = `
    <div class="index-head">
      <span class="index-label">${escapeHTML(label)}</span>
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
    card.title = t("openChartTitle");
    card.setAttribute("role", "button");
    card.setAttribute("aria-haspopup", "dialog");
    card.setAttribute("aria-label", t("openChartAria", { symbol: label }));
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

function renderQuotePill(index) {
  const pill = document.createElement("article");
  const tone = index.error ? "neutral" : quoteTone(index.change);
  const name = indexLabel(index);
  const label = index.unit ? `${name} ${index.unit}` : name;
  pill.className = `ticker-pill ${tone}`;
  pill.title = index.error
    ? t("quoteUnavailableTitle", { name })
    : [label, index.symbol, formatIndexTime(index)]
      .filter(Boolean)
      .join(" · ");

  const value = index.error ? "—" : formatQuotePrice(index);
  const change = index.error ? "—" : formatPercent(index.change);
  pill.innerHTML = `
    <span class="ticker-label">${escapeHTML(label)}</span>
    <span class="ticker-value">${escapeHTML(value)}</span>
    <span class="ticker-change">${escapeHTML(change)}</span>`;

  return pill;
}

function renderTickerStrip(indices) {
  if (!tickerStripEl) {
    return;
  }

  if (indices.length === 0) {
    tickerStripEl.replaceChildren();
    tickerStripEl.hidden = true;
    return;
  }

  tickerStripEl.hidden = false;
  tickerStripEl.replaceChildren(...indices.map(renderQuotePill));
}

function renderIndices(indices) {
  if (!Array.isArray(indices) || indices.length === 0) {
    indicesEl.replaceChildren();
    indicesEl.hidden = true;
    renderTickerStrip([]);
    return;
  }

  const major = [];
  const compact = [];
  for (const index of indices) {
    if (index.compact) {
      compact.push(index);
    } else {
      major.push(index);
    }
  }

  renderTickerStrip(compact);

  if (major.length === 0) {
    indicesEl.replaceChildren();
    indicesEl.hidden = true;
    return;
  }

  indicesEl.hidden = false;
  indicesEl.replaceChildren(...major.map((index, position) => renderIndexCard(index, position)));
}

function renderHighlights(groups, mode) {
  const items = [];
  for (const group of groups) {
    for (const item of group.items || []) {
      items.push({ ...item, group: groupLabel(group) });
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
  const collapsibleGroups = groups.filter((group) => group.key);
  const allCollapsed = collapsibleGroups.length > 0
    && collapsibleGroups.every((group) => collapsedGroups.has(group.key));

  const topChangeOptions = topChange
    ? {
      action: "open-chart",
      haspopup: "dialog",
      chartKey: `asset:${topChange.symbol}`,
      title: t("openChartTitle"),
      ariaLabel: t("openChartAria", { symbol: topChange.symbol }),
      onClick: (card) => openChart(assetChart(topChange), card),
    }
    : {};
  const topVolumeOptions = topVolume
    ? {
      action: "open-chart",
      haspopup: "dialog",
      chartKey: `asset:${topVolume.symbol}`,
      title: t("openChartTitle"),
      ariaLabel: t("openChartAria", { symbol: topVolume.symbol }),
      onClick: (card) => openChart(assetChart(topVolume), card),
    }
    : {};

  highlightsEl.replaceChildren(
    highlightCard(
      t(config.topKey),
      topChange ? topChange.symbol : "—",
      topChange
        ? `${topChange.group} · ${formatPercent(topChange.change)}`
        : t("highlightNoData"),
      topChange ? changeTone(topChange.change) : "neutral",
      topChangeOptions,
    ),
    highlightCard(
      t("highlightVolume"),
      topVolume ? topVolume.symbol : "—",
      topVolume
        ? `${topVolume.group} · ${formatCompact(topVolume.financialVolume)}`
        : t("highlightNoData"),
      "neutral",
      topVolumeOptions,
    ),
    highlightCard(
      t("highlightCoverage"),
      t("highlightAssetsCount", { count: items.length }),
      t("coverageMeta", {
        groups: groups.length,
        action: allCollapsed ? t("coverageExpand") : t("coverageCollapse"),
      }),
      "neutral",
      collapsibleGroups.length > 0
        ? {
          action: "toggle-groups",
          title: allCollapsed ? t("toggleGroupsExpand") : t("toggleGroupsCollapse"),
          ariaLabel: allCollapsed ? t("toggleGroupsAriaExpand") : t("toggleGroupsAriaCollapse"),
          onClick: () => toggleAllGroups(groups),
        }
        : {},
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
      <th>${escapeHTML(t("colAsset"))}</th>
      <th>${escapeHTML(t("colChart"))}</th>
      <th>${escapeHTML(t("colLast"))}</th>
      <th>${escapeHTML(t("colDayChange"))}</th>
      <th>${escapeHTML(t("colVolume"))}</th>
      <th>${escapeHTML(t("colMarketCap"))}</th>
      <th>${escapeHTML(t("colSector"))}</th>
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
      ? `<button type="button" class="spark-button" data-chart-key="asset:${escapeHTML(item.symbol)}" aria-label="${escapeHTML(t("openChartAria", { symbol: item.symbol }))}" title="${escapeHTML(t("openChartTitle"))}">${buildSparkline(chartPoints, changeTone(periodChange(chartPoints)))}</button>`
      : '<span class="chart-na">—</span>';

    const row = document.createElement("tr");
    row.className = "asset-row";
    row.title = chartPoints.length >= 2
      ? t("rowChartTitle")
      : t("rowChartUnavailable");
    row.innerHTML = `
      <td><span class="rank${rankClass}">${escapeHTML(item.rank)}</span></td>
      <td>
        <span class="asset-cell">
          ${walletStarMarkup(item.symbol, item.name)}
          <span class="asset-id">
            <span class="symbol">${escapeHTML(item.symbol)}</span>
            <span class="asset-name" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</span>
          </span>
        </span>
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
    const walletStarEl = row.querySelector(".wallet-star");
    if (walletStarEl) {
      walletStarEl.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleWallet(item.symbol, item.name);
      });
    }
    const chartTrigger = chartButtonEl || row;
    row.addEventListener("click", (event) => {
      if (event.target.closest(".spark-button, .wallet-star")) {
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
  const label = groupLabel(group);
  const collapsed = collapsedGroups.has(group.key);
  const bodyId = `group-body-${group.key}`;
  const ariaKey = collapsed ? "groupExpandAria" : "groupCollapseAria";

  if (collapsed) {
    section.classList.add("collapsed");
  }

  const head = document.createElement("button");
  head.type = "button";
  head.className = "group-head";
  head.setAttribute("aria-controls", bodyId);
  head.setAttribute("aria-expanded", String(!collapsed));
  head.setAttribute("aria-label", t(ariaKey, { label, count: items.length }));
  head.innerHTML = `
    <span class="group-title">${escapeHTML(label)}</span>
    <span class="group-count">${escapeHTML(t("groupCount", { count: items.length }))}</span>
    <span class="scroll-hint">${escapeHTML(t("groupScrollHint"))}</span>`;

  if (leader) {
    const leaderEl = document.createElement("span");
    leaderEl.className = "group-leader";
    leaderEl.innerHTML = t("groupLeader", {
      symbol: `<strong>${escapeHTML(leader.symbol)}</strong>`,
      change: formatPercent(leader.change),
    });
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
    head.setAttribute("aria-label", t(isCollapsed ? "groupExpandAria" : "groupCollapseAria", { label, count: items.length }));
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
    message.textContent = t("groupEmpty");
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

function activeGroups() {
  return activeMode === "lows"
    ? (Array.isArray(lastSnapshot?.lows) ? lastSnapshot.lows : [])
    : (Array.isArray(lastSnapshot?.groups) ? lastSnapshot.groups : []);
}

function toggleAllGroups(groups) {
  const collapsible = groups.filter((group) => group.key);
  const collapse = !collapsible.every((group) => collapsedGroups.has(group.key));

  for (const group of collapsible) {
    setCollapsed(group.key, collapse);
  }

  renderActiveGroups();
  highlightsEl.querySelector('[data-action="toggle-groups"]')?.focus();
}

function normalizeWalletSymbol(value) {
  return String(value || "").trim().toUpperCase().replace(/\.SA$/, "");
}

function isValidWalletSymbol(symbol) {
  return WALLET_SYMBOL_PATTERN.test(symbol);
}

function parseWalletNumber(value) {
  const normalized = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!normalized) {
    return 0;
  }
  const number = Number(normalized);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function formatQuantity(value) {
  return Number.isFinite(value) ? quantity.format(value) : "—";
}

function normalizeWalletEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const symbol = normalizeWalletSymbol(entry.symbol || entry.stock || entry.ticker);
  if (!isValidWalletSymbol(symbol)) {
    return null;
  }

  return {
    symbol,
    name: String(entry.name || "").trim(),
    quantity: parseWalletNumber(entry.quantity ?? entry.qty),
    averagePrice: parseWalletNumber(entry.averagePrice ?? entry.average ?? entry.avgPrice),
    lastPrice: parseWalletNumber(entry.lastPrice),
    lastChange: Number(entry.lastChange) || 0,
    lastAsOf: typeof entry.lastAsOf === "string" ? entry.lastAsOf : "",
    addedAt: typeof entry.addedAt === "string" ? entry.addedAt : new Date().toISOString(),
  };
}

function loadWallet() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WALLET_KEY) || "[]");
    const entries = Array.isArray(parsed) ? parsed.map(normalizeWalletEntry).filter(Boolean) : [];
    const unique = new Map();
    for (const entry of entries) {
      if (!unique.has(entry.symbol)) {
        unique.set(entry.symbol, entry);
      }
    }
    return [...unique.values()];
  } catch {
    return [];
  }
}

function saveWallet() {
  try {
    window.localStorage.setItem(WALLET_KEY, JSON.stringify(wallet));
  } catch {
    // Storage may be unavailable in private mode.
  }
}

function findWalletEntry(symbol) {
  return wallet.find((entry) => entry.symbol === symbol) || null;
}

function isInWallet(symbol) {
  return wallet.some((entry) => entry.symbol === symbol);
}

function loadActiveMode() {
  try {
    const stored = window.localStorage.getItem(MODE_KEY);
    return MODES[stored] ? stored : "highs";
  } catch {
    return "highs";
  }
}

function saveActiveMode(mode) {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Storage may be unavailable in private mode.
  }
}

function applyModeState() {
  if (modeSwitchEl) {
    modeSwitchEl.dataset.mode = activeMode;
  }
  for (const button of modeButtons) {
    const isActive = button.dataset.mode === activeMode;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  }
}

function snapshotAssetMap() {
  const assets = new Map();
  for (const groups of [lastSnapshot?.groups, lastSnapshot?.lows]) {
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const item of group.items || []) {
        const symbol = normalizeWalletSymbol(item.symbol);
        if (symbol && !assets.has(symbol)) {
          assets.set(symbol, item);
        }
      }
    }
  }
  return assets;
}

function walletQuoteFor(entry, assets) {
  const cached = walletQuotes.get(entry.symbol);
  const snapshot = assets.get(entry.symbol);
  if (cached && Number.isFinite(cached.price) && cached.price > 0) {
    return {
      ...cached,
      name: cached.name || snapshot?.name || entry.name,
      history: cached.history?.length ? cached.history : (snapshot?.history || []),
      asOf: cached.asOf || lastSnapshot?.generatedAt || "",
    };
  }

  if (snapshot) {
    return {
      price: Number(snapshot.price) || 0,
      change: Number(snapshot.change) || 0,
      name: snapshot.name || entry.name,
      history: Array.isArray(snapshot.history) ? snapshot.history : [],
      asOf: lastSnapshot?.generatedAt || "",
    };
  }

  if (entry.lastPrice > 0) {
    return {
      price: entry.lastPrice,
      change: entry.lastChange,
      name: entry.name,
      history: [],
      asOf: entry.lastAsOf,
    };
  }

  return null;
}

async function fetchWorkerWalletQuote(symbol) {
  const response = await fetch(`${QUOTE_URL}?symbol=${encodeURIComponent(symbol)}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = await response.json();
  const price = Number(payload.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(t("quoteUnavailableError"));
  }

  return {
    price,
    change: Number(payload.change) || 0,
    name: String(payload.name || ""),
    asOf: typeof payload.asOf === "string" ? payload.asOf : "",
    history: Array.isArray(payload.points) ? payload.points : [],
    at: Date.now(),
  };
}

async function fetchBrapiWalletQuote(symbol) {
  const params = new URLSearchParams({
    search: symbol,
    limit: String(SEARCH_LIMIT),
  });
  const response = await fetch(`${SEARCH_URL}?${params}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = await response.json();
  const match = (Array.isArray(payload.stocks) ? payload.stocks : [])
    .find((asset) => normalizeWalletSymbol(asset.stock) === symbol);
  const price = Number(match?.close);
  if (!match || !Number.isFinite(price) || price <= 0) {
    throw new Error(t("quoteUnavailableError"));
  }

  return {
    price,
    change: Number(match.change) || 0,
    name: String(match.name || ""),
    asOf: "",
    history: [],
    at: Date.now(),
  };
}

async function fetchWalletQuote(symbol) {
  try {
    return await fetchWorkerWalletQuote(symbol);
  } catch {
    return fetchBrapiWalletQuote(symbol);
  }
}

function requestWalletQuote(symbol) {
  if (walletQuoteRequests.has(symbol)) {
    return walletQuoteRequests.get(symbol);
  }

  const request = fetchWalletQuote(symbol).finally(() => {
    walletQuoteRequests.delete(symbol);
  });
  walletQuoteRequests.set(symbol, request);
  return request;
}

function walletQuoteIsFresh(symbol) {
  const quote = walletQuotes.get(symbol);
  return Boolean(quote && quote.at && Date.now() - quote.at < WALLET_QUOTE_MS);
}

async function hydrateWalletEntry(symbol) {
  const entry = findWalletEntry(symbol);
  if (!entry) {
    throw new Error(t("walletEntryNotFound"));
  }

  const quote = await requestWalletQuote(symbol);
  walletQuotes.set(symbol, quote);
  if (!entry.name && quote.name) {
    entry.name = quote.name;
  }
  entry.lastPrice = quote.price;
  entry.lastChange = quote.change;
  entry.lastAsOf = quote.asOf || new Date().toISOString();
  saveWallet();
}

async function refreshWalletQuotes() {
  if (wallet.length === 0) {
    return;
  }

  const assets = snapshotAssetMap();
  const pending = wallet.filter((entry) => !assets.has(entry.symbol) && !walletQuoteIsFresh(entry.symbol));
  if (pending.length === 0) {
    return;
  }

  await Promise.allSettled(pending.map((entry) => hydrateWalletEntry(entry.symbol)));
  saveWallet();
  if (activeMode === "wallet") {
    renderWallet();
  }
}

function setWalletStatus(message, tone = "") {
  if (!walletStatusEl) {
    return;
  }
  walletStatusEl.textContent = message || "";
  walletStatusEl.className = `wallet-status ${tone}`.trim();
}

function updateWalletStar(star, symbol) {
  const inWallet = isInWallet(symbol);
  const name = star.dataset.name || symbol;
  star.setAttribute("aria-pressed", String(inWallet));
  const label = t(inWallet ? "rowStarRemove" : "rowStarAdd", { name });
  star.setAttribute("aria-label", label);
  star.setAttribute("title", label);
  star.textContent = inWallet ? "★" : "☆";
}

function walletStarMarkup(symbol, name, extraClass = "") {
  const inWallet = isInWallet(symbol);
  const label = t(inWallet ? "rowStarRemove" : "rowStarAdd", { name: name || symbol });
  const classes = extraClass ? `wallet-star ${extraClass}` : "wallet-star";
  return `<button type="button" class="${classes}" data-symbol="${escapeHTML(symbol)}" data-name="${escapeHTML(name)}" aria-pressed="${inWallet}" title="${escapeHTML(label)}" aria-label="${escapeHTML(label)}">${inWallet ? "★" : "☆"}</button>`;
}

function updateWalletStars(symbol) {
  for (const star of document.querySelectorAll(`.wallet-star[data-symbol="${CSS.escape(symbol)}"]`)) {
    updateWalletStar(star, symbol);
  }
}

function walletStat(label, value, meta, tone = "neutral") {
  const card = document.createElement("article");
  card.className = "wallet-stat";
  card.innerHTML = `
    <span class="wallet-stat-label">${escapeHTML(label)}</span>
    <strong class="wallet-stat-value ${tone}">${escapeHTML(value)}</strong>
    <span class="wallet-stat-meta">${escapeHTML(meta)}</span>`;
  return card;
}

function walletRows(assets) {
  return wallet.map((entry) => {
    const quote = walletQuoteFor(entry, assets);
    const price = quote?.price ?? 0;
    const hasPrice = Number.isFinite(price) && price > 0;
    const isPosition = entry.quantity > 0;
    const invested = isPosition && entry.averagePrice > 0 ? entry.quantity * entry.averagePrice : null;
    const current = isPosition && hasPrice ? entry.quantity * price : null;
    const pnl = invested !== null && current !== null ? current - invested : null;
    const pnlPercent = pnl !== null && invested > 0 ? (pnl / invested) * 100 : null;

    return {
      entry,
      quote,
      price,
      hasPrice,
      invested,
      current,
      pnl,
      pnlPercent,
      isPosition,
    };
  }).sort((a, b) => {
    if (a.isPosition !== b.isPosition) {
      return a.isPosition ? -1 : 1;
    }
    if (a.isPosition) {
      return (b.current || 0) - (a.current || 0);
    }
    return a.entry.symbol.localeCompare(b.entry.symbol);
  });
}

function walletTable(rows) {
  const totalCurrent = rows.reduce((total, row) => total + (row.current || 0), 0);
  const table = document.createElement("table");
  table.className = "group-table wallet-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>${escapeHTML(t("colAsset"))}</th>
        <th>${escapeHTML(t("colLast"))}</th>
        <th>${escapeHTML(t("colDayChange"))}</th>
        <th>${escapeHTML(t("walletColQuantity"))}</th>
        <th>${escapeHTML(t("walletColAverage"))}</th>
        <th>${escapeHTML(t("walletColInvested"))}</th>
        <th>${escapeHTML(t("walletColCurrent"))}</th>
        <th>${escapeHTML(t("walletColResult"))}</th>
        <th>${escapeHTML(t("walletColWeight"))}</th>
        <th>${escapeHTML(t("walletColActions"))}</th>
      </tr>
    </thead>`;

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const { entry, quote, hasPrice, invested, current, pnl, pnlPercent, isPosition } = row;
    const tone = quote ? changeTone(quote.change) : "neutral";
    const priceText = hasPrice ? formatMoney(row.price) : "—";
    const changeText = quote ? formatPercent(quote.change) : "—";
    const quantityText = isPosition ? formatQuantity(entry.quantity) : "—";
    const averageText = entry.averagePrice > 0 ? formatMoney(entry.averagePrice) : "—";
    const investedText = invested !== null ? formatMoney(invested) : "—";
    const currentText = current !== null ? formatMoney(current) : "—";
    const pnlText = pnl !== null ? formatMoney(pnl) : "—";
    const pnlPercentText = pnlPercent !== null ? formatPercent(pnlPercent) : "";
    const pnlTone = pnl === null ? "neutral" : (pnl >= 0 ? "positive" : "negative");
    const weight = current !== null && totalCurrent > 0 ? (current / totalCurrent) * 100 : null;
    const weightText = weight !== null ? `${points.format(weight)}%` : "—";
    const quoteTime = quote?.asOf ? ` · ${formatDate(quote.asOf)}` : "";

    const tr = document.createElement("tr");
    tr.className = "wallet-row asset-row";
    tr.dataset.symbol = entry.symbol;
    tr.title = quote ? `${t("rowChartTitle")}${quoteTime}` : t("rowChartTitle");
    tr.innerHTML = `
      <td>
        <span class="asset-cell">
          <button type="button" class="wallet-star" data-symbol="${escapeHTML(entry.symbol)}" data-name="${escapeHTML(entry.name)}" aria-pressed="true" title="${escapeHTML(t("rowStarRemove", { name: entry.name || entry.symbol }))}" aria-label="${escapeHTML(t("rowStarRemove", { name: entry.name || entry.symbol }))}">★</button>
          <span class="asset-id">
            <span class="symbol">${escapeHTML(entry.symbol)}</span>
            <span class="asset-name" title="${escapeHTML(entry.name || entry.symbol)}">${escapeHTML(entry.name || "—")}</span>
          </span>
        </span>
      </td>
      <td>${escapeHTML(priceText)}</td>
      <td><span class="change ${tone}">${escapeHTML(changeText)}</span></td>
      <td>${escapeHTML(quantityText)}</td>
      <td>${escapeHTML(averageText)}</td>
      <td>${escapeHTML(investedText)}</td>
      <td>${escapeHTML(currentText)}</td>
      <td>
        <span class="wallet-pnl ${pnlTone}">${escapeHTML(pnlText)}</span>
        ${pnlPercentText ? `<span class="wallet-pnl-meta ${pnlTone}">${escapeHTML(pnlPercentText)}</span>` : ""}
      </td>
      <td>${escapeHTML(weightText)}</td>
      <td>
        <span class="wallet-row-actions">
          <button type="button" class="wallet-edit" data-symbol="${escapeHTML(entry.symbol)}">${escapeHTML(t("walletEdit"))}</button>
          <button type="button" class="wallet-remove" data-symbol="${escapeHTML(entry.symbol)}">${escapeHTML(t("walletRemove"))}</button>
        </span>
      </td>`;
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  return table;
}

function renderWallet() {
  if (!walletEl) {
    return;
  }

  if (activeMode === "wallet") {
    modeDescriptionEl.textContent = modeDescription("wallet");
  }

  const assets = snapshotAssetMap();
  const rows = walletRows(assets);
  const positions = rows.filter((row) => row.isPosition);
  const investedComplete = positions.length > 0 && positions.every((row) => row.invested !== null);
  const currentComplete = positions.length > 0 && positions.every((row) => row.current !== null);
  const invested = positions.reduce((total, row) => total + (row.invested || 0), 0);
  const current = currentComplete
    ? positions.reduce((total, row) => total + (row.current || 0), 0)
    : null;
  const pnl = investedComplete && current !== null ? current - invested : null;
  const pnlPercent = pnl !== null && invested > 0 ? (pnl / invested) * 100 : null;
  const pnlTone = pnl === null ? "neutral" : (pnl >= 0 ? "positive" : "negative");

  walletSummaryEl.replaceChildren(
    walletStat(
      t("walletInvested"),
      invested > 0 && investedComplete ? formatMoney(invested) : "—",
      positions.length === 0
        ? t("walletNoPositions")
        : (investedComplete
          ? `${positions.length} ${t(positions.length === 1 ? "positionOne" : "positionMany")}`
          : t("walletFillAverage")),
    ),
    walletStat(
      t("walletCurrent"),
      current !== null ? formatMoney(current) : "—",
      positions.length === 0
        ? t("walletWatchlistOnly")
        : (currentComplete ? t("walletRecentPrices") : t("walletAwaitingQuote")),
    ),
    walletStat(
      t("walletResult"),
      pnl === null ? "—" : formatMoney(pnl),
      pnlPercent === null ? t("walletNoCompleteData") : formatPercent(pnlPercent),
      pnlTone,
    ),
    walletStat(
      t("walletAssets"),
      String(wallet.length),
      t("walletAssetsMeta", { positions: positions.length, watchlist: wallet.length - positions.length }),
    ),
  );

  const empty = wallet.length === 0;
  walletTableWrapEl.hidden = empty;
  walletEmptyEl.hidden = !empty;
  walletExportEl.disabled = empty;
  walletLinkEl.disabled = empty;

  if (empty) {
    walletTableWrapEl.replaceChildren();
    return;
  }

  walletTableWrapEl.replaceChildren(walletTable(rows));
}

function openWalletEditor(symbol) {
  const entry = findWalletEntry(symbol);
  if (!entry) {
    return;
  }

  walletEditSymbol = symbol;
  walletEditTitleEl.textContent = entry.name || symbol;
  walletEditSymbolEl.textContent = symbol;
  walletEditQuantityEl.value = entry.quantity > 0 ? String(entry.quantity).replace(".", ",") : "";
  walletEditAverageEl.value = entry.averagePrice > 0 ? String(entry.averagePrice).replace(".", ",") : "";
  walletEditErrorEl.hidden = true;
  walletEditErrorEl.textContent = "";

  if (typeof walletEditDialogEl.showModal === "function") {
    walletEditDialogEl.showModal();
  } else {
    walletEditDialogEl.setAttribute("open", "");
  }
  walletEditQuantityEl.focus();
}

function closeWalletEditor() {
  walletEditSymbol = "";
  if (typeof walletEditDialogEl.close === "function") {
    walletEditDialogEl.close();
  } else {
    walletEditDialogEl.removeAttribute("open");
  }
}

function saveWalletEditor(event) {
  event.preventDefault();
  const entry = findWalletEntry(walletEditSymbol);
  if (!entry) {
    closeWalletEditor();
    return;
  }

  const quantity = parseWalletNumber(walletEditQuantityEl.value);
  const averagePrice = parseWalletNumber(walletEditAverageEl.value);

  if (quantity > 0 && averagePrice <= 0) {
    walletEditErrorEl.textContent = t("walletErrorAverage");
    walletEditErrorEl.hidden = false;
    walletEditAverageEl.focus();
    return;
  }

  entry.quantity = quantity;
  entry.averagePrice = quantity > 0 ? averagePrice : 0;
  saveWallet();
  closeWalletEditor();
  renderWallet();
  setWalletStatus(
    entry.quantity > 0
      ? t("walletStatusPosition", { symbol: entry.symbol, quantity: formatQuantity(entry.quantity), average: formatMoney(entry.averagePrice) })
      : t("walletStatusWatchlist", { symbol: entry.symbol }),
    "success",
  );
}

function removeWalletEntry(symbol) {
  const entry = findWalletEntry(symbol);
  if (!entry) {
    return;
  }

  if (entry.quantity > 0 && !window.confirm(t("walletConfirmRemove", { symbol }))) {
    return;
  }

  wallet = wallet.filter((item) => item.symbol !== symbol);
  saveWallet();
  updateWalletStars(symbol);
  renderWallet();
  const removed = t("walletStatusRemoved", { symbol });
  setWalletStatus(removed, "success");
  showToast(removed, "success");
}

function toggleWallet(symbol, name) {
  const entry = findWalletEntry(symbol);
  if (entry) {
    removeWalletEntry(symbol);
    return;
  }

  const snapshot = snapshotAssetMap().get(symbol);
  wallet.push({
    symbol,
    name: name || snapshot?.name || "",
    quantity: 0,
    averagePrice: 0,
    lastPrice: Number(snapshot?.price) || 0,
    lastChange: Number(snapshot?.change) || 0,
    lastAsOf: lastSnapshot?.generatedAt || "",
    addedAt: new Date().toISOString(),
  });
  saveWallet();
  updateWalletStars(symbol);
  if (activeMode === "wallet") {
    renderWallet();
  }
  const added = t("walletStatusAdded", { symbol });
  setWalletStatus(added, "success");
  showToast(added, "success");
  void hydrateWalletEntry(symbol).then(() => {
    if (activeMode === "wallet") {
      renderWallet();
    }
  }).catch(() => {
    setWalletStatus(t("walletStatusQuoteMissing", { symbol }), "error");
  });
}

async function addWalletSymbol(raw, knownName = "") {
  const symbol = normalizeWalletSymbol(raw);
  if (!isValidWalletSymbol(symbol)) {
    setWalletStatus(t("walletStatusInvalid"), "error");
    return;
  }
  if (isInWallet(symbol)) {
    setWalletStatus(t("walletStatusAlready", { symbol }), "error");
    return;
  }

  const snapshot = snapshotAssetMap().get(symbol);
  wallet.push({
    symbol,
    name: snapshot?.name || String(knownName || "").trim(),
    quantity: 0,
    averagePrice: 0,
    lastPrice: Number(snapshot?.price) || 0,
    lastChange: Number(snapshot?.change) || 0,
    lastAsOf: lastSnapshot?.generatedAt || "",
    addedAt: new Date().toISOString(),
  });
  saveWallet();
  updateWalletStars(symbol);
  renderWallet();
  setWalletStatus(t("walletStatusAdded", { symbol }), "success");

  if (!snapshot) {
    try {
      await hydrateWalletEntry(symbol);
      renderWallet();
    } catch {
      setWalletStatus(t("walletStatusQuoteMissing", { symbol }), "error");
    }
  }
}

function walletAssetsFromFile(payload) {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.assets)
      ? payload.assets
      : Array.isArray(payload?.wallet)
        ? payload.wallet
        : Array.isArray(payload?.carteira)
          ? payload.carteira
          : [];

  const entries = [];
  for (const item of items) {
    const source = typeof item === "string" ? { symbol: item } : item;
    const entry = normalizeWalletEntry(source);
    if (entry) {
      entries.push(entry);
    }
  }
  return entries;
}

function exportWallet() {
  if (wallet.length === 0) {
    setWalletStatus(t("walletExportEmpty"), "error");
    return;
  }

  const assets = wallet.map((entry) => ({
    symbol: entry.symbol,
    name: entry.name,
    quantity: entry.quantity,
    averagePrice: entry.averagePrice,
  }));
  const payload = {
    version: 1,
    exported_at: new Date().toISOString(),
    carteira: "Carteira",
    assets,
  };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${t("walletFilePrefix")}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  setWalletStatus(t("walletExported", { count: assets.length, assets: t(assets.length === 1 ? "assetOne" : "assetMany") }), "success");
}

async function importWalletFile(file) {
  try {
    const entries = walletAssetsFromFile(JSON.parse(await file.text()));
    if (entries.length === 0) {
      setWalletStatus(t("walletImportEmptyFile"), "error");
      return;
    }

    let added = 0;
    let updated = 0;
    for (const incoming of entries) {
      const existing = findWalletEntry(incoming.symbol);
      if (existing) {
        if (!existing.name && incoming.name) {
          existing.name = incoming.name;
        }
        if (incoming.quantity > 0) {
          existing.quantity = incoming.quantity;
          existing.averagePrice = incoming.averagePrice;
        }
        updated += 1;
      } else {
        wallet.push(incoming);
        added += 1;
      }
    }

    saveWallet();
    for (const entry of wallet) {
      updateWalletStars(entry.symbol);
    }
    renderWallet();
    setWalletStatus(t("walletImportSummary", { added, updated }), "success");
    void refreshWalletQuotes();
  } catch {
    setWalletStatus(t("walletImportInvalid"), "error");
  }
}

async function copyWalletLink() {
  if (wallet.length === 0) {
    setWalletStatus(t("walletLinkEmpty"), "error");
    return;
  }

  const url = new URL(window.location.href);
  url.hash = "";
  url.searchParams.set("carteira", wallet.map((entry) => entry.symbol).sort().join(","));

  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error("clipboard unavailable");
    }
    await navigator.clipboard.writeText(url.toString());
    setWalletStatus(t("walletLinkCopied"), "success");
  } catch {
    window.prompt(t("walletLinkPrompt"), url.toString());
    setWalletStatus(t("walletLinkFailed"), "error");
  }
}

function applySharedWallet() {
  const url = new URL(window.location.href);
  const raw = url.searchParams.get("carteira") || url.searchParams.get("wallet");
  if (!raw) {
    return;
  }

  const symbols = raw.split(",")
    .map(normalizeWalletSymbol)
    .filter(isValidWalletSymbol);
  url.searchParams.delete("carteira");
  url.searchParams.delete("wallet");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);

  if (symbols.length === 0) {
    return;
  }

  let added = 0;
  for (const symbol of symbols) {
    if (!isInWallet(symbol)) {
      wallet.push({
        symbol,
        name: "",
        quantity: 0,
        averagePrice: 0,
        lastPrice: 0,
        lastChange: 0,
        lastAsOf: "",
        addedAt: new Date().toISOString(),
      });
      added += 1;
    }
  }
  if (added > 0) {
    saveWallet();
  }
  for (const entry of wallet) {
    updateWalletStars(entry.symbol);
  }

  activeMode = "wallet";
  saveActiveMode(activeMode);
  applyModeState();
  renderActiveGroups();
  setWalletStatus(t("walletLinkImported", { count: symbols.length, assets: t(symbols.length === 1 ? "assetOne" : "assetMany") }), "success");
  void refreshWalletQuotes();
}

function openWalletChart(entry, trigger) {
  const quote = walletQuoteFor(entry, snapshotAssetMap());
  const chart = {
    key: `asset:${entry.symbol}`,
    label: entry.symbol,
    symbol: quote?.name || entry.name || entry.symbol,
    price: quote?.price ?? entry.lastPrice,
    change: quote?.change ?? entry.lastChange,
    timezone: "America/Sao_Paulo",
    history: Array.isArray(quote?.history) ? quote.history : [],
  };

  if (chart.history.length >= 2) {
    openChart(chart, trigger);
    return;
  }

  openChart({ ...chart, loading: true }, trigger);
  fetchAssetHistory(entry.symbol)
    .then((history) => {
      if (activeChartKey !== chart.key) {
        return;
      }
      chart.history = history;
      renderChart(chart);
    })
    .catch((error) => {
      if (activeChartKey === chart.key) {
        renderChart({ ...chart, historyError: error.message });
      }
    });
}

function hideWalletSuggestions() {
  if (!walletSuggestionsEl) {
    return;
  }
  walletSuggestionsEl.hidden = true;
  walletSuggestionsEl.replaceChildren();
  walletAddInputEl?.setAttribute("aria-expanded", "false");
  walletAddInputEl?.removeAttribute("aria-activedescendant");
  walletSearchIndex = -1;
}

function showWalletSuggestions() {
  if (!walletSuggestionsEl) {
    return;
  }
  walletSuggestionsEl.hidden = false;
  walletAddInputEl?.setAttribute("aria-expanded", "true");
}

function showWalletSearchMessage(message) {
  walletSearchItems = [];
  walletSearchIndex = -1;
  if (!walletSuggestionsEl) {
    return;
  }
  const empty = document.createElement("p");
  empty.className = "wallet-suggestion-empty";
  empty.textContent = message;
  walletSuggestionsEl.replaceChildren(empty);
  showWalletSuggestions();
}

function renderWalletSuggestions(items, query) {
  walletSearchItems = items;
  walletSearchIndex = -1;
  if (!walletSuggestionsEl) {
    return;
  }

  if (items.length === 0) {
    showWalletSearchMessage(t("searchEmpty", { query }));
    return;
  }

  walletSuggestionsEl.replaceChildren();
  items.forEach((item, index) => {
    const option = document.createElement("div");
    option.className = "search-result wallet-suggestion";
    option.id = `wallet-suggestion-${index}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    option.innerHTML = `
      ${walletStarMarkup(item.symbol, item.name, "search-result-star")}
      <span class="search-result-main">
        <span class="search-result-symbol">${escapeHTML(item.symbol)}</span>
        <span class="search-result-name" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</span>
        <span class="search-result-type">${escapeHTML(item.type)}</span>
      </span>
      <span class="search-result-side">
        <strong class="search-result-price">${escapeHTML(formatMoney(item.price))}</strong>
        <span class="search-result-change ${changeTone(item.change)}">${escapeHTML(formatPercent(item.change))}</span>
      </span>`;
    option.addEventListener("click", () => selectWalletSuggestion(item));
    const star = option.querySelector(".search-result-star");
    star?.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleWallet(item.symbol, item.name);
    });
    walletSuggestionsEl.appendChild(option);
  });

  showWalletSuggestions();
  walletAddInputEl?.removeAttribute("aria-activedescendant");
}

function setActiveWalletSuggestion(index) {
  const options = Array.from(walletSuggestionsEl?.querySelectorAll(".wallet-suggestion") || []);
  walletSearchIndex = index;
  options.forEach((option, position) => {
    const active = position === index;
    option.classList.toggle("active", active);
    option.setAttribute("aria-selected", String(active));
  });

  if (index >= 0 && options[index]) {
    walletAddInputEl.setAttribute("aria-activedescendant", options[index].id);
    options[index].scrollIntoView({ block: "nearest" });
  } else {
    walletAddInputEl.removeAttribute("aria-activedescendant");
  }
}

function scheduleWalletSearch(rawQuery) {
  const query = rawQuery.trim().replace(/\s+/g, " ");
  window.clearTimeout(walletSearchTimer);
  walletSearchController?.abort();

  if (query.length < 2) {
    walletSearchItems = [];
    hideWalletSuggestions();
    return;
  }

  walletSearchTimer = window.setTimeout(() => {
    void runWalletSearch(query);
  }, SEARCH_TIMEOUT_MS);
}

async function runWalletSearch(query) {
  const cacheKey = query.toLowerCase();
  const cached = walletSearchCache.get(cacheKey);
  if (cached) {
    if (query.toLowerCase() === walletAddInputEl.value.trim().toLowerCase()) {
      renderWalletSuggestions(cached, query);
    }
    return;
  }

  if (typeof AbortController === "function") {
    walletSearchController?.abort();
    walletSearchController = new AbortController();
  }
  showWalletSearchMessage(t("searchingAssets"));

  try {
    const params = new URLSearchParams({
      search: query,
      limit: String(SEARCH_LIMIT),
    });
    const response = await fetch(`${SEARCH_URL}?${params}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: walletSearchController?.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const assets = (Array.isArray(payload.stocks) ? payload.stocks : [])
      .filter((asset) => !String(asset.stock || "").toUpperCase().endsWith("F"))
      .slice(0, 8)
      .map((asset) => searchResultItem(asset));

    if (walletSearchCache.size > 40) {
      walletSearchCache.delete(walletSearchCache.keys().next().value);
    }
    walletSearchCache.set(cacheKey, assets);

    if (query.toLowerCase() !== walletAddInputEl.value.trim().toLowerCase()) {
      return;
    }
    renderWalletSuggestions(assets, query);
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }
    if (query.toLowerCase() === walletAddInputEl.value.trim().toLowerCase()) {
      showWalletSearchMessage(t("searchUnavailable", { error: error.message }));
    }
  }
}

function selectWalletSuggestion(item) {
  const symbol = normalizeWalletSymbol(item?.symbol);
  if (!isValidWalletSymbol(symbol)) {
    return;
  }

  walletAddInputEl.value = "";
  hideWalletSuggestions();

  if (isInWallet(symbol)) {
    setWalletStatus(t("walletStatusAlready", { symbol }), "error");
    openWalletEditor(symbol);
    return;
  }

  void addWalletSymbol(symbol, item?.name || "");
}

function bindWallet() {
  walletAddFormEl?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (walletSearchIndex >= 0 && walletSearchItems[walletSearchIndex]) {
      selectWalletSuggestion(walletSearchItems[walletSearchIndex]);
      return;
    }
    const value = walletAddInputEl.value;
    walletAddInputEl.value = "";
    hideWalletSuggestions();
    void addWalletSymbol(value);
  });

  walletAddInputEl?.addEventListener("input", () => {
    scheduleWalletSearch(walletAddInputEl.value);
  });

  walletAddInputEl?.addEventListener("focus", () => {
    if (walletAddInputEl.value.trim().length >= 2 && walletSearchItems.length > 0) {
      showWalletSuggestions();
    }
  });

  walletAddInputEl?.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      if (walletSearchItems.length === 0) {
        return;
      }
      event.preventDefault();
      setActiveWalletSuggestion((walletSearchIndex + 1) % walletSearchItems.length);
      return;
    }

    if (event.key === "ArrowUp") {
      if (walletSearchItems.length === 0) {
        return;
      }
      event.preventDefault();
      const previous = walletSearchIndex <= 0 ? walletSearchItems.length - 1 : walletSearchIndex - 1;
      setActiveWalletSuggestion(previous);
      return;
    }

    if (event.key === "Enter") {
      if (walletSearchIndex >= 0 && walletSearchItems[walletSearchIndex]) {
        event.preventDefault();
        selectWalletSuggestion(walletSearchItems[walletSearchIndex]);
      }
      return;
    }

    if (event.key === "Escape" && !walletSuggestionsEl?.hidden) {
      event.preventDefault();
      hideWalletSuggestions();
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (walletSuggestionsEl && !walletAddFormEl?.contains(event.target)) {
      hideWalletSuggestions();
    }
  });

  walletExportEl?.addEventListener("click", exportWallet);
  walletImportEl?.addEventListener("click", () => walletFileEl?.click());
  walletFileEl?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) {
      await importWalletFile(file);
    }
  });
  walletLinkEl?.addEventListener("click", () => {
    void copyWalletLink();
  });

  walletEditFormEl?.addEventListener("submit", saveWalletEditor);
  walletEditCloseEl?.addEventListener("click", closeWalletEditor);
  walletEditCancelEl?.addEventListener("click", closeWalletEditor);
  walletEditDialogEl?.addEventListener("click", (event) => {
    if (event.target === walletEditDialogEl) {
      closeWalletEditor();
    }
  });
  walletEditDialogEl?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeWalletEditor();
  });

  walletTableWrapEl?.addEventListener("click", (event) => {
    const edit = event.target.closest(".wallet-edit");
    if (edit) {
      event.stopPropagation();
      openWalletEditor(edit.dataset.symbol);
      return;
    }
    const remove = event.target.closest(".wallet-remove");
    if (remove) {
      event.stopPropagation();
      removeWalletEntry(remove.dataset.symbol);
      return;
    }
    const star = event.target.closest(".wallet-star");
    if (star) {
      event.stopPropagation();
      removeWalletEntry(star.dataset.symbol);
      return;
    }
    const row = event.target.closest(".wallet-row");
    if (row) {
      const entry = findWalletEntry(row.dataset.symbol);
      if (entry) {
        openWalletChart(entry, row);
      }
    }
  });
}

function renderActiveGroups() {
  const isWallet = activeMode === "wallet";
  if (walletEl) {
    walletEl.hidden = !isWallet;
    if (isWallet) {
      walletEl.classList.add("visible");
    }
  }
  highlightsEl.hidden = isWallet;
  groupsEl.hidden = isWallet;

  if (isWallet) {
    modeDescriptionEl.textContent = modeDescription("wallet");
    renderWallet();
    if (lastSnapshot) {
      void refreshWalletQuotes();
    }
    return;
  }

  hideWalletSuggestions();

  if (!lastSnapshot) {
    return;
  }

  const groups = activeGroups();

  groupsEl.replaceChildren();

  if (groups.length === 0) {
    const message = document.createElement("p");
    message.className = "empty";
    message.textContent = activeMode === "lows" ? t("groupEmptyLows") : t("groupEmpty");
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
  if (mode === "wallet") {
    const positions = wallet.filter((entry) => entry.quantity > 0).length;
    return t("modeDescWallet", {
      count: wallet.length,
      assets: t(wallet.length === 1 ? "assetOne" : "assetMany"),
      positions,
      positionsLabel: t(positions === 1 ? "positionOne" : "positionMany"),
    });
  }

  const config = MODES[mode] || MODES.highs;
  return t(lastSnapshot?.b3Closed ? config.descLast : config.descToday);
}

function setMode(mode) {
  if (!MODES[mode] || mode === activeMode) {
    return;
  }

  activeMode = mode;
  saveActiveMode(mode);
  applyModeState();
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

  throw new Error(t("snapshotUnavailable"));
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
    throw new Error(t("unexpectedBrapiResponse"));
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
    throw new Error(t("brapiUnavailable"));
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

  if (manual || forceLive) {
    walletQuotes.clear();
  }

  setLoading(true);
  statusEl.textContent = manual || forceLive ? t("statusFetching") : t("statusLoading");
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
        showToast(t("toastFallback"), "error");
      }
    }

    render(snapshot);

    if (manual) {
      showToast(
        live ? t("toastLive") : t("toastReloaded"),
        "success",
      );
    }
  } catch (error) {
    statusEl.textContent = t("statusLoadError", { error: error.message });
    statusEl.classList.add("error");
    showToast(t("toastUpdateFailed", { error: error.message }), "error");

    if (!lastSnapshot) {
      renderFatal(t("fatalLoad"));
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

langToggleEl?.addEventListener("click", () => {
  setLanguage(currentLang === "pt-BR" ? "en-US" : "pt-BR");
});

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
    activeChartData = null;

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

function initFeatureCarousel() {
  const carousel = document.querySelector("[data-feature-carousel]");
  if (!carousel) {
    return;
  }

  const viewport = carousel.querySelector("[data-carousel-viewport]");
  const track = carousel.querySelector("[data-carousel-track]");
  const prev = carousel.querySelector("[data-carousel-prev]");
  const next = carousel.querySelector("[data-carousel-next]");
  const cards = Array.from(track?.querySelectorAll("[data-feature-card]") || []);
  if (!viewport || !track || !prev || !next || cards.length === 0) {
    return;
  }

  let perView = 1;
  let pageCount = 1;
  let activePage = 0;
  let scrollFrame = 0;
  let resizeFrame = 0;

  const getPerView = () => {
    const raw = window.getComputedStyle(carousel).getPropertyValue("--feature-per-view").trim();
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  };

  const getPageOffset = (page) => {
    const target = cards[Math.min(cards.length - 1, Math.max(0, page * perView))];
    return target ? Math.max(0, target.offsetLeft - cards[0].offsetLeft) : 0;
  };

  const scrollToPage = (page, smooth = true) => {
    const targetPage = Math.min(Math.max(page, 0), pageCount - 1);
    const left = getPageOffset(targetPage);
    const behavior = smooth && !prefersReducedMotion ? "smooth" : "auto";
    if (typeof viewport.scrollTo === "function") {
      viewport.scrollTo({ left, behavior });
    } else {
      viewport.scrollLeft = left;
    }
  };

  const updateControls = () => {
    let nextPage = 0;
    let bestDistance = Infinity;
    for (let page = 0; page < pageCount; page += 1) {
      const distance = Math.abs(getPageOffset(page) - viewport.scrollLeft);
      if (distance < bestDistance) {
        bestDistance = distance;
        nextPage = page;
      }
    }

    activePage = nextPage;
    prev.disabled = activePage <= 0;
    next.disabled = activePage >= pageCount - 1;
  };

  const updateLayout = () => {
    pageCount = Math.max(1, Math.ceil(cards.length / perView));
    updateControls();
  };

  const refresh = () => {
    perView = getPerView();
    updateLayout();
    scrollToPage(Math.min(activePage, pageCount - 1), false);
    updateControls();
  };

  const scheduleRefresh = () => {
    window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(refresh);
  };

  prev.addEventListener("click", () => {
    scrollToPage(activePage - 1);
  });

  next.addEventListener("click", () => {
    scrollToPage(activePage + 1);
  });

  viewport.addEventListener("scroll", () => {
    window.cancelAnimationFrame(scrollFrame);
    scrollFrame = window.requestAnimationFrame(updateControls);
  }, { passive: true });

  if ("ResizeObserver" in window) {
    new ResizeObserver(scheduleRefresh).observe(viewport);
  } else {
    window.addEventListener("resize", scheduleRefresh);
  }

  refresh();
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

wallet = loadWallet();
activeMode = loadActiveMode();
applyStaticTranslations();
applyModeState();
bindWallet();
applySharedWallet();
renderActiveGroups();

initReveal();
initFeatureCarousel();
initMarketParticles();
initMarketBackdrop();
void load();
