const DATA_URL = "data/latest.json";
const REFRESH_MS = 5 * 60 * 1000;
const groupsEl = document.getElementById("groups");
const highlightsEl = document.getElementById("highlights");
const statusEl = document.getElementById("status");
const refreshEl = document.getElementById("refresh");
const toastEl = document.getElementById("toast");
const backToTopEl = document.getElementById("back-to-top");
const modeButtons = Array.from(document.querySelectorAll(".mode-button"));
const modeDescriptionEl = document.getElementById("mode-description");

const MODES = {
  highs: {
    description: "Top 10 maiores altas do dia",
    topLabel: "Maior alta",
    coverage: "altas",
  },
  lows: {
    description: "Top 10 maiores baixas do dia",
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

const percent = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});

let loading = false;
let lastSnapshot = null;
let toastTimer = null;
let activeMode = "highs";

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
  statusEl.textContent = `Atualizado ${formatDate(generated)}${relative ? ` · ${relative}` : ""}`;
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
      `${groups.length} grupos · top 10 ${config.coverage} do dia`,
      "neutral",
    ),
  );
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

    const row = document.createElement("tr");
    row.innerHTML = `
      <td><span class="rank${rankClass}">${escapeHTML(item.rank)}</span></td>
      <td>
        <span class="symbol">${escapeHTML(item.symbol)}</span>
        <span class="asset-name" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</span>
      </td>
      <td>${formatMoney(item.price)}</td>
      <td class="change-cell">
        <span class="change ${tone}">${formatPercent(item.change)}</span>
        <span class="bar" aria-hidden="true"><span class="bar-fill ${tone}" style="width:${barWidth.toFixed(1)}%"></span></span>
      </td>
      <td>${formatCompact(item.financialVolume)}</td>
      <td>${formatCompact(item.marketCap)}</td>
      <td class="sector" title="${escapeHTML(sector)}">${escapeHTML(sector)}</td>`;
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

  const head = document.createElement("div");
  head.className = "group-head";
  head.innerHTML = `
    <h2>${escapeHTML(label)}</h2>
    <span class="group-count">${items.length} ativos</span>
    <span class="scroll-hint">deslize a tabela →</span>`;

  if (leader) {
    const leaderEl = document.createElement("span");
    leaderEl.className = "group-leader";
    leaderEl.innerHTML = `#1 <strong>${escapeHTML(leader.symbol)}</strong> ${formatPercent(leader.change)}`;
    head.appendChild(leaderEl);
  }

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "group-toggle";
  toggle.setAttribute("aria-controls", bodyId);
  toggle.setAttribute("aria-expanded", String(!collapsed));
  toggle.setAttribute("aria-label", `${collapsed ? "Expandir" : "Recolher"} ${label}`);
  toggle.title = toggle.getAttribute("aria-label");
  toggle.innerHTML = '<span class="chevron" aria-hidden="true"></span>';
  head.appendChild(toggle);

  const body = document.createElement("div");
  body.className = "group-body";
  body.id = bodyId;
  body.setAttribute("aria-hidden", String(collapsed));

  const inner = document.createElement("div");
  inner.className = "group-body-inner";
  body.appendChild(inner);

  toggle.addEventListener("click", () => {
    const isCollapsed = section.classList.toggle("collapsed");
    toggle.setAttribute("aria-expanded", String(!isCollapsed));
    toggle.setAttribute("aria-label", `${isCollapsed ? "Expandir" : "Recolher"} ${label}`);
    toggle.title = toggle.getAttribute("aria-label");
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
  modeDescriptionEl.textContent = MODES[mode].description;
  renderActiveGroups();
}

function render(snapshot) {
  lastSnapshot = snapshot;
  renderActiveGroups();
  updateStatus(snapshot);
}

async function load({ manual = false } = {}) {
  if (loading) {
    return;
  }

  setLoading(true);
  statusEl.textContent = manual ? "Buscando atualização…" : "Carregando…";
  statusEl.classList.remove("error");

  try {
    const response = await fetch(`${DATA_URL}?t=${Date.now()}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    render(await response.json());

    if (manual) {
      showToast("Dados recarregados com sucesso.", "success");
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
  void load({ manual: true });
});

for (const button of modeButtons) {
  button.addEventListener("click", () => {
    setMode(button.dataset.mode);
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
