const DATA_URL = "data/latest.json";
const REFRESH_MS = 5 * 60 * 1000;

const groupsEl = document.getElementById("groups");
const statusEl = document.getElementById("status");
const refreshEl = document.getElementById("refresh");

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

function changeClass(value) {
  if (!Number.isFinite(value) || value === 0) {
    return "neutral";
  }
  return value > 0 ? "positive" : "negative";
}

function buildTable(items) {
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
    const row = document.createElement("tr");
    const sector = item.sector ? escapeHTML(item.sector) : "—";
    row.innerHTML = `
      <td>${escapeHTML(item.rank)}</td>
      <td>
        <span class="symbol">${escapeHTML(item.symbol)}</span>
        <span class="asset-name" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</span>
      </td>
      <td>${formatMoney(item.price)}</td>
      <td class="${changeClass(item.change)}">${formatPercent(item.change)}</td>
      <td>${formatCompact(item.financialVolume)}</td>
      <td>${formatCompact(item.marketCap)}</td>
      <td>${sector}</td>`;
    tbody.appendChild(row);
  }
  table.appendChild(tbody);

  return table;
}

function renderGroup(group) {
  const section = document.createElement("section");
  section.className = "group";

  const title = document.createElement("h2");
  title.textContent = group.label || group.key;
  section.appendChild(title);

  if (group.error) {
    const message = document.createElement("p");
    message.className = "error";
    message.textContent = group.error;
    section.appendChild(message);
    return section;
  }

  if (!Array.isArray(group.items) || group.items.length === 0) {
    const message = document.createElement("p");
    message.className = "empty";
    message.textContent = "Sem dados para este filtro.";
    section.appendChild(message);
    return section;
  }

  section.appendChild(buildTable(group.items));
  return section;
}

function render(snapshot) {
  groupsEl.replaceChildren();

  for (const group of snapshot.groups || []) {
    groupsEl.appendChild(renderGroup(group));
  }

  const updated = document.createElement("span");
  updated.textContent = `Atualizado em ${formatDate(snapshot.generatedAt)}`;
  statusEl.replaceChildren(updated);
  statusEl.classList.remove("error");
}

async function load() {
  refreshEl.disabled = true;
  statusEl.textContent = "Carregando…";
  statusEl.classList.remove("error");

  try {
    const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    render(await response.json());
  } catch (error) {
    statusEl.textContent = `Falha ao carregar: ${error.message}`;
    statusEl.classList.add("error");
  } finally {
    refreshEl.disabled = false;
  }
}

refreshEl.addEventListener("click", load);

load();
setInterval(load, REFRESH_MS);
