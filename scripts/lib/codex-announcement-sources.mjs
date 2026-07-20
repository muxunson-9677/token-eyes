const X_EPOCH_MS = 1_288_834_974_657n;
const X_WINDOW_MS = 48 * 60 * 60 * 1000;
const CREATED_AT_TOLERANCE_MS = 5 * 60 * 1000;

export const CODEX_ANNOUNCEMENT_X_AUTHORS = Object.freeze([
  Object.freeze({ username: "OpenAI", role: "company" }),
  Object.freeze({ username: "thsottiaux", role: "head_of_codex" }),
]);

export const X_RECENT_QUERY = [
  "(from:OpenAI OR from:thsottiaux) Codex",
  '(reset OR "rate limit" OR "usage limit" OR quota OR credit OR "extra usage" OR "additional usage")',
  "-is:retweet",
].join(" ");

const AUTHOR_BY_LOWERCASE = new Map(
  CODEX_ANNOUNCEMENT_X_AUTHORS.map((author) => [
    author.username.toLowerCase(),
    author,
  ]),
);
const RESET_CONCEPT = /\b(reset|rate\s+limits?|usage\s+limits?|quota|credits?|extra\s+usage|additional\s+usage)\b|重置|额度|使用限制|额外用量|赠送额度/iu;

function normalizeAuthor(username) {
  if (typeof username !== "string") return null;
  return AUTHOR_BY_LOWERCASE.get(username.toLowerCase())?.username || null;
}

export function parseAllowlistedXStatusUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:"
    || url.hostname.toLowerCase() !== "x.com"
    || url.search
    || url.hash
  ) {
    return null;
  }
  const match = url.pathname.match(/^\/([^/]+)\/status\/([0-9]+)\/?$/u);
  if (!match) return null;
  const sourceAuthor = normalizeAuthor(match[1]);
  if (!sourceAuthor) return null;
  return {
    source_author: sourceAuthor,
    source_post_id: match[2],
    source_url: `https://x.com/${sourceAuthor}/status/${match[2]}`,
  };
}

export function xStatusIdCreatedAt(statusId) {
  if (typeof statusId !== "string" || !/^[0-9]+$/u.test(statusId)) return null;
  try {
    const timestamp = Number((BigInt(statusId) >> 22n) + X_EPOCH_MS);
    if (!Number.isSafeInteger(timestamp)) return null;
    const date = new Date(timestamp);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  } catch {
    return null;
  }
}

function validCampaignKey(value, statusId) {
  if (typeof value !== "string" || value.length === 0) return `post:${statusId}`;
  return /^[a-z0-9][a-z0-9._:-]{0,79}$/iu.test(value) ? value : null;
}

export function classifyCodexResetCandidate(post, { nowMs = Date.now() } = {}) {
  if (!post || typeof post !== "object" || Array.isArray(post)) return null;
  if (
    post.is_reply === true
    || post.is_quote === true
    || post.is_repost === true
    || (Array.isArray(post.referenced_tweets) && post.referenced_tweets.length > 0)
  ) {
    return null;
  }

  const text = typeof post.text === "string" ? post.text.trim() : "";
  if (!text || text.length > 4_000 || !/\bcodex\b/iu.test(text) || !RESET_CONCEPT.test(text)) {
    return null;
  }

  const parsedUrl = post.source_url
    ? parseAllowlistedXStatusUrl(post.source_url)
    : null;
  const postId = typeof post.id === "string" && /^[0-9]+$/u.test(post.id)
    ? post.id
    : parsedUrl?.source_post_id;
  const declaredAuthor = normalizeAuthor(post.author_username);
  if (post.author_username !== undefined && !declaredAuthor) return null;
  const sourceAuthor = declaredAuthor || parsedUrl?.source_author;
  if (!postId || !sourceAuthor) return null;
  if (
    parsedUrl
    && (
      parsedUrl.source_post_id !== postId
      || parsedUrl.source_author !== sourceAuthor
    )
  ) {
    return null;
  }

  const idCreatedAt = xStatusIdCreatedAt(postId);
  if (!idCreatedAt) return null;
  let publishedAt = idCreatedAt;
  if (post.created_at !== undefined) {
    const declaredMs = Date.parse(post.created_at);
    if (
      !Number.isFinite(declaredMs)
      || Math.abs(declaredMs - Date.parse(idCreatedAt)) > CREATED_AT_TOLERANCE_MS
    ) {
      return null;
    }
    publishedAt = new Date(declaredMs).toISOString();
  }
  const publishedMs = Date.parse(publishedAt);
  if (
    !Number.isFinite(nowMs)
    || publishedMs > nowMs + CREATED_AT_TOLERANCE_MS
    || nowMs - publishedMs > X_WINDOW_MS
  ) {
    return null;
  }

  const campaignKey = validCampaignKey(post.campaign_key, postId);
  if (!campaignKey) return null;
  return {
    campaign_key: campaignKey,
    source_author: sourceAuthor,
    source_post_id: postId,
    source_url: `https://x.com/${sourceAuthor}/status/${postId}`,
    published_at: publishedAt,
    text,
    collected_at: new Date(nowMs).toISOString(),
    review_status: "pending",
  };
}

