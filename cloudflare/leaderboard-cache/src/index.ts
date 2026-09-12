import { collectResetAnnouncements, signedEnvelope, verifiedExistingAnnouncements } from './codex-reset-collector';

interface Env {
  PUBLIC_FEED_ORIGIN: string;
  LEADERBOARD_PUBLISHER_SECRET?: string;
  LEADERBOARD_SIGNING_PRIVATE_KEY_B64?: string;
  LEADERBOARD_SIGNING_KEY_ID?: string;
  LEADERBOARD_PUBLISHING_PAUSED?: string;
  LEADERBOARD_DO_DAILY_REQUEST_WARNING_LIMIT?: string;
  LEADERBOARD_DO_DAILY_REQUEST_STOP_LIMIT?: string;
  LEADERBOARD_DO_DAILY_WRITE_WARNING_LIMIT?: string;
  LEADERBOARD_DO_DAILY_WRITE_STOP_LIMIT?: string;
  LEADERBOARD_REFRESH_URL?: string;
  LEADERBOARD_SCHEDULER_SECRET?: string;
  LEADERBOARD_DIRTY_TRIGGER_SECRET?: string;
  LEADERBOARD_REFRESH_COORDINATOR?: DurableObjectNamespaceLike;
}

interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

interface DurableObjectStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  getAlarm(): Promise<number | null>;
  setAlarm(timestamp: number): Promise<void>;
}

interface StoredPublicObject {
  body: string | Uint8Array;
  contentType: string;
  cacheControl: string;
  contentSha256: string;
  generatedAt?: string;
}

interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
  delete?(request: Request): Promise<boolean>;
}

interface HandlerDependencies {
  cache: CacheLike;
  originFetch: typeof fetch;
  waitUntil(promise: Promise<unknown>): void;
  bypassFreshCache?: boolean;
}

const PERIODS = new Set(["today", "week", "30d", "month", "total"]);
const METRICS = new Set(["tokens", "estimated_spend", "actual_cost"]);
const SOURCES = new Set([
  "all",
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
  "deepseek-harness",
]);
const INTERNAL_AVATAR_RE = /^\/internal\/leaderboard-avatar\/([a-f0-9]{64})\.webp$/;
const LEADERBOARD_QUERY_KEYS = new Set(["period", "metric", "source", "limit", "offset"]);
const PUBLISH_PATH = "/internal/leaderboard-snapshots";
const DIRTY_TRIGGER_PATH = "/internal/leaderboard-refresh-dirty";
const STATIC_FEED_UPLOAD_RE = /^\/internal\/static-feed\/(plan-market|codex-reset)$/;
const PUBLIC_OBJECT_RE = /^\/v1\/(?:plan-market\/feed\.json|codex-reset\/feed\.json|avatars\/[a-f0-9]{64}\.webp|leaderboard\/(?:today|week|30d|month|total)\/(?:tokens|estimated_spend)\/(?:all|claude|codex|every-code|cursor|trae|gemini|opencode|openclaw|kilo-cli|kilocode|roocode|kiro|hermes|kimi|kimi-code|codebuddy|workbuddy|omp|pi|craft|grok|copilot|zed|goose|droid|antigravity|deepseek-harness)\.json|leaderboard\/(?:today|week|30d|month|total)\/actual_cost\/all\.json)$/;
const PUBLIC_OBJECT_STORAGE_PREFIX = "publicObject:";
const REFRESH_COOLDOWN_MS = 60_000;
const DEFAULT_DO_DAILY_WARNING_LIMIT = 70_000;
const DEFAULT_DO_DAILY_STOP_LIMIT = 90_000;
const PUBLIC_ROW_KEYS = new Set([
  "rank",
  "participant_count",
  "public_entry_id",
  "display_name",
  "avatar_url",
  "github_url",
  "total_tokens",
  "estimated_cost_usd",
  "actual_cost_usd",
  "source_breakdown",
  "pricing_version",
  "from_day",
  "to_day",
]);

function equalSecret(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let different = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    different |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return different === 0;
}

function standardBase64Bytes(value: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) throw new TypeError("invalid signing key");
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

