/**
 * InsForge Edge: public leaderboard list.
 *
 * IMPORTANT — why no Authorization header is read here:
 * InsForge's platform gateway validates any incoming `Authorization: Bearer ...`
 * against the service JWT secret *before* this function runs. Any token problem
 * (bad signature, expired, wrong issuer, stale after key rotation) is surfaced
 * as an opaque HTTP 500 JWSError instead of a proper 401. That blew up the
 * Leaderboard for real users whose stored access_token drifted (GitHub issue #6
 * / Linear 001-51).
 *
 * Fix: this endpoint is now purely public. The client passes its own `user_id`
 * as a query parameter (already known from the Insforge auth context) to get
 * `is_me` highlighting. The function never touches the Authorization header,
 * so no JWT validation path can ever fire for Leaderboard reads.
 *
 * Security note: `user_id` from the query is only used for row-highlight. All
 * leaderboard entries are public data in `tokentracker_leaderboard_snapshots`,
 * so spoofing `user_id` at worst re-highlights a different row — no PII or
 * private data is exposed.
 */
import { createClient } from "npm:@insforge/sdk";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};
const BLOCKED_LEADERBOARD_USER_IDS = new Set(
  (Deno.env.get("LEADERBOARD_BLOCKED_USER_IDS") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);
const VALID_PERIODS = new Set(["today", "yesterday", "7d", "30d", "total"]);
const VALID_METRICS = new Set(["with_cache", "without_cache", "estimated_cost"]);
const LEADERBOARD_AGENT_SOURCES = new Set([
  "claude",
  "codex",
  "every-code",
  "cursor",
  "trae",
  "gemini",
  "opencode",
  "openclaw",
  "kilo-cli",
  "kilocode",
  "roocode",
  "kiro",
  "kiro-cli",
  "hermes",
  "kimi",
  "kimi-code",
  "codebuddy",
  "omp",
  "pi",
  "craft",
  "grok",
  "copilot",
  "zed",
  "goose",
  "droid",
  "antigravity",
]);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/**
 * Decode (without verifying) the `sub` claim from a JWT. Pure back-compat
 * fallback so v0.5.46 clients that still send an Authorization header
 * (instead of the new `user_id` query param) still get `is_me` highlighting.
 * Signature is NOT verified — the value is only used for cosmetic row
 * highlighting on public data, never for authorization.
 */
function unsafeDecodeJwtSub(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const p = parts[1];
    const padded = p
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(p.length + ((4 - (p.length % 4)) % 4), "=");
    const payload = JSON.parse(atob(padded)) as Record<string, unknown>;
    const sub = payload.sub;
    if (typeof sub === "string" && sub.length > 0) return sub;
    const uid = payload.user_id;
    if (typeof uid === "string" && uid.length > 0) return uid;
  } catch {
    /* ignore */
  }
  return null;
}

function normalizePeriod(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "week") return "7d";
  if (normalized === "month") return "30d";
  return VALID_PERIODS.has(normalized) ? normalized : null;
}

function normalizeAgent(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "all" || LEADERBOARD_AGENT_SOURCES.has(normalized)) return normalized;
  return null;
}

function normalizeMetric(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return VALID_METRICS.has(normalized) ? normalized : null;
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  const period = normalizePeriod(url.searchParams.get("period") || "total");
  const agent = normalizeAgent(url.searchParams.get("agent") || "all");
  const metric = normalizeMetric(url.searchParams.get("metric") || "with_cache");
  if (!period || !agent || !metric) {
    return json({ error: "invalid leaderboard dimensions" }, 400);
  }
  const parsedLimit = Number.parseInt(url.searchParams.get("limit") || "20", 10);
  const parsedOffset = Number.parseInt(url.searchParams.get("offset") || "0", 10);
  const limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 20, 1), 100);
  const offset = Math.max(Number.isFinite(parsedOffset) ? parsedOffset : 0, 0);
  // Preferred path: client passes user_id as a query param (v0.5.51+).
  // Fallback: v0.5.46 clients still send a Bearer token — decode its sub
  // claim (WITHOUT signature verification) so they keep seeing is_me
  // highlighting. Signature validation is unnecessary because sub is only
  // used to pick which public row to highlight.
  let requestedUserId =
    url.searchParams.get("user_id") || url.searchParams.get("userId") || null;
  if (!requestedUserId) {
    const authH = req.headers.get("Authorization");
    const token = authH?.startsWith("Bearer ") ? authH.slice(7) : null;
    if (token) requestedUserId = unsafeDecodeJwtSub(token);
  }

  const baseUrl = Deno.env.get("INSFORGE_BASE_URL")!;
  const incomingApiKey =
    req.headers.get("apikey") ?? req.headers.get("Apikey") ?? req.headers.get("x-api-key") ?? undefined;
  const anonKey =
    Deno.env.get("INSFORGE_ANON_KEY") ?? Deno.env.get("ANON_KEY") ?? incomingApiKey ?? undefined;
  const serviceRoleKey = Deno.env.get("INSFORGE_SERVICE_ROLE_KEY");
  // Always use service role (never the caller's token) so a stale/broken
  // caller token can't cascade into a 500 on the DB query.
  const client = createClient({
    baseUrl,
    edgeFunctionToken: serviceRoleKey,
    anonKey,
    ...(anonKey ? { headers: { apikey: anonKey } } : {}),
  });

  const { data, error } = await client.database.rpc(
    "leaderboard_ranked",
    {
      p_period: period,
      p_agent: agent,
      p_metric: metric,
      p_limit: limit,
      p_offset: offset,
      p_user_id: requestedUserId,
      p_blocked_user_ids: Array.from(BLOCKED_LEADERBOARD_USER_IDS),
    },
  );
  if (error) return json({ error: error.message }, 500);

  type RankedPayload = {
    entries?: Array<Record<string, unknown>>;
    me?: Record<string, unknown> | null;
    participant_count?: number | string;
    total_score?: number | string;
    aggregate_total_tokens?: number | string;
    from?: string | null;
    to?: string | null;
    generated_at?: string | null;
  };
  const payload = (
    Array.isArray(data) ? (data[0] ?? {}) : (data ?? {})
  ) as RankedPayload;
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  const participantCount = Math.max(Number(payload.participant_count) || 0, 0);
  const me = payload.me ?? null;
  const meUserId = typeof me?.user_id === "string" ? me.user_id : null;

  return json({
    entries: entries.map((e) => ({
      ...e,
      is_me: Boolean(meUserId && meUserId === e.user_id),
    })),
    me,
    participant_count: participantCount,
    total_entries: participantCount,
    total_score: Number(payload.total_score) || 0,
    aggregate_total_tokens: Number(payload.aggregate_total_tokens) || 0,
    page: Math.floor(offset / limit) + 1,
    total_pages: Math.ceil(participantCount / limit),
    period,
    agent,
    metric,
    from: payload.from ?? null,
    to: payload.to ?? null,
    generated_at: payload.generated_at ?? null,
  });
}
