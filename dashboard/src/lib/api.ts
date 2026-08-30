import {
  getMockUsageDaily,
  getMockUsageBounds,
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
  getMockSpendTimeseries,
  getMockTokenPlans,
  isMockEnabled,
} from "./mock-data";
import { getInsforgeFunctionsUrl, getInsforgeRemoteUrl, getInsforgeAnonKey } from "./insforge-config";
import { isValidJwtShape } from "./auth-token";
import { getLocalApiAuthHeaders } from "./local-api-auth";
import { buildLocalApiUrl, isTauriRuntime } from "./local-api-url";
import { getBrowserTimeZone, getBrowserTimeZoneOffsetMinutes } from "./timezone";
import { DASHBOARD_AGENTS } from "./agent-adapters-dashboard";
import { verifySignedStaticFeedEnvelope } from "./signed-static-feed";

type AnyRecord = Record<string, any>;

export const TOKEN_PLANS_CHANGED_EVENT = "token-eyes:token-plans-changed";

function notifyTokenPlansChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(TOKEN_PLANS_CHANGED_EVENT));
  }
}

export type CodexResetEventType =
  | "reset_upcoming"
  | "reset_completed"
  | "manual_reset"
  | "unexpected_quota_restore"
  | "banked_reset_available"
  | "official_reset_announcement";

export interface CodexResetMonitorStatus {
  enabled: boolean;
  configured: boolean | null;
  running: boolean;
  last_checked_at: string | null;
  last_successful_at: string | null;
  next_check_at: string | null;
  last_error_code: string | null;
  failure_count: number;
  unread_count: number;
  feed_enabled: boolean;
  feed_last_checked_at: string | null;
  feed_error_code: string | null;
  backfill_error_code: string | null;
}

export interface CodexResetEvent {
  id: string;
  type: CodexResetEventType;
  agent: "codex";
  account_key: string;
  window: "rolling_5_hour" | "rolling_weekly" | null;
  created_at: string;
  reset_at: string | null;
  official_url: string;
  source: "local_quota" | "live_usage" | "codex_rollout" | "signed_feed";
  observed_at: string | null;
  previous_used_percent: number | null;
  current_used_percent: number | null;
  confidence: "confirmed" | "recovered";
  alert_eligible: boolean;
  occurred_at?: string;
  source_url?: string;
  source_author?: "OpenAI" | "thsottiaux" | null;
  source_post_id?: string | null;
  reset_kind?: "hard" | "banked" | "mixed" | "unknown";
  reset_scope?: "all_paid_users" | "all_codex_work_users" | "unknown";
  title?: string;
  summary?: string;
  body?: string;
  expires_at?: string;
}

export interface CodexResetHistoryEvent extends CodexResetEvent {
  type: "official_reset_announcement";
  occurred_at: string;
}

export interface CodexResetEventsResponse {
  ok: boolean;
  status: CodexResetMonitorStatus;
  events: CodexResetEvent[];
  tray_events: CodexResetEvent[];
  widget_events: CodexResetEvent[];
  notification_events: CodexResetEvent[];
  history: CodexResetHistoryEvent[];
}

export type DesktopWidgetAgent =
  | "all"
  | "claude"
  | "codex"
  | "cursor"
  | "trae"
  | "codebuddy"
  | "gemini"
  | "hermes"
  | "openclaw"
  | "opencode"
  | "antigravity"
  | "zed"
  | "workbuddy"
  | "kimi"
  | "kimi-code"
  | "pi"
  | "grok"
  | "copilot"
  | "deepseek-harness";
export type DesktopWidgetMode = "projects" | "limits" | "models";
export type DesktopWidgetMaterial = "frost" | "graphite" | "ocean" | "sand";
export type DesktopWidgetActiveSessionWindow = "1h" | "3h" | "5h" | "1d" | "3d";

export interface DesktopWidgetPrefs {
  version: number;
  visible: boolean;
  x?: number | null;
  y?: number | null;
  width: number;
  height: number;
  collapsedHeight: number;
  expandedHeight: number;
  scaleFactor: number;
  selectedAgent: DesktopWidgetAgent;
  mode: DesktopWidgetMode;
  expanded: boolean;
  material: DesktopWidgetMaterial;
  opacity: number;
  alwaysOnTop: boolean;
  activeSessionWindow: DesktopWidgetActiveSessionWindow;
  selectedProjectIds: string[];
  selectedLimitIds: string[] | null;
  selectedProjects: Array<{
    id: string;
    label: string;
    path: string;
  }>;
}

