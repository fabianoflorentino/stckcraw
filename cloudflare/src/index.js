const GITHUB_API = "https://api.github.com";
const SNAPSHOT_URL = "https://fabianoflorentino.github.io/stckcraw/data/latest.json";

export default {
  async scheduled(controller, env, _ctx) {
    console.log(JSON.stringify({ event: "cron", cron: controller.cron }));
    await dispatch(env);
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok", { headers: { "content-type": "text/plain" } });
    }

    if (url.pathname === "/snapshot") {
      return snapshot();
    }

    if (url.pathname === "/history") {
      return history(url);
    }

    if (url.pathname === "/quote") {
      return quote(url);
    }

    if (url.pathname !== "/trigger" || request.method !== "POST") {
      return new Response("not found", { status: 404 });
    }

    const authorization = request.headers.get("Authorization") || "";
    const expected = `Bearer ${env.TRIGGER_SECRET || ""}`;

    if (!env.TRIGGER_SECRET || !(await secureEqual(authorization, expected))) {
      return new Response("unauthorized", { status: 401 });
    }

    try {
      await dispatch(env);
      return Response.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ event: "trigger_error", error: message }));
      return Response.json({ ok: false, error: message }, { status: 502 });
    }
  },
};

async function snapshot() {
  try {
    const response = await fetch(`${SNAPSHOT_URL}?t=${Date.now()}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "stckcraw-cloudflare-snapshot",
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub Pages snapshot failed: ${response.status}`);
    }

    return new Response(await response.text(), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
        "cache-control": "public, max-age=30, stale-while-revalidate=60",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ event: "snapshot_error", error: message }));
    return Response.json(
      { error: "snapshot unavailable" },
      { status: 502, headers: { "access-control-allow-origin": "*" } },
    );
  }
}

async function history(url) {
  const symbol = (url.searchParams.get("symbol") || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(symbol)) {
    return jsonError("invalid symbol", 400);
  }

  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(`https://stckcraw-history/${symbol}`, { method: "GET" });
  if (cache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) {
        return cached;
      }
    } catch {
      // Local runtimes may not implement the Cache API.
    }
  }

  const target = new URL("https://query1.finance.yahoo.com/v7/finance/spark");
  target.searchParams.set("symbols", `${symbol}.SA`);
  target.searchParams.set("range", "1mo");
  target.searchParams.set("interval", "1d");

  let response;
  try {
    response = await fetch(target, {
      headers: {
        Accept: "application/json",
        "User-Agent": "stckcraw-cloudflare-history",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(`history request failed: ${message}`, 502);
  }

  if (!response.ok) {
    return jsonError(`history status ${response.status}`, 502);
  }

  const payload = await response.json().catch(() => null);
  const result = payload?.spark?.result?.[0];
  const series = result?.response?.[0];
  const timestamps = Array.isArray(series?.timestamp) ? series.timestamp : [];
  const closes = Array.isArray(series?.indicators?.quote?.[0]?.close)
    ? series.indicators.quote[0].close
    : [];
  const points = historyPoints(timestamps, closes);

  if (points.length === 0) {
    return jsonError("history unavailable", 404);
  }

  const output = new Response(JSON.stringify({ symbol, points }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=300, stale-while-revalidate=600",
    },
  });

  if (cache) {
    try {
      await cache.put(cacheKey, output.clone());
    } catch {
      // Local runtimes may not implement the Cache API.
    }
  }
  return output;
}

async function quote(url) {
  const symbol = (url.searchParams.get("symbol") || "")
    .trim()
    .toUpperCase()
    .replace(/\.SA$/, "");
  if (!/^[A-Z0-9]{4,12}$/.test(symbol)) {
    return jsonError("invalid symbol", 400);
  }

  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(`https://stckcraw-quote/${symbol}`, { method: "GET" });
  if (cache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) {
        return cached;
      }
    } catch {
      // Local runtimes may not implement the Cache API.
    }
  }

  const target = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(`${symbol}.SA`)}`);
  target.searchParams.set("range", "1mo");
  target.searchParams.set("interval", "1d");

  let response;
  try {
    response = await fetch(target, {
      headers: {
        Accept: "application/json",
        "User-Agent": "stckcraw-cloudflare-quote",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(`quote request failed: ${message}`, 502);
  }

  if (!response.ok) {
    return jsonError(`quote status ${response.status}`, response.status === 404 ? 404 : 502);
  }

  const payload = await response.json().catch(() => null);
  const result = payload?.chart?.result?.[0];
  const meta = result?.meta;
  const price = Number(meta?.regularMarketPrice);
  if (!result || !Number.isFinite(price) || price <= 0) {
    return jsonError("quote unavailable", 404);
  }

  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const closes = Array.isArray(result.indicators?.quote?.[0]?.close)
    ? result.indicators.quote[0].close
    : [];
  const points = historyPoints(timestamps, closes);
  let change = Number(meta.regularMarketChangePercent);
  if (!Number.isFinite(change) && points.length >= 2) {
    const previous = points[points.length - 2].close;
    change = previous > 0 ? (points[points.length - 1].close / previous - 1) * 100 : 0;
  }
  if (!Number.isFinite(change)) {
    change = 0;
  }

  const marketTime = Number(meta.regularMarketTime);
  const asOf = Number.isFinite(marketTime) && marketTime > 0
    ? new Date(marketTime * 1000).toISOString()
    : "";

  const output = new Response(JSON.stringify({
    symbol,
    name: meta.longName || meta.shortName || symbol,
    price,
    change,
    currency: meta.currency || "BRL",
    asOf,
    points,
  }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=300, stale-while-revalidate=600",
    },
  });

  if (cache) {
    try {
      await cache.put(cacheKey, output.clone());
    } catch {
      // Local runtimes may not implement the Cache API.
    }
  }
  return output;
}

function historyPoints(timestamps, closes) {
  const points = [];
  const count = Math.min(timestamps.length, closes.length);
  for (let i = 0; i < count; i += 1) {
    const close = closes[i];
    const timestamp = timestamps[i];
    if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) {
      continue;
    }
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      continue;
    }
    points.push({
      date: new Date(timestamp * 1000).toISOString(),
      close,
    });
  }
  return points;
}

function jsonError(message, status) {
  return Response.json(
    { error: message },
    { status, headers: { "access-control-allow-origin": "*" } },
  );
}

async function dispatch(env) {
  const { GITHUB_OWNER, GITHUB_REPO, GITHUB_WORKFLOW, GITHUB_REF, GITHUB_TOKEN } = env;

  if (!GITHUB_OWNER || !GITHUB_REPO || !GITHUB_WORKFLOW || !GITHUB_TOKEN) {
    throw new Error("missing GITHUB_OWNER, GITHUB_REPO, GITHUB_WORKFLOW or GITHUB_TOKEN");
  }

  const ref = GITHUB_REF || "main";
  const url = `${GITHUB_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW}/dispatches`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "stckcraw-cloudflare-dispatch",
    },
    body: JSON.stringify({ ref }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(JSON.stringify({
      event: "dispatch_error",
      status: response.status,
      body: body.slice(0, 500),
    }));
    throw new Error(`GitHub dispatch failed: ${response.status}`);
  }

  console.log(JSON.stringify({ event: "dispatch", workflow: GITHUB_WORKFLOW, ref }));
}

async function secureEqual(provided, expected) {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);

  if (typeof crypto.subtle.timingSafeEqual === "function") {
    return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
  }

  // Fallback for local runtimes without the Workers extension.
  const left = new Uint8Array(providedHash);
  const right = new Uint8Array(expectedHash);
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}
