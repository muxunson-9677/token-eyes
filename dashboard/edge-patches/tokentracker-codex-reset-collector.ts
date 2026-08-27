import { createClient } from "npm:@insforge/sdk";

const OPENAI_STATUS_URL = "https://status.openai.com/api/v2/incidents.json";
const FXTWITTER_URL = "https://api.fxtwitter.com/2/profile/thsottiaux/statuses";
const X_OEMBED_URL = "https://publish.x.com/oembed";
const X_WINDOW_MS = 30 * 24 * 60 * 60_000;
const ANNOUNCEMENT_RETENTION_MS = 30 * 24 * 60 * 60_000;
const MAX_X_PAGES = 12;
const X_EPOCH_MS = 1_288_834_974_657n;
const CODEX_CONCEPT = /\bcodex\b/iu;
const RESET_CONCEPT = /\b(reset|rate\s+limits?|usage\s+limits?|quota|credits?|extra\s+usage|additional\s+usage)\b|重置|额度|使用限制|额外用量|赠送额度/iu;
const CONFIRMED_RESET_CONCEPT = /\b(?:i(?:'ve| have)\s+reset|we(?:'ve| have)\s+reset|usage\s+limits?\s+(?:have\s+been|were)\s+reset|banked\s+reset\s+has\s+landed|reset\s+has\s+been\s+propagated|reset\s+is\s+(?:live|complete))\b/iu;
const SCHEDULED_RESET_CONCEPT = /\b(?:reset\s+will\s+be|will\s+(?:be\s+)?reset|will\s+reset|going\s+to\s+reset|reset\s+(?:is\s+)?(?:coming|scheduled)|tomorrow[\s\S]{0,60}\breset)\b/iu;
const RESET_CONFIRMATION_CORRELATION_MS = 6 * 60 * 60_000;
type ResetKind = "hard" | "banked" | "mixed" | "unknown";
type ResetScope = "all_paid_users" | "all_codex_work_users" | "unknown";

type Announcement = {
  id: string;
  type: "official_reset_announcement";
  title: string;
  summary: string;
  body?: string;
  announcement_state?: "confirmed";
  source_url: string;
  official_url: string;
  published_at: string;
  expires_at: string;
  source_author?: "thsottiaux";
  source_post_id?: string;
  reset_kind: ResetKind;
  reset_scope: ResetScope;
};

