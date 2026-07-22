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
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    },
  });
}

async function verifiedUserId(baseUrl: string, token: string): Promise<string | null> {
  const authClient = createClient({ baseUrl, edgeFunctionToken: token });
  const { data, error } = await authClient.auth.getCurrentUser();
  return !error && typeof data?.user?.id === "string" ? data.user.id : null;
}

function choice(value: string | null, allowed: Set<string>, fallback: string) {
  const normalized = (value || "").trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const baseUrl = Deno.env.get("INSFORGE_BASE_URL");
  if (!baseUrl) return json({ error: "server misconfigured" }, 500);
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
  const userId = await verifiedUserId(baseUrl, token);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const url = new URL(req.url);
  const period = choice(url.searchParams.get("period"), PERIODS, "today");
  const metric = choice(url.searchParams.get("metric"), METRICS, "tokens");
  const requestedSource = choice(url.searchParams.get("source"), KNOWN_SOURCES, "all");
  const source = metric === "actual_cost" ? "all" : requestedSource;

  const serviceRoleKey = Deno.env.get("API_KEY") ?? Deno.env.get("INSFORGE_SERVICE_ROLE_KEY");
  if (!baseUrl || !serviceRoleKey) return json({ error: "server misconfigured" }, 500);
  const client = createClient({ baseUrl, edgeFunctionToken: serviceRoleKey });
  const { data, error } = await client.database
    .from("tokentracker_leaderboard_snapshots_v2")
    .select(
      "rank,total_tokens,estimated_cost_usd,actual_cost_usd,source_breakdown,display_name,avatar_url,github_url,pricing_version,generated_at",
    )
    .eq("period", period)
    .eq("metric", metric)
    .eq("source", source)
    .eq("is_public", true)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return json({ error: error.message || "Self rank read failed" }, 500);

  return json({ me: data || null, period, metric, source });
}
