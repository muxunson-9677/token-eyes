import { createClient } from "npm:@insforge/sdk";

const OPENAI_STATUS_URL = "https://status.openai.com/api/v2/incidents.json";
const TAVILY_URL = "https://api.tavily.com/search";
const TAVILY_INTERVAL_MS = 60 * 60_000;
const X_WINDOW_MS = 48 * 60 * 60_000;
const X_EPOCH_MS = 1_288_834_974_657n;
const CODEX_CONCEPT = /\bcodex\b/iu;
const RESET_CONCEPT = /\b(reset|rate\s+limits?|usage\s+limits?|quota|credits?|extra\s+usage|additional\s+usage)\b|重置|额度|使用限制|额外用量|赠送额度/iu;

type Announcement = {
  id: string;
  type: "official_reset_announcement";
  title: string;
  summary: string;
  source_url: string;
  official_url: string;
  published_at: string;
  expires_at: string;
  source_author?: "thsottiaux";
  source_post_id?: string;
};

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

function tiboAnnouncement(result: Record<string, unknown>, nowMs: number): Announcement | null {
  let url: URL;
  try {
    url = new URL(String(result.url || ""));
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "x.com" || url.search || url.hash) return null;
  const match = url.pathname.match(/^\/thsottiaux\/status\/([0-9]+)\/?$/u);
  if (!match) return null;
  const text = `${String(result.title || "")} ${String(result.content || "")}`.trim();
  if (!CODEX_CONCEPT.test(text) || !RESET_CONCEPT.test(text)) return null;
  const publishedAt = xPublishedAt(match[1]);
  const publishedMs = publishedAt ? Date.parse(publishedAt) : Number.NaN;
  if (!Number.isFinite(publishedMs) || publishedMs > nowMs + 5 * 60_000 || nowMs - publishedMs > X_WINDOW_MS) return null;
  return {
    id: `x:${match[1]}`,
    type: "official_reset_announcement",
    title: String(result.title || "Tibo 发布了 Codex 额度公告").slice(0, 80),
    summary: String(result.content || "请查看 Tibo 的原帖确认适用范围。").slice(0, 240),
    source_url: `https://x.com/thsottiaux/status/${match[1]}`,
    official_url: "https://chatgpt.com/codex",
    published_at: publishedAt,
    expires_at: new Date(publishedMs + X_WINDOW_MS).toISOString(),
    source_author: "thsottiaux",
    source_post_id: match[1],
  };
}

function statusAnnouncement(incident: Record<string, unknown>, nowMs: number): Announcement | null {
  const text = `${String(incident.name || "")} ${String(incident.incident_updates || "")}`;
  if (!CODEX_CONCEPT.test(text) || !RESET_CONCEPT.test(text)) return null;
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
    source_url: sourceUrl,
    official_url: "https://status.openai.com/",
    published_at: new Date(publishedMs).toISOString(),
    expires_at: new Date(publishedMs + X_WINDOW_MS).toISOString(),
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
    .select("envelope,last_openai_checked_at,last_tavily_checked_at")
    .eq("singleton", true)
    .maybeSingle();

  const nowMs = Date.now();
  const announcements = decodeBase64UrlJson(current?.envelope?.payload_b64)
    .filter((item) => Date.parse(item.expires_at) > nowMs);
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

  const tavilyKey = Deno.env.get("TAVILY_API_KEY") || "";
  const lastTavilyMs = Date.parse(String(current?.last_tavily_checked_at || ""));
  const tavilyDue = !Number.isFinite(lastTavilyMs) || nowMs - lastTavilyMs >= TAVILY_INTERVAL_MS;
  let tavilyStatus = tavilyKey ? "not_due" : "not_configured";
  let lastTavilyCheckedAt = current?.last_tavily_checked_at || null;
  if (tavilyKey && tavilyDue) {
    tavilyStatus = "ok";
    lastTavilyCheckedAt = new Date(nowMs).toISOString();
    try {
      const response = await fetch(TAVILY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: tavilyKey,
          query: "site:x.com/thsottiaux/status Codex reset quota credits usage limit",
          topic: "general",
          search_depth: "basic",
          include_domains: ["x.com"],
          max_results: 10,
          days: 2,
        }),
      });
      if (!response.ok) throw new Error("search request failed");
      const body = await response.json();
      for (const result of Array.isArray(body?.results) ? body.results : []) {
        const item = tiboAnnouncement(result, nowMs);
        if (item) announcements.push(item);
      }
    } catch {
      tavilyStatus = "unavailable";
    }
  }

  const unique = [...new Map(announcements.map((item) => [item.id, item])).values()]
    .sort((left, right) => Date.parse(right.published_at) - Date.parse(left.published_at))
    .slice(0, 20);
  const envelope = await signedEnvelope(unique, signingKey, nowMs);
  const { error } = await client.database
    .from("tokentracker_codex_reset_feed_state")
    .upsert({
      singleton: true,
      envelope,
      last_openai_checked_at: new Date(nowMs).toISOString(),
      last_tavily_checked_at: lastTavilyCheckedAt,
      updated_at: new Date(nowMs).toISOString(),
    }, { onConflict: "singleton" });
  if (error) return json({ error: error.message || "feed update failed" }, 500);
  return json({ ok: true, announcements: unique.length, openai_status: openaiStatus, tavily_status: tavilyStatus });
}