export interface DesktopWidgetViewModel {
  agents: DesktopWidgetAgent[];
  selectedAgent: DesktopWidgetAgent;
  projectStatus: {
    red: number;
    yellow: number;
    green: number;
    unknown: number;
    recentProjects: Array<{
      id: string;
      label: string;
      updatedAt: string | null;
    }>;
    projects: Array<{
      id: string;
      label: string;
      red: number;
      yellow: number;
      green: number;
      unknown: number;
      sessions: Array<{
        id: string;
        label: string | null;
        status: "red" | "yellow" | "green" | "stopped" | "unknown";
        state: "waiting_approval" | "error" | "running" | "completed" | "stopped" | "unknown";
        updatedAt: string | null;
      }>;
    }>;
  };
  limits: Array<{
    id: string;
    planId: string;
    agent: string;
    provider: string;
    planLabel: string;
    accountLabel: string;
    subscriptionAmount: number;
    subscriptionCurrency: string;
    kind: string;
    window: string;
    usedPercent: number | null;
    resetAt: string | null;
    expiresAt: string | null;
    notes: string | null;
    error: string | null;
  }>;
  totals: {
    tokens: number;
    costUsd: number;
    models: Array<{
      name: string;
      tokens: number;
      share: number;
      costUsd: number;
    }>;
  };
  pendingReset: {
    id: string;
    agent: string;
    window: "rolling_5_hour" | "rolling_weekly" | null;
    occurredAt: string;
    previousUsedPercent: number | null;
    currentUsedPercent: number | null;
  } | null;
}

const PATHS = {
  usageBounds: "tokentracker-usage-bounds",
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
  limitAccounts: "tokentracker-limit-accounts",
  workbuddyQuota: "tokentracker-workbuddy-quota",
  codexResetEvents: "tokentracker-codex-reset-events",
  desktopWidget: "tokentracker-desktop-widget",
  localSettings: "tokentracker-local-settings",
  clearLocalData: "tokentracker-clear-local-data",
  detectDataDirectories: "tokentracker-detect-data-directories",
  selectDirectory: "tokentracker-select-directory",
  tokenPlans: "tokentracker-token-plans",
  tokenPlansOrder: "tokentracker-token-plans-order",
  tokenPlansRefresh: "tokentracker-token-plans-refresh",
  tokenPlanCatalog: "tokentracker-token-plan-catalog",
  planMarket: "tokentracker-plan-market",
  spendRecords: "tokentracker-spend-records",
  otherAiSpendGroups: "tokentracker-other-ai-groups",
  spendTimeseries: "tokentracker-spend-timeseries",
  realtimeSessions: "tokentracker-realtime-sessions",
  requestUsageRecords: "tokentracker-request-usage-records",
  providerStats: "tokentracker-provider-stats",
  providerApiStats: "tokentracker-provider-api-stats",
  usageAttribution: "tokentracker-usage-attribution",
  observabilityExport: "tokentracker-observability-export",
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
  officialModelPricing: "tokentracker-official-model-pricing",
};

export async function getUsageBounds({
  timeZone,
  tzOffsetMinutes,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockUsageBounds();
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  return fetchLocalJson(PATHS.usageBounds, tzParams);
}

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

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw signal.reason || new DOMException("The operation was aborted", "AbortError");
}