function classifyResetKind(text: string): ResetKind {
  const normalized = String(text || "").replace(/&#39;/gu, "'").toLowerCase();
  const banked = /\bbanked\s+reset\b/u.test(normalized);
  const hard = (
    /\b(?:reset|resetting|reset of)\s+(?:your\s+|the\s+)?usage\s+limits?\b/u.test(normalized)
    || /\busage\s+limits?\s+(?:have\s+been\s+|are\s+|were\s+)?reset\b/u.test(normalized)
    || /\b(?:full|another|new)\s+reset\b/u.test(normalized)
  );
  if (hard && banked) return "mixed";
  if (hard) return "hard";
  if (banked) return "banked";
  return "unknown";
}

function classifyResetScope(text: string): ResetScope {
  const normalized = String(text || "").replace(/&#39;/gu, "'").toLowerCase();
  if (/\ball\s+paid\s+(?:codex\s+)?users\b/u.test(normalized)) return "all_paid_users";
  if (
    /\ball\s+(?:chatgpt\s+work\s+and\s+codex|codex\s+and\s+chatgpt\s+work)\s+users\b/u.test(normalized)
    || /\bfor\s+(?:chatgpt\s+work\s+and\s+codex|codex\s+and\s+chatgpt\s+work)\b/u.test(normalized)
  ) return "all_codex_work_users";
  return "unknown";
}

function enrichAnnouncement(item: Announcement): Announcement {
  const fullText = item.body || item.summary;
  return {
    ...item,
    reset_kind: classifyResetKind(fullText),
    reset_scope: classifyResetScope(fullText),
  };
}

function isConfirmedRetainedAnnouncement(item: Announcement) {
  if (item.source_author !== "thsottiaux") return true;
  return item.announcement_state === "confirmed"
    || CONFIRMED_RESET_CONCEPT.test(item.body || item.summary);
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

function decodeBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeBase64UrlJson(value: unknown): Announcement[] {
  if (typeof value !== "string") return [];
  try {
    const padded = value.replace(/-/gu, "+").replace(/_/gu, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const bytes = decodeBase64(padded);
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return Array.isArray(parsed?.announcements) ? parsed.announcements : [];
  } catch {
    return [];
  }
}

function xPublishedAt(postId: string) {
  try {
    const timestamp = Number((BigInt(postId) >> 22n) + X_EPOCH_MS);
    return Number.isSafeInteger(timestamp) ? new Date(timestamp).toISOString() : null;
  } catch {
    return null;
  }
}

function tiboCandidate(result: Record<string, unknown>, nowMs: number) {
  let url: URL;
  try {
    url = new URL(String(result.url || ""));
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "x.com" || url.search || url.hash) return null;
  const match = url.pathname.match(/^\/thsottiaux\/status\/([0-9]+)\/?$/u);
  if (!match) return null;
  const author = result.author && typeof result.author === "object"
    ? result.author as Record<string, unknown>
    : {};
  if (
    String(author.screen_name || "") !== "thsottiaux"
    || String(author.url || "") !== "https://x.com/thsottiaux"
  ) {
    return null;
  }
  const text = String(result.text || "").trim();
  const state = CONFIRMED_RESET_CONCEPT.test(text)
    ? "confirmed"
    : SCHEDULED_RESET_CONCEPT.test(text)
      ? "scheduled"
      : null;
  if (!text || text.length > 4_000 || !RESET_CONCEPT.test(text) || !state) return null;
  const publishedAt = xPublishedAt(match[1]);
  const publishedMs = publishedAt ? Date.parse(publishedAt) : Number.NaN;
  if (!Number.isFinite(publishedMs) || publishedMs > nowMs + 5 * 60_000 || nowMs - publishedMs > X_WINDOW_MS) return null;
  return {
    postId: match[1],
    text,
    publishedAt,
    publishedMs,
    state,
    hasCodexContext: CODEX_CONCEPT.test(text),
  };
}

function correlateTiboResetPosts(
  candidates: Array<NonNullable<ReturnType<typeof tiboCandidate>>>,
) {
  const ordered = [...candidates].sort((left, right) => left.publishedMs - right.publishedMs);
  const scheduled = ordered.filter((candidate) => (
    candidate.state === "scheduled" && candidate.hasCodexContext
  ));
  return ordered.flatMap((candidate) => {
    if (candidate.state !== "confirmed") return [];
    if (candidate.hasCodexContext) {
      return [{ ...candidate, contextText: candidate.text }];
    }
    const context = [...scheduled].reverse().find((scheduledPost) => {
      const delay = candidate.publishedMs - scheduledPost.publishedMs;
      return delay >= 0 && delay <= RESET_CONFIRMATION_CORRELATION_MS;
    });
    return context
      ? [{ ...candidate, contextText: `${context.text}\n${candidate.text}` }]
      : [];
  });
}

async function verifyTiboAnnouncement(
  candidate: ReturnType<typeof correlateTiboResetPosts>[number],
): Promise<Announcement | null> {
  if (candidate.state !== "confirmed") return null;
  const sourceUrl = `https://x.com/thsottiaux/status/${candidate.postId}`;
  const oembedUrl = new URL(X_OEMBED_URL);
  oembedUrl.searchParams.set("omit_script", "true");
  oembedUrl.searchParams.set("dnt", "true");
  oembedUrl.searchParams.set("url", sourceUrl);
  const response = await fetch(oembedUrl, { headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  const verified = await response.json();
  const verifiedText = String(verified?.html || "");
  if (
    verified?.url !== sourceUrl
    || verified?.author_url !== "https://x.com/thsottiaux"
    || verified?.provider_name !== "X"
    || !RESET_CONCEPT.test(verifiedText)
    || !CONFIRMED_RESET_CONCEPT.test(verifiedText.replace(/&#39;/gu, "'"))
  ) {
    return null;
  }
  return {
    id: `x:${candidate.postId}`,
    type: "official_reset_announcement",
    title: "Codex 官方额外重置",
    summary: candidate.text.slice(0, 240),
    body: candidate.text,
    announcement_state: "confirmed",
    source_url: sourceUrl,
    official_url: "https://chatgpt.com/codex",
    published_at: candidate.publishedAt,
    expires_at: new Date(candidate.publishedMs + ANNOUNCEMENT_RETENTION_MS).toISOString(),
    source_author: "thsottiaux",
    source_post_id: candidate.postId,
    reset_kind: classifyResetKind(candidate.contextText),
    reset_scope: classifyResetScope(candidate.contextText),
  };
}

async function fetchTiboResults(nowMs: number) {
  const results: Array<Record<string, unknown>> = [];
  const seenCursors = new Set<string>();
  const cutoffMs = nowMs - X_WINDOW_MS;
  let cursor = "";

  for (let page = 0; page < MAX_X_PAGES; page += 1) {
    const url = new URL(FXTWITTER_URL);
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("discovery request failed");
    const body = await response.json();
    const pageResults = Array.isArray(body?.results) ? body.results : [];
    results.push(...pageResults);

    const publishedTimes = pageResults
      .map((result: Record<string, unknown>) => {
        const match = String(result?.url || "").match(/\/status\/([0-9]+)$/u);
        const publishedAt = match ? xPublishedAt(match[1]) : null;
        return publishedAt ? Date.parse(publishedAt) : Number.NaN;
      })
      .filter((value: number) => Number.isFinite(value));
    if (publishedTimes.length > 0 && Math.min(...publishedTimes) <= cutoffMs) break;

    const nextCursor = String(body?.cursor?.bottom || "");
    if (!nextCursor || seenCursors.has(nextCursor)) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return results;
}

function statusAnnouncement(incident: Record<string, unknown>, nowMs: number): Announcement | null {
  const text = `${String(incident.name || "")} ${String(incident.incident_updates || "")}`;
  if (
    !CODEX_CONCEPT.test(text)
    || !RESET_CONCEPT.test(text)
    || !CONFIRMED_RESET_CONCEPT.test(text)
  ) return null;
  const publishedMs = Date.parse(String(incident.created_at || incident.started_at || ""));
  if (!Number.isFinite(publishedMs) || nowMs - publishedMs > X_WINDOW_MS) return null;
  const incidentId = String(incident.id || "");
  if (!/^[a-zA-Z0-9]+$/u.test(incidentId)) return null;
  const sourceUrl = `https://status.openai.com/incidents/${incidentId}`;
  return {
    id: `status:${incidentId.toLowerCase()}`,
    type: "official_reset_announcement",
    title: String(incident.name || "OpenAI Codex 状态公告").slice(0, 80),
    summary: "OpenAI 状态页发布了 Codex 额度或限制相关公告，请打开官方页面确认。",
    body: String(incident.name || "OpenAI Codex 状态公告").slice(0, 4_000),
    source_url: sourceUrl,
    official_url: "https://status.openai.com/",
    published_at: new Date(publishedMs).toISOString(),
    expires_at: new Date(publishedMs + ANNOUNCEMENT_RETENTION_MS).toISOString(),
    reset_kind: classifyResetKind(text),
    reset_scope: classifyResetScope(text),
  };
}

async function signedEnvelope(announcements: Announcement[], privateKeyBase64: string, nowMs: number) {
  const payload = new TextEncoder().encode(JSON.stringify({
    generated_at: new Date(nowMs).toISOString(),
    announcements,
  }));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    decodeBase64(privateKeyBase64),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", key, payload));
  return { version: 1, payload_b64: base64Url(payload), signature_b64: base64Url(signature) };
}

export default async function (request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const schedulerSecret = Deno.env.get("LEADERBOARD_SCHEDULER_SECRET") || "";
  if (!schedulerSecret || request.headers.get("Authorization") !== `Bearer ${schedulerSecret}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  const baseUrl = Deno.env.get("INSFORGE_BASE_URL");
  const serviceKey = Deno.env.get("API_KEY");
  const signingKey = Deno.env.get("CODEX_RESET_SIGNING_KEY_PKCS8_B64");
  if (!baseUrl || !serviceKey || !signingKey) return json({ error: "server misconfigured" }, 500);
  const client = createClient({ baseUrl, edgeFunctionToken: serviceKey });
  const { data: current } = await client.database
    .from("tokentracker_codex_reset_feed_state")
    .select("envelope,last_openai_checked_at")
    .eq("singleton", true)
    .maybeSingle();

  const nowMs = Date.now();
  const announcements = decodeBase64UrlJson(current?.envelope?.payload_b64)
    .filter((item) => Date.parse(item.expires_at) > nowMs)
    .filter(isConfirmedRetainedAnnouncement)
    .map(enrichAnnouncement);
  let openaiStatus = "ok";
  try {
    const response = await fetch(OPENAI_STATUS_URL, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("status request failed");
    const body = await response.json();
    for (const incident of Array.isArray(body?.incidents) ? body.incidents : []) {
      const item = statusAnnouncement(incident, nowMs);
      if (item) announcements.push(item);
    }
  } catch {
    openaiStatus = "unavailable";
  }

  let xStatus = "ok";
  try {
    const knownPostIds = new Set(
      announcements.map((item) => item.source_post_id).filter(Boolean),
    );
    const candidates = correlateTiboResetPosts(
      (await fetchTiboResults(nowMs))
        .map((result) => tiboCandidate(result, nowMs))
        .filter((candidate): candidate is NonNullable<ReturnType<typeof tiboCandidate>> => Boolean(candidate)),
    );
    for (const candidate of candidates) {
      if (knownPostIds.has(candidate.postId)) continue;
      const item = await verifyTiboAnnouncement(candidate);
      if (item) {
        announcements.push(item);
        knownPostIds.add(candidate.postId);
      }
    }
  } catch {
    xStatus = "unavailable";
  }

  const unique = [...new Map(announcements.map((item) => [item.id, item])).values()]
    .sort((left, right) => Date.parse(right.published_at) - Date.parse(left.published_at))
    .slice(0, 100);
  const envelope = await signedEnvelope(unique, signingKey, nowMs);
  const { error } = await client.database
    .from("tokentracker_codex_reset_feed_state")
    .upsert({
      singleton: true,
      envelope,
      last_openai_checked_at: new Date(nowMs).toISOString(),
      updated_at: new Date(nowMs).toISOString(),
    }, { onConflict: "singleton" });
  if (error) return json({ error: error.message || "feed update failed" }, 500);
  return json({ ok: true, announcements: unique.length, openai_status: openaiStatus, x_status: xStatus });
}
