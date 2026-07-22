/**
 * One global 15-minute scheduler wrapper. All aggregation, public filtering,
 * pricing, ranking, and atomic snapshot replacement live in PostgreSQL.
 * Every run refreshes today and week; month is hourly and total is daily.
 */
import { createClient } from "npm:@insforge/sdk";

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
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

export default async function (req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expectedSecret = Deno.env.get("LEADERBOARD_SCHEDULER_SECRET") || "";
  const suppliedSecret = req.headers.get("x-leaderboard-scheduler-secret") || "";
  if (!expectedSecret || !constantTimeEqual(suppliedSecret, expectedSecret)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const baseUrl = Deno.env.get("INSFORGE_BASE_URL");
  const serviceRoleKey = Deno.env.get("API_KEY") ?? Deno.env.get("INSFORGE_SERVICE_ROLE_KEY");
  if (!baseUrl || !serviceRoleKey) return json({ error: "server misconfigured" }, 500);

  const slot = Math.floor(Date.now() / 1000 / 900);
  const refreshMonth = slot % 4 === 0;
  const refreshTotal = slot % 96 === 0;
  const client = createClient({ baseUrl, edgeFunctionToken: serviceRoleKey });
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
    periods: ["today", "week", ...(refreshMonth ? ["month"] : []), ...(refreshTotal ? ["total"] : [])],
    row_counts: result.row_counts || {},
    rows_inserted: result.rows_inserted || 0,
    duration_ms: result.duration_ms || 0,
    pricing_version: result.pricing_version || null,
    generated_at: result.generated_at || null,
    snapshot_run_id: result.snapshot_run_id || null,
  });
}