async function fetchLocalApi(url: string, init: RequestInit) {
  const attempts = isTauriRuntime() ? 10 : 1;
  let lastError: unknown = null;
  for (let i = 0; i < attempts; i += 1) {
    throwIfAborted(init.signal || undefined);
    try {
      const response = await fetch(url, init);
      throwIfAborted(init.signal || undefined);
      return response;
    } catch (err) {
      throwIfAborted(init.signal || undefined);
      lastError = err;
      if (i < attempts - 1) {
        await sleep(250);
        throwIfAborted(init.signal || undefined);
      }
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
      throw new Error("本地 API 未连接：桌面应用收到的是前端 HTML，不是 JSON。请重新打开 Token Eyes，或确认 Token Eyes 本地服务已启动后再刷新。");
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

function appendSearchParams(url: URL, params?: AnyRecord) {
  if (!params) return;
  for (const [key, value] of Object.entries(params)) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (item != null && item !== "") url.searchParams.append(key, String(item));
    }
  }
}

async function fetchLocalJson(slug: string, params?: AnyRecord, options?: AnyRecord) {
  const accessToken = options?.accessToken as string | undefined;
  const signal = options?.signal as AbortSignal | undefined;
  const accountSlug = USAGE_TO_ACCOUNT_SLUG[slug];
  throwIfAborted(signal);

  // Deployed web (e.g. tokentracker.cc): there's no local CLI behind
  // window.location.origin, so usage-* calls would 404. When the visitor is
  // signed in and the slug has a cloud account-* mirror, route to the cloud
  // aggregator (cross-device usage by user_id) with the auth token. Local CLI
  // (localhost) keeps the original same-origin usage-* path.
  if (!isTauriRuntime() && !isLocalhostHost() && accessToken && accountSlug) {
    const base = getInsforgeRemoteUrl().replace(/\/$/, "");
    const url = new URL(`${base}/functions/${accountSlug}`);
    appendSearchParams(url, params);
    const headers: Record<string, string> = { Accept: "application/json" };
    const anonKey = getInsforgeAnonKey();
    if (anonKey) headers.apikey = anonKey;
    if (isValidJwtShape(accessToken)) headers.Authorization = `Bearer ${accessToken}`;
    const response = await fetch(url.toString(), { headers, cache: "no-store", signal });
    throwIfAborted(signal);
    if (!response.ok) {
      throw await buildErrorFromResponse(response);
    }
    const payload = await response.json();
    throwIfAborted(signal);
    return payload;
  }

  const url = new URL(await buildLocalApiUrl(`/functions/${slug}`));
  throwIfAborted(signal);
  appendSearchParams(url, params);
  const { accessToken: _omit, ...fetchOptions } = options || {};
  const response = await fetchLocalApi(url.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
    ...fetchOptions,
  });
  throwIfAborted(signal);
  if (!response.ok) {
    throw await buildErrorFromResponse(response);
  }
  const payload = await readJsonResponse(response);
  throwIfAborted(signal);
  return payload;
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

function buildModelBreakdownSourceParams({ source, sources }: AnyRecord = {}) {
  const candidates = Array.isArray(sources)
    ? sources
    : sources === null
      ? []
      : [source];
  const normalized = [...new Set(
    candidates.map((value) => typeof value === "string" ? value.trim().toLowerCase() : "").filter(Boolean),
  )].sort();
  return normalized.length > 0 ? { source: normalized } : {};
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

export async function clearLocalData() {
  const authHeaders = await getLocalApiAuthHeaders();
  return fetchLocalJson(PATHS.clearLocalData, undefined, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({ confirm: true }),
  });
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

export async function verifyOfficialModelPricing(params: AnyRecord = {}) {
  const authHeaders = await getLocalApiAuthHeaders();
  return fetchLocalJson(PATHS.officialModelPricing, undefined, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify(params),
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
  if (isMockEnabled()) {
    return getMockTokenPlans();
  }
  return fetchLocalJson(PATHS.tokenPlans);
}

export async function getApiBillingAccounts({ month, timeZone }: AnyRecord = {}) {
  return fetchLocalJson(PATHS.apiBillingAccounts, {
    month,
    time_zone: timeZone,
  });
}

export async function saveTokenPlan(record: AnyRecord = {}, options: { notify?: boolean } = {}) {
  const authHeaders = await getLocalApiAuthHeaders();
  const result = await fetchLocalJson(PATHS.tokenPlans, undefined, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify(record),
  });
  if (options.notify !== false) notifyTokenPlansChanged();
  return result;
}

export async function deleteTokenPlan(id: string) {
  const authHeaders = await getLocalApiAuthHeaders();
  const result = await fetchLocalJson(PATHS.tokenPlans, undefined, {
    method: "DELETE",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({ id }),
  });
  notifyTokenPlansChanged();
  return result;
}

export async function reorderTokenPlans(ids: string[]) {
  const authHeaders = await getLocalApiAuthHeaders();
  const result = await fetchLocalJson(PATHS.tokenPlansOrder, undefined, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({ ids }),
  });
  notifyTokenPlansChanged();
  return result;
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
  if (isMockEnabled()) {
    return getMockSpendTimeseries(params);
  }
  const tzParams = buildTimeZoneParams(params || {});
  const multiParams = buildMultiFilterParams(params || {});
  return fetchLocalJson(PATHS.spendTimeseries, { ...(params || {}), ...tzParams, ...multiParams });
}

const realtimeSessionsCache = new Map<string, AnyRecord>();

function realtimeSessionsCacheKey(range: string, month?: string) {
  return `${range}:${month || "current"}`;
}

export function peekRealtimeSessions(range = "today", month?: string) {
  return realtimeSessionsCache.get(realtimeSessionsCacheKey(range, month)) || null;
}

export function resetRealtimeSessionsCacheForTests() {
  realtimeSessionsCache.clear();
}

export async function getRealtimeSessions(range = "today", signal?: AbortSignal, month?: string) {
  const tzParams = buildTimeZoneParams({
    timeZone: getBrowserTimeZone(),
    tzOffsetMinutes: getBrowserTimeZoneOffsetMinutes(),
  });
  const result = await fetchLocalJson(PATHS.realtimeSessions, { range, ...(month ? { month } : {}), ...tzParams }, { signal });
  realtimeSessionsCache.set(realtimeSessionsCacheKey(range, month), result);
  return result;
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
  recordKind,
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
  // V2-W3: server-side granularity filter ("request_event" | "aggregate_bucket").
  if (recordKind) params.record_kind = String(recordKind);
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

export async function saveOtherAiSpendGroup(group: AnyRecord = {}) {
  const authHeaders = await getLocalApiAuthHeaders();
  return fetchLocalJson(PATHS.otherAiSpendGroups, undefined, {
    method: group.id ? "PUT" : "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify(group),
  });
}

export async function deleteOtherAiSpendGroup(id: string) {
  const authHeaders = await getLocalApiAuthHeaders();
  return fetchLocalJson(PATHS.otherAiSpendGroups, undefined, {
    method: "DELETE",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ id }),
  });
}

export async function getPlanMarketState({ signal }: { signal?: AbortSignal } = {}) {
  return fetchLocalJson(PATHS.planMarket, undefined, { signal });
}

export async function refreshPlanMarketCatalog() {
  const authHeaders = await getLocalApiAuthHeaders();
  return fetchLocalJson(PATHS.planMarket, undefined, {
    method: "POST",
    headers: { Accept: "application/json", ...authHeaders },
  });
}