function canonicalGeneratedAt(value: unknown) {
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
  ) {
    throw new TypeError("generated_at must be an ISO timestamp");
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError("generated_at must be an ISO timestamp");
  return new Date(parsed).toISOString();
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function finiteNonNegative(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function codeLockedLimit(value: string | undefined, ceiling: number) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0
    ? Math.min(numeric, ceiling)
    : ceiling;
}

function zeroDollarGateResponse(message: string, status = 429) {
  return new Response(message, {
    status,
    headers: {
      "Retry-After": "3600",
      "Cache-Control": "no-store",
      "X-Token-Eyes-Zero-Dollar-Gate": "stopped",
    },
  });
}

async function writePublicObject(
  env: Env,
  objectKey: string,
  body: string | Uint8Array,
  metadata: Omit<StoredPublicObject, "body">,
  expectedETag?: string,
) {
  if (!env.LEADERBOARD_REFRESH_COORDINATOR) {
    return { response: zeroDollarGateResponse("Zero-dollar object store is not configured", 503), unchanged: false };
  }
  try {
    const id = env.LEADERBOARD_REFRESH_COORDINATOR.idFromName("global");
    const response = await env.LEADERBOARD_REFRESH_COORDINATOR.get(id).fetch(
      new Request(`https://coordinator/objects/${objectKey}`, {
        method: "PUT",
        headers: {
          "Content-Type": metadata.contentType,
          "X-Object-Cache-Control": metadata.cacheControl,
          "X-Object-Content-Sha256": metadata.contentSha256,
          ...(expectedETag ? {'If-Match':expectedETag} : {}),
          ...(metadata.generatedAt ? { "X-Object-Generated-At": metadata.generatedAt } : {}),
        },
        body,
      }),
    );
    if (!response.ok) {
      return {
        response: zeroDollarGateResponse(
          (await response.text().catch(() => "")) || "Zero-dollar object store write failed",
          response.status === 429 ? 429 : 503,
        ),
        unchanged: false,
      };
    }
    const result = await response.json().catch(() => ({})) as { unchanged?: boolean };
    return { response: null, unchanged: result.unchanged === true };
  } catch {
    return { response: zeroDollarGateResponse("Zero-dollar object store is unavailable", 503), unchanged: false };
  }
}

async function writePublicObjects(
  env: Env,
  objects: Array<{ objectKey: string; body: string; metadata: Omit<StoredPublicObject, "body"> }>,
) {
  if (!env.LEADERBOARD_REFRESH_COORDINATOR) {
    return { response: zeroDollarGateResponse("Zero-dollar object store is not configured", 503) };
  }
  try {
    const id = env.LEADERBOARD_REFRESH_COORDINATOR.idFromName("global");
    const response = await env.LEADERBOARD_REFRESH_COORDINATOR.get(id).fetch(
      new Request("https://coordinator/objects-batch", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objects }),
      }),
    );
    if (!response.ok) {
      return {
        response: zeroDollarGateResponse(
          (await response.text().catch(() => "")) || "Zero-dollar object store batch write failed",
          response.status === 429 ? 429 : 503,
        ),
      };
    }
    return {
      response: null,
      result: await response.json() as { written: number; unchanged: number; written_keys: string[] },
    };
  } catch {
    return { response: zeroDollarGateResponse("Zero-dollar object store is unavailable", 503) };
  }
}

async function deletePublicObject(env: Env, objectKey: string) {
  if (!env.LEADERBOARD_REFRESH_COORDINATOR) {
    return zeroDollarGateResponse("Zero-dollar object store is not configured", 503);
  }
  try {
    const id = env.LEADERBOARD_REFRESH_COORDINATOR.idFromName("global");
    return await env.LEADERBOARD_REFRESH_COORDINATOR.get(id).fetch(
      new Request(`https://coordinator/objects/${objectKey}`, { method: "DELETE" }),
    );
  } catch {
    return zeroDollarGateResponse("Zero-dollar object store is unavailable", 503);
  }
}

function containsPrivateField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsPrivateField);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => (
    ["user_id", "account_id", "device_id", "email"].includes(key.toLowerCase())
      || containsPrivateField(child)
  ));
}

function safeStaticAvatarUrl(value: unknown, publicFeedOrigin: string) {
  if (typeof value !== "string") return null;
  try {
    const candidate = new URL(value);
    const origin = new URL(publicFeedOrigin);
    return candidate.origin === origin.origin
      && /^\/v1\/avatars\/[a-f0-9]{64}\.webp$/u.test(candidate.pathname)
      && !candidate.search
      && !candidate.hash
      ? candidate.toString()
      : null;
  } catch {
    return null;
  }
}

function safeGithubUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/?$/iu);
  return match ? `https://github.com/${match[1]}` : null;
}

function sanitizeSourceBreakdown(value: unknown) {
  if (!Array.isArray(value) || value.length > 28) {
    throw new TypeError("invalid public leaderboard breakdown");
  }
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new TypeError("invalid public leaderboard breakdown");
    }
    const record = item as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.some((key) => ![
      "source", "total_tokens", "estimated_cost_usd", "unpriced_tokens",
    ].includes(key))) {
      throw new TypeError("private or unknown leaderboard breakdown field");
    }
    const source = String(record.source || "").trim().toLowerCase();
    if (!SOURCES.has(source)) throw new TypeError("invalid leaderboard breakdown source");
    return {
      source,
      total_tokens: String(Math.trunc(finiteNonNegative(record.total_tokens))),
      estimated_cost_usd: finiteNonNegative(record.estimated_cost_usd),
      unpriced_tokens: String(Math.trunc(finiteNonNegative(record.unpriced_tokens))),
    };
  });
}

