/**
 * InsForge Edge: GitHub README statistics card (SVG).
 *
 * Returns a self-contained SVG stat card for a public profile, designed to be
 * embedded in a GitHub README:
 *
 *   ![Token Eyes](https://www.tokentracker.cc/functions/tokentracker-badge?profile=<id>)
 *
 * Query params:
 *   profile  (required) – public profile id (user_id UUID, same identifier the
 *            leaderboard profile endpoint accepts as user_id).
 *            TODO(field-verification): if a short public "profile handle"
 *            alias table ships later, resolve it here before the UUID check.
 *   user_id  – accepted as an alias of `profile` for consistency with
 *            tokentracker-badge-svg.ts.
 *
 * Card contents: weekly tokens, weekly estimated spend, top model (current
 * ISO Monday-start week, matching leaderboard-refresh + dashboard).
 *
 * Data access mirrors the existing endpoints:
 *   - weekly tokens / est. spend come from tokentracker_leaderboard_snapshots_v2
 *     (period=week, metric=tokens, source=all) exactly like tokentracker-badge-svg.ts;
 *   - top model comes from a single-user week-window scan of tokentracker_hourly,
 *     a simplified copy of scanHourlyForUser in tokentracker-leaderboard-profile.ts
 *     (account-level sources deduped across devices, machine-level sources summed
 *     across active devices only).
 *
 * Error handling: this endpoint NEVER returns JSON — every failure renders a
 * valid error-state SVG so the README image never breaks.
 *
 * Caching: 1h (Cache-Control: public, max-age=3600).
 * Colors are dark-mode friendly (GitHub dark palette card that also reads
 * fine on light backgrounds).
 *
 * NOTE: not deployed yet — code-only deliverable (W10).
 */
import { createClient } from "npm:@insforge/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const CACHE_SECONDS = 3600;

// GitHub dark palette; readable on both dark and light README backgrounds.
const CARD_BG = "#0d1117";
const CARD_BORDER = "#30363d";
const TEXT_PRIMARY = "#e6edf3";
const TEXT_MUTED = "#8b949e";
const BRAND_GREEN = "#3fb950";

// Blocked users must disappear from EVERY public read path (mirrors
// tokentracker-badge-svg.ts / leaderboard endpoints).
const BLOCKED_LEADERBOARD_USER_IDS = new Set(
  (Deno.env.get("LEADERBOARD_BLOCKED_USER_IDS") ?? "")
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean),
);

// Keep in sync with ACCOUNT_LEVEL_SOURCES in src/lib/source-metadata.js and
// tokentracker-leaderboard-profile.ts (account-level rows are identical on
// every device and must be deduped, not summed).
const ACCOUNT_LEVEL_SOURCES = new Set<string>(["cursor"]);

