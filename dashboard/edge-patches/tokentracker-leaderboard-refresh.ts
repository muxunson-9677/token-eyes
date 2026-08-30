/** Debounced dirty-key refresh and signed static-object publication wrapper. */
import { createClient } from "npm:@insforge/sdk";

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-leaderboard-scheduler-secret",
};

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

async function notifyRefreshCoordinator(): Promise<boolean> {
  const triggerUrl = Deno.env.get("LEADERBOARD_DIRTY_TRIGGER_URL") || "";
  const triggerSecret = Deno.env.get("LEADERBOARD_DIRTY_TRIGGER_SECRET") || "";
  if (!triggerUrl || !triggerSecret) return false;
  const response = await fetch(triggerUrl, {
    method: "POST",
    headers: { "x-leaderboard-dirty-secret": triggerSecret },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  return response?.ok === true;
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const baseUrl = Deno.env.get("INSFORGE_BASE_URL");
  const serviceRoleKey =
    Deno.env.get("API_KEY") ?? Deno.env.get("INSFORGE_SERVICE_ROLE_KEY");
  if (!baseUrl || !serviceRoleKey) return json({ error: "server misconfigured" }, 500);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const expectedSecret = Deno.env.get("LEADERBOARD_SCHEDULER_SECRET") || "";
  const suppliedSecret = req.headers.get("x-leaderboard-scheduler-secret") || "";
  const schedulerRequest = Boolean(
    expectedSecret
      && suppliedSecret
      && constantTimeEqual(suppliedSecret, expectedSecret),
  );
  const client = createClient({ baseUrl, edgeFunctionToken: serviceRoleKey });

  if (!schedulerRequest) {
    const token =
      req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
    const userId = await verifiedUserId(baseUrl, token);
    if (!userId) return json({ error: "Unauthorized" }, 401);
    if (body.source !== "compact-state-upload" && body.source !== "dirty-state-change") {
      return json({ error: "Invalid refresh request" }, 400);
    }
    let queuedDimensions = 0;
    if (body.source === "compact-state-upload") {
      const { data, error } = await client.database.rpc(
        "mark_leaderboard_dimensions_dirty",
        {
          p_user_id: userId,
          p_actual_cost_changed: false,
        },
      );
      if (error) return json({ error: error.message || "Leaderboard dirty mark failed" }, 500);
      queuedDimensions = Number(data) || 0;
    }
    if (!await notifyRefreshCoordinator()) {
      return json({ error: "Leaderboard refresh coordinator unavailable" }, 502);
    }
    return json({
      ok: true,
      queued_dimensions: queuedDimensions,
      refresh_deadline_seconds: 60,
      trigger: body.source,
    }, 202);
  }

  if (body.mode === "daily-reconcile") {
    const daily = await client.database.rpc(
      "enqueue_leaderboard_daily_reconciliation",
      {},
    );
    if (daily.error) {
      return json({ error: daily.error.message || "Daily reconciliation enqueue failed" }, 500);
    }
  }

  const claimed = await client.database.rpc(
    "claim_leaderboard_dirty_dimensions",
    { p_limit: 285 },
  );
  if (claimed.error) {
    return json({ error: claimed.error.message || "Dirty dimension claim failed" }, 500);
  }
  const claimedDimensions = Array.isArray(claimed.data) ? claimed.data : [];
  if (claimedDimensions.length === 0) {
    return json({ ok: true, skipped: "no-dirty-dimensions", trigger: "scheduler" });
  }
  const dimensions = claimedDimensions.map((dimension) => ({
    period: dimension.period,
    metric: dimension.metric,
    source: dimension.source,
  }));

  const refreshed = await client.database.rpc(
    "refresh_leaderboard_snapshot_dimensions",
    { p_dimensions: dimensions },
  );
  if (refreshed.error) {
    return json({ error: refreshed.error.message || "Leaderboard incremental refresh failed" }, 500);
  }

  const result = (refreshed.data || {}) as Record<string, unknown>;
  const publishUrl = Deno.env.get("LEADERBOARD_PUBLISH_URL") || "";
  const publisherSecret = Deno.env.get("LEADERBOARD_PUBLISHER_SECRET") || "";
  if (!publishUrl || !publisherSecret || !Array.isArray(result.static_dimensions)) {
    return json({ error: "Leaderboard static publisher is not configured" }, 500);
  }
  const published = await fetch(publishUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-leaderboard-publisher-secret": publisherSecret,
    },
    body: JSON.stringify({
      generated_at: result.generated_at,
      dimensions: result.static_dimensions,
    }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!published?.ok) {
    return json({ error: "Leaderboard static publication failed" }, 502);
  }

  const acknowledged = await client.database.rpc(
    "ack_leaderboard_dirty_dimensions",
    { p_dimensions: claimedDimensions },
  );
  if (acknowledged.error) {
    return json({ error: acknowledged.error.message || "Dirty dimension acknowledgement failed" }, 500);
  }

  return json({
    ok: true,
    dimensions,
    row_counts: result.row_counts || {},
    rows_inserted: result.rows_inserted || 0,
    duration_ms: result.duration_ms || 0,
    pricing_version: result.pricing_version || null,
    generated_at: result.generated_at || null,
    snapshot_run_id: result.snapshot_run_id || null,
    trigger: body.mode === "daily-reconcile" ? "daily-reconcile" : "scheduler",
  });
}