function candidateSource(candidate) {
  return {
    source_author: candidate.source_author,
    source_post_id: candidate.source_post_id,
    source_url: candidate.source_url,
    published_at: candidate.published_at,
    text: candidate.text,
  };
}

export function mergeCodexResetCandidates(existing = [], incoming = []) {
  const groups = new Map();
  const seenPostIds = new Set();

  function addReviewItem(item) {
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item.sources)) {
      const group = groups.get(item.campaign_key) || {
        campaign_key: item.campaign_key,
        review_status: "pending",
        sources: [],
      };
      groups.set(item.campaign_key, group);
      for (const source of item.sources) {
        if (!source?.source_post_id || seenPostIds.has(source.source_post_id)) continue;
        seenPostIds.add(source.source_post_id);
        group.sources.push({ ...source });
      }
      return;
    }
    if (!item.source_post_id || seenPostIds.has(item.source_post_id)) return;
    seenPostIds.add(item.source_post_id);
    const group = groups.get(item.campaign_key) || {
      campaign_key: item.campaign_key,
      review_status: "pending",
      sources: [],
    };
    groups.set(item.campaign_key, group);
    group.sources.push(candidateSource(item));
  }

  for (const item of existing) addReviewItem(item);
  for (const item of incoming) addReviewItem(item);
  return [...groups.values()].filter((item) => item.sources.length > 0);
}

export async function collectXRecentCandidates({
  bearerToken,
  sinceId,
  fetchImpl = fetch,
  nowMs = Date.now(),
}) {
  if (typeof bearerToken !== "string" || bearerToken.length === 0) {
    throw new TypeError("X bearer token is required");
  }
  const url = new URL("https://api.x.com/2/tweets/search/recent");
  url.searchParams.set("query", X_RECENT_QUERY);
  url.searchParams.set("max_results", "100");
  url.searchParams.set("start_time", new Date(nowMs - X_WINDOW_MS).toISOString());
  url.searchParams.set("tweet.fields", "id,text,author_id,created_at");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "username");
  if (typeof sinceId === "string" && /^[0-9]+$/u.test(sinceId)) {
    url.searchParams.set("since_id", sinceId);
  }

  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`X recent search returned HTTP ${response.status || "error"}`);
  }
  const body = await response.json();
  const usernames = new Map(
    (body?.includes?.users || []).map((user) => [String(user.id), user.username]),
  );
  const candidates = [];
  for (const post of Array.isArray(body?.data) ? body.data.slice(0, 100) : []) {
    const candidate = classifyCodexResetCandidate({
      id: String(post.id || ""),
      text: post.text,
      author_username: usernames.get(String(post.author_id)),
      created_at: post.created_at,
      referenced_tweets: post.referenced_tweets,
    }, { nowMs });
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}
