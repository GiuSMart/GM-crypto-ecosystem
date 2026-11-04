import { decideFromAudits, normalizeAudit } from "./audit";
import type { AuditProviderResult, AuditVerdict, SkillSummary, SkillsPage } from "./types";

export const SKILLS_API_BASE = "https://skills.sh/api/v1";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type SkillsClientConfig = {
  baseUrl?: string;
  /** Read per request, never cached at module scope. */
  token?: () => string | undefined | Promise<string | undefined>;
  fetchImpl?: FetchLike;
  /** Extra attempts for 503 only. Default 1 (two tries in total). */
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
};

export class SkillsApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSec: number | null;

  constructor(message: string, status: number, code: string, retryAfterSec: number | null = null) {
    super(message);
    this.name = "SkillsApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }

  get retryable(): boolean {
    return this.status === 429 || this.status === 503;
  }
}

const SOURCE_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SLUG_RE = /^[A-Za-z0-9_.-]+$/;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Read-only client for the skills.sh catalogue.
 *
 * Verified 2026-11-04: the catalogue, search and curated endpoints answer 401
 * `authentication_required` without a Vercel OIDC token, while the audit endpoint
 * is public. The client therefore never assumes catalogue access: it surfaces the
 * API's own error instead of failing silently.
 *
 * It never installs, downloads or executes a Skill.
 */
