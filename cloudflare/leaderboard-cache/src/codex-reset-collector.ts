const FXTWITTER_URL = "https://api.fxtwitter.com/2/profile/thsottiaux/statuses";
const X_OEMBED_URL = "https://publish.x.com/oembed";
const X_WINDOW_MS = 30 * 24 * 60 * 60_000;
const ANNOUNCEMENT_RETENTION_MS = 30 * 24 * 60 * 60_000;
const MAX_X_PAGES = 12;
const X_EPOCH_MS = 1_288_834_974_657n;
const CODEX_CONCEPT = /\bcodex\b|^Hi Astra users\b/iu;
const RESET_CONCEPT = /\b(reset|rate\s+limits?|usage\s+limits?|quota|credits?|extra\s+usage|additional\s+usage)\b|重置|额度|使用限制|额外用量|赠送额度/iu;
const CONFIRMED_RESET_CONCEPT = /\breset\s+all\s+propagated\b|\b(?:i(?:'ve| have)\s+reset|we(?:'ve| have)\s+reset|usage\s+limits?\s+(?:have\s+been|were)\s+reset|banked\s+reset\s+has\s+landed|reset\s+has\s+been\s+propagated|reset\s+is\s+(?:live|complete))\b/iu;
const SCHEDULED_RESET_CONCEPT = /\breset\s+is\s+(?:also\s+)?landing\b|\b(?:reset\s+will\s+be|will\s+(?:be\s+)?reset|will\s+reset|going\s+to\s+reset|reset\s+(?:is\s+)?(?:coming|scheduled)|tomorrow[\s\S]{0,60}\breset)\b/iu;
const QUOTED_RESET_CONFIRMATION_MAX_MS = 24 * 60 * 60_000;
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
  if (/\ball\s+paid\s+(?:(?:codex\s+)?users|subscriptions)\b/u.test(normalized)) return "all_paid_users";
  if (
    /\ball\s+(?:chatgpt\s+work\s+and\s+codex|codex\s+and\s+chatgpt\s+work)\s+users\b/u.test(normalized)
    || /\bfor\s+(?:chatgpt\s+work\s+and\s+codex|codex\s+and\s+chatgpt\s+work)\b/u.test(normalized)
  ) return "all_codex_work_users";
  return "unknown";
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

export function tiboCandidate(result: Record<string, unknown>, nowMs: number) {
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
  const quote = result.quote && typeof result.quote === "object"
    ? result.quote as Record<string, unknown>
    : {};
  const quotedPostId = /^[0-9]+$/u.test(String(quote.id || ""))
    ? String(quote.id)
    : null;
  return {
    postId: match[1],
    text,
    publishedAt,
    publishedMs,
    state,
    hasCodexContext: CODEX_CONCEPT.test(text),
    quotedPostId,
  };
}

export function correlateTiboResetPosts(
  candidates: Array<NonNullable<ReturnType<typeof tiboCandidate>>>,
) {
  const ordered = [...candidates].sort((left, right) => left.publishedMs - right.publishedMs);
  const scheduled = ordered.filter((candidate) => (
    candidate.state === "scheduled" && candidate.hasCodexContext
  ));
  const scheduledByPostId = new Map(scheduled.map((candidate) => [candidate.postId, candidate]));
  return ordered.flatMap((candidate) => {
    if (candidate.state !== "confirmed") return [];
    if (candidate.hasCodexContext) {
      return [{ ...candidate, contextCandidate: null }];
    }
    const quotedContext = candidate.quotedPostId
      ? scheduledByPostId.get(candidate.quotedPostId)
      : null;
    const quotedDelay = quotedContext
      ? candidate.publishedMs - quotedContext.publishedMs
      : Number.NaN;
    const boundedQuotedContext = quotedContext
      && quotedDelay >= 0
      && quotedDelay <= QUOTED_RESET_CONFIRMATION_MAX_MS
      ? quotedContext
      : null;
    return boundedQuotedContext
      ? [{ ...candidate, contextCandidate: boundedQuotedContext }]
      : [];
  });
}

