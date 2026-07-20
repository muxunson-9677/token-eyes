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

function b64urlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function verifiedUserIdFromJwt(token: string): Promise<string | null> {
  const secret = Deno.env.get("JWT_SECRET");
  const parts = token.split(".");
  if (!secret || parts.length !== 3) return null;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]))) as Record<string, unknown>;
    if (typeof payload.exp === "number" && payload.exp < Date.now() / 1000) return null;
    const userId = payload.sub ?? payload.user_id;
    return typeof userId === "string" && userId ? userId : null;
  } catch {
    return null;
  }
}

function choice(value: string | null, allowed: Set<string>, fallback: string) {
  const normalized = (value || "").trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
  const userId = await verifiedUserIdFromJwt(token);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const url = new URL(req.url);
  const period = choice(url.searchParams.get("period"), PERIODS, "today");
  const metric = choice(url.searchParams.get("metric"), METRICS, "tokens");
  const requestedSource = choice(url.searchParams.get("source"), KNOWN_SOURCES, "all");
  const source = metric === "actual_cost" ? "all" : requestedSource;

  const baseUrl = Deno.env.get("INSFORGE_BASE_URL");
  const serviceRoleKey = Deno.env.get("INSFORGE_SERVICE_ROLE_KEY");
  if (!baseUrl || !serviceRoleKey) return json({ error: "server misconfigured" }, 500);
  const client = createClient({ baseUrl, edgeFunctionToken: serviceRoleKey });
  const { data, error } = await client.database
    .from("tokentracker_leaderboard_snapshots")
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