export async function reorderOtherAiSpendGroups(ids: string[]) {
  const authHeaders = await getLocalApiAuthHeaders();
  return fetchLocalJson(PATHS.otherAiSpendGroups, undefined, {
    method: "PUT",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ action: "reorder", ids }),
  });
}

export async function reorderOtherAiSpendRecords(ids: string[], move: AnyRecord = {}) {
  return updateSpendRecord({ action: "reorder", ids, ...move });
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
  baseUrl?: string;
  params?: AnyRecord;
  body?: unknown;
  timeoutMs?: number;
  publicSimpleRequest?: boolean;
} = {}) {
  const baseUrl = options.baseUrl || getInsforgeFunctionsUrl();
  if (!baseUrl) throw new Error("InsForge base URL not configured");
  const root = baseUrl.replace(/\/$/, "");
  const url = new URL(`${root}/${slug}`);
  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      if (value != null && value !== "") url.searchParams.set(key, String(value));
    }
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (!options.publicSimpleRequest) headers["Content-Type"] = "application/json";
  const anonKey = getInsforgeAnonKey();
  if (anonKey && !options.publicSimpleRequest) headers.apikey = anonKey;
  // Only attach Authorization if the token is a well-formed JWT. InsForge's
  // platform gateway validates the JWT before user code runs and returns
  // HTTP 500 (JWSError) for any malformed value 鈥?which would break
  // public endpoints like leaderboard for users whose stored token got
  // corrupted or truncated.
  if (options.accessToken && isValidJwtShape(options.accessToken)) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }

  const timeoutMs = Math.max(500, Math.min(30_000, Number(options.timeoutMs) || 10_000));
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    const error = new Error(`Request timed out after ${timeoutMs}ms`);
    error.name = "TimeoutError";
    controller.abort(error);
  }, timeoutMs);
  let res;
  try {
    res = await fetch(url.toString(), {
      method: options.method || "GET",
      headers,
      signal: controller.signal,
      ...(options.body != null ? { body: JSON.stringify(options.body) } : {}),
    });
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res.ok) {
    const err: any = new Error(`Request failed with HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

const LEADERBOARD_SAFE_PERIODS = new Set(["today", "week", "30d", "month", "total"]);
const LEADERBOARD_SAFE_METRICS = new Set(["tokens", "estimated_spend", "actual_cost"]);
const LEADERBOARD_SAFE_SOURCES = new Set([
  "all",
  ...DASHBOARD_AGENTS.map((agent) => agent.queueSource),
]);
function safeLeaderboardDimension(value: unknown, allowed: Set<string>, fallback: string) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

async function fetchLocalLeaderboardPublic({
  period,
  metric,
  source,
  limit,
  offset,
}: AnyRecord) {
  const url = new URL(await buildLocalApiUrl("/functions/tokentracker-leaderboard-public"));
  for (const [key, value] of Object.entries({ period, metric, source, limit, offset })) {
    if (value != null && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetchLocalApi(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw await buildErrorFromResponse(response);
  return response.json();
}

export async function getLeaderboard({
  baseUrl,
  period,
  metric,
  source,
  limit,
  offset,
  timeoutMs = 2_500,
  mock = false,
}: AnyRecord = {}) {
  if (mock || isMockEnabled()) {
    return getMockLeaderboard({ period, metric, source, limit, offset });
  }
  const safePeriod = safeLeaderboardDimension(period, LEADERBOARD_SAFE_PERIODS, "total");
  const safeMetric = safeLeaderboardDimension(metric, LEADERBOARD_SAFE_METRICS, "tokens");
  const requestedSource = safeLeaderboardDimension(source, LEADERBOARD_SAFE_SOURCES, "all");
  const safeSource = safeMetric === "actual_cost" ? "all" : requestedSource;
  const publicBaseUrl = String(baseUrl || "https://feeds.tokentracker.cc/v1").replace(/\/$/, "");
  if (isTauriRuntime()) {
    return fetchLocalLeaderboardPublic({
      period: safePeriod,
      metric: safeMetric,
      source: safeSource,
      limit: 50,
      offset: 0,
    });
  }
  if (!publicBaseUrl) throw new Error("Public feed base URL not configured");
  const controller = new AbortController();
  const boundedTimeout = Math.max(500, Math.min(30_000, Number(timeoutMs) || 2_500));
  const timeoutId = setTimeout(() => controller.abort(), boundedTimeout);
  let response;
  try {
    response = await fetch(
      `${publicBaseUrl}/leaderboard/${safePeriod}/${safeMetric}/${safeSource}.json`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      },
    );
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok) {
    const error: any = new Error(`Request failed with HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const envelope = await response.json();
  return verifySignedStaticFeedEnvelope(envelope, {
    expectedSchema: "token-eyes.leaderboard-snapshot/v1",
    expectedSnapshotKey: `${safePeriod}/${safeMetric}/${safeSource}`,
    maxEntries: 50,
  });
}

export async function getMyLeaderboardRank({
  accessToken,
  period,
  metric,
  source,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    const data = getMockLeaderboard({ seed: accessToken, period, metric, source, limit: 100, offset: 0 });
    return { me: data?.me || null, period, metric, source };
  }
  return fetchInsforgeFunction("tokentracker-leaderboard-me", {
    accessToken,
    params: { period, metric, source },
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
  leaderboard_public,
  display_name,
  github_url,
  show_github_url,
}: AnyRecord = {}) {
  const body: AnyRecord = {};
  if (leaderboard_public === true) body.leaderboard_public = true;
  if (display_name !== undefined) body.display_name = String(display_name);
  if (github_url !== undefined) body.github_url = github_url === null ? null : String(github_url);
  if (show_github_url !== undefined) body.show_github_url = Boolean(show_github_url);
  return fetchInsforgeFunction("tokentracker-public-visibility", {
    accessToken,
    method: "POST",
    body,
  });
}

async function triggerLeaderboardDirtyPublication(accessToken: string) {
  return fetchInsforgeFunction("tokentracker-leaderboard-refresh", {
    accessToken,
    method: "POST",
    body: { source: "dirty-state-change" },
  });
}

export async function setLeaderboardActualCost({
  accessToken,
  share,
  periodCosts,
  capturedAt,
}: AnyRecord = {}) {
  const baseUrl = getInsforgeRemoteUrl();
  if (!baseUrl) throw new Error("InsForge base URL not configured");
  if (!accessToken || !isValidJwtShape(accessToken)) {
    throw new Error("Authenticated leaderboard session required");
  }

  const normalized = {
    today: Number(periodCosts?.today),
    week: Number(periodCosts?.week),
    "30d": Number(periodCosts?.["30d"]),
    month: Number(periodCosts?.month),
    total: Number(periodCosts?.total),
  };
  if (
    share &&
    Object.values(normalized).some((value) => !Number.isFinite(value) || value < 0)
  ) {
    throw new Error("Five non-negative period costs are required");
  }
  const captured = capturedAt ? new Date(capturedAt) : new Date();
  if (!Number.isFinite(captured.getTime())) throw new Error("Invalid actual-cost capture time");

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  };
  const anonKey = getInsforgeAnonKey();
  if (anonKey) headers.apikey = anonKey;
  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/api/database/rpc/set_my_leaderboard_actual_cost`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        p_share: Boolean(share),
        p_today_usd: share ? normalized.today : null,
        p_week_usd: share ? normalized.week : null,
        p_30d_usd: share ? normalized["30d"] : null,
        p_month_usd: share ? normalized.month : null,
        p_total_usd: share ? normalized.total : null,
        p_captured_at: captured.toISOString(),
      }),
    },
  );
  if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}`);
  const changed = (await response.json()) === true;
  if (changed) await triggerLeaderboardDirtyPublication(accessToken);
}

