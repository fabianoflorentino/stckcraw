const GITHUB_API = "https://api.github.com";

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