export class SkillsClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly retries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly config: SkillsClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? SKILLS_API_BASE).replace(/\/+$/, "");
    this.fetchImpl = config.fetchImpl ?? ((url, init) => fetch(url, init));
    this.retries = Math.max(0, Math.min(3, config.retries ?? 1));
    this.sleep = config.sleep ?? defaultSleep;
  }

  async listSkills(opts: { view?: "all-time" | "trending" | "hot"; page?: number; perPage?: number; source?: string } = {}): Promise<SkillsPage> {
    const page = opts.page ?? 0;
    if (!Number.isInteger(page) || page < 0) throw new SkillsApiError("page deve essere un intero >= 0", 400, "invalid_request");
    const perPage = opts.perPage ?? 100;
    if (!Number.isInteger(perPage) || perPage < 1 || perPage > 500) {
      throw new SkillsApiError("perPage deve essere tra 1 e 500", 400, "invalid_request");
    }
    if (opts.source !== undefined && !SOURCE_RE.test(opts.source)) {
      throw new SkillsApiError(`source non valido: ${JSON.stringify(opts.source)}`, 400, "invalid_request");
    }
    if (opts.source !== undefined && opts.view !== undefined && opts.view !== "all-time") {
      throw new SkillsApiError("source è disponibile solo con la vista all-time", 400, "invalid_request");
    }

    const json = await this.request("/skills", {
      view: opts.view,
      page,
      per_page: perPage,
      source: opts.source,
    }, true);

    const raw = Array.isArray(json.data) ? json.data : null;
    if (!raw) throw new SkillsApiError("risposta inattesa: campo data assente", 502, "unexpected_shape");
    const pagination = asObject(json.pagination);
    if (!pagination) throw new SkillsApiError("risposta inattesa: pagination assente", 502, "unexpected_shape");

    return {
      data: raw.map(toSummary).filter((s): s is SkillSummary => s !== null),
      pagination: {
        page: asNumber(pagination.page, page),
        perPage: asNumber(pagination.perPage, perPage),
        total: asNumber(pagination.total, 0),
        hasMore: pagination.hasMore === true,
      },
    };
  }

  async searchSkills(query: string, opts: { owner?: string; limit?: number } = {}): Promise<SkillSummary[]> {
    const q = query.trim();
    if (q.length < 2) throw new SkillsApiError("q richiede almeno 2 caratteri", 400, "invalid_request");
    const limit = opts.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new SkillsApiError("limit deve essere tra 1 e 200", 400, "invalid_request");
    }
    if (opts.owner !== undefined && !/^[A-Za-z0-9_.-]+$/.test(opts.owner)) {
      throw new SkillsApiError(`owner non valido: ${JSON.stringify(opts.owner)}`, 400, "invalid_request");
    }

    const json = await this.request("/skills/search", { q, limit, owner: opts.owner }, true);
    const raw = Array.isArray(json.data) ? json.data : null;
    if (!raw) throw new SkillsApiError("risposta inattesa: campo data assente", 502, "unexpected_shape");
    return raw.map(toSummary).filter((s): s is SkillSummary => s !== null);
  }

  /**
   * Public audit results plus the conservative verdict of the governance matrix.
   * Works without a token; a 404 means the provider has no audit for this skill.
   */
  async getAudits(source: string, slug: string): Promise<{ audits: AuditProviderResult[]; verdict: AuditVerdict }> {
    if (!SOURCE_RE.test(source)) throw new SkillsApiError(`source non valido: ${JSON.stringify(source)}`, 400, "invalid_request");
    if (!SLUG_RE.test(slug)) throw new SkillsApiError(`slug non valido: ${JSON.stringify(slug)}`, 400, "invalid_request");

    const json = await this.request(`/skills/audit/${encodeURIComponent(source)}/${encodeURIComponent(slug)}`, {}, false);
    const raw = Array.isArray(json.audits) ? json.audits : null;
    if (!raw) throw new SkillsApiError("risposta inattesa: campo audits assente", 502, "unexpected_shape");

    const audits = raw.map((entry) => normalizeAudit(asObject(entry) ?? {}));
    return { audits, verdict: decideFromAudits(audits) };
  }

  private headers(token: string | undefined): Record<string, string> {
    const headers: Record<string, string> = { accept: "application/json" };
    // The token is a bearer credential: it is never logged, cached or echoed.
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  }

  private async request(
    path: string,
    query: Record<string, string | number | undefined>,
    requiresAuth: boolean,
  ): Promise<Record<string, unknown>> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") params.set(key, String(value));
    }
    const url = `${this.baseUrl}${path}${params.size > 0 ? `?${params.toString()}` : ""}`;

    // Resolve the token once per request: a rotating provider must not be called
    // twice for the same call, and a retry must reuse the already-verified token.
    const token = await this.config.token?.();
    if (requiresAuth && !token) {
      // Fail fast with an actionable error instead of spending a request that can only 401.
      throw new SkillsApiError(
        "Il catalogo skills.sh richiede un token OIDC Vercel: imposta la funzione token() con un token per richiesta. L'endpoint audit resta pubblico.",
        401,
        "authentication_required",
      );
    }

    let lastError: SkillsApiError | null = null;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const res = await this.fetchImpl(url, { headers: this.headers(token), redirect: "error" });
      if (res.status === 503 && attempt < this.retries) {
        lastError = new SkillsApiError("skills.sh non disponibile (503)", 503, "unavailable");
        await this.sleep(250 * 2 ** attempt);
        continue;
      }
      const json = await safeJson(res);
      if (res.ok) return json ?? {};

      const code = typeof json?.error === "string" ? json.error : `http_${res.status}`;
      const message = typeof json?.message === "string" ? json.message : `skills.sh ha risposto ${res.status}`;
      throw new SkillsApiError(message, res.status, code, retryAfterSeconds(res));
    }
    throw lastError ?? new SkillsApiError("skills.sh non disponibile", 503, "unavailable");
  }
}

export function createSkillsClient(config: SkillsClientConfig = {}): SkillsClient {
  return new SkillsClient(config);
}

function toSummary(value: unknown): SkillSummary | null {
  const row = asObject(value);
  if (!row) return null;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const slug = typeof row.slug === "string" ? row.slug.trim() : "";
  const source = typeof row.source === "string" ? row.source.trim() : "";
  if (!id || !slug || !source) return null;
  return {
    id,
    slug,
    name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : slug,
    source,
    installs: asNumber(row.installs, 0),
    sourceType: typeof row.sourceType === "string" ? row.sourceType : "unknown",
    installUrl: typeof row.installUrl === "string" ? row.installUrl : "",
    url: typeof row.url === "string" ? row.url : "",
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await res.json();
    return asObject(parsed);
  } catch {
    return null;
  }
}

/** `Retry-After` is either delta-seconds or an HTTP date. */
function retryAfterSeconds(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number.parseInt(header, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}