function svgResponse(svg: string, status = 200, cacheSeconds = CACHE_SECONDS): Response {
  return new Response(svg, {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`,
    },
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function compactNumber(n: number): string {
  if (!isFinite(n) || n <= 0) return "0";
  if (n >= 1e12) return (n / 1e12).toFixed(2).replace(/\.?0+$/, "") + "T";
  if (n >= 1e9) return (n / 1e9).toFixed(2).replace(/\.?0+$/, "") + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2).replace(/\.?0+$/, "") + "K";
  return String(Math.round(n));
}

function formatCost(n: number): string {
  if (!isFinite(n) || n < 0) return "$0";
  if (n >= 1000) return "$" + Math.round(n).toLocaleString("en-US");
  if (n >= 100) return "$" + n.toFixed(0);
  return "$" + n.toFixed(2);
}

/** Trim a model name so it fits the card column. */
function shortModel(model: string, maxChars = 22): string {
  const trimmed = model.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, maxChars - 1) + "\u2026";
}

/** ISO Monday-start week bounds, mirrors leaderboard-refresh + dashboard. */
function currentWeekBounds(): { from_day: string; to_day: string } {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const from_day = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 6);
  return { from_day, to_day: d.toISOString().slice(0, 10) };
}

// ─────────────────────────── SVG card rendering ───────────────────────────

interface CardStats {
  displayName: string;
  weeklyTokens: string;
  weeklySpend: string;
  topModel: string;
}

function renderStatCard(stats: CardStats): string {
  const width = 480;
  const height = 140;
  const name = escapeXml(stats.displayName);
  const cols = [
    { x: 24, value: escapeXml(stats.weeklyTokens), label: "Tokens this week" },
    { x: 184, value: escapeXml(stats.weeklySpend), label: "Est. spend" },
    { x: 320, value: escapeXml(stats.topModel), label: "Top model" },
  ];
  const statBlocks = cols
    .map(
      (c) => `
    <text x="${c.x}" y="88" font-size="22" font-weight="600" fill="${TEXT_PRIMARY}">${c.value}</text>
    <text x="${c.x}" y="110" font-size="11" fill="${TEXT_MUTED}">${c.label}</text>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Token Eyes weekly usage for ${name}">
  <title>Token Eyes weekly usage for ${name}</title>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="${CARD_BG}" stroke="${CARD_BORDER}"/>
  <g font-family="Segoe UI, Ubuntu, Helvetica, Arial, sans-serif">
    <circle cx="30" cy="32" r="6" fill="${BRAND_GREEN}"/>
    <text x="44" y="37" font-size="15" font-weight="600" fill="${TEXT_PRIMARY}">Token Eyes</text>
    <text x="${width - 24}" y="37" font-size="12" text-anchor="end" fill="${TEXT_MUTED}">${name} \u00b7 weekly</text>${statBlocks}
  </g>
</svg>`;
}

/** Error state is still a fully valid SVG so README embeds never break. */
function renderErrorCard(message: string): string {
  const width = 480;
  const height = 140;
  const safeMessage = escapeXml(message);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Token Eyes: ${safeMessage}">
  <title>Token Eyes: ${safeMessage}</title>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="${CARD_BG}" stroke="${CARD_BORDER}"/>
  <g font-family="Segoe UI, Ubuntu, Helvetica, Arial, sans-serif">
    <circle cx="30" cy="32" r="6" fill="${TEXT_MUTED}"/>
    <text x="44" y="37" font-size="15" font-weight="600" fill="${TEXT_PRIMARY}">Token Eyes</text>
    <text x="24" y="88" font-size="14" fill="${TEXT_MUTED}">${safeMessage}</text>
  </g>
</svg>`;
}

// ─────────────────────────── Data access ───────────────────────────

interface SnapshotRow {
  total_tokens: number | string | null;
  estimated_cost_usd: number | string | null;
  is_public: boolean | null;
  display_name: string | null;
}

// deno-lint-ignore no-explicit-any
async function fetchWeekSnapshot(client: any, userId: string): Promise<SnapshotRow | null> {
  const { from_day, to_day } = currentWeekBounds();
  const { data, error } = await client.database
    .from("tokentracker_leaderboard_snapshots_v2")
    .select("total_tokens, estimated_cost_usd, is_public, display_name")
    .eq("user_id", userId)
    .eq("period", "week")
    .eq("metric", "tokens")
    .eq("source", "all")
    .eq("from_day", from_day)
    .eq("to_day", to_day)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SnapshotRow | null) ?? null;
}

/**
 * Single-user week-window top-model scan. Simplified copy of
 * scanHourlyForUser in tokentracker-leaderboard-profile.ts: account-level
 * sources keep one canonical row per (source, model, hour) across all
 * devices, machine-level sources sum across ACTIVE devices only.
 * Returns null when the deployment has no tokentracker_hourly table
 * (privacy-minimal deployments intentionally omit it).
 */
// deno-lint-ignore no-explicit-any
async function fetchTopModel(client: any, userId: string): Promise<string | null> {
  const { from_day, to_day } = currentWeekBounds();
  const fromIso = `${from_day}T00:00:00Z`;
  const endExclusive = new Date(`${to_day}T00:00:00Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const toIso = endExclusive.toISOString();

  try {
    const activeDeviceIds = new Set<string>();
    {
      let dOff = 0;
      const DPAGE = 1000;
      while (true) {
        const { data: devs, error: dErr } = await client.database
          .from("tokentracker_devices")
          .select("id")
          .eq("user_id", userId)
          .is("revoked_at", null)
          .order("id", { ascending: true })
          .range(dOff, dOff + DPAGE - 1);
        if (dErr) throw new Error(dErr.message);
        if (!devs || devs.length === 0) break;
        for (const d of devs as Array<{ id: string }>) activeDeviceIds.add(d.id);
        if (devs.length < DPAGE) break;
        dOff += DPAGE;
      }
    }

    interface ScanRow {
      device_id: string;
      source: string;
      model: string;
      hour_start: string;
      total_tokens: number | null;
    }
    const accountMap = new Map<string, number>();
    const byModel = new Map<string, number>();
    let offset = 0;
    const PAGE_SIZE = 1000;
    while (true) {
      const { data: rows, error } = await client.database
        .from("tokentracker_hourly")
        .select("device_id, source, model, hour_start, total_tokens")
        .eq("user_id", userId)
        .gte("hour_start", fromIso)
        .lt("hour_start", toIso)
        // Total order over the upsert conflict key so PostgREST pagination
        // cannot skip/duplicate rows (see leaderboard-profile.ts).
        .order("hour_start", { ascending: true })
        .order("device_id", { ascending: true })
        .order("source", { ascending: true })
        .order("model", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      if (!rows || rows.length === 0) break;
      for (const row of rows as ScanRow[]) {
        const tokens = Number(row.total_tokens) || 0;
        if (!row.model || tokens <= 0) continue;
        if (ACCOUNT_LEVEL_SOURCES.has(row.source)) {
          // Keep one canonical value per base bucket across devices.
          const key = `${row.source}|${row.model}|${row.hour_start}`;
          const existing = accountMap.get(key) || 0;
          if (tokens > existing) {
            byModel.set(row.model, (byModel.get(row.model) || 0) + tokens - existing);
            accountMap.set(key, tokens);
          }
        } else {
          if (!activeDeviceIds.has(row.device_id)) continue;
          byModel.set(row.model, (byModel.get(row.model) || 0) + tokens);
        }
      }
      if (rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    let top: string | null = null;
    let topTokens = 0;
    for (const [model, tokens] of byModel.entries()) {
      if (tokens > topTokens) {
        top = model;
        topTokens = tokens;
      }
    }
    return top;
  } catch {
    return null;
  }
}

// ─────────────────────────── Main handler ───────────────────────────

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return svgResponse(renderErrorCard("Method not allowed"), 405, 0);
  }

  const url = new URL(req.url);
  const profileId = (url.searchParams.get("profile") || url.searchParams.get("user_id") || "")
    .trim()
    .toLowerCase();

  if (!profileId || !isUuid(profileId)) {
    return svgResponse(renderErrorCard("Invalid or missing profile id"), 400, 0);
  }
  if (BLOCKED_LEADERBOARD_USER_IDS.has(profileId)) {
    return svgResponse(renderErrorCard("Profile not found"), 404, 0);
  }

  // Public endpoint: service role key so a caller's stale Authorization can
  // never trigger the gateway's JWT validator (see tokentracker-badge-svg.ts).
  const serviceRoleKey = Deno.env.get("INSFORGE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("INSFORGE_ANON_KEY") ?? Deno.env.get("ANON_KEY");
  const baseUrl = Deno.env.get("INSFORGE_BASE_URL");
  if (!baseUrl) {
    return svgResponse(renderErrorCard("Service misconfigured"), 500, 0);
  }
  const client = createClient({
    baseUrl,
    edgeFunctionToken: serviceRoleKey,
    anonKey: anonKey ?? undefined,
    isServerMode: true,
  });

  let snapshot: SnapshotRow | null = null;
  try {
    snapshot = await fetchWeekSnapshot(client, profileId);
  } catch {
    return svgResponse(renderErrorCard("Data temporarily unavailable"), 502, 0);
  }

  if (!snapshot) {
    // No snapshot row for the current week: either the profile does not
    // exist or it has no usage yet. Same 404 shape as tokentracker-badge-svg.
    return svgResponse(renderErrorCard("No public data for this profile"), 404, 0);
  }
  if (snapshot.is_public === false) {
    // Privacy gate: mirrors badge-svg / leaderboard exposure policy.
    return svgResponse(renderErrorCard("This profile is private"), 403, 0);
  }

  const topModel = await fetchTopModel(client, profileId);

  const weeklyTokens = Number(snapshot.total_tokens ?? 0);
  // TODO(pricing): weekly spend comes from the snapshot's estimated_cost_usd
  // (computed by leaderboard-refresh). We intentionally do NOT mirror the
  // 5-file MODEL_PRICING table into a 6th edge file; if the snapshot row is
  // ever missing the cost we render "$0" rather than recomputing locally.
  const weeklySpend = Number(snapshot.estimated_cost_usd ?? 0);

  const svg = renderStatCard({
    displayName: snapshot.display_name?.trim() || "Anonymous",
    weeklyTokens: compactNumber(weeklyTokens),
    weeklySpend: formatCost(weeklySpend),
    topModel: topModel ? shortModel(topModel) : "n/a",
  });
  return svgResponse(svg, 200, CACHE_SECONDS);
}