function decodeXHtmlText(value: string) {
  return String(value || "")
    .replace(/<br\s*\/?\s*>/giu, "\n")
    .replace(/<[^>]+>/gu, "")
    .replace(/&#x([0-9a-f]+);/giu, (_match, digits) => {
      const codePoint = Number.parseInt(digits, 16);
      return Number.isInteger(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : "�";
    })
    .replace(/&#([0-9]+);/gu, (_match, digits) => {
      const codePoint = Number.parseInt(digits, 10);
      return Number.isInteger(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : "�";
    })
    .replace(/&quot;/giu, '"')
    .replace(/&apos;|&#39;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function comparableXText(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

export function extractXPagePostText(html: string, sourceUrl: string) {
  const marker = `itemID="${sourceUrl}"`;
  const markerIndex = html.indexOf(marker);
  // X's current server-rendered page uses canonical metadata instead of itemID.
  const canonical = html.match(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"/iu)?.[1];
  if (markerIndex < 0 && canonical !== sourceUrl) return null;
  const postHtml = markerIndex < 0 ? html : html.slice(markerIndex, markerIndex + 100_000);
  const bodyMatch = postHtml.match(
    /<div[^>]*\bdir=(?:"auto"|'auto')[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/iu,
  );
  const text = bodyMatch ? decodeXHtmlText(bodyMatch[1]) : "";
  return text && text.length <= 4_000 ? text : null;
}

function extractOembedEvidence(value: Record<string, unknown>, sourceUrl: string) {
  if (
    value?.url !== sourceUrl
    || value?.author_url !== "https://x.com/thsottiaux"
    || value?.provider_name !== "X"
  ) return null;
  const html = String(value?.html || "");
  const paragraph = html.match(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/iu);
  const text = paragraph ? decodeXHtmlText(paragraph[1]) : "";
  const shortUrls = [...html.matchAll(/\bhref=(?:"|')(https:\/\/t\.co\/[a-zA-Z0-9]+)(?:"|')/gu)]
    .map((match) => match[1]);
  return text ? { text, shortUrls: [...new Set(shortUrls)] } : null;
}

function oembedTextMatchesPost(oembedText: string, postText: string) {
  const withoutLinks = oembedText
    .replace(/\s*https:\/\/t\.co\/[a-zA-Z0-9]+/gu, "")
    .replace(/(?:…|\.\.\.)$/u, "")
    .trim();
  const evidence = comparableXText(withoutLinks);
  return evidence.length > 0 && comparableXText(postText).startsWith(evidence);
}

async function verifiedXPost(postId: string) {
  const sourceUrl = `https://x.com/thsottiaux/status/${postId}`;
  const oembedUrl = new URL(X_OEMBED_URL);
  oembedUrl.searchParams.set("omit_script", "true");
  oembedUrl.searchParams.set("dnt", "true");
  oembedUrl.searchParams.set("url", sourceUrl);
  const oembedResponse = await sourceFetch(oembedUrl, { headers: { Accept: "application/json" } });
  if (!oembedResponse.ok) return null;
  const oembed = extractOembedEvidence(await oembedResponse.json(), sourceUrl);
  if (!oembed) return null;

  const pageResponse = await sourceFetch(sourceUrl, {
    headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0" },
    redirect: "error",
  });
  if (!pageResponse.ok) return null;
  const text = extractXPagePostText(await pageResponse.text(), sourceUrl);
  if (!text || !oembedTextMatchesPost(oembed.text, text)) return null;
  return { sourceUrl, text, shortUrls: oembed.shortUrls };
}

async function resolveQuotedXPostId(shortUrl: string) {
  const response = await sourceFetch(shortUrl, { method: "HEAD", redirect: "manual" });
  if (![301, 302, 303, 307, 308].includes(response.status)) return null;
  const location = response.headers.get("location");
  if (!location) return null;
  try {
    const target = new URL(location, shortUrl);
    if (
      target.protocol !== "https:"
      || !["x.com", "twitter.com", "www.x.com", "www.twitter.com"].includes(target.hostname.toLowerCase())
    ) return null;
    return target.pathname.match(/^\/thsottiaux\/status\/([0-9]+)\/?$/u)?.[1] || null;
  } catch {
    return null;
  }
}

async function verifyTiboAnnouncement(
  candidate: ReturnType<typeof correlateTiboResetPosts>[number],
): Promise<Announcement | null> {
  if (candidate.state !== "confirmed") return null;
  const verified = await verifiedXPost(candidate.postId);
  if (
    !verified
    || !RESET_CONCEPT.test(verified.text)
    || !CONFIRMED_RESET_CONCEPT.test(verified.text)
  ) return null;

  let contextText = verified.text;
  if (candidate.contextCandidate) {
    const context = await verifiedXPost(candidate.contextCandidate.postId);
    if (
      !context
      || !CODEX_CONCEPT.test(context.text)
      || !RESET_CONCEPT.test(context.text)
      || !SCHEDULED_RESET_CONCEPT.test(context.text)
    ) return null;
    const quoteTargets = await Promise.all(verified.shortUrls.map(resolveQuotedXPostId));
    if (!quoteTargets.includes(candidate.contextCandidate.postId)) return null;
    contextText = `${context.text}\n${verified.text}`;
  } else if (!CODEX_CONCEPT.test(verified.text)) {
    return null;
  }
  return {
    id: `x:${candidate.postId}`,
    type: "official_reset_announcement",
    title: "Codex 官方额外重置",
    summary: verified.text.slice(0, 240),
    body: candidate.contextCandidate
      ? `${contextText}\n\n引用公告：https://x.com/thsottiaux/status/${candidate.contextCandidate.postId}`
      : verified.text,
    announcement_state: "confirmed",
    source_url: verified.sourceUrl,
    official_url: "https://chatgpt.com/codex",
    published_at: candidate.publishedAt,
    expires_at: new Date(candidate.publishedMs + ANNOUNCEMENT_RETENTION_MS).toISOString(),
    source_author: "thsottiaux",
    source_post_id: candidate.postId,
    reset_kind: classifyResetKind(contextText),
    reset_scope: classifyResetScope(contextText),
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
    const response = await sourceFetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`discovery request failed: HTTP ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body?.results)) throw new Error('discovery response schema changed');
    const pageResults = body.results;
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

export async function signedEnvelope(announcements: Announcement[], privateKeyBase64: string, nowMs: number, checkedPostIds: string[] = [], pendingAnnouncements: Announcement[] = []) {
  const payload = new TextEncoder().encode(JSON.stringify({
    generated_at: new Date(nowMs).toISOString(),
    announcements,
    ...(checkedPostIds.length ? {checked_post_ids:checkedPostIds} : {}),
    ...(pendingAnnouncements.length ? {pending_announcements:pendingAnnouncements} : {}),
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


async function sourceFetch(input: string | URL, init: RequestInit = {}) {
  return fetch(input, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
}

export async function verifiedExistingAnnouncements(envelope: {payload_b64: string; signature_b64: string}, privateKeyBase64: string) {
  const privateKey = await crypto.subtle.importKey('pkcs8', decodeBase64(privateKeyBase64), {name:'Ed25519'}, true, ['sign']);
  const jwk = await crypto.subtle.exportKey('jwk', privateKey);
  const publicKey = await crypto.subtle.importKey('jwk', {kty:jwk.kty, crv:jwk.crv, x:jwk.x}, {name:'Ed25519'}, false, ['verify']);
  const decode = (value: string) => decodeBase64(value.replace(/-/g, '+').replace(/_/g, '/'));
  if (!await crypto.subtle.verify('Ed25519', publicKey, decode(envelope.signature_b64), decode(envelope.payload_b64))) {
    throw new Error('Stored reset feed signature is invalid');
  }
  return decodeBase64UrlJson(envelope.payload_b64);
}

// Discovery is untrusted; only posts matching both official X surfaces are admitted.
export async function collectResetAnnouncements(existing: Announcement[], nowMs: number, scan = {checkedPostIds: [] as string[], complete: true}) {
  scan.complete = true;
  const retained = existing.filter(item => Date.parse(item.expires_at) > nowMs);
  const known = new Set(retained.map(item => item.source_post_id).filter(Boolean));
  let results: Array<Record<string, unknown>>;
  try { results = await fetchTiboResults(nowMs); }
  catch { results = await fetchOfficialProfileResults(nowMs, known, scan); }
  const candidates = correlateTiboResetPosts(results
    .map(result => tiboCandidate(result, nowMs))
    .filter((item): item is NonNullable<ReturnType<typeof tiboCandidate>> => Boolean(item)));
  const pending = candidates.filter(item => !known.has(item.postId))
    .sort((a, b) => b.publishedMs - a.publishedMs);
  // Bound each run to stay inside the Worker subrequest budget; later runs backfill.
  for (const candidate of pending.slice(0, 6)) {
    const verified = await verifyTiboAnnouncement(candidate);
    if (!verified) throw new Error("Official X verification failed: " + candidate.postId);
    retained.push(verified);
  }
  if (pending.length > 6) scan.complete = false;
  if (scan.complete) scan.checkedPostIds = [];
  return [...new Map(retained.map(item => [item.id, item])).values()]
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at)).slice(0, 100);
}

async function fetchOfficialProfileResults(nowMs: number, known: Set<string | undefined>, scan: {checkedPostIds:string[];complete:boolean}) {
  const profile = await sourceFetch('https://x.com/thsottiaux', {headers:{Accept:'text/html'},redirect:'error'});
  if (!profile.ok) throw new Error(`Official profile unavailable: HTTP ${profile.status}`);
  const html = await profile.text();
  if (!html.includes('href="https://x.com/thsottiaux"')) throw new Error('Official profile identity missing');
  const ids = [...new Set([...html.matchAll(/href="(?:https:\/\/x\.com)?\/thsottiaux\/status\/([0-9]+)(?:["/?])/g)].map(match => match[1]))]
    .filter(id => { const date = Date.parse(xPublishedAt(id) || ''); return date <= nowMs + 300000 && date >= nowMs - X_WINDOW_MS; })
    .sort((a,b) => a < b ? 1 : -1);
  if (!ids.length) throw new Error('Official profile contains no recent posts');
  const results: Array<Record<string, unknown>> = [];
  const candidateResult = (id: string, text: string, quote?: string) => ({
    url:`https://x.com/thsottiaux/status/${id}`, text,
    author:{screen_name:'thsottiaux',url:'https://x.com/thsottiaux'},
    ...(quote ? {quote:{id:quote}} : {}),
  });
  const checked = new Set(scan.checkedPostIds.filter(id => ids.includes(id)));
  for (const id of ids.filter(id => !known.has(id) && !checked.has(id)).slice(0,4)) {
    const post = await verifiedXPost(id);
    if (!post) throw new Error('Official profile post verification failed: ' + id);
    checked.add(id);
    const candidate = tiboCandidate(candidateResult(id, post.text), nowMs);
    if (!candidate) continue;
    if (candidate.state === 'confirmed' && !candidate.hasCodexContext) {
      for (const shortUrl of post.shortUrls.slice(0,1)) {
        const quotedId = await resolveQuotedXPostId(shortUrl);
        if (!quotedId) continue;
        const quote = await verifiedXPost(quotedId);
        if (!quote) throw new Error('Official quoted post unavailable');
        results.push(candidateResult(quotedId, quote.text), candidateResult(id, post.text, quotedId));
      }
    } else results.push(candidateResult(id, post.text));
  }
  scan.checkedPostIds = [...checked];
  scan.complete = ids.every(id => known.has(id) || checked.has(id));
  return results;
}
