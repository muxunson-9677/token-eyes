/**
 * Public, cacheable leaderboard list. Identity-aware reads belong to the
 * authenticated tokentracker-leaderboard-me endpoint.
 */
import { createClient } from "npm:@insforge/sdk";

const PERIODS = new Set(["today", "week", "month", "total"]);
const METRICS = new Set(["tokens", "estimated_spend", "actual_cost"]);
const KNOWN_SOURCES = new Set([
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
const STALE_AFTER_MS: Record<string, number> = {
  today: 30 * 60_000,
  week: 30 * 60_000,
  month: 2 * 60 * 60_000,
  total: 26 * 60 * 60_000,
};
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, apikey",
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60, s-maxage=900, stale-if-error=86400",
    },
  });
}

function choice(value: string | null, allowed: Set<string>, fallback: string) {
  const normalized = (value || "").trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function boundedInteger(value: string | null, fallback: number, maximum: number) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, maximum);
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  const period = choice(url.searchParams.get("period"), PERIODS, "today");
  const metric = choice(url.searchParams.get("metric"), METRICS, "tokens");
  const requestedSource = choice(url.searchParams.get("source"), KNOWN_SOURCES, "all");
  const source = metric === "actual_cost" ? "all" : requestedSource;
  const limit = Math.max(1, Math.min(boundedInteger(url.searchParams.get("limit"), 20, 100), 100));
  const offset = boundedInteger(url.searchParams.get("offset"), 0, 100_000);

  const baseUrl = Deno.env.get("INSFORGE_BASE_URL");
  const serviceRoleKey = Deno.env.get("INSFORGE_SERVICE_ROLE_KEY");
  if (!baseUrl || !serviceRoleKey) return json({ error: "server misconfigured" }, 500);
  const client = createClient({ baseUrl, edgeFunctionToken: serviceRoleKey });

  const {
    data: entries,
    error,
    count,
  } = await client.database
    .from("tokentracker_leaderboard_snapshots")
    .select(
      "rank,total_tokens,estimated_cost_usd,actual_cost_usd,source_breakdown,display_name,avatar_url,github_url,pricing_version,generated_at",
      { count: "exact" },
    )
    .eq("period", period)
    .eq("metric", metric)
    .eq("source", source)
    .eq("is_public", true)
    .order("rank", { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) return json({ error: error.message || "Leaderboard read failed" }, 500);

  const rows = Array.isArray(entries) ? entries : [];
  const generatedAt = typeof rows[0]?.generated_at === "string" ? rows[0].generated_at : null;
  const pricingVersion = typeof rows[0]?.pricing_version === "string" ? rows[0].pricing_version : null;
  const generatedMs = generatedAt ? Date.parse(generatedAt) : Number.NaN;
  const stale = !Number.isFinite(generatedMs) || Date.now() - generatedMs > STALE_AFTER_MS[period];
  const totalEntries = Number(count) || 0;

  return json({
    entries: rows,
    period,
    metric,
    source,
    limit,
    offset,
    total_entries: totalEntries,
    total_pages: Math.ceil(totalEntries / limit),
    generated_at: generatedAt,
    pricing_version: pricingVersion,
    stale,
  });
}