function validateDimension(dimension: Record<string, unknown>, publicFeedOrigin: string) {
  const period = String(dimension.period || "");
  const metric = String(dimension.metric || "");
  const source = String(dimension.source || "");
  const rows = dimension.rows;
  if (!PERIODS.has(period) || !METRICS.has(metric) || !SOURCES.has(source)
    || (metric === "actual_cost" && source !== "all")
    || !Array.isArray(rows) || rows.length > 50) {
    throw new TypeError("invalid static leaderboard dimension");
  }
  const entries = rows.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new TypeError("invalid public leaderboard row");
    }
    const record = row as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!PUBLIC_ROW_KEYS.has(key)) throw new TypeError("private or unknown leaderboard row field");
    }
    if (containsPrivateField(record.source_breakdown)) {
      throw new TypeError("private leaderboard breakdown field");
    }
    if (Number(record.rank) !== index + 1 || !/^[a-f0-9]{64}$/u.test(String(record.public_entry_id || ""))) {
      throw new TypeError("invalid public leaderboard row identity");
    }
    return {
      rank: Number(record.rank),
      public_entry_id: String(record.public_entry_id),
      display_name: String(record.display_name || "Anonymous").slice(0, 50),
      avatar_url: safeStaticAvatarUrl(record.avatar_url, publicFeedOrigin),
      github_url: safeGithubUrl(record.github_url),
      total_tokens: String(Math.trunc(finiteNonNegative(record.total_tokens))),
      estimated_cost_usd: finiteNonNegative(record.estimated_cost_usd),
      actual_cost_usd: record.actual_cost_usd == null
        ? null
        : finiteNonNegative(record.actual_cost_usd),
      source_breakdown: sanitizeSourceBreakdown(record.source_breakdown),
      pricing_version: typeof record.pricing_version === "string" ? record.pricing_version : null,
    };
  });
  return { period, metric, source, rows, entries };
}

