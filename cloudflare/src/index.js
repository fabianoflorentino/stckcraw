const GITHUB_API = "https://api.github.com";

export default {
  async scheduled(controller, env, _ctx) {
    console.log(`cron ${controller.cron}`);
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
    if (!env.TRIGGER_SECRET || authorization !== `Bearer ${env.TRIGGER_SECRET}`) {
      return new Response("unauthorized", { status: 401 });
    }

    try {
      await dispatch(env);
      return Response.json({ ok: true });
    } catch (error) {
      console.error(error);
      return Response.json({ ok: false, error: error.message }, { status: 502 });
    }
  },
};

async function dispatch(env) {
  const { GITHUB_OWNER, GITHUB_REPO, GITHUB_WORKFLOW, GITHUB_REF, GITHUB_TOKEN } = env;

  if (!GITHUB_OWNER || !GITHUB_REPO || !GITHUB_WORKFLOW || !GITHUB_TOKEN) {
    throw new Error("missing GITHUB_OWNER, GITHUB_REPO, GITHUB_WORKFLOW or GITHUB_TOKEN");
  }

  const url = `${GITHUB_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW}/dispatches`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "stckcraw-cloudflare-dispatch",
    },
    body: JSON.stringify({ ref: GITHUB_REF || "main" }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub dispatch failed: ${response.status} ${body}`);
  }

  console.log(`dispatched ${GITHUB_WORKFLOW} on ${GITHUB_REF || "main"}`);
}