export async function refreshLeaderboardActualCost({
  accessToken,
  periodCosts,
  capturedAt,
}: AnyRecord = {}) {
  const baseUrl = getInsforgeRemoteUrl();
  if (!baseUrl) throw new Error("InsForge base URL not configured");
  if (!accessToken || !isValidJwtShape(accessToken)) {
    throw new Error("Authenticated leaderboard session required");
  }

  const normalized = {
    today: Number(periodCosts?.today),
    week: Number(periodCosts?.week),
    "30d": Number(periodCosts?.["30d"]),
    month: Number(periodCosts?.month),
    total: Number(periodCosts?.total),
  };
  if (Object.values(normalized).some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Five non-negative period costs are required");
  }
  const captured = capturedAt ? new Date(capturedAt) : new Date();
  if (!Number.isFinite(captured.getTime())) throw new Error("Invalid actual-cost capture time");

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  };
  const anonKey = getInsforgeAnonKey();
  if (anonKey) headers.apikey = anonKey;
  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/api/database/rpc/refresh_my_leaderboard_actual_cost`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        p_today_usd: normalized.today,
        p_week_usd: normalized.week,
        p_30d_usd: normalized["30d"],
        p_month_usd: normalized.month,
        p_total_usd: normalized.total,
        p_captured_at: captured.toISOString(),
      }),
    },
  );
  if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}`);
  const result = await response.json();
  const enabled = result?.enabled === true;
  if (result?.changed === true) await triggerLeaderboardDirtyPublication(accessToken);
  return enabled;
}

export async function getLocalLeaderboardActualCost() {
  const [url, authHeaders] = await Promise.all([
    buildLocalApiUrl("/functions/tokentracker-leaderboard-actual-cost"),
    getLocalApiAuthHeaders(),
  ]);
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json", ...authHeaders },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}`);
  const data = await response.json();
  const costs = data?.period_costs_usd;
  const result = {
    today: Number(costs?.today),
    week: Number(costs?.week),
    "30d": Number(costs?.["30d"]),
    month: Number(costs?.month),
    total: Number(costs?.total),
  };
  if (Object.values(result).some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Invalid local actual-cost summary");
  }
  return result;
}

