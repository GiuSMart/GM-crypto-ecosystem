import assert from "node:assert/strict";
import test from "node:test";
import { SkillsApiError, SkillsClient } from "../src/lib/skills/client";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** Records every call so a test can assert on the exact request that was made. */
function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { calls, impl };
}

const pageBody = {
  data: [
    {
      id: "vercel-labs/agent-skills/web-design-guidelines",
      slug: "web-design-guidelines",
      name: "web-design-guidelines",
      source: "vercel-labs/agent-skills",
      installs: 4210,
      sourceType: "github",
      installUrl: "https://github.com/vercel-labs/agent-skills",
      url: "https://skills.sh/vercel-labs/agent-skills/web-design-guidelines",
    },
    { id: "broken-row" },
  ],
  pagination: { page: 2, perPage: 50, total: 300, hasMore: true },
};

test("listSkills requests the documented pagination and normalises the page", async () => {
  const { calls, impl } = fakeFetch(() => json(pageBody));
  const client = new SkillsClient({ fetchImpl: impl, token: () => "oidc-token" });

  const page = await client.listSkills({ view: "trending", page: 2, perPage: 50 });

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, "https://skills.sh/api/v1/skills");
  assert.equal(url.searchParams.get("view"), "trending");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("per_page"), "50");
  assert.equal(page.data.length, 1, "la riga senza id viene scartata");
  assert.equal(page.pagination.hasMore, true);
  assert.equal(page.pagination.total, 300);
});

test("catalogue calls without a token fail fast and never hit the network", async () => {
  const { calls, impl } = fakeFetch(() => json(pageBody));
  const client = new SkillsClient({ fetchImpl: impl });

  await assert.rejects(client.listSkills(), (err: unknown) => {
    assert.ok(err instanceof SkillsApiError);
    assert.equal(err.status, 401);
    assert.equal(err.code, "authentication_required");
    assert.match(err.message, /OIDC/);
    return true;
  });
  assert.equal(calls.length, 0);
});

test("the token is read per request and sent as a bearer credential", async () => {
  let issued = 0;
  const { calls, impl } = fakeFetch(() => json(pageBody));
  const client = new SkillsClient({ fetchImpl: impl, token: () => `token-${++issued}` });

  await client.listSkills();
  await client.listSkills();

  assert.equal(issued, 2);
  assert.equal(new Headers(calls[0].init?.headers).get("authorization"), "Bearer token-1");
  assert.equal(new Headers(calls[1].init?.headers).get("authorization"), "Bearer token-2");
});

test("an API 401 surfaces the API code and message without echoing the token", async () => {
  const { impl } = fakeFetch(() =>
    json({ error: "authentication_required", message: "Pass a Vercel OIDC token" }, 401),
  );
  const client = new SkillsClient({ fetchImpl: impl, token: () => "super-secret-token" });

  await assert.rejects(client.listSkills(), (err: unknown) => {
    assert.ok(err instanceof SkillsApiError);
    assert.equal(err.code, "authentication_required");
    assert.equal(err.retryAfterSec, null);
    assert.equal(err.message.includes("super-secret-token"), false);
    return true;
  });
});

test("409-style rate limiting exposes Retry-After in seconds", async () => {
  const { impl } = fakeFetch(() =>
    json({ error: "rate_limited", message: "Slow down" }, 429, { "retry-after": "17" }),
  );
  const client = new SkillsClient({ fetchImpl: impl, token: () => "t" });

  await assert.rejects(client.listSkills(), (err: unknown) => {
    assert.ok(err instanceof SkillsApiError);
    assert.equal(err.status, 429);
    assert.equal(err.retryAfterSec, 17);
    assert.equal(err.retryable, true);
    return true;
  });
});

test("503 is retried with backoff and then surfaces as unavailable", async () => {
  const sleeps: number[] = [];
  let attempts = 0;
  const { calls, impl } = fakeFetch(() => {
    attempts += 1;
    return json({ error: "unavailable", message: "try later" }, 503);
  });
  const client = new SkillsClient({
    fetchImpl: impl,
    token: () => "t",
    retries: 2,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });

  await assert.rejects(client.listSkills(), (err: unknown) => {
    assert.ok(err instanceof SkillsApiError);
    assert.equal(err.status, 503);
    assert.equal(err.retryable, true);
    return true;
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [250, 500]);
  assert.equal(attempts, 3);
});

test("a transient 503 succeeds on the retry", async () => {
  let attempts = 0;
  const { calls, impl } = fakeFetch(() => {
    attempts += 1;
    if (attempts === 1) return json({ error: "unavailable" }, 503);
    return json(pageBody);
  });
  const client = new SkillsClient({ fetchImpl: impl, token: () => "t", sleep: async () => {} });

  const page = await client.listSkills();
  assert.equal(calls.length, 2);
  assert.equal(page.data.length, 1);
});

test("search validates the query, the limit and the owner before calling the API", async () => {
  const { calls, impl } = fakeFetch(() => json({ data: [], query: "x", searchType: "fuzzy", count: 0 }));
  const client = new SkillsClient({ fetchImpl: impl, token: () => "t" });

  await assert.rejects(client.searchSkills("a"), /almeno 2 caratteri/);
  await assert.rejects(client.searchSkills("next", { limit: 500 }), /tra 1 e 200/);
  await assert.rejects(client.searchSkills("next", { owner: "bad owner!" }), /owner non valido/);
  await assert.rejects(client.listSkills({ perPage: 1000 }), /tra 1 e 500/);
  await assert.rejects(client.listSkills({ source: "owner", view: "trending" }), /source/);
  assert.equal(calls.length, 0);
});

test("the audit endpoint stays public and the verdict is conservative", async () => {
  const { calls, impl } = fakeFetch(() =>
    json({
      id: "vercel-labs/agent-skills/web-design-guidelines",
      source: "vercel-labs/agent-skills",
      slug: "web-design-guidelines",
      audits: [
        { provider: "Gen Agent Trust Hub", status: "pass", riskLevel: "SAFE", summary: "safe", auditedAt: "2026-09-15T09:11:58.047Z" },
        { provider: "Socket", status: "warn", summary: "1 alert: gptAnomaly", auditedAt: "2026-03-18T16:51:36.290Z" },
        { provider: "Snyk", status: "pass", riskLevel: "LOW", auditedAt: "2026-09-15T09:11:42.193108+00:00" },
      ],
    }),
  );
  const client = new SkillsClient({ fetchImpl: impl });

  const result = await client.getAudits("vercel-labs/agent-skills", "web-design-guidelines");

  assert.equal(calls.length, 1);
  assert.equal(new Headers(calls[0].init?.headers).get("authorization"), null);
  assert.equal(result.audits.length, 3);
  assert.equal(result.audits[1].riskLevel, "UNKNOWN", "rischio assente resta sconosciuto");
  assert.equal(result.verdict.decision, "manual_review");
  assert.equal(result.verdict.conservative?.provider, "Socket");
});

test("a 404 for a skill without audits is reported as not_found", async () => {
  const { impl } = fakeFetch(() => json({ error: "not_found", message: "Skill not found" }, 404));
  const client = new SkillsClient({ fetchImpl: impl });

  await assert.rejects(client.getAudits("owner/repo", "missing"), (err: unknown) => {
    assert.ok(err instanceof SkillsApiError);
    assert.equal(err.status, 404);
    assert.equal(err.code, "not_found");
    assert.equal(err.retryable, false);
    return true;
  });
  await assert.rejects(client.getAudits("owner/repo", "../etc"), /slug non valido/);
});
