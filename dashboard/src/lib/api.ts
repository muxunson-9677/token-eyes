import {
  getMockUsageDaily,
  getMockUsageHourly,
  getMockUsageHeatmap,
  getMockUsageMonthly,
  getMockUsageModelBreakdown,
  getMockUsageCategoryBreakdown,
  getMockUsageSummary,
  getMockProjectUsageSummary,
  getMockLeaderboard,
  getMockProviderStats,
  getMockModelStats,
  isMockEnabled,
} from "./mock-data";
import { getInsforgeRemoteUrl, getInsforgeAnonKey } from "./insforge-config";
import { isValidJwtShape } from "./auth-token";
import { getLocalApiAuthHeaders } from "./local-api-auth";
import { buildLocalApiUrl, isTauriRuntime } from "./local-api-url";

type AnyRecord = Record<string, any>;

const PATHS = {
  usageSummary: "tokentracker-usage-summary",
  usageDaily: "tokentracker-usage-daily",
  usageHourly: "tokentracker-usage-hourly",
  usageMonthly: "tokentracker-usage-monthly",
  usageHeatmap: "tokentracker-usage-heatmap",
  usageModelBreakdown: "tokentracker-usage-model-breakdown",
  usageCategoryBreakdown: "tokentracker-usage-category-breakdown",
  projectUsageSummary: "tokentracker-project-usage-summary",
  userStatus: "tokentracker-user-status",
  localSync: "tokentracker-local-sync",
  usageLimits: "tokentracker-usage-limits",
  localSettings: "tokentracker-local-settings",
  detectDataDirectories: "tokentracker-detect-data-directories",
  selectDirectory: "tokentracker-select-directory",
  tokenPlans: "tokentracker-token-plans",
  tokenPlansRefresh: "tokentracker-token-plans-refresh",
  tokenPlanCatalog: "tokentracker-token-plan-catalog",
  spendRecords: "tokentracker-spend-records",
  spendTimeseries: "tokentracker-spend-timeseries",
  requestUsageRecords: "tokentracker-request-usage-records",
  providerStats: "tokentracker-provider-stats",
  modelStats: "tokentracker-model-stats",
  consoleSessions: "tokentracker-token-plan-console-sessions",
  tokenPlanSecrets: "tokentracker-token-plan-secrets",
  agentEnvironment: "tokentracker-agent-environment",
  apiBillingAccounts: "tokentracker-api-billing-accounts",
  // 03-ia-api-balance: provider API config / secret / balance endpoints.
  // Backed by the 02 work order's local-api.js handlers. Mutations require
  // the x-tokentracker-local-auth header (getLocalApiAuthHeaders).
  providerApiConfigs: "tokentracker-provider-api-configs",
  providerApiSecrets: "tokentracker-provider-api-secrets",
  providerApiTest: "tokentracker-provider-api-test",
  providerApiRefresh: "tokentracker-provider-api-refresh",
  providerApiBalances: "tokentracker-provider-api-balances",
};

/**
 * usage-* (local CLI) 鈫?account-* (cloud) slug map. The cloud `account-*`
 * edge functions mirror the local `tokentracker-usage-*` response schema
 * exactly (see their source: "Mirrors local-api.js ... response schema"),
 * so the dashboard components render identically off either source.
 */
const USAGE_TO_ACCOUNT_SLUG: Record<string, string> = {
  "tokentracker-usage-summary": "tokentracker-account-summary",
  "tokentracker-usage-daily": "tokentracker-account-daily",
  "tokentracker-usage-hourly": "tokentracker-account-hourly",
  "tokentracker-usage-monthly": "tokentracker-account-monthly",
  "tokentracker-usage-heatmap": "tokentracker-account-heatmap",
  "tokentracker-usage-model-breakdown": "tokentracker-account-model-breakdown",
};

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchLocalApi(url: string, init: RequestInit) {
  const attempts = isTauriRuntime() ? 10 : 1;
  let lastError: unknown = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await sleep(250);
    }
  }
  throw lastError;
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (err) {
    const contentType = response.headers.get("content-type") || "";
    const startsLikeHtml = /^\s*<!doctype\s+html|^\s*<html[\s>]/i.test(text);
    if (startsLikeHtml || contentType.toLowerCase().includes("text/html")) {
      throw new Error("本地 API 未连接：桌面应用收到的是前端 HTML，不是 JSON。请重新打开 Token Eyes，或先运行本地 Token Tracker 服务后再刷新。");
    }
    throw err;
  }
}

/**
 * Build an Error from a non-2xx HTTP response, enriching it with the backend's
 * structured error body ({ error, error_code, field }) when available.
 *
 * 06-订阅记录必填契约修复: the spend-records API returns specific error bodies
 * like { ok: false, error: "Missing required field: currency",
 * error_code: "missing_required_field", field: "currency" } on 400. Without
 * this enrichment, fetchLocalJson threw a generic "Request failed with HTTP
 * 400", losing the backend's specific message. The UI must surface the real
 * backend error so users know which field failed — not a generic HTTP string.
 */
async function buildErrorFromResponse(response: Response): Promise<Error> {
  const err: any = new Error(`Request failed with HTTP ${response.status}`);
  err.status = response.status;
  try {
    const body = await readJsonResponse(response);
    if (body?.error) err.message = body.error;
    if (body?.error_code) err.error_code = body.error_code;
    if (body?.field) err.field = body.field;
  } catch {
    // Body not JSON (e.g. HTML error page from a proxy) — keep generic message.
  }
  return err;
}
function isLocalhostHost() {
  return (
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
  );
}