export async function deleteLeaderboardParticipation({ accessToken }: AnyRecord = {}) {
  const baseUrl = getInsforgeRemoteUrl();
  if (!baseUrl) throw new Error("InsForge base URL not configured");
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
  const anonKey = getInsforgeAnonKey();
  if (anonKey) headers.apikey = anonKey;
  if (accessToken && isValidJwtShape(accessToken)) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  const avatarResponse = await fetch(
    `${baseUrl.replace(/\/$/, "")}/functions/tokentracker-avatar`,
    { method: "DELETE", headers },
  );
  if (!avatarResponse.ok) throw new Error(`Request failed with HTTP ${avatarResponse.status}`);
  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/api/database/rpc/delete_my_leaderboard_data`,
    { method: "POST", headers, body: "{}" },
  );
  if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}`);
  await triggerLeaderboardDirtyPublication(accessToken);
}

export async function uploadLeaderboardAvatar({
  accessToken,
  file,
}: {
  accessToken?: string;
  file: Blob;
}) {
  if (!file || file.type !== "image/webp" || file.size > 16 * 1024) {
    throw new Error("Avatar must be a WebP image no larger than 16 KiB");
  }
  const baseUrl = getInsforgeRemoteUrl();
  if (!baseUrl) throw new Error("InsForge base URL not configured");
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "image/webp",
  };
  const anonKey = getInsforgeAnonKey();
  if (anonKey) headers.apikey = anonKey;
  if (accessToken && isValidJwtShape(accessToken)) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/functions/tokentracker-avatar`,
    { method: "PUT", headers, body: file },
  );
  if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}`);
  return response.json();
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
  sources,
  timeZone,
  tzOffsetMinutes,
  accessToken,
  signal,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockUsageModelBreakdown({ from, to, seed: accessToken });
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildModelBreakdownSourceParams({ source, sources });
  return fetchLocalJson(PATHS.usageModelBreakdown, { from, to, ...filterParams, ...tzParams }, { accessToken, signal });
}

/** Selected-range statistics grouped strictly by explicit Provider identity. */
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
    return getMockProviderStats({
      from,
      to,
      seed: accessToken,
      timeZone,
      tzOffsetMinutes,
      sources,
      models,
      agentIds,
      view: "range",
    });
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildMultiFilterParams({ sources, models, agentIds });
  return fetchLocalJson(PATHS.providerStats, { from, to, ...filterParams, ...tzParams }, { accessToken });
}

/** Current seven-UTC-day API-key Provider cards backed by positive official billed cost facts. */
export async function getRecentApiProviderStats({
  sources,
  models,
  agentIds,
  timeZone,
  tzOffsetMinutes,
  accessToken,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockProviderStats({
      seed: accessToken,
      timeZone,
      tzOffsetMinutes,
      sources,
      models,
      agentIds,
      view: "recent_api_7d",
    });
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildMultiFilterParams({ sources, models, agentIds });
  return fetchLocalJson(PATHS.providerApiStats, { ...filterParams, ...tzParams }, { accessToken });
}

/** O3: local-only, dimension-aware usage attribution. */
export async function getUsageAttribution({
  from,
  to,
  sources,
  models,
  agentIds,
  timeZone,
  tzOffsetMinutes,
  accessToken,
}: AnyRecord = {}) {
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildMultiFilterParams({ sources, models, agentIds });
  return fetchLocalJson(
    PATHS.usageAttribution,
    { from, to, group_by: "environment", ...filterParams, ...tzParams },
    { accessToken },
  );
}

/** O6: server-redacted local observability export for a user-triggered download. */
export async function getObservabilityExport({ format = "json" }: AnyRecord = {}) {
  const safeFormat = format === "csv" ? "csv" : "json";
  return fetchLocalJson(PATHS.observabilityExport, { format: safeFormat });
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

export async function getLimitAccounts(opts: { refresh?: boolean } = {}) {
  return fetchLocalJson(PATHS.limitAccounts, opts?.refresh ? { refresh: "1" } : undefined);
}

export interface WorkbuddyQuotaGroup {
  id: "base" | "activity" | "extra" | "other";
  items: number | null;
  total: number | null;
  remain: number | null;
  used: number | null;
  used_percent: number | null;
}

export interface WorkbuddyQuotaResponse {
  signed_in: boolean | null;
  account?: { nickname?: string; phone_masked?: string; type?: string };
  plan?: string | null;
  groups?: WorkbuddyQuotaGroup[];
  fetched_at: string | null;
  error?: string | null;
}

export async function getWorkbuddyQuota(opts: { refresh?: boolean } = {}): Promise<WorkbuddyQuotaResponse> {
  return fetchLocalJson(
    PATHS.workbuddyQuota,
    opts?.refresh ? { refresh: "1" } : undefined,
  ) as Promise<WorkbuddyQuotaResponse>;
}

export async function getCodexResetEvents(): Promise<CodexResetEventsResponse> {
  return fetchLocalJson(PATHS.codexResetEvents) as Promise<CodexResetEventsResponse>;
}

export async function getDesktopWidgetViewModel(
  agent: DesktopWidgetAgent = "all",
  activeSessionWindow: DesktopWidgetActiveSessionWindow = "1h",
): Promise<DesktopWidgetViewModel> {
  return fetchLocalJson(PATHS.desktopWidget, {
    agent,
    active_window: activeSessionWindow,
  }) as Promise<DesktopWidgetViewModel>;
}

export async function acknowledgeCodexResetEvent(
  eventId: string,
  channels?: Array<"banner" | "tray" | "widget">,
): Promise<void> {
  const authHeaders = await getLocalApiAuthHeaders();
  await fetchLocalJson(`${PATHS.codexResetEvents}/ack`, undefined, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({
      event_id: eventId,
      ...(channels?.length ? { channels } : {}),
    }),
  });
}

export async function markCodexResetEventDelivered(
  eventId: string,
  channel: "windows_notification",
): Promise<void> {
  const authHeaders = await getLocalApiAuthHeaders();
  await fetchLocalJson(`${PATHS.codexResetEvents}/delivered`, undefined, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({ event_id: eventId, channel }),
  });
}

