/**
 * InsForge Edge：接收本地 CLI 上传的用量数据，写入 tokentracker_hourly。
 * 用 device token（SHA-256 hash）验证身份，用 service role key 写 DB。
 */
import { createClient } from "npm:@insforge/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, apikey, x-tokentracker-device-token-hash",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const PRIVACY_FORBIDDEN_FIELDS = new Set([
  "code",
  "conversation",
  "project",
  "path",
  "skill",
  "mcp",
  "file",
]);

function findPrivacyForbiddenField(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findPrivacyForbiddenField(item);
      if (nested) return nested;
    }
    return null;
  }
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.trim().toLowerCase();
    if (PRIVACY_FORBIDDEN_FIELDS.has(normalized)) return normalized;
    const nested = findPrivacyForbiddenField(nestedValue);
    if (nested) return nested;
  }
  return null;
}

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  const deviceToken = authHeader?.replace(/^Bearer\s+/i, "");
  if (!deviceToken) return json({ error: "Missing bearer token" }, 401);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: "Invalid JSON body" }, 400);
  const forbiddenField = findPrivacyForbiddenField(body);
  if (forbiddenField) {
    return json({ error: `Privacy-forbidden field: ${forbiddenField}` }, 400);
  }
  if (Deno.env.get("TOKENTRACKER_LEGACY_HOURLY_INGEST_ENABLED") !== "true") {
    return json({
      error: "Legacy hourly leaderboard ingest is disabled",
      migration: "leaderboard-compact-state-v1",
    }, 410);
  }

  const baseUrl = Deno.env.get("INSFORGE_BASE_URL")!;
  const serviceRoleKey = Deno.env.get("INSFORGE_SERVICE_ROLE_KEY");
  const incomingApiKey =
    req.headers.get("apikey") ?? req.headers.get("Apikey") ?? req.headers.get("x-api-key") ?? undefined;
  const anonKey =
    Deno.env.get("INSFORGE_ANON_KEY") ?? Deno.env.get("ANON_KEY") ?? incomingApiKey ?? undefined;
  if (!serviceRoleKey) return json({ error: "server misconfigured" }, 500);

  const client = createClient({
    baseUrl,
    edgeFunctionToken: serviceRoleKey,
    anonKey,
    ...(anonKey ? { headers: { apikey: anonKey } } : {}),
  });

  const tokenHash = await sha256Hex(deviceToken);

  const { data: tokenRow, error: tokenErr } = await client.database
    .from("tokentracker_device_tokens")
    .select("user_id, device_id")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .maybeSingle();

  if (tokenErr) return json({ error: tokenErr.message }, 500);
  if (!tokenRow) return json({ error: "Unauthorized" }, 401);

  const userId = (tokenRow as { user_id: string }).user_id;
  const deviceId = (tokenRow as { device_id: string }).device_id;

  const buckets = Array.isArray(body.buckets)
    ? body.buckets
    : Array.isArray(body.hourly)
      ? body.hourly
      : [];
  if (!Array.isArray(buckets) || buckets.length === 0) {
    return json({ error: "No usage buckets provided" }, 400);
  }
  if (buckets.length > 500) {
    return json({ error: "Too many buckets (max 500)" }, 400);
  }

  const normalizeBillingMode = (value: unknown): "api_key" | "token_plan" | "unknown" =>
    value === "api_key" || value === "token_plan" ? value : "unknown";

  const expandedBuckets: Record<string, unknown>[] = [];
  for (const bucket of buckets as Record<string, unknown>[]) {
    if (bucket.billing_mode_compat_summary !== "base_total_v1") {
      expandedBuckets.push(bucket);
      continue;
    }
    const slices = bucket.billing_mode_compat_slices;
    if (!slices || typeof slices !== "object" || Array.isArray(slices)) continue;
    for (const [billingMode, slice] of Object.entries(slices as Record<string, unknown>)) {
      if (!slice || typeof slice !== "object" || Array.isArray(slice)) continue;
      expandedBuckets.push({
        ...bucket,
        ...(slice as Record<string, unknown>),
        billing_mode: billingMode,
        billing_mode_compat_summary: undefined,
        billing_mode_compat_slices: undefined,
      });
    }
  }

  const mappedRows = expandedBuckets
    .map((b: Record<string, unknown>) => ({
    user_id: userId,
    device_id: deviceId,
    hour_start: b.hour_start,
    source: b.source || "unknown",
    model: b.model || "unknown",
    billing_mode: normalizeBillingMode(b.billing_mode),
    input_tokens: b.input_tokens || 0,
    cached_input_tokens: b.cached_input_tokens || 0,
    cache_creation_input_tokens: b.cache_creation_input_tokens || 0,
    output_tokens: b.output_tokens || 0,
    reasoning_output_tokens: b.reasoning_output_tokens || 0,
    total_tokens: b.total_tokens || 0,
    billable_total_tokens: b.billable_total_tokens || 0,
    total_cost_usd: Number(b.total_cost_usd) || 0,
    // The CLI queue rows name this field `conversation_count`; older upload
    // paths sent `conversations`. Reading only `conversations` zeroed the
    // column for every CLI upload since 2026-04-18 — accept both.
    conversations: b.conversation_count ?? b.conversations ?? 0,
  }));

  // Latest cumulative value wins per mode identity. Retraction zeros are
  // authoritative, so MAX would resurrect stale usage.
  const dedupedMap = new Map<string, typeof mappedRows[number]>();
  for (const r of mappedRows) {
    const key = `${r.hour_start}|${r.source}|${r.model}|${r.billing_mode}`;
    dedupedMap.set(key, r);
  }
  const modeRows = Array.from(dedupedMap.values());

  const { error: mergeErr } = await client.database.rpc("tokentracker_hourly_ingest_v2", {
    p_user_id: userId,
    p_device_id: deviceId,
    p_rows: modeRows,
  });
  if (!mergeErr) return json({ ok: true, inserted: modeRows.length, skipped: 0 });
  const mergeMessage = String(mergeErr.message || mergeErr);
  const missingCapability = /tokentracker_hourly_ingest_v2/iu.test(mergeMessage)
    && /(?:not found|does not exist|schema cache|pgrst202)/iu.test(mergeMessage);
  if (!missingCapability) return json({ error: mergeErr.message }, 500);

  // Edge-first rollout fallback: collapse modes into the legacy five-column
  // base row and omit the extension column entirely.
  const fallbackMap = new Map<string, Omit<typeof modeRows[number], "billing_mode">>();
  for (const { billing_mode: _mode, ...r } of modeRows) {
    const key = `${r.hour_start}|${r.source}|${r.model}`;
    const base = fallbackMap.get(key);
    if (!base) fallbackMap.set(key, { ...r });
    else {
      for (const field of ["input_tokens", "cached_input_tokens", "cache_creation_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens", "billable_total_tokens", "total_cost_usd", "conversations"] as const) {
        base[field] = Number(base[field] || 0) + Number(r[field] || 0);
      }
    }
  }
  const rows = Array.from(fallbackMap.values());

  const { error: upsertErr } = await client.database
    .from("tokentracker_hourly")
    .upsert(rows, {
      onConflict: "user_id,device_id,hour_start,source,model",
    });

  if (upsertErr) return json({ error: upsertErr.message }, 500);

  return json({ ok: true, inserted: rows.length, skipped: 0 });
}
