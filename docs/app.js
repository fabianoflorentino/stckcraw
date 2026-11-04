const DATA_URL = "data/latest.json";
const SNAPSHOT_FALLBACK_URL = "https://stckcraw-dispatch.fabianoflorentino.workers.dev/snapshot";
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

  if (points.length < 2) {
    const empty = document.createElement("p");
    empty.className = "chart-empty";
    empty.textContent = index.error
      ? `Dados indisponíveis: ${index.error}`
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
  const summary = document.createElement("div");
  summary.className = "chart-summary";
  summary.append(
    chartStat("Último", formatPoints(index.price)),
    chartStat("Variação do dia", formatPercent(index.change), changeTone(index.change)),
    chartStat("No período", formatPercent(change), changeTone(change)),
    chartStat("Mín / Máx", `${formatPoints(Math.min(...points.map((point) => point.close)))} / ${formatPoints(Math.max(...points.map((point) => point.close)))}`),
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

function openChart(chart, trigger) {
  if (!chartDialogEl) {
    return;
  }

  activeChartKey = chart.key || chart.symbol || "";
  lastChartTrigger = trigger || null;
  renderChart(chart);

  if (typeof chartDialogEl.showModal === "function") {
    if (!chartDialogEl.open) {
      chartDialogEl.showModal();
    }
  } else {
    chartDialogEl.setAttribute("open", "");
  }
}

function closeChart() {
  if (!chartDialogEl?.open) {
    return;
  }

  if (typeof chartDialogEl.close === "function") {
    chartDialogEl.close();
  } else {
    chartDialogEl.removeAttribute("open");
  }
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

void load();
