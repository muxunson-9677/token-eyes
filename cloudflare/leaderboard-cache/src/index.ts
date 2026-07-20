interface Env {
  INSFORGE_PUBLIC_ORIGIN: string;
}

interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

interface HandlerDependencies {
  cache: CacheLike;
  originFetch: typeof fetch;
  waitUntil(promise: Promise<unknown>): void;
  bypassFreshCache?: boolean;
}

const PERIODS = new Set(["today", "week", "month", "total"]);
const METRICS = new Set(["tokens", "estimated_spend", "actual_cost"]);
const SOURCES = new Set([
  "all",
  "codex",
  "claude",
  "gemini",
  "cursor",
  "opencode",
  "openclaw",
  "hermes",
  "kiro",
  "copilot",
  "kimi",
  "every-code",
  "other",
]);
const AVATAR_RE = /^\/avatars\/([a-f0-9]{64})\.webp$/;

function pick(value: string | null, allowed: Set<string>, fallback: string) {
  const normalized = (value || "").trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function integer(value: string | null, fallback: number, maximum: number) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, maximum);
}

function canonicalLeaderboardUrl(requestUrl: URL) {
  const url = new URL("/leaderboard", requestUrl.origin);
  url.searchParams.set("period", pick(requestUrl.searchParams.get("period"), PERIODS, "today"));
  url.searchParams.set("metric", pick(requestUrl.searchParams.get("metric"), METRICS, "tokens"));
  url.searchParams.set("source", pick(requestUrl.searchParams.get("source"), SOURCES, "all"));
  url.searchParams.set("limit", String(Math.max(1, integer(requestUrl.searchParams.get("limit"), 20, 100))));
  url.searchParams.set("offset", String(integer(requestUrl.searchParams.get("offset"), 0, 100_000)));
  return url;
}

function withCacheHeaders(response: Response, value: string, cacheStatus: string) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", value);
  headers.set("X-Token-Eyes-Cache", cacheStatus);
  return new Response(response.body, { status: response.status, headers });
}

async function markStale(response: Response) {
  try {
    const body = await response.json() as Record<string, unknown>;
    return withCacheHeaders(
      new Response(JSON.stringify({ ...body, stale: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
      "public, max-age=60, s-maxage=60",
      "STALE",
    );
  } catch {
    return new Response(JSON.stringify({ error: "Cached response is invalid" }), {
      status: 502,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
}

export function createHandler(dependencies: HandlerDependencies) {
  return async function handle(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }
    const requestUrl = new URL(request.url);
    const avatarMatch = requestUrl.pathname.match(AVATAR_RE);

    if (avatarMatch) {
      const cacheKey = new Request(new URL(requestUrl.pathname, requestUrl.origin));
      if (!dependencies.bypassFreshCache) {
        const hit = await dependencies.cache.match(cacheKey);
        if (hit) return withCacheHeaders(hit, "public, max-age=31536000, immutable", "HIT");
      }
      const originUrl = new URL("/functions/tokentracker-avatar-public", env.INSFORGE_PUBLIC_ORIGIN);
      originUrl.searchParams.set("hash", avatarMatch[1]);
      const origin = await dependencies.originFetch(new Request(originUrl, {
        method: "GET",
        headers: { Accept: "image/webp" },
      }));
      if (!origin.ok) return new Response("Avatar unavailable", { status: origin.status });
      const response = withCacheHeaders(origin, "public, max-age=31536000, immutable", "MISS");
      dependencies.waitUntil(dependencies.cache.put(cacheKey, response.clone()));
      return response;
    }

    if (requestUrl.pathname !== "/leaderboard") {
      return new Response("Not found", { status: 404 });
    }

    const canonicalUrl = canonicalLeaderboardUrl(requestUrl);
    const cacheKey = new Request(canonicalUrl);
    const staleUrl = new URL(canonicalUrl);
    staleUrl.pathname = "/.stale/leaderboard";
    const staleKey = new Request(staleUrl);
    if (!dependencies.bypassFreshCache) {
      const hit = await dependencies.cache.match(cacheKey);
      if (hit) {
        return withCacheHeaders(hit, "public, max-age=60, s-maxage=900, stale-if-error=86400", "HIT");
      }
    }

    const originUrl = new URL("/functions/tokentracker-leaderboard", env.INSFORGE_PUBLIC_ORIGIN);
    originUrl.search = canonicalUrl.search;
    try {
      const origin = await dependencies.originFetch(new Request(originUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      }));
      if (!origin.ok) throw new Error(`origin HTTP ${origin.status}`);
      const response = withCacheHeaders(
        origin,
        "public, max-age=60, s-maxage=900, stale-if-error=86400",
        "MISS",
      );
      dependencies.waitUntil(Promise.all([
        dependencies.cache.put(cacheKey, response.clone()),
        dependencies.cache.put(
          staleKey,
          withCacheHeaders(response.clone(), "public, max-age=86400", "STALE-SEED"),
        ),
      ]));
      return response;
    } catch {
      const stale = await dependencies.cache.match(staleKey);
      if (stale) return markStale(stale);
      return new Response(JSON.stringify({ error: "Leaderboard temporarily unavailable", stale: true }), {
        status: 503,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }
  };
}

export default {
  fetch(request: Request, env: Env, context: { waitUntil(promise: Promise<unknown>): void }) {
    const cache = caches.default as unknown as CacheLike;
    return createHandler({
      cache,
      originFetch: fetch,
      waitUntil: (promise) => context.waitUntil(promise),
    })(request, env);
  },
};