export async function checkCodexResetEvents(
  force = false,
): Promise<CodexResetEventsResponse> {
  const authHeaders = await getLocalApiAuthHeaders();
  return fetchLocalJson(`${PATHS.codexResetEvents}/check`, undefined, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({ force: force === true }),
  }) as Promise<CodexResetEventsResponse>;
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
  options: { signal?: AbortSignal } = {},
) {
  throwIfAborted(options.signal);
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
  appendSearchParams(url, params);
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
    signal: options.signal,
  });
  throwIfAborted(options.signal);
  if (!response.ok) {
    const err: any = new Error(`Request failed with HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  const payload = await response.json();
  throwIfAborted(options.signal);
  return payload;
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
  sources,
  timeZone,
  tzOffsetMinutes,
  accessToken,
  signal,
}: AnyRecord = {}) {
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildModelBreakdownSourceParams({ source, sources });
  return fetchAccountFunction(
    ACCOUNT_PATHS.modelBreakdown,
    { from, to, ...filterParams, ...tzParams },
    accessToken,
    { signal },
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
  | "reauth_required"
  | "temporary"
  | "unsupported"
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
  const internals = (window as any).__TAURI_INTERNALS__;
  if (typeof internals?.invoke === "function") return internals.invoke;
  return null;
}

export interface TokenEyesBuildInfo {
  app_version: string;
  head_sha: string;
  built_at_utc: string;
}

export async function getTokenEyesBuildInfo(): Promise<TokenEyesBuildInfo> {
  const invoke = getTauriInvoke();
  if (!invoke) throw new Error("Tauri runtime not available");
  return invoke("get_token_eyes_build_info");
}

export async function openExternalLink(linkId: string): Promise<boolean> {
  const invoke = getTauriInvoke();
  if (!invoke) throw new Error("Tauri runtime not available");
  return invoke("open_external_link", { linkId });
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

export interface OfficialBalanceSnapshot {
  balance: number;
  available_balance: number;
  credit_balance: number;
  currency: string;
  provider_reported_at: string;
}

export interface NativeSessionResult {
  connected: boolean;
  session_ref: string;
  state_code: string;
  error_code: string;
  error_message: string;
  quota?: XiaomiMimoQuota;
  balance?: OfficialBalanceSnapshot;
}

/**
 * Verify a session by forwarding the native bridge's XiaomiMimoSessionStatus
 * back to the local API. The local API WILL NOT mark the session connected
 * without a real `native_result` payload.
 */
export async function verifyConsoleSession(
  id: string,
  nativeResult: NativeSessionResult,
): Promise<{ ok: boolean; session: ConsoleSession; sessions: ConsoleSession[] }> {
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
  ) as Promise<{ ok: boolean; session: ConsoleSession; sessions: ConsoleSession[] }>;
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

export interface GlmBalanceSnapshot extends OfficialBalanceSnapshot {}

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

export async function refreshGlmConsoleSession(sessionRef: string): Promise<GlmSessionStatus> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error("Tauri runtime not available");
  }
  return invoke("refresh_glm_console_session", { sessionRef });
}

export async function deleteGlmConsoleSession(sessionRef: string): Promise<void> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error("Tauri runtime not available");
  }
  return invoke("delete_glm_console_session", { sessionRef });
}

export interface MiniMaxSessionStatus extends NativeSessionResult {
  balance?: OfficialBalanceSnapshot;
}

export async function openMiniMaxConsoleLogin(sessionRef: string): Promise<MiniMaxSessionStatus> {
  const invoke = getTauriInvoke();
  if (!invoke) throw new Error("Tauri runtime not available");
  return invoke("open_minimax_console_login", { sessionRef });
}

export async function verifyMiniMaxConsoleSession(sessionRef: string): Promise<MiniMaxSessionStatus> {
  const invoke = getTauriInvoke();
  if (!invoke) throw new Error("Tauri runtime not available");
  return invoke("verify_minimax_console_session", { sessionRef });
}

export async function deleteMiniMaxConsoleSession(sessionRef: string): Promise<void> {
  const invoke = getTauriInvoke();
  if (!invoke) throw new Error("Tauri runtime not available");
  return invoke("delete_minimax_console_session", { sessionRef });
}

/**
 * Re-check a connected provider console in the native desktop runtime and
 * persist the new balance snapshot before the financial API reads it.
 */
export async function refreshOfficialConsoleProviderBalance(providerId: string): Promise<NativeSessionResult> {
  const normalizedProvider = String(providerId || "").trim().toLowerCase();
  const sessions = (await getConsoleSessions()).sessions || [];
  const session = sessions
    .filter((item) => (
      String(item.provider_id || "").trim().toLowerCase() === normalizedProvider
      && item.session_ref
    ))
    .sort((left, right) => {
      const leftProviderAccount = String(left.session_ref).startsWith("provider-api/") ? 1 : 0;
      const rightProviderAccount = String(right.session_ref).startsWith("provider-api/") ? 1 : 0;
      if (leftProviderAccount !== rightProviderAccount) return rightProviderAccount - leftProviderAccount;
      return String(right.last_verified_at || "").localeCompare(String(left.last_verified_at || ""));
    })[0];
  if (!session) throw new Error("No connected official console session");

  const verifiers: Record<string, (sessionRef: string) => Promise<NativeSessionResult>> = {
    xiaomi_mimo: verifyXiaomiMimoConsoleSession,
    glm: refreshGlmConsoleSession,
    minimax: verifyMiniMaxConsoleSession,
  };
  const verify = verifiers[normalizedProvider];
  if (!verify) throw new Error("Unsupported official console provider");

  const nativeResult = await verify(session.session_ref);
  await verifyConsoleSession(session.id, nativeResult);
  return nativeResult;
}

export interface CodexQuotaSnapshot {
  total_quota: number;
  used_quota: number;
  remaining_quota: number;
  provider_reported_at: string;
  account_label?: string;
  subscription_expires_at?: string;
  quota_windows: Array<{
    kind: string;
    unit: string;
    total: number;
    used: number;
    remaining: number;
    percentage: number;
    resets_at: string;
  }>;
}

export interface CodexSessionStatus extends NativeSessionResult {
  authorized: boolean;
  quota_sync_status: "idle" | "success" | "error";
  legacy_auth_present: boolean;
  quota?: CodexQuotaSnapshot;
}

export async function openCodexConsoleLogin(sessionRef: string): Promise<CodexSessionStatus> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error("Tauri runtime not available");
  }
  return invoke("open_codex_console_login", { sessionRef });
}

export async function reauthorizeCodexConsoleLogin(sessionRef: string): Promise<CodexSessionStatus> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error("Tauri runtime not available");
  }
  return invoke("reauthorize_codex_console_login", { sessionRef });
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

export async function cancelCodexConsoleLogin(
  sessionRef: string,
  reason: "user_cancelled" | "timeout",
): Promise<CodexSessionStatus> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error("Tauri runtime not available");
  }
  return invoke("cancel_codex_console_login", { sessionRef, reason });
}

export async function reopenCodexConsoleLogin(sessionRef: string): Promise<CodexSessionStatus> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error("Tauri runtime not available");
  }
  return invoke("reopen_codex_console_login", { sessionRef });
}

export async function cleanupLegacyCodexAuthFile(sessionRef: string): Promise<CodexSessionStatus> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error("Tauri runtime not available");
  }
  return invoke("cleanup_legacy_codex_auth_file", { sessionRef });
}

export async function deleteCodexConsoleSession(sessionRef: string): Promise<CodexSessionStatus> {
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
  plan_name?: string;
  total_usage_percent?: number;
  auto_composer_percent?: number | null;
  api_usage_percent?: number | null;
  reset_at?: string | null;
  subscription_expires_at?: string | null;
  fetched_at?: string;
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

export interface TraeQuotaSnapshot {
  plan_name?: string;
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

export interface TraeSessionStatus extends NativeSessionResult {
  quota?: TraeQuotaSnapshot;
}

export async function openTraeConsoleLogin(sessionRef: string): Promise<TraeSessionStatus> {
  const invoke = getTauriInvoke();
  if (!invoke) throw new Error("Tauri runtime not available");
  return invoke("open_trae_console_login", { sessionRef });
}

export async function verifyTraeConsoleSession(sessionRef: string): Promise<TraeSessionStatus> {
  const invoke = getTauriInvoke();
  if (!invoke) throw new Error("Tauri runtime not available");
  return invoke("verify_trae_console_session", { sessionRef });
}

export async function syncTraeConsoleQuota(sessionRef: string): Promise<TraeSessionStatus> {
  const invoke = getTauriInvoke();
  if (!invoke) throw new Error("Tauri runtime not available");
  return invoke("sync_trae_console_quota", { sessionRef });
}

export async function deleteTraeConsoleSession(sessionRef: string): Promise<void> {
  const invoke = getTauriInvoke();
  if (!invoke) throw new Error("Tauri runtime not available");
  return invoke("delete_trae_console_session", { sessionRef });
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
