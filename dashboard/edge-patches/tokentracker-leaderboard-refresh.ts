/**
 * One global 15-minute scheduler wrapper. Aggregation, pricing, ranking, and
 * atomic snapshot replacement are performed by the database RPC.
 */
import { createClient } from "npm:@insforge/sdk";

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-leaderboard-scheduler-secret",
};

type Period = "today" | "yesterday" | "7d" | "30d" | "total";

const ALL_PERIODS: Period[] = ["today", "yesterday", "7d", "30d", "total"];
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
  "workbuddy",
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

const LEADERBOARD_METRICS = ["total_without_cache_tokens", "agent_metrics"] as const;

// LEADERBOARD_PERIOD_HELPERS_START
const SHANGHAI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

function shiftDay(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function shanghaiDay(now: Date): string {
  return new Date(now.getTime() + SHANGHAI_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

function computeDateRange(
  period: Period,
  now = new Date(),
): { from_day: string; to_day: string } {
  const today = shanghaiDay(now);
  if (period === "today") return { from_day: today, to_day: today };
  if (period === "yesterday") {
    const yesterday = shiftDay(today, -1);
    return { from_day: yesterday, to_day: yesterday };
  }
  if (period === "7d") return { from_day: shiftDay(today, -6), to_day: today };
  if (period === "30d") return { from_day: shiftDay(today, -29), to_day: today };
  return { from_day: "1970-01-01", to_day: today };
}

function toUtcTimestampRange(
  { from_day, to_day }: { from_day: string; to_day: string },
): { rangeStart: string; rangeEnd: string } {
  return {
    rangeStart: `${from_day}T00:00:00+08:00`,
    rangeEnd: `${shiftDay(to_day, 1)}T00:00:00+08:00`,
  };
}
// LEADERBOARD_PERIOD_HELPERS_END

function assertLeaderboardPeriod(period: string): asserts period is Period {
  if (!ALL_PERIODS.includes(period as Period)) throw new Error("invalid leaderboard period");
}

function withoutCacheTokens(row: Record<string, number>): number {
  return Math.max(
    0,
    (row.total_tokens || 0) - (row.cached_input_tokens || 0) - (row.cache_creation_input_tokens || 0),
  );
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers });
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return difference === 0;
}

async function verifiedUserId(baseUrl: string, token: string): Promise<string | null> {
  if (!token) return null;
  const authClient = createClient({ baseUrl, edgeFunctionToken: token });
  const { data, error } = await authClient.auth.getCurrentUser();
  return !error && typeof data?.user?.id === "string" ? data.user.id : null;
}

function firstRow(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) || null;
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const baseUrl = Deno.env.get("INSFORGE_BASE_URL");
  const serviceRoleKey =
    Deno.env.get("API_KEY") ?? Deno.env.get("INSFORGE_SERVICE_ROLE_KEY");
  if (!baseUrl || !serviceRoleKey) return json({ error: "server misconfigured" }, 500);

  const expectedSecret = Deno.env.get("LEADERBOARD_SCHEDULER_SECRET") || "";
  const suppliedSecret = req.headers.get("x-leaderboard-scheduler-secret") || "";
  const schedulerRequest = Boolean(
    expectedSecret
      && suppliedSecret
      && constantTimeEqual(suppliedSecret, expectedSecret),
  );
  let userId: string | null = null;
  if (!schedulerRequest) {
    const token =
      req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
    userId = await verifiedUserId(baseUrl, token);
    if (!userId) return json({ error: "Unauthorized" }, 401);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (body.period !== "total" || body.source !== "compact-state-upload") {
      return json({ error: "Invalid refresh request" }, 400);
    }
  }

  const slot = Math.floor(Date.now() / 1000 / 900);
  const refreshMonth = schedulerRequest && slot % 4 === 0;
  // Compact device state is bounded to three 8 KiB rows per user, so keeping
  // the cumulative snapshot current every scheduled run is inexpensive and
  // avoids the week-old totals produced by the former once-daily cadence.
  const refreshTotal = true;
  const client = createClient({ baseUrl, edgeFunctionToken: serviceRoleKey });

  if (userId) {
    const [stateResult, snapshotResult] = await Promise.all([
      client.database
        .from("tokentracker_leaderboard_device_state")
        .select("captured_at")
        .eq("user_id", userId)
        .order("captured_at", { ascending: false })
        .limit(1),
      client.database
        .from("tokentracker_leaderboard_snapshots_v2")
        .select("generated_at")
        .eq("user_id", userId)
        .eq("period", "total")
        .eq("metric", "tokens")
        .eq("source", "all")
        .order("generated_at", { ascending: false })
        .limit(1),
    ]);
    if (stateResult.error) {
      return json({ error: stateResult.error.message || "Leaderboard state read failed" }, 500);
    }
    const latestState = firstRow(stateResult.data);
    const latestSnapshot = firstRow(snapshotResult.data);
    const capturedAt = Date.parse(String(latestState?.captured_at || ""));
    const generatedAt = Date.parse(String(latestSnapshot?.generated_at || ""));
    if (Number.isFinite(capturedAt) && Number.isFinite(generatedAt) && generatedAt >= capturedAt) {
      return json({
        ok: true,
        skipped: "up_to_date",
        generated_at: latestSnapshot?.generated_at || null,
      });
    }
  }

  const { data, error } = await client.database.rpc(
    "refresh_leaderboard_snapshots",
    {
      p_refresh_month: refreshMonth,
      p_refresh_total: refreshTotal,
    },
  );
  if (error) return json({ error: error.message || "Leaderboard refresh failed" }, 500);

  const result = (data || {}) as Record<string, unknown>;
  return json({
    ok: true,
    periods: ["today", "week", "30d", ...(refreshMonth ? ["month"] : []), ...(refreshTotal ? ["total"] : [])],
    row_counts: result.row_counts || {},
    rows_inserted: result.rows_inserted || 0,
    duration_ms: result.duration_ms || 0,
    pricing_version: result.pricing_version || null,
    generated_at: result.generated_at || null,
    snapshot_run_id: result.snapshot_run_id || null,
    trigger: schedulerRequest ? "scheduler" : "compact-state-upload",
  });
}