async function fetchLocalJson(slug: string, params?: AnyRecord, options?: AnyRecord) {
  const accessToken = options?.accessToken as string | undefined;
  const accountSlug = USAGE_TO_ACCOUNT_SLUG[slug];

  // Deployed web (e.g. tokentracker.cc): there's no local CLI behind
  // window.location.origin, so usage-* calls would 404. When the visitor is
  // signed in and the slug has a cloud account-* mirror, route to the cloud
  // aggregator (cross-device usage by user_id) with the auth token. Local CLI
  // (localhost) keeps the original same-origin usage-* path.
  if (!isTauriRuntime() && !isLocalhostHost() && accessToken && accountSlug) {
    const base = getInsforgeRemoteUrl().replace(/\/$/, "");
    const url = new URL(`${base}/functions/${accountSlug}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value != null && value !== "") url.searchParams.set(key, String(value));
      }
    }
    const headers: Record<string, string> = { Accept: "application/json" };
    const anonKey = getInsforgeAnonKey();
    if (anonKey) headers.apikey = anonKey;
    if (isValidJwtShape(accessToken)) headers.Authorization = `Bearer ${accessToken}`;
    const response = await fetch(url.toString(), { headers, cache: "no-store" });
    if (!response.ok) {
      throw await buildErrorFromResponse(response);
    }
    return response.json();
  }

  const url = new URL(await buildLocalApiUrl(`/functions/${slug}`));
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== "") url.searchParams.set(key, String(value));
    }
  }
  const { accessToken: _omit, ...fetchOptions } = options || {};
  const response = await fetchLocalApi(url.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
    ...fetchOptions,
  });
  if (!response.ok) {
    throw await buildErrorFromResponse(response);
  }
  return readJsonResponse(response);
}

function buildTimeZoneParams({ timeZone, tzOffsetMinutes }: AnyRecord = {}) {
  const params: AnyRecord = {};
  const tz = typeof timeZone === "string" ? timeZone.trim() : "";
  if (tz) params.tz = tz;
  if (Number.isFinite(tzOffsetMinutes)) {
    params.tz_offset_minutes = String(Math.trunc(tzOffsetMinutes));
  }
  return params;
}

function buildFilterParams({ source, model }: AnyRecord = {}) {
  const params: AnyRecord = {};
  const normalizedSource = typeof source === "string" ? source.trim().toLowerCase() : "";
  if (normalizedSource) params.source = normalizedSource;
  const normalizedModel = typeof model === "string" ? model.trim() : "";
  if (normalizedModel) params.model = normalizedModel;
  return params;
}

/** Build multi-value filter params (sources / models / agent_ids) for the
 *  TICKET-01 usage endpoints. Values are joined with commas to match the
 *  backend's `parseMultiParam` parser. Empty arrays produce no param so the
 *  backend treats them as "no filter" (null). */
function buildMultiFilterParams({ sources, models, agentIds }: AnyRecord = {}) {
  const params: AnyRecord = {};
  const join = (v: unknown) => (Array.isArray(v) ? v.filter(Boolean).join(",") : "");
  if (join(sources)) params.sources = join(sources);
  if (join(models)) params.models = join(models);
  if (join(agentIds)) params.agent_ids = join(agentIds);
  return params;
}

export async function getUsageSummary({
  from,
  to,
  source,
  model,
  sources,
  models,
  agentIds,
  timeZone,
  tzOffsetMinutes,
  rolling = false,
  accessToken,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockUsageSummary({ from, to, seed: accessToken, rolling });
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildFilterParams({ source, model });
  const multiParams = buildMultiFilterParams({ sources, models, agentIds });
  const rollingParams = rolling ? { rolling: "1" } : {};
  return fetchLocalJson(PATHS.usageSummary, { from, to, ...filterParams, ...multiParams, ...tzParams, ...rollingParams }, { accessToken });
}

export async function getProjectUsageSummary({
  from,
  to,
  source,
  limit,
  timeZone,
  tzOffsetMinutes,
  accessToken,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockProjectUsageSummary({ seed: accessToken, limit });
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildFilterParams({ source });
  const params: AnyRecord = { ...filterParams, ...tzParams };
  if (from) params.from = from;
  if (to) params.to = to;
  if (limit != null) params.limit = String(limit);
  return fetchLocalJson(PATHS.projectUsageSummary, params);
}

export async function getLocalSettings() {
  return fetchLocalJson(PATHS.localSettings);
}

export async function detectLocalDataDirectories() {
  return fetchLocalJson(PATHS.detectDataDirectories);
}

export async function setLocalSettings(settings: AnyRecord = {}) {
  const authHeaders = await getLocalApiAuthHeaders();
  return fetchLocalJson(PATHS.localSettings, undefined, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify(settings),
  });
}

export async function selectLocalDirectory() {
  const authHeaders = await getLocalApiAuthHeaders();
  return fetchLocalJson(PATHS.selectDirectory, undefined, {
    method: "POST",
    headers: {
      Accept: "application/json",
      ...authHeaders,
    },
  });
}

export async function getAgentEnvironment(agent?: string, dataPath?: string) {
  const params: AnyRecord = {};
  if (agent) params.agent = agent;
  if (dataPath != null) params.path = dataPath;
  return fetchLocalJson(PATHS.agentEnvironment, params);
}

export async function getAllAgentEnvironments() {
  return fetchLocalJson(PATHS.agentEnvironment);
}

export async function getTokenPlans() {
  return fetchLocalJson(PATHS.tokenPlans);
}

export async function getApiBillingAccounts() {
  return fetchLocalJson(PATHS.apiBillingAccounts);
}

export async function saveTokenPlan(record: AnyRecord = {}) {
  const authHeaders = await getLocalApiAuthHeaders();
  return fetchLocalJson(PATHS.tokenPlans, undefined, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify(record),
  });
}

export async function getTokenPlanCatalog() {
  return fetchLocalJson(PATHS.tokenPlanCatalog);
}

export async function getSpendRecords(params?: AnyRecord) {
  const tzParams = buildTimeZoneParams(params || {});
  const multiParams = buildMultiFilterParams(params || {});
  return fetchLocalJson(PATHS.spendRecords, { ...(params || {}), ...tzParams, ...multiParams });
}

export async function getSpendTimeseries(params?: AnyRecord) {
  const tzParams = buildTimeZoneParams(params || {});
  const multiParams = buildMultiFilterParams(params || {});
  return fetchLocalJson(PATHS.spendTimeseries, { ...(params || {}), ...tzParams, ...multiParams });
}

export async function getRequestUsageRecords({
  source,
  sources,
  models,
  agentIds,
  from,
  to,
  timeZone,
  tzOffsetMinutes,
  limit,
  page,
  pageSize,
  accessToken,
}: AnyRecord = {}) {
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildFilterParams({ source });
  const multiParams = buildMultiFilterParams({ sources, models, agentIds });
  const params: AnyRecord = { ...filterParams, ...multiParams, ...tzParams };
  if (from) params.from = from;
  if (to) params.to = to;
  if (limit != null) params.limit = String(limit);
  if (page != null) params.page = String(page);
  if (pageSize != null) params.pageSize = String(pageSize);
  return fetchLocalJson(PATHS.requestUsageRecords, params, { accessToken });
}

export async function refreshTokenPlan(id: string) {
  const authHeaders = await getLocalApiAuthHeaders();
  return fetchLocalJson(PATHS.tokenPlansRefresh, undefined, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({ id }),
  });
}

/** W03-R3C: Save a custom API key via the secrets endpoint.
 *  Only returns an api_key_ref — never the secret itself.
 *  The secret is NOT stored in config.json. */
export async function saveTokenPlanSecret(params: {
  provider_id: string;
  purpose: string;
  secret: string;
}): Promise<{ ok: boolean; api_key_ref?: string; error_code?: string; error?: string }> {
  const authHeaders = await getLocalApiAuthHeaders();
  return fetchLocalJson(PATHS.tokenPlanSecrets, undefined, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify(params),
  });
}

export async function createSpendRecord(record: AnyRecord = {}) {
  const authHeaders = await getLocalApiAuthHeaders();
  return fetchLocalJson(PATHS.spendRecords, undefined, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify(record),
  });
}

export async function updateSpendRecord(record: AnyRecord = {}) {
  const authHeaders = await getLocalApiAuthHeaders();
  return fetchLocalJson(PATHS.spendRecords, undefined, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify(record),
  });
}

export async function deleteSpendRecord(id: string) {
  const authHeaders = await getLocalApiAuthHeaders();
  return fetchLocalJson(PATHS.spendRecords, undefined, {
    method: "DELETE",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({ id }),
  });
}

// ---------------------------------------------------------------------------
// 03-ia-api-balance: Provider API config / secret / balance client.
//
// These endpoints (added by work order 02) return rich machine error codes
// (invalid_config, credential_store_unavailable, provider_unauthorized, …)
// on non-2xx HTTP status. The existing fetchLocalJson helper throws on
// !response.ok without exposing the parsed body, so the UI could not read
// error_code. requestProviderApi reuses the SAME fetch infrastructure
// (buildLocalApiUrl / getLocalApiAuthHeaders / fetchLocalApi /
// readJsonResponse) — it only adapts the result shape to carry the body and
// error_code on failure. No parallel fetch plumbing is introduced.
//
// Every function returns a ProviderApiResult:
//   { ok: boolean, status: number, data?: any, error_code?: string, error?: string }
// so callers can branch on error_code without try/catch gymnastics.
// ---------------------------------------------------------------------------

export type ProviderApiResult = {
  ok: boolean;
  status: number;
  data?: AnyRecord;
  error_code?: string;
  error?: string;
};

async function requestProviderApi(
  slug: string,
  options: {
    method?: string;
    params?: AnyRecord;
    body?: unknown;
    auth?: boolean;
  } = {},
): Promise<ProviderApiResult> {
  const { method = "GET", params, body, auth = false } = options;
  const url = new URL(await buildLocalApiUrl(`/functions/${slug}`));
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== "") url.searchParams.set(key, String(value));
    }
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const authHeaders = await getLocalApiAuthHeaders();
    Object.assign(headers, authHeaders);
  }
  const response = await fetchLocalApi(url.toString(), {
    method,
    headers,
    cache: "no-store",
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await readJsonResponse(response)) as AnyRecord;
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      data,
      error_code: typeof data?.error_code === "string" ? data.error_code : undefined,
      error: typeof data?.error === "string" ? data.error : `HTTP ${response.status}`,
    };
  }
  return { ok: true, status: response.status, data };
}

/** GET /functions/tokentracker-provider-api-configs → { configs: ProviderApiConfig[] } */
export async function getProviderApiConfigs(): Promise<ProviderApiResult> {
  return requestProviderApi(PATHS.providerApiConfigs, { method: "GET" });
}

/** POST /functions/tokentracker-provider-api-configs → { config } (auth required) */
export async function saveProviderApiConfig(config: AnyRecord): Promise<ProviderApiResult> {
  return requestProviderApi(PATHS.providerApiConfigs, { method: "POST", body: config, auth: true });
}

/** PUT /functions/tokentracker-provider-api-configs?id=<id> → { config } (auth required) */
export async function updateProviderApiConfig(id: string, config: AnyRecord): Promise<ProviderApiResult> {
  return requestProviderApi(PATHS.providerApiConfigs, { method: "PUT", params: { id }, body: config, auth: true });
}

/** DELETE /functions/tokentracker-provider-api-configs?id=<id> → { ok } (auth required) */
export async function deleteProviderApiConfig(id: string): Promise<ProviderApiResult> {
  return requestProviderApi(PATHS.providerApiConfigs, { method: "DELETE", params: { id }, auth: true });
}

/** POST /functions/tokentracker-provider-api-secrets { configId, secret } → { ok, apiKeyRef, masked } */
export async function saveProviderApiSecret(params: {
  configId: string;
  secret: string;
}): Promise<ProviderApiResult> {
  return requestProviderApi(PATHS.providerApiSecrets, { method: "POST", body: params, auth: true });
}

/** DELETE /functions/tokentracker-provider-api-secrets?id=<configId> → { ok } */
export async function deleteProviderApiSecret(configId: string): Promise<ProviderApiResult> {
  return requestProviderApi(PATHS.providerApiSecrets, { method: "DELETE", params: { id: configId }, auth: true });
}

/** POST /functions/tokentracker-provider-api-test?id=<id> → { balance } (always 200; balance.status carries errors) */
export async function testProviderApiConfig(id: string): Promise<ProviderApiResult> {
  return requestProviderApi(PATHS.providerApiTest, { method: "POST", params: { id }, auth: true });
}

/** POST /functions/tokentracker-provider-api-refresh?id=<id> → { balance } */
export async function refreshProviderApiBalance(id: string): Promise<ProviderApiResult> {
  return requestProviderApi(PATHS.providerApiRefresh, { method: "POST", params: { id }, auth: true });
}

/** GET /functions/tokentracker-provider-api-balances → { balances: ProviderAccountBalance[] } (cached, no network) */
export async function getProviderApiBalances(): Promise<ProviderApiResult> {
  return requestProviderApi(PATHS.providerApiBalances, { method: "GET" });
}

async function fetchInsforgeFunction(slug: string, options: {
  method?: string;
  accessToken?: string;
  params?: AnyRecord;
  body?: unknown;
} = {}) {
  const baseUrl = getInsforgeRemoteUrl();
  if (!baseUrl) throw new Error("InsForge base URL not configured");
  const root = baseUrl.replace(/\/$/, "");
  const url = new URL(`${root}/functions/${slug}`);
  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      if (value != null && value !== "") url.searchParams.set(key, String(value));
    }
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const anonKey = getInsforgeAnonKey();
  if (anonKey) headers.apikey = anonKey;
  // Only attach Authorization if the token is a well-formed JWT. InsForge's
  // platform gateway validates the JWT before user code runs and returns
  // HTTP 500 (JWSError) for any malformed value 鈥?which would break
  // public endpoints like leaderboard for users whose stored token got
  // corrupted or truncated.
  if (options.accessToken && isValidJwtShape(options.accessToken)) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }

  const res = await fetch(url.toString(), {
    method: options.method || "GET",
    headers,
    ...(options.body != null ? { body: JSON.stringify(options.body) } : {}),
  });
  if (!res.ok) {
    const err: any = new Error(`Request failed with HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function getLeaderboard({
  accessToken,
  userId,
  period,
  metric,
  limit,
  offset,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockLeaderboard({ seed: accessToken || userId, period, metric, limit, offset });
  }
  // Deliberately NOT passing accessToken. Leaderboard is a public read and
  // InsForge's gateway returns opaque 500 (JWSError) for any JWT issue
  // (bad signature, expired, rotated secret). Passing user_id as a query
  // param lets the server compute `is_me` without ever touching the
  // Authorization header.
  return fetchInsforgeFunction("tokentracker-leaderboard", {
    params: { period, limit, offset, user_id: userId },
  });
}

export async function getPublicVisibility({ accessToken }: AnyRecord = {}) {
  return fetchInsforgeFunction("tokentracker-public-visibility", {
    accessToken,
    method: "GET",
  });
}

export async function setPublicVisibility({
  accessToken,
  enabled,
  anonymous,
  display_name,
  github_url,
  show_github_url,
}: AnyRecord = {}) {
  const body: AnyRecord = {};
  if (enabled !== undefined) body.enabled = Boolean(enabled);
  if (anonymous !== undefined) body.anonymous = Boolean(anonymous);
  if (display_name !== undefined) body.display_name = String(display_name);
  // null is a valid value (clears the URL), so check for presence via `in`-style
  if (github_url !== undefined) body.github_url = github_url === null ? null : String(github_url);
  if (show_github_url !== undefined) body.show_github_url = Boolean(show_github_url);
  return fetchInsforgeFunction("tokentracker-public-visibility", {
    accessToken,
    method: "POST",
    body,
  });
}

export async function refreshLeaderboard({ accessToken, period, source }: AnyRecord = {}) {
  const body: AnyRecord = {};
  if (period) body.period = period;
  if (typeof source === "string" && source.trim()) body.source = source.trim();
  return fetchInsforgeFunction("tokentracker-leaderboard-refresh", {
    accessToken,
    method: "POST",
    body,
  });
}

/**
 * Detailed per-user profile used by the leaderboard modal.
 * Returns hero totals, streak, best day, model highlight, per-provider
 * breakdown, 365-day heatmap and a period-scoped daily trend.
 * See dashboard/edge-patches/tokentracker-leaderboard-profile.ts for the
 * canonical response shape.
 */
export async function getLeaderboardProfile({
  accessToken,
  userId,
  period,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    // Minimal stub for dashboard:dev (no live edge). Frontend layout should
    // render without throwing; numbers don't need to be plausible.
    const mock = getMockLeaderboard({ seed: accessToken, period, metric: "all", limit: 250, offset: 0 });
    const entries = Array.isArray(mock?.entries) ? mock.entries : [];
    const match: any = entries.find((entry: any) => entry?.user_id === userId) || entries[0] || null;
    const tokens = Number(match?.total_tokens) || 0;
    const today = new Date();
    const heatmap = Array.from({ length: 365 }).map((_, i) => {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - (364 - i));
      return { date: d.toISOString().slice(0, 10), total_tokens: i % 7 === 0 ? Math.floor(tokens / 365) : 0 };
    });
    const dailyTrend = heatmap.slice(-7);
    return {
      user: {
        user_id: userId,
        display_name: match?.display_name || "Mock User",
        avatar_url: match?.avatar_url || null,
        github_url: match?.github_url || null,
        is_anonymous: false,
        rank: match?.rank ?? null,
      },
      period: {
        kind: period || "week",
        from: mock?.from ?? null,
        to: mock?.to ?? null,
        generated_at: mock?.generated_at ?? new Date().toISOString(),
      },
      totals: {
        total_tokens: tokens,
        estimated_cost_usd: Number(match?.estimated_cost_usd) || 0,
        active_days: 53,
        avg_per_day_usd: 0,
      },
      streak: { current_days: 3, longest_days: 12 },
      best_day: tokens
        ? { date: today.toISOString().slice(0, 10), total_tokens: Math.floor(tokens / 30), estimated_cost_usd: 0 }
        : null,
      models: { count: 5, favorite: { model_name: "claude-opus-4-7", total_tokens: Math.floor(tokens / 2) } },
      by_provider: [],
      heatmap,
      daily_trend: dailyTrend,
    };
  }
  return fetchInsforgeFunction("tokentracker-leaderboard-profile", {
    accessToken,
    params: { user_id: userId, period },
  });
}

function mockLikeCount(userId: string | undefined | null) {
  if (!userId) return 0;
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash % 165) + 24;
}

export async function getProfileLikes({ userId }: AnyRecord = {}) {
  if (isMockEnabled()) {
    return { count: mockLikeCount(userId) };
  }
  // Public read 鈥?same rationale as getLeaderboard: don't attach Authorization
  // so a malformed/expired JWT can't 500 the gateway for unauthenticated callers.
  return fetchInsforgeFunction("tokentracker-profile-likes", {
    params: { user_id: userId },
  });
}

export async function bumpProfileLike({ userId, delta, accessToken }: AnyRecord = {}) {
  if (isMockEnabled()) {
    return { count: Math.max(0, mockLikeCount(userId) + Number(delta || 0)) };
  }
  return fetchInsforgeFunction("tokentracker-profile-likes", {
    accessToken,
    method: "POST",
    body: { user_id: userId, delta },
  });
}

export async function getUserStatus(_opts: AnyRecord = {}) {
  if (isMockEnabled()) {
    const now = new Date().toISOString();
    return {
      user_id: "local-user",
      created_at: now,
      pro: { active: false, sources: [], expires_at: null, partial: false, as_of: now },
      subscriptions: { partial: false, as_of: now, items: [] },
      install: {
        partial: false,
        as_of: now,
        has_active_device_token: false,
        has_active_device: false,
        active_device_tokens: 0,
        active_devices: 0,
        latest_token_activity_at: null,
        latest_device_seen_at: null,
      },
    };
  }
  return fetchLocalJson(PATHS.userStatus);
}

export async function triggerLocalSync({ signal }: AnyRecord = {}) {
  const authHeaders = await getLocalApiAuthHeaders();
  const response = await fetchLocalApi(await buildLocalApiUrl(`/functions/${PATHS.localSync}`), {
    method: "POST",
    headers: { Accept: "application/json", ...authHeaders },
    cache: "no-store",
    signal,
  });
  const payload = await readJsonResponse(response).catch(() => ({
    ok: false,
    error: `Local sync request failed with HTTP ${response.status}`,
  }));
  if (!response.ok || payload?.ok === false) {
    const message = payload?.error || payload?.message || `Local sync request failed with HTTP ${response.status}`;
    const error: any = new Error(message);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function getUsageModelBreakdown({
  from,
  to,
  source,
  timeZone,
  tzOffsetMinutes,
  accessToken,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockUsageModelBreakdown({ from, to, seed: accessToken });
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildFilterParams({ source });
  return fetchLocalJson(PATHS.usageModelBreakdown, { from, to, ...filterParams, ...tzParams }, { accessToken });
}

/** TICKET-01 A4: provider stats (per-source aggregate leaderboard). */
export async function getProviderStats({
  from,
  to,
  sources,
  models,
  agentIds,
  timeZone,
  tzOffsetMinutes,
  accessToken,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockProviderStats({ from, to, seed: accessToken });
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildMultiFilterParams({ sources, models, agentIds });
  return fetchLocalJson(PATHS.providerStats, { from, to, ...filterParams, ...tzParams }, { accessToken });
}

/** TICKET-01 A5: model stats (per source×model aggregate leaderboard). */
export async function getModelStats({
  from,
  to,
  sources,
  models,
  agentIds,
  timeZone,
  tzOffsetMinutes,
  accessToken,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockModelStats({ from, to, seed: accessToken });
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildMultiFilterParams({ sources, models, agentIds });
  return fetchLocalJson(PATHS.modelStats, { from, to, ...filterParams, ...tzParams }, { accessToken });
}

export async function getUsageCategoryBreakdown({
  from,
  to,
  source = "claude",
  timeZone,
  tzOffsetMinutes,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockUsageCategoryBreakdown({ from, to, source });
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  return fetchLocalJson(PATHS.usageCategoryBreakdown, { from, to, source, ...tzParams });
}

export async function getUsageDaily({
  from,
  to,
  source,
  model,
  timeZone,
  tzOffsetMinutes,
  accessToken,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockUsageDaily({ from, to, seed: accessToken });
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildFilterParams({ source, model });
  return fetchLocalJson(PATHS.usageDaily, { from, to, ...filterParams, ...tzParams }, { accessToken });
}

export async function getUsageHourly({
  day,
  source,
  model,
  timeZone,
  tzOffsetMinutes,
  accessToken,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockUsageHourly({ day, seed: accessToken });
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildFilterParams({ source, model });
  const params = day ? { day, ...filterParams, ...tzParams } : { ...filterParams, ...tzParams };
  return fetchLocalJson(PATHS.usageHourly, params, { accessToken });
}

export async function getUsageMonthly({
  months,
  to,
  source,
  model,
  timeZone,
  tzOffsetMinutes,
  accessToken,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockUsageMonthly({ months, to, seed: accessToken });
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildFilterParams({ source, model });
  return fetchLocalJson(PATHS.usageMonthly, {
    ...(months ? { months: String(months) } : {}),
    ...(to ? { to } : {}),
    ...filterParams,
    ...tzParams,
  }, { accessToken });
}

export async function getUsageLimits(opts: { refresh?: boolean } = {}) {
  const params = opts?.refresh ? { refresh: "1" } : undefined;
  return fetchLocalJson(PATHS.usageLimits, params);
}

export async function getUsageHeatmap({
  weeks,
  to,
  weekStartsOn,
  source,
  model,
  timeZone,
  tzOffsetMinutes,
  accessToken,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockUsageHeatmap({ weeks, to, weekStartsOn, seed: accessToken });
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildFilterParams({ source, model });
  return fetchLocalJson(PATHS.usageHeatmap, {
    weeks: String(weeks),
    to,
    week_starts_on: weekStartsOn,
    ...filterParams,
    ...tzParams,
  }, { accessToken });
}

// ---------------------------------------------------------------------------
// Cloud (account-wide) fetchers. Hit InsForge directly at
// `${INSFORGE_BASE_URL}/functions/tokentracker-account-*` with the user's
// JWT in the Authorization header. The edge functions verify HS256 against
// JWT_SECRET, then aggregate across the user's active devices (dedup by
// (hour, source, model), drop revoked-device historical rows).
//
// Use the same response schema as the corresponding local /functions/* so
// hooks can swap fetchers based on `accountView` with no other transform.
// ---------------------------------------------------------------------------

const ACCOUNT_PATHS = {
  summary: "tokentracker-account-summary",
  daily: "tokentracker-account-daily",
  hourly: "tokentracker-account-hourly",
  monthly: "tokentracker-account-monthly",
  heatmap: "tokentracker-account-heatmap",
  modelBreakdown: "tokentracker-account-model-breakdown",
} as const;

async function fetchAccountFunction(
  slug: string,
  params: AnyRecord | undefined,
  accessToken: string,
) {
  if (!accessToken || !isValidJwtShape(accessToken)) {
    const err: any = new Error("Account view requires a signed-in user");
    err.status = 401;
    throw err;
  }
  const baseUrl = getInsforgeRemoteUrl();
  if (!baseUrl) {
    const err: any = new Error("InsForge base URL not configured");
    err.status = 0;
    throw err;
  }
  const root = baseUrl.replace(/\/$/, "");
  const url = new URL(`${root}/functions/${slug}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== "") url.searchParams.set(key, String(value));
    }
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`,
  };
  const anonKey = getInsforgeAnonKey();
  if (anonKey) headers.apikey = anonKey;
  const response = await fetch(url.toString(), {
    method: "GET",
    headers,
    cache: "no-store",
  });
  if (!response.ok) {
    const err: any = new Error(`Request failed with HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return response.json();
}

export async function fetchCloudUsageSummary({
  from,
  to,
  source,
  model,
  timeZone,
  tzOffsetMinutes,
  rolling = false,
  accessToken,
}: AnyRecord = {}) {
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildFilterParams({ source, model });
  const rollingParams = rolling ? { rolling: "1" } : {};
  return fetchAccountFunction(
    ACCOUNT_PATHS.summary,
    { from, to, ...filterParams, ...tzParams, ...rollingParams },
    accessToken,
  );
}

export async function fetchCloudUsageDaily({
  from,
  to,
  source,
  model,
  timeZone,
  tzOffsetMinutes,
  accessToken,
}: AnyRecord = {}) {
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildFilterParams({ source, model });
  return fetchAccountFunction(
    ACCOUNT_PATHS.daily,
    { from, to, ...filterParams, ...tzParams },
    accessToken,
  );
}

export async function fetchCloudUsageHourly({
  day,
  source,
  model,
  timeZone,
  tzOffsetMinutes,
  accessToken,
}: AnyRecord = {}) {
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildFilterParams({ source, model });
  const params = day ? { day, ...filterParams, ...tzParams } : { ...filterParams, ...tzParams };
  return fetchAccountFunction(ACCOUNT_PATHS.hourly, params, accessToken);
}

export async function fetchCloudUsageMonthly({
  months,
  to,
  source,
  model,
  timeZone,
  tzOffsetMinutes,
  accessToken,
}: AnyRecord = {}) {
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildFilterParams({ source, model });
  return fetchAccountFunction(
    ACCOUNT_PATHS.monthly,
    {
      ...(months ? { months: String(months) } : {}),
      ...(to ? { to } : {}),
      ...filterParams,
      ...tzParams,
    },
    accessToken,
  );
}

export async function fetchCloudUsageHeatmap({
  weeks,
  to,
  weekStartsOn,
  source,
  model,
  timeZone,
  tzOffsetMinutes,
  accessToken,
}: AnyRecord = {}) {
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildFilterParams({ source, model });
  return fetchAccountFunction(
    ACCOUNT_PATHS.heatmap,
    {
      weeks: String(weeks),
      to,
      week_starts_on: weekStartsOn,
      ...filterParams,
      ...tzParams,
    },
    accessToken,
  );
}

export async function fetchCloudUsageModelBreakdown({
  from,
  to,
  source,
  timeZone,
  tzOffsetMinutes,
  accessToken,
}: AnyRecord = {}) {
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildFilterParams({ source });
  return fetchAccountFunction(
    ACCOUNT_PATHS.modelBreakdown,
    { from, to, ...filterParams, ...tzParams },
    accessToken,
  );
}

// ---------------------------------------------------------------------------
// W03C: Xiaomi MiMo Console Session API
// ---------------------------------------------------------------------------

// Server-side status lifecycle. The local API is the source of truth — the
// frontend MUST NOT treat "POST created" as "connected".
export type ConsoleSessionStatus =
  | "pending_login"
  | "login_started"
  | "awaiting_verification"
  | "connected"
  | "expired"
  | "revoked"
  | "failed";

export const CONNECTED_CONSOLE_STATUSES: ReadonlyArray<ConsoleSessionStatus> = ["connected"];

export interface ConsoleSession {
  id: string;
  provider_id: string;
  auth_kind: string;
  display_name: string;
  status: ConsoleSessionStatus;
  session_ref: string;
  connected_at: string;
  last_verified_at: string;
  last_error_code: string;
  last_error_message: string;
}

export interface ConsoleSessionsResponse {
  sessions: ConsoleSession[];
}

export interface CreateConsoleSessionResult {
  session: ConsoleSession;
  sessions: ConsoleSession[];
}

function getTauriInvoke() {
  if (typeof window === "undefined") return null;
  const tauri = (window as any).__TAURI__;
  if (typeof tauri?.core?.invoke === "function") return tauri.core.invoke;
  if (typeof tauri?.invoke === "function") return tauri.invoke;
  return null;
}

export async function getConsoleSessions(): Promise<ConsoleSessionsResponse> {
  if (isTauriRuntime()) {
    return fetchLocalJson(PATHS.consoleSessions) as Promise<ConsoleSessionsResponse>;
  }
  throw new Error("该功能仅桌面端支持");
}

export async function createConsoleSession(params: {
  provider_id: string;
  auth_kind: string;
  display_name: string;
  session_ref: string;
}): Promise<CreateConsoleSessionResult> {
  if (!isTauriRuntime()) {
    throw new Error("该功能仅桌面端支持");
  }
  const authHeaders = await getLocalApiAuthHeaders();
  return fetchLocalJson(PATHS.consoleSessions, undefined, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify(params),
  }) as Promise<CreateConsoleSessionResult>;
}

export async function deleteConsoleSession(id: string): Promise<{ ok: boolean }> {
  if (!isTauriRuntime()) {
    throw new Error("该功能仅桌面端支持");
  }
  const authHeaders = await getLocalApiAuthHeaders();
  return fetchLocalJson(`${PATHS.consoleSessions}?id=${encodeURIComponent(id)}`, undefined, {
    method: "DELETE",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders,
    },
  }) as Promise<{ ok: boolean }>;
}

export interface XiaomiMimoQuota {
  total_quota: number;
  used_quota: number;
  remaining_quota: number;
  expires_at?: string | null;
  provider_reported_at?: string;
}

export interface NativeSessionResult {
  connected: boolean;
  session_ref: string;
  state_code: string;
  error_code: string;
  error_message: string;
  quota?: XiaomiMimoQuota;
}

/**
 * Verify a session by forwarding the native bridge's XiaomiMimoSessionStatus
 * back to the local API. The local API WILL NOT mark the session connected
 * without a real `native_result` payload.
 */
export async function verifyConsoleSession(
  id: string,
  nativeResult: NativeSessionResult,
): Promise<{ ok: boolean; session: ConsoleSession }> {
  if (!isTauriRuntime()) {
    throw new Error("该功能仅桌面端支持");
  }
  const authHeaders = await getLocalApiAuthHeaders();
  return fetchLocalJson(
    `${PATHS.consoleSessions}/${encodeURIComponent(id)}/verify`,
    undefined,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({ native_result: nativeResult }),
    },
  ) as Promise<{ ok: boolean; session: ConsoleSession }>;
}

export interface XiaomiMimoSessionStatus extends NativeSessionResult {}

export async function openXiaomiMimoConsoleLogin(sessionRef: string): Promise<XiaomiMimoSessionStatus> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error("Tauri runtime not available");
  }
  return invoke("open_xiaomi_mimo_console_login", { sessionRef });
}

export async function verifyXiaomiMimoConsoleSession(sessionRef: string): Promise<XiaomiMimoSessionStatus> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error("Tauri runtime not available");
  }
  return invoke("verify_xiaomi_mimo_console_session", { sessionRef });
}

export async function deleteXiaomiMimoConsoleSession(sessionRef: string): Promise<void> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error("Tauri runtime not available");
  }
  return invoke("delete_xiaomi_mimo_console_session", { sessionRef });
}

export interface GlmBalanceSnapshot {
  balance: number;
  available_balance: number;
  credit_balance: number;
  currency: string;
  provider_reported_at: string;
}

export interface GlmSessionStatus extends NativeSessionResult {
  balance?: GlmBalanceSnapshot;
}

export async function openGlmConsoleLogin(sessionRef: string): Promise<GlmSessionStatus> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error("Tauri runtime not available");
  }
  return invoke("open_glm_console_login", { sessionRef });
}

export async function verifyGlmConsoleSession(sessionRef: string): Promise<GlmSessionStatus> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error("Tauri runtime not available");
  }
  return invoke("verify_glm_console_session", { sessionRef });
}

export async function deleteGlmConsoleSession(sessionRef: string): Promise<void> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error("Tauri runtime not available");
  }
  return invoke("delete_glm_console_session", { sessionRef });
}

export interface CodexQuotaSnapshot {
  total_quota: number;
  used_quota: number;
  remaining_quota: number;
  provider_reported_at: string;
  quota_windows?: Array<{
    kind: string;
    unit: string;
    total: number;
    used: number;
    remaining: number;
    percentage?: number;
    resets_at?: string;
  }>;
}

export interface CodexSessionStatus extends NativeSessionResult {
  authorized: boolean;
  quota_sync_status?: "idle" | "success" | "error";
  quota?: CodexQuotaSnapshot;
}

export async function openCodexConsoleLogin(sessionRef: string): Promise<CodexSessionStatus> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error("Tauri runtime not available");
  }
  return invoke("open_codex_console_login", { sessionRef });
}

export async function verifyCodexConsoleSession(sessionRef: string): Promise<CodexSessionStatus> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error("Tauri runtime not available");
  }
  return invoke("verify_codex_console_session", { sessionRef });
}

export async function syncCodexConsoleQuota(sessionRef: string): Promise<CodexSessionStatus> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error("Tauri runtime not available");
  }
  return invoke("sync_codex_console_quota", { sessionRef });
}

export async function discardCodexPendingSession(sessionRef: string): Promise<boolean> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error("Tauri runtime not available");
  }
  return invoke("discard_codex_pending_session", { sessionRef });
}

export async function deleteCodexConsoleSession(sessionRef: string): Promise<void> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error("Tauri runtime not available");
  }
  return invoke("delete_codex_console_session", { sessionRef });
}

export interface ClaudeQuotaSnapshot {
  total_quota: number;
  used_quota: number;
  remaining_quota: number;
  provider_reported_at: string;
  quota_windows?: Array<{
    kind: string;
    unit: string;
    total: number;
    used: number;
    remaining: number;
    percentage?: number;
    resets_at?: string;
  }>;
}

export interface ClaudeSessionStatus extends NativeSessionResult {
  quota?: ClaudeQuotaSnapshot;
}

export async function openClaudeConsoleLogin(sessionRef: string): Promise<ClaudeSessionStatus> {
  const invoke = getTauriInvoke();
  if (!invoke) throw new Error("Tauri runtime not available");
  return invoke("open_claude_console_login", { sessionRef });
}

export async function verifyClaudeConsoleSession(sessionRef: string): Promise<ClaudeSessionStatus> {
  const invoke = getTauriInvoke();
  if (!invoke) throw new Error("Tauri runtime not available");
  return invoke("verify_claude_console_session", { sessionRef });
}

export async function deleteClaudeConsoleSession(sessionRef: string): Promise<void> {
  const invoke = getTauriInvoke();
  if (!invoke) throw new Error("Tauri runtime not available");
  return invoke("delete_claude_console_session", { sessionRef });
}

export interface CursorQuotaSnapshot {
  total_quota: number;
  used_quota: number;
  remaining_quota: number;
  provider_reported_at: string;
  quota_windows?: Array<{
    kind: string;
    unit: string;
    total: number;
    used: number;
    remaining: number;
    percentage?: number;
    resets_at?: string;
  }>;
}

export interface CursorSessionStatus extends NativeSessionResult {
  quota?: CursorQuotaSnapshot;
}

export async function openCursorConsoleLogin(sessionRef: string): Promise<CursorSessionStatus> {
  const invoke = getTauriInvoke();
  if (!invoke) throw new Error("Tauri runtime not available");
  return invoke("open_cursor_console_login", { sessionRef });
}

export async function verifyCursorConsoleSession(sessionRef: string): Promise<CursorSessionStatus> {
  const invoke = getTauriInvoke();
  if (!invoke) throw new Error("Tauri runtime not available");
  return invoke("verify_cursor_console_session", { sessionRef });
}

export async function deleteCursorConsoleSession(sessionRef: string): Promise<void> {
  const invoke = getTauriInvoke();
  if (!invoke) throw new Error("Tauri runtime not available");
  return invoke("delete_cursor_console_session", { sessionRef });
}

export interface KimiQuotaSnapshot {
  total_quota: number;
  used_quota: number;
  remaining_quota: number;
  provider_reported_at: string;
  quota_windows?: Array<{
    kind: string;
    unit: string;
    total: number;
    used: number;
    remaining: number;
    percentage?: number;
    resets_at?: string;
  }>;
}

export interface KimiSessionStatus extends NativeSessionResult {
  quota?: KimiQuotaSnapshot;
}

export async function openKimiConsoleLogin(sessionRef: string): Promise<KimiSessionStatus> {
  const invoke = getTauriInvoke();
  if (!invoke) throw new Error("Tauri runtime not available");
  return invoke("open_kimi_console_login", { sessionRef });
}

export async function verifyKimiConsoleSession(sessionRef: string): Promise<KimiSessionStatus> {
  const invoke = getTauriInvoke();
  if (!invoke) throw new Error("Tauri runtime not available");
  return invoke("verify_kimi_console_session", { sessionRef });
}

export async function deleteKimiConsoleSession(sessionRef: string): Promise<void> {
  const invoke = getTauriInvoke();
  if (!invoke) throw new Error("Tauri runtime not available");
  return invoke("delete_kimi_console_session", { sessionRef });
}