async function publishLeaderboardSnapshots(request: Request, env: Env) {
  const suppliedSecret = request.headers.get("x-leaderboard-publisher-secret") || "";
  const expectedSecret = env.LEADERBOARD_PUBLISHER_SECRET || "";
  if (!suppliedSecret || !expectedSecret || !equalSecret(suppliedSecret, expectedSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!env.LEADERBOARD_REFRESH_COORDINATOR || !env.LEADERBOARD_SIGNING_PRIVATE_KEY_B64
    || !env.LEADERBOARD_SIGNING_KEY_ID) {
    return new Response("Publisher not configured", { status: 503 });
  }
  if (env.LEADERBOARD_PUBLISHING_PAUSED === "true") {
    return new Response("Leaderboard optional cloud publishing is paused by the zero-dollar gate", {
      status: 503,
      headers: { "Retry-After": "3600", "Cache-Control": "no-store" },
    });
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  let generatedAt;
  try {
    generatedAt = canonicalGeneratedAt(body?.generated_at);
  } catch {
    return new Response("Invalid publish request", { status: 400 });
  }
  if (!Array.isArray(body?.dimensions) || body.dimensions.length < 1 || body.dimensions.length > 285) {
    return new Response("Invalid publish request", { status: 400 });
  }
  const signingKey = await crypto.subtle.importKey(
    "pkcs8",
    standardBase64Bytes(env.LEADERBOARD_SIGNING_PRIVATE_KEY_B64),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const objects: Array<{
    objectKey: string;
    body: string;
    metadata: Omit<StoredPublicObject, "body">;
  }> = [];
  const seen = new Set<string>();
  for (const rawDimension of body.dimensions) {
    try {
      const dimension = validateDimension(
        rawDimension as Record<string, unknown>,
        env.PUBLIC_FEED_ORIGIN,
      );
      const snapshotKey = `${dimension.period}/${dimension.metric}/${dimension.source}`;
      if (seen.has(snapshotKey)) throw new TypeError("duplicate static leaderboard dimension");
      seen.add(snapshotKey);
      const first = dimension.rows[0] as Record<string, unknown> | undefined;
      const content = {
        schema_version: "token-eyes.leaderboard-snapshot/v1",
        snapshot_key: snapshotKey,
        period: dimension.period,
        metric: dimension.metric,
        source: dimension.source,
        entries: dimension.entries,
        participant_count: Math.max(
          dimension.entries.length,
          Number(first?.participant_count) || 0,
        ),
        ranked_entry_count: dimension.entries.length,
        aggregate_total_tokens: dimension.entries.reduce(
          (sum, row) => sum + finiteNonNegative(row.total_tokens),
          0,
        ),
        aggregate_total_cost_usd: dimension.entries.reduce(
          (sum, row) => sum + finiteNonNegative(
            dimension.metric === "actual_cost" ? row.actual_cost_usd : row.estimated_cost_usd,
          ),
          0,
        ),
        from: typeof first?.from_day === "string" ? first.from_day : null,
        to: typeof first?.to_day === "string" ? first.to_day : null,
      };
      const contentBytes = new TextEncoder().encode(JSON.stringify(content));
      const contentSha256 = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", contentBytes)));
      const objectKey = `v1/leaderboard/${snapshotKey}.json`;
      const payloadBytes = new TextEncoder().encode(JSON.stringify({
        ...content,
        generated_at: generatedAt,
        content_sha256: contentSha256,
      }));
      const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", signingKey, payloadBytes));
      const envelope = JSON.stringify({
        version: 1,
        algorithm: "Ed25519",
        key_id: env.LEADERBOARD_SIGNING_KEY_ID,
        payload_b64: base64Url(payloadBytes),
        signature_b64: base64Url(signature),
      });
      objects.push({
        objectKey,
        body: envelope,
        metadata: {
          contentType: "application/json; charset=utf-8",
          cacheControl: "public, max-age=60, stale-if-error=86400",
          contentSha256,
          generatedAt,
        },
      });
    } catch (error) {
      return new Response(error instanceof Error ? error.message : "Invalid publish request", { status: 400 });
    }
  }
  const write = await writePublicObjects(env, objects);
  if (write.response) return write.response;
  return new Response(JSON.stringify({ ok: true, ...write.result }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

async function publishLeaderboardAvatar(request: Request, env: Env, hashValue: string) {
  const suppliedSecret = request.headers.get("x-leaderboard-publisher-secret") || "";
  const expectedSecret = env.LEADERBOARD_PUBLISHER_SECRET || "";
  if (!suppliedSecret || !expectedSecret || !equalSecret(suppliedSecret, expectedSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!env.LEADERBOARD_REFRESH_COORDINATOR) return new Response("Publisher not configured", { status: 503 });
  if (env.LEADERBOARD_PUBLISHING_PAUSED === "true") {
    return new Response("Leaderboard optional cloud publishing is paused by the zero-dollar gate", {
      status: 503,
      headers: { "Retry-After": "3600", "Cache-Control": "no-store" },
    });
  }
  const objectKey = `v1/avatars/${hashValue}.webp`;
  if (request.method === "DELETE") {
    const response = await deletePublicObject(env, objectKey);
    if (!response.ok) return response;
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (request.method !== "PUT") return new Response("Method not allowed", { status: 405 });
  if ((request.headers.get("content-type") || "").toLowerCase() !== "image/webp") {
    return new Response("Only image/webp is accepted", { status: 415 });
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > 16 * 1024) {
    return new Response("Avatar exceeds 16 KiB", { status: 413 });
  }
  const actualHash = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
  if (actualHash !== hashValue) return new Response("Avatar hash mismatch", { status: 400 });
  const write = await writePublicObject(env, objectKey, bytes, {
    contentType: "image/webp",
    cacheControl: "public, max-age=31536000, immutable",
    contentSha256: hashValue,
  });
  if (write.response) return write.response;
  return new Response(JSON.stringify({ ok: true, unchanged: write.unchanged }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

async function publishStaticFeed(request: Request, env: Env, feed: "plan-market" | "codex-reset", cache: CacheLike, expectedETag?: string) {
  const suppliedSecret = request.headers.get("x-leaderboard-publisher-secret") || "";
  const expectedSecret = env.LEADERBOARD_PUBLISHER_SECRET || "";
  if (!suppliedSecret || !expectedSecret || !equalSecret(suppliedSecret, expectedSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (env.LEADERBOARD_PUBLISHING_PAUSED === "true") {
    return zeroDollarGateResponse("Static feed publishing is paused by the zero-dollar gate", 503);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength < 2 || bytes.byteLength > 512 * 1024) {
    return new Response("Invalid signed feed size", { status: 413 });
  }
  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return new Response("Invalid signed feed", { status: 400 });
  }
  const commonEnvelopeValid = envelope.version === 1
    && typeof envelope.payload_b64 === "string"
    && typeof envelope.signature_b64 === "string";
  const feedSpecificEnvelopeValid = feed === "codex-reset"
    ? envelope.algorithm === undefined && envelope.key_id === undefined
    : envelope.algorithm === "Ed25519" && typeof envelope.key_id === "string";
  if (!commonEnvelopeValid || !feedSpecificEnvelopeValid) {
    return new Response("Invalid signed feed", { status: 400 });
  }
  const canonicalBody = JSON.stringify(envelope);
  const contentSha256 = hex(new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalBody),
  )));
  const objectKey = `v1/${feed}/feed.json`;
  const write = await writePublicObject(env, objectKey, canonicalBody, {
    contentType: "application/json; charset=utf-8",
    cacheControl: "public, max-age=300, stale-if-error=86400",
    contentSha256,
  }, expectedETag);
  if (write.response) return write.response;
  if (!write.unchanged) {
    await cache.delete?.(new Request(new URL(`/${objectKey}`, env.PUBLIC_FEED_ORIGIN)));
  }
  return new Response(JSON.stringify({ ok: true, unchanged: write.unchanged }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function runResetRefresh(env: Env, cache: CacheLike) {
  if (env.LEADERBOARD_PUBLISHING_PAUSED === 'true') throw new Error('Publishing is paused');
  if (!env.LEADERBOARD_REFRESH_COORDINATOR || !env.LEADERBOARD_SIGNING_PRIVATE_KEY_B64 || !env.LEADERBOARD_PUBLISHER_SECRET) {
    throw new Error('Reset collector is not configured');
  }
  const id = env.LEADERBOARD_REFRESH_COORDINATOR.idFromName('global');
  const stored = await env.LEADERBOARD_REFRESH_COORDINATOR.get(id).fetch(
    new Request('https://coordinator/objects/v1/codex-reset/feed.json'),
  );
  // Do not replace missing/unreadable history with an empty list.
  if (!stored.ok) throw new Error('Stored reset feed is unavailable');
  const storedEnvelope = await stored.json() as {payload_b64:string;signature_b64:string};
  const existing = await verifiedExistingAnnouncements(storedEnvelope, env.LEADERBOARD_SIGNING_PRIVATE_KEY_B64);
  const previousPayload = JSON.parse(new TextDecoder().decode(standardBase64Bytes(
    storedEnvelope.payload_b64.replace(/-/g, '+').replace(/_/g, '/'),
  )));
  const scan = {checkedPostIds: Array.isArray(previousPayload.checked_post_ids) ? previousPayload.checked_post_ids.filter((id:unknown) => typeof id === 'string' && /^[0-9]+$/.test(id)) : [], complete:true};
  const now = Date.now();
  const pending = Array.isArray(previousPayload.pending_announcements) ? previousPayload.pending_announcements : [];
  const collected = await collectResetAnnouncements([...existing, ...pending], now, scan);
  const announcements = scan.complete ? collected : existing;
  const generatedAt = scan.complete ? now : Date.parse(previousPayload.generated_at);
  const existingIds = new Set(existing.map(item => item.id));
  const pendingAnnouncements = scan.complete ? [] : collected.filter(item => !existingIds.has(item.id));
  const envelope = await signedEnvelope(announcements, env.LEADERBOARD_SIGNING_PRIVATE_KEY_B64, generatedAt, scan.checkedPostIds, pendingAnnouncements);
  const result = await publishStaticFeed(new Request('https://collector/internal/static-feed/codex-reset', {
    method: 'PUT', headers: {'x-leaderboard-publisher-secret': env.LEADERBOARD_PUBLISHER_SECRET},
    body: JSON.stringify(envelope),
  }), env, 'codex-reset', cache, stored.headers.get('ETag') || undefined);
  if (!result.ok) throw new Error('Reset feed publication failed');
  return {ok:true, complete:scan.complete, announcements:announcements.length, generated_at:new Date(generatedAt).toISOString(), latest:announcements[0]?.published_at ?? null};
}

export async function runScheduledRefresh(
  scheduledTime: number,
  env: Env,
  forcedMode?: "scheduler" | "daily-reconcile",
) {
  if (env.LEADERBOARD_PUBLISHING_PAUSED === "true") return;
  if (!env.LEADERBOARD_REFRESH_URL || !env.LEADERBOARD_SCHEDULER_SECRET) {
    throw new Error("Leaderboard refresh scheduler is not configured");
  }
  const scheduled = new Date(scheduledTime);
  const mode = forcedMode || (
    scheduled.getUTCHours() === 16 && scheduled.getUTCMinutes() === 5
      ? "daily-reconcile"
      : "scheduler"
  );
  const response = await fetch(env.LEADERBOARD_REFRESH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-leaderboard-scheduler-secret": env.LEADERBOARD_SCHEDULER_SECRET,
    },
    body: JSON.stringify({ mode }),
  });
  if (!response.ok) throw new Error(`Leaderboard refresh failed with HTTP ${response.status}`);
  return response.json().catch(() => ({}));
}

export class LeaderboardRefreshCoordinator {
  private state: { storage: DurableObjectStorageLike };
  private env: Env;
  private publicObjectMemory = new Map<string, StoredPublicObject>();

  constructor(state: { storage: DurableObjectStorageLike }, env: Env) {
    this.state = state;
    this.env = env;
  }

  private async reserveDailyDurableUsage(requests: number, writes: number) {
    const day = new Date().toISOString().slice(0, 10);
    const current = await this.state.storage.get<{
      day: string;
      requests: number;
      writes: number;
    }>("durableDailyBudget");
    const existing = current?.day === day ? current : { day, requests: 0, writes: 0 };
    const next = {
      day,
      requests: existing.requests + requests,
      writes: existing.writes + writes,
    };
    const requestWarning = codeLockedLimit(
      this.env.LEADERBOARD_DO_DAILY_REQUEST_WARNING_LIMIT,
      DEFAULT_DO_DAILY_WARNING_LIMIT,
    );
    const requestStop = codeLockedLimit(
      this.env.LEADERBOARD_DO_DAILY_REQUEST_STOP_LIMIT,
      DEFAULT_DO_DAILY_STOP_LIMIT,
    );
    const writeWarning = codeLockedLimit(
      this.env.LEADERBOARD_DO_DAILY_WRITE_WARNING_LIMIT,
      DEFAULT_DO_DAILY_WARNING_LIMIT,
    );
    const writeStop = codeLockedLimit(
      this.env.LEADERBOARD_DO_DAILY_WRITE_STOP_LIMIT,
      DEFAULT_DO_DAILY_STOP_LIMIT,
    );
    if (next.requests > requestStop || next.writes > writeStop) {
      return { allowed: false, warning: true, next };
    }
    await this.state.storage.put("durableDailyBudget", next);
    return {
      allowed: true,
      warning: next.requests >= requestWarning || next.writes >= writeWarning,
      next,
    };
  }

  async fetch(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url);
    if (requestUrl.pathname === "/objects-batch") {
      if (request.method !== "PUT") return new Response("Method not allowed", { status: 405 });
      if (this.env.LEADERBOARD_PUBLISHING_PAUSED === "true") {
        return zeroDollarGateResponse("Object publishing is paused", 503);
      }
      const payload = await request.json().catch(() => null) as {
        objects?: Array<{ objectKey?: unknown; body?: unknown; metadata?: Partial<StoredPublicObject> }>;
      } | null;
      if (!Array.isArray(payload?.objects) || payload.objects.length < 1 || payload.objects.length > 285) {
        return new Response("Invalid object batch", { status: 400 });
      }
      const seen = new Set<string>();
      const changed: Array<{ storageKey: string; objectKey: string; value: StoredPublicObject }> = [];
      let unchanged = 0;
      for (const item of payload.objects) {
        const objectKey = typeof item.objectKey === "string" ? item.objectKey : "";
        const body = typeof item.body === "string" ? item.body : "";
        const metadata = item.metadata || {};
        if (!/^v1\/leaderboard\//u.test(objectKey) || !PUBLIC_OBJECT_RE.test(`/${objectKey}`)
          || seen.has(objectKey) || body.length < 2 || body.length > 512 * 1024
          || metadata.contentType !== "application/json; charset=utf-8"
          || metadata.cacheControl !== "public, max-age=60, stale-if-error=86400"
          || typeof metadata.contentSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(metadata.contentSha256)
          || typeof metadata.generatedAt !== "string") {
          return new Response("Invalid object batch", { status: 400 });
        }
        seen.add(objectKey);
        const storageKey = `${PUBLIC_OBJECT_STORAGE_PREFIX}${objectKey}`;
        const existing = this.publicObjectMemory.get(storageKey)
          ?? await this.state.storage.get<StoredPublicObject>(storageKey);
        if (existing?.contentSha256 === metadata.contentSha256) {
          unchanged += 1;
          continue;
        }
        changed.push({
          storageKey,
          objectKey,
          value: {
            body: new TextEncoder().encode(body),
            contentType: metadata.contentType,
            cacheControl: metadata.cacheControl,
            contentSha256: metadata.contentSha256,
            generatedAt: metadata.generatedAt,
          },
        });
      }
      const budget = await this.reserveDailyDurableUsage(1, 1 + changed.length);
      if (!budget.allowed) return zeroDollarGateResponse("Zero-dollar Durable Object daily hard stop reached");
      for (const item of changed) {
        await this.state.storage.put(item.storageKey, item.value);
        this.publicObjectMemory.delete(item.storageKey);
      }
      return new Response(JSON.stringify({
        ok: true,
        written: changed.length,
        unchanged,
        written_keys: changed.map((item) => item.objectKey),
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          ...(budget.warning ? { "X-Token-Eyes-Zero-Dollar-Gate": "warning" } : {}),
        },
      });
    }
    if (requestUrl.pathname.startsWith("/objects/")) {
      const objectKey = requestUrl.pathname.slice("/objects/".length);
      if (!PUBLIC_OBJECT_RE.test(`/${objectKey}`)) return new Response("Invalid object key", { status: 400 });
      const storageKey = `${PUBLIC_OBJECT_STORAGE_PREFIX}${objectKey}`;
      const memoryExisting = this.publicObjectMemory.get(storageKey);
      const existing = memoryExisting ?? await this.state.storage.get<StoredPublicObject>(storageKey);
      if (request.method === "GET") {
        const budget = await this.reserveDailyDurableUsage(1, 1);
        if (!budget.allowed) return zeroDollarGateResponse("Zero-dollar Durable Object daily hard stop reached");
        if (!existing) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
        if (!memoryExisting) this.publicObjectMemory.set(storageKey, existing);
        return new Response(existing.body, {
          status: 200,
          headers: {
            "Content-Type": existing.contentType,
            "Cache-Control": existing.cacheControl,
            ETag: `"${existing.contentSha256}"`,
            "X-Object-Cache": memoryExisting ? "HIT" : "MISS",
            ...(existing.generatedAt ? { "X-Object-Generated-At": existing.generatedAt } : {}),
            ...(budget.warning ? { "X-Token-Eyes-Zero-Dollar-Gate": "warning" } : {}),
          },
        });
      }
      if (request.method === "PUT") {
        if (this.env.LEADERBOARD_PUBLISHING_PAUSED === "true") {
          return zeroDollarGateResponse("Object publishing is paused", 503);
        }
        const contentSha256 = request.headers.get("x-object-content-sha256") || "";
        const contentType = request.headers.get("content-type") || "application/octet-stream";
        const cacheControl = request.headers.get("x-object-cache-control") || "public, max-age=60";
        if (!/^[a-f0-9]{64}$/u.test(contentSha256)) return new Response("Invalid object hash", { status: 400 });
        const unchanged = existing?.contentSha256 === contentSha256;
        const budget = await this.reserveDailyDurableUsage(1, unchanged ? 1 : 2);
        if (!budget.allowed) return zeroDollarGateResponse("Zero-dollar Durable Object daily hard stop reached");
        if (!unchanged) {
          const body = new Uint8Array(await request.arrayBuffer());
          const expected = request.headers.get('If-Match');
          if (expected) {
            const current = await this.state.storage.get<StoredPublicObject>(storageKey);
            if (expected !== `"${current?.contentSha256}"`) return new Response('Feed changed during collection', {status:412});
          }
          await this.state.storage.put(storageKey, {
            body,
            contentType,
            cacheControl,
            contentSha256,
            generatedAt: request.headers.get("x-object-generated-at") || undefined,
          } satisfies StoredPublicObject);
          this.publicObjectMemory.delete(storageKey);
        }
        return new Response(JSON.stringify({ ok: true, unchanged }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            ...(budget.warning ? { "X-Token-Eyes-Zero-Dollar-Gate": "warning" } : {}),
          },
        });
      }
      if (request.method === "DELETE") {
        if (this.env.LEADERBOARD_PUBLISHING_PAUSED === "true") {
          return zeroDollarGateResponse("Object publishing is paused", 503);
        }
        const budget = await this.reserveDailyDurableUsage(1, existing ? 2 : 1);
        if (!budget.allowed) return zeroDollarGateResponse("Zero-dollar Durable Object daily hard stop reached");
        if (existing) await this.state.storage.delete(storageKey);
        this.publicObjectMemory.delete(storageKey);
        return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
      }
      return new Response("Method not allowed", { status: 405 });
    }
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (this.env.LEADERBOARD_PUBLISHING_PAUSED === "true") {
      return new Response("Leaderboard optional cloud publishing is paused", { status: 503 });
    }
    if (requestUrl.pathname !== "/mark" && requestUrl.pathname !== "/daily") {
      return new Response("Not found", { status: 404 });
    }
    const dailyBudget = await this.reserveDailyDurableUsage(1, 3);
    if (!dailyBudget.allowed) {
      return zeroDollarGateResponse("Zero-dollar Durable Object daily hard stop reached");
    }
    if (requestUrl.pathname === "/daily") {
      await this.state.storage.put("pendingDailyReconciliation", true);
    }
    const now = Date.now();
    const [lastSuccessfulRefreshAt, existingAlarm] = await Promise.all([
      this.state.storage.get<number>("lastSuccessfulRefreshAt"),
      this.state.storage.getAlarm(),
    ]);
    const scheduledFor = Math.max(
      now,
      (Number(lastSuccessfulRefreshAt) || 0) + REFRESH_COOLDOWN_MS,
    );
    if (existingAlarm === null || existingAlarm > scheduledFor) {
      await this.state.storage.setAlarm(scheduledFor);
    }
    return new Response(JSON.stringify({ ok: true, scheduled_for: scheduledFor }), {
      status: 202,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...(dailyBudget.warning ? { "X-Token-Eyes-Zero-Dollar-Gate": "warning" } : {}),
      },
    });
  }

  async alarm(): Promise<void> {
    if (this.env.LEADERBOARD_PUBLISHING_PAUSED === "true") return;
    const dailyBudget = await this.reserveDailyDurableUsage(1, 3);
    if (!dailyBudget.allowed) return;
    const daily = await this.state.storage.get<boolean>("pendingDailyReconciliation");
    await runScheduledRefresh(
      Date.now(),
      this.env,
      daily === true ? "daily-reconcile" : "scheduler",
    );
    await this.state.storage.put("lastSuccessfulRefreshAt", Date.now());
    if (daily === true) await this.state.storage.put("pendingDailyReconciliation", false);
  }
}

async function triggerDurableRefresh(request: Request, env: Env) {
  const suppliedSecret = request.headers.get("x-leaderboard-dirty-secret") || "";
  const expectedSecret = env.LEADERBOARD_DIRTY_TRIGGER_SECRET || "";
  if (!suppliedSecret || !expectedSecret || !equalSecret(suppliedSecret, expectedSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!env.LEADERBOARD_REFRESH_COORDINATOR) {
    return new Response("Refresh coordinator not configured", { status: 503 });
  }
  const id = env.LEADERBOARD_REFRESH_COORDINATOR.idFromName("global");
  return env.LEADERBOARD_REFRESH_COORDINATOR.get(id).fetch(
    new Request("https://coordinator/mark", { method: "POST" }),
  );
}

function withCacheHeaders(response: Response, value: string, cacheStatus: string) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", value);
  headers.set("X-Token-Eyes-Cache", cacheStatus);
  return new Response(response.body, { status: response.status, headers });
}

function withPublicCors(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  headers.set("Access-Control-Expose-Headers", "ETag, X-Token-Eyes-Cache");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  return new Response(response.body, { status: response.status, headers });
}

async function servePublicObject(request: Request, env: Env, dependencies: HandlerDependencies) {
  if (!env.LEADERBOARD_REFRESH_COORDINATOR) {
    return new Response("Public object store is not configured", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const publicPath = new URL(request.url).pathname;
  const globallyCoherentJson = publicPath.endsWith(".json");
  if (!globallyCoherentJson && !dependencies.bypassFreshCache) {
    const cached = await dependencies.cache.match(request);
    if (cached) return withCacheHeaders(cached, cached.headers.get("cache-control") || "public, max-age=60", "HIT");
  }
  try {
    const id = env.LEADERBOARD_REFRESH_COORDINATOR.idFromName("global");
    const response = await env.LEADERBOARD_REFRESH_COORDINATOR.get(id).fetch(
      new Request(`https://coordinator/objects${publicPath}`, { method: "GET" }),
    );
    if (!response.ok) {
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "no-store");
      return new Response(response.body, { status: response.status, headers });
    }
    const result = withCacheHeaders(
      response,
      globallyCoherentJson
        ? "public, max-age=0, must-revalidate"
        : response.headers.get("cache-control") || "public, max-age=60",
      globallyCoherentJson ? response.headers.get("x-object-cache") || "MISS" : "MISS",
    );
    if (!globallyCoherentJson) dependencies.waitUntil(dependencies.cache.put(request, result.clone()));
    return result;
  } catch {
    return new Response("Public object store is unavailable", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

export function createHandler(dependencies: HandlerDependencies) {
  return async function handle(request: Request, env: Env): Promise<Response> {
    const requestUrl = new URL(request.url);
    if (requestUrl.pathname === '/internal/codex-reset/refresh') {
      if (request.method !== 'POST') return new Response('Method not allowed', {status:405});
      const secret = request.headers.get('x-leaderboard-publisher-secret') || '';
      if (!secret || !env.LEADERBOARD_PUBLISHER_SECRET || !equalSecret(secret, env.LEADERBOARD_PUBLISHER_SECRET)) {
        return new Response('Unauthorized', {status:401});
      }
      try { return Response.json(await runResetRefresh(env, dependencies.cache)); }
      catch (error) {
        console.error('Reset collection failed', error instanceof Error ? error.message : 'unknown');
        return Response.json({ok:false,error:'Reset collection failed; previous verified feed retained'}, {status:502});
      }
    }
    const internalAvatar = requestUrl.pathname.match(INTERNAL_AVATAR_RE);
    if (internalAvatar) return publishLeaderboardAvatar(request, env, internalAvatar[1]);
    if (requestUrl.pathname === PUBLISH_PATH) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      return publishLeaderboardSnapshots(request, env);
    }
    const staticFeed = requestUrl.pathname.match(STATIC_FEED_UPLOAD_RE);
    if (staticFeed) {
      if (request.method !== "PUT") return new Response("Method not allowed", { status: 405 });
      return publishStaticFeed(request, env, staticFeed[1] as "plan-market" | "codex-reset", dependencies.cache);
    }
    if (requestUrl.pathname === DIRTY_TRIGGER_PATH) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      return triggerDurableRefresh(request, env);
    }
    if (PUBLIC_OBJECT_RE.test(requestUrl.pathname)) {
      if (request.method === "OPTIONS" && !requestUrl.search) {
        return withPublicCors(new Response(null, {
          status: 204,
          headers: { "Access-Control-Max-Age": "86400", "Cache-Control": "public, max-age=86400" },
        }));
      }
      if (request.method !== "GET") {
        return withPublicCors(new Response("Method not allowed", { status: 405 }));
      }
      if (requestUrl.search) {
        return withPublicCors(new Response("Invalid public object query", { status: 400 }));
      }
      return withPublicCors(await servePublicObject(request, env, dependencies));
    }
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }
    if (requestUrl.pathname !== "/leaderboard") {
      return new Response("Not found", { status: 404 });
    }

    for (const key of requestUrl.searchParams.keys()) {
      if (!LEADERBOARD_QUERY_KEYS.has(key)) {
        return new Response("Invalid leaderboard query", { status: 400 });
      }
    }
    const period = (requestUrl.searchParams.get("period") || "total").trim().toLowerCase();
    const metric = (requestUrl.searchParams.get("metric") || "tokens").trim().toLowerCase();
    const source = (requestUrl.searchParams.get("source") || "all").trim().toLowerCase();
    const limit = requestUrl.searchParams.get("limit") || "50";
    const offset = requestUrl.searchParams.get("offset") || "0";
    if (!PERIODS.has(period) || !METRICS.has(metric) || !SOURCES.has(source)
      || limit !== "50" || offset !== "0" || (metric === "actual_cost" && source !== "all")) {
      return new Response("Invalid leaderboard query", { status: 400 });
    }
    const staticUrl = new URL(
      `/v1/leaderboard/${period}/${metric}/${source}.json`,
      env.PUBLIC_FEED_ORIGIN,
    );
    return new Response(null, {
      status: 308,
      headers: {
        Location: staticUrl.toString(),
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
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
  scheduled(controller: { scheduledTime: number; cron?: string }, env: Env, context: { waitUntil(promise: Promise<unknown>): void }) {
    if (controller.cron === '15 * * * *') {
      context.waitUntil(runResetRefresh(env, caches.default as unknown as CacheLike));
      return;
    }
    if (!env.LEADERBOARD_REFRESH_COORDINATOR) {
      context.waitUntil(runScheduledRefresh(controller.scheduledTime, env));
      return;
    }
    const id = env.LEADERBOARD_REFRESH_COORDINATOR.idFromName("global");
    context.waitUntil(env.LEADERBOARD_REFRESH_COORDINATOR.get(id).fetch(
      new Request("https://coordinator/daily", { method: "POST" }),
    ));
  },
};
