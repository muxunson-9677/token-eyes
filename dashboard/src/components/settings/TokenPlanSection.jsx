import React, { useEffect, useMemo, useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, RefreshCw, Save, X, Link2, CheckCircle2, AlertCircle, Clock, ShieldAlert, GripVertical, ChevronDown, ChevronUp, Trash2, Package, CalendarDays, Eye, EyeOff } from "lucide-react";
import {
  getTokenPlans,
  deleteTokenPlan,
  saveTokenPlan,
  refreshTokenPlan,
  getUsageLimits,
  getTokenPlanCatalog,
  getTokenEyesBuildInfo,
  getConsoleSessions,
  createConsoleSession,
  deleteConsoleSession,
  verifyConsoleSession,
  openXiaomiMimoConsoleLogin,
  verifyXiaomiMimoConsoleSession,
  deleteXiaomiMimoConsoleSession,
  openGlmConsoleLogin,
  verifyGlmConsoleSession,
  deleteGlmConsoleSession,
  openCodexConsoleLogin,
  reauthorizeCodexConsoleLogin,
  verifyCodexConsoleSession,
  syncCodexConsoleQuota,
  cancelCodexConsoleLogin,
  reopenCodexConsoleLogin,
  cleanupLegacyCodexAuthFile,
  deleteCodexConsoleSession,
  openClaudeConsoleLogin,
  verifyClaudeConsoleSession,
  deleteClaudeConsoleSession,
  openCursorConsoleLogin,
  verifyCursorConsoleSession,
  deleteCursorConsoleSession,
  openTraeConsoleLogin,
  verifyTraeConsoleSession,
  deleteTraeConsoleSession,
  openKimiConsoleLogin,
  verifyKimiConsoleSession,
  deleteKimiConsoleSession,
  saveTokenPlanSecret,
  reorderTokenPlans,
} from "../../lib/api";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import { readCostSettingsSessionCache, writeCostSettingsSessionCache } from "../../lib/cost-settings-session-cache";
import { DASHBOARD_AGENTS } from "../../lib/agent-adapters-dashboard";
import {
  isTokenPlanActive,
  isTokenPlanExpired as canonicalIsTokenPlanExpired,
  isTokenPlanScheduled,
  tokenPlanStartValue,
  tokenPlanExpiryTimestamp as canonicalTokenPlanExpiryTimestamp,
  tokenPlanExpiryValue,
} from "../../lib/token-plan-validity.js";
import providerCapabilitiesRegistry from "../../../../shared/provider-capabilities.json";
import { ProviderIcon } from "../../ui/dashboard/components/ProviderIcon.jsx";
import {
  OfficialExternalLink,
  resolveProviderLinkUrl,
} from "../OfficialExternalLink.jsx";
import { SectionCard } from "./Controls.jsx";

function isCodexSource(source) {
  return String(source || "").trim().toLowerCase() === "codex";
}

function formatCodexReset(isoOrUnix) {
  const raw = String(isoOrUnix ?? "").trim();
  const ts = typeof isoOrUnix === "number" || /^\d+$/.test(raw)
    ? Number(raw || isoOrUnix) * 1000
    : Date.parse(raw);
  if (!Number.isFinite(ts)) return "--";
  const diff = ts - Date.now();
  if (diff <= 0) return copy("shared.time.now");
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function formatQuota(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat().format(Number.isFinite(n) ? n : 0);
}

const TOKEN_PLAN_FULL_EMAIL_KEY = "token-eyes.settings.token-plan.show-full-email.v1";

function readTokenPlanFullEmailPreference() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(TOKEN_PLAN_FULL_EMAIL_KEY) === "1";
  } catch {
    return false;
  }
}

function authorizedTokenPlanAccount(record) {
  const official = record?.detection_config?.official_account || {};
  if (record?.detection_method === "official_account") {
    return official.display_name || official.account_label || official.account_id
      || record.account_label || record.account_name || "";
  }
  return record?.account_label || record?.account_name || "";
}

function maskTokenPlanEmail(value) {
  const normalized = String(value || "").trim();
  const match = /^([^@]+)@(.+)$/.exec(normalized);
  if (!match || match[1].includes("*")) return normalized;
  return `${match[1].slice(0, Math.min(3, match[1].length))}***@${match[2]}`;
}

export const tokenPlanExpiryTimestamp = canonicalTokenPlanExpiryTimestamp;
export const isTokenPlanExpired = canonicalIsTokenPlanExpired;

function isUsableTokenPlan(record) {
  return isTokenPlanActive(record);
}

function isExpiredTokenPlanRecord(record) {
  return isTokenPlanExpired(record);
}

function isScheduledTokenPlanRecord(record) {
  return isTokenPlanScheduled(record);
}

function mergeUsableTokenPlanOrder(records, reorderedUsable) {
  let activeIndex = 0;
  return records.map((record) => (
    isUsableTokenPlan(record) ? reorderedUsable[activeIndex++] : record
  ));
}

const TOKEN_PLAN_PAGE_SIZE = 10;
const TOKEN_PLAN_ATTENTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_PLAN_SYNC_FAILURE_STATES = new Set(["error", "failed", "reauth_required", "temporary", "unsupported"]);

function tokenPlanHasSyncFailure(record) {
  return [record?.sync_status, record?.last_refresh_status]
    .some((status) => TOKEN_PLAN_SYNC_FAILURE_STATES.has(String(status || "").toLowerCase()));
}

export function tokenPlanDisplayStatus(record, now = new Date()) {
  if (isTokenPlanExpired(record, now)) return { kind: "expired", reasons: ["expired"] };
  if (isTokenPlanScheduled(record, now)) return { kind: "scheduled", reasons: ["scheduled"] };

  const reasons = [];
  const expiresAt = tokenPlanExpiryTimestamp(tokenPlanExpiryValue(record));
  if (expiresAt !== null && expiresAt - now.getTime() <= TOKEN_PLAN_ATTENTION_WINDOW_MS) reasons.push("expiring");

  const quotaWindows = Array.isArray(record?.quota_windows) ? record.quota_windows : [];
  const quotaWindowNeedsAttention = quotaWindows.some((window) => {
    const { usedPercent } = quotaWindowNumbers(window);
    return Number.isFinite(usedPercent) && usedPercent >= 80;
  });
  const total = Number(record?.total_quota || 0);
  const used = Number(record?.used_quota || 0);
  const totalNeedsAttention = Number.isFinite(total) && total > 0 && Number.isFinite(used) && used / total >= 0.8;
  if (quotaWindowNeedsAttention || totalNeedsAttention) reasons.push("usage");

  if (tokenPlanHasSyncFailure(record)) reasons.push("sync");

  return reasons.length ? { kind: "attention", reasons } : { kind: "active", reasons: [] };
}

export function paginateTokenPlans(records, requestedPage = 0, pageSize = TOKEN_PLAN_PAGE_SIZE) {
  const list = Array.isArray(records) ? records : [];
  const safePageSize = Math.max(1, Number(pageSize) || TOKEN_PLAN_PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(list.length / safePageSize));
  const page = Math.min(Math.max(0, Number(requestedPage) || 0), pageCount - 1);
  const start = page * safePageSize;
  return { page, pageCount, records: list.slice(start, start + safePageSize) };
}

function tokenPlanStatusLabel(kind) {
  if (kind === "attention") return copy("settings.token_plan.status_attention");
  if (kind === "expired") return copy("settings.token_plan.status_expired");
  if (kind === "scheduled") return copy("settings.token_plan.status_scheduled");
  return copy("settings.token_plan.status_active");
}

function countAttentionTokenPlans(records) {
  let count = 0;
  for (const record of records) {
    if (tokenPlanDisplayStatus(record).kind === "attention") count += 1;
  }
  return count;
}

function tokenPlanQuotaProgressTone(percent) {
  if (percent >= 80) return "danger";
  if (percent >= 60) return "warning";
  return "success";
}

const EMPTY_FORM = {
  id: "",
  source: "",
  provider_id: "custom",
  plan_id: "custom",
  plan_label: "",
  quota_kind: "manual",
  quota_unit: "tokens",
  total_quota: 0,
  total_quota_display: "",
  quota_catalog_version: "",
  quota_source: "manual",
  used_quota: 0,
  remaining_quota: 0,
  expires_at: "",
  subscription_amount: 0,
  subscription_currency: "CNY",
  subscription_cycle: "monthly",
  subscription_start_date: "",
  subscription_end_date: "",
  refresh_enabled: false,
  refresh_interval_minutes: 60,
  refresh_method: "manual",
  credential_ref: "",
  notes: "",
  // W03-R3B: detection fields per R3A contract
  detection_method: "",
  detection_config: {
    official_account: {
      provider_home_url: "",
      account_binding_id: "",
      claude_account_mode: "",
      api_key_ref: "",
    },
    custom_api: {
      api_key_ref: "",
      api_format: "",
      request_url: "",
      official_url: "",
      method: "GET",
      response_mapping: {
        total_quota_path: "",
        used_quota_path: "",
        remaining_quota_path: "",
        expires_at_path: "",
      },
    },
  },
};

const REFRESH_INTERVAL_OPTIONS = [15, 30, 60, 240, 1440];
// W03E-R3E: cookie_scrape is removed from user-visible options. Historical
// records with refresh_method=cookie_scrape are normalized to "manual" at
// the editRecord boundary below; the backend keeps its legacy compatibility
// branch in src/lib/token-plan-refresh.js untouched.
const REFRESH_METHOD_OPTIONS = ["manual", "official_api"];
const LEGACY_REFRESH_METHODS = new Set(["manual", "official_api"]);
const XIAOMI_AUTH_POLL_MS = 1000;
const XIAOMI_AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const TRAE_AUTH_TIMEOUT_MS = 10 * 60 * 1000;
const CODEX_NATIVE_PENDING_STATES = new Set(["login_started", "awaiting_verification"]);
const CODEX_AUTHORIZED_STATES = new Set(["authorized", "connected"]);
const CODEX_STABLE_ERROR_CODES = new Set([
  "CODEX_COMPONENT_MISSING",
  "CODEX_CREDENTIAL_STORE_UNAVAILABLE",
  "BROWSER_OPEN_FAILED",
  "AWAITING_VERIFICATION",
  "AUTHORIZATION_FAILED",
  "AUTHORIZATION_CANCELLED",
  "AUTHORIZATION_TIMEOUT",
  "SESSION_NOT_FOUND",
  "REAUTH_REQUIRED",
  "QUOTA_SYNC_FAILED",
  "LOCAL_SESSION_PERSIST_FAILED",
  "CODEX_LOGOUT_FAILED",
  "LEGACY_CREDENTIAL_CLEANUP_FAILED",
]);
const CODEX_QUOTA_SYNC_STATUSES = new Set(["idle", "success", "error"]);

export function quotaConsoleAuthTimeoutMs(providerId) {
  return providerId === "trae" ? TRAE_AUTH_TIMEOUT_MS : XIAOMI_AUTH_TIMEOUT_MS;
}
const AUTHORIZATION_DEFAULT = providerCapabilitiesRegistry.authorization?.default || {
  mode: "no_official_auth",
  operations: {
    start: false,
    reopen: false,
    verify: false,
    sync: false,
    cancel: false,
    delete: false,
  },
};
const AUTHORIZATION_BY_PROVIDER = providerCapabilitiesRegistry.authorization?.providers || {};
const AUTHORIZATION_OPERATION_KEYS = new Set(
  providerCapabilitiesRegistry.authorization?.operation_keys || [],
);

export function providerAuthorizationState(providerId) {
  return AUTHORIZATION_BY_PROVIDER[providerId] || AUTHORIZATION_DEFAULT;
}

export function providerSupportsAuthorizationOperation(providerId, operation) {
  return AUTHORIZATION_OPERATION_KEYS.has(operation)
    && providerAuthorizationState(providerId).operations?.[operation] === true;
}

export function resolveProviderHomeLinkId(providerId, planId = "") {
  switch (providerId) {
    case "xiaomi_mimo":
      return "provider-home-xiaomi-mimo";
    case "glm":
      return "provider-home-glm-usage";
    case "codex":
      return "provider-home-codex";
    case "claude":
      return "provider-home-claude-billing";
    case "cursor":
      return "provider-home-cursor-settings";
    case "trae":
      return "provider-home-trae";
    case "kimi":
      return planId === "kimi_api_budget"
        ? "provider-home-kimi-api"
        : "provider-home-kimi-code";
    case "minimax":
      return "provider-home-minimax-account";
    case "aliyun_bailian":
      return "provider-home-aliyun-bailian-plan";
    default:
      return "";
  }
}

function resolveProviderHomeUrl(providerId, planId = "") {
  return resolveProviderLinkUrl(resolveProviderHomeLinkId(providerId, planId));
}

function ProviderHomeLink({ linkId, testId }) {
  const url = resolveProviderLinkUrl(linkId);
  if (!url) return null;
  return (
    <OfficialExternalLink
      linkId={linkId}
      data-testid={testId}
      className="tt-product-focusable rounded-sm text-oai-brand-600 underline dark:text-oai-brand-400"
    >
      {url}
    </OfficialExternalLink>
  );
}

function providerSupportsOfficialAccountDetection(providerId, planId, claudeAccountMode = "") {
  if (
    !providerSupportsAuthorizationOperation(providerId, "start")
    || !providerSupportsAuthorizationOperation(providerId, "verify")
  ) return false;
  if (providerId === "claude") {
    if (planId === "claude_routing") return false;
    if (String(claudeAccountMode || "").trim().toLowerCase() === "routing") return false;
  }
  return true;
}

function applyOfficialAccountDefaults(formState, providerId, planId) {
  if (!providerSupportsOfficialAccountDetection(
    providerId,
    planId,
    formState.detection_config?.official_account?.claude_account_mode,
  )) {
    return formState;
  }
  const homeUrl = resolveProviderHomeUrl(providerId, planId);
  return {
    ...formState,
    detection_method: "official_account",
    refresh_enabled: true,
    refresh_method: "official_api",
    refresh_interval_minutes: Number(formState.refresh_interval_minutes) || 5,
    detection_config: {
      ...formState.detection_config,
      official_account: {
        ...formState.detection_config?.official_account,
        provider_home_url: homeUrl || formState.detection_config?.official_account?.provider_home_url || "",
        claude_account_mode: providerId === "claude"
          ? (planId === "claude_routing" ? "routing" : (formState.detection_config?.official_account?.claude_account_mode || "official"))
          : (formState.detection_config?.official_account?.claude_account_mode || ""),
      },
    },
  };
}

function providerNeedsApiKeyForOfficialSync(providerId, planId) {
  if (providerId === "glm") return false;
  if (providerId === "kimi") return planId === "kimi_api_budget";
  if (providerId === "minimax") return planId === "minimax_manual_quota";
  if (providerId === "aliyun_bailian") return planId === "aliyun_bailian_manual_quota";
  return false;
}

function isClaudeRoutingMode(providerId, planId, claudeAccountMode = "") {
  if (providerId !== "claude") return false;
  if (planId === "claude_routing") return true;
  return String(claudeAccountMode || "").trim().toLowerCase() === "routing";
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isCodexAuthorizationComplete(status) {
  return CODEX_AUTHORIZED_STATES.has(status?.state_code)
    && status?.authorized === true
    && status?.connected === true;
}

function projectCodexQuota(quota) {
  if (!quota || typeof quota !== "object") return null;
  const projected = {};
  for (const key of [
    "total_quota",
    "used_quota",
    "remaining_quota",
    "provider_reported_at",
    "subscription_expires_at",
  ]) {
    if (Object.prototype.hasOwnProperty.call(quota, key)) projected[key] = quota[key];
  }
  if (Array.isArray(quota.quota_windows)) {
    projected.quota_windows = quota.quota_windows.map((window) => {
      const item = {};
      for (const key of ["kind", "unit", "total", "used", "remaining", "percentage", "resets_at"]) {
        if (Object.prototype.hasOwnProperty.call(window || {}, key)) item[key] = window[key];
      }
      return item;
    });
  }
  return projected;
}

const PROVIDER_REPORTED_QUOTA_FIELDS = [
  "total_quota",
  "used_quota",
  "remaining_quota",
  "quota_windows",
  "expires_at",
];

function projectNativeQuotaSnapshot(quota, now) {
  const source = quota && typeof quota === "object" ? quota : {};
  const hasValue = (field) => Object.prototype.hasOwnProperty.call(source, field)
    && source[field] !== null
    && source[field] !== undefined;
  const projected = {};
  const providerReportedFields = [];
  const declaredReportedFields = Array.isArray(source.provider_reported_fields)
    ? new Set(source.provider_reported_fields)
    : null;

  for (const field of ["total_quota", "used_quota", "remaining_quota", "quota_windows"]) {
    if (!hasValue(field)) continue;
    projected[field] = source[field];
    if (!declaredReportedFields || declaredReportedFields.has(field)) {
      providerReportedFields.push(field);
    }
  }

  const hasCompleteTopLevel = ["total_quota", "used_quota", "remaining_quota"].every(hasValue);
  if (hasCompleteTopLevel && Array.isArray(source.quota_windows)) {
    const headline = source.quota_windows.find((window) => (
      Number.isFinite(Number(window?.total))
      && Number.isFinite(Number(window?.used))
      && Number.isFinite(Number(window?.remaining))
      && Math.sign(Math.abs(Number(window.total) - Number(source.total_quota)) - 1e-9) === -1
      && Math.sign(Math.abs(Number(window.used) - Number(source.used_quota)) - 1e-9) === -1
      && Math.sign(Math.abs(Number(window.remaining) - Number(source.remaining_quota)) - 1e-9) === -1
    ));
    if (typeof headline?.unit === "string" && headline.unit) {
      projected.quota_unit = headline.unit;
    }
  }

  const nativeExpiryField = hasValue("expires_at")
    ? "expires_at"
    : hasValue("subscription_expires_at")
      ? "subscription_expires_at"
      : "";
  if (nativeExpiryField) {
    projected.expires_at = source[nativeExpiryField];
    if (!declaredReportedFields || declaredReportedFields.has("expires_at")) {
      providerReportedFields.push("expires_at");
    }
  }

  projected.provider_reported_fields = PROVIDER_REPORTED_QUOTA_FIELDS
    .filter((field) => providerReportedFields.includes(field));
  const clientObserved = source.source_kind === "undocumented_console_api"
    && source.support_tier === "best_effort"
    && Boolean(String(source.observed_at || "").trim());
  projected.provider_reported_at = providerReportedFields.length
    ? (String(source.provider_reported_at || "").trim() || (clientObserved ? "" : now))
    : "";
  for (const field of ["fetched_at", "observed_at", "source_kind", "support_tier"]) {
    if (hasValue(field)) projected[field] = source[field];
  }
  if (Object.prototype.hasOwnProperty.call(source, "partial")) {
    projected.partial = Boolean(source.partial);
  }
  return projected;
}

function projectNativeQuotaForLocal(quota, now) {
  return projectNativeQuotaSnapshot(quota, now);
}

function projectNativeStatusForLocal(nativeStatus, fallbackSessionRef = "") {
  const status = nativeStatus && typeof nativeStatus === "object" ? nativeStatus : {};
  const rawErrorCode = String(status.error_code || "").trim();
  const projected = {
    connected: status.connected === true,
    session_ref: String(status.session_ref || fallbackSessionRef),
    state_code: String(status.state_code || "failed"),
    error_code: /^[a-z0-9_]{1,64}$/i.test(rawErrorCode) ? rawErrorCode : "PROVIDER_ERROR",
    error_message: status.error_message ? copy("settings.token_plan.refresh_failed") : "",
  };
  if (status.quota && typeof status.quota === "object") {
    projected.quota = projectNativeQuotaForLocal(status.quota, new Date().toISOString());
  }
  if (status.balance && typeof status.balance === "object") {
    projected.balance = {};
    for (const key of ["balance", "available_balance", "credit_balance", "currency", "provider_reported_at"]) {
      if (Object.prototype.hasOwnProperty.call(status.balance, key)) {
        projected.balance[key] = status.balance[key];
      }
    }
  }
  return projected;
}

function projectCodexStatusForLocal(nativeStatus) {
  const rawState = String(nativeStatus?.state_code || "");
  let connected = nativeStatus?.connected === true;
  let authorized = nativeStatus?.authorized === true;
  let stateCode = rawState;
  const rawErrorCode = String(nativeStatus?.error_code || "");
  let errorCode = CODEX_STABLE_ERROR_CODES.has(rawErrorCode)
    ? rawErrorCode
    : "";
  let errorMessage = String(nativeStatus?.error_message || "");

  if (CODEX_AUTHORIZED_STATES.has(rawState)) {
    if (!isCodexAuthorizationComplete(nativeStatus)) {
      connected = false;
      authorized = false;
      stateCode = "failed";
      errorCode = "AUTHORIZATION_FAILED";
      errorMessage ||= copy("settings.token_plan.console_session.verify_error");
    }
  } else if (CODEX_NATIVE_PENDING_STATES.has(rawState)) {
    if (connected || authorized) {
      connected = false;
      authorized = false;
      stateCode = "failed";
      errorCode = "AUTHORIZATION_FAILED";
      errorMessage ||= copy("settings.token_plan.console_session.verify_error");
    } else if (!errorCode) {
      errorCode = "AWAITING_VERIFICATION";
    }
  } else if (rawState === "disconnected"
    && !connected
    && !authorized
    && !rawErrorCode
    && !errorMessage.trim()) {
    stateCode = "disconnected";
    errorCode = "";
    errorMessage = "";
  } else if (["reauth_required", "failed", "session_not_found"].includes(rawState)) {
    connected = false;
    authorized = false;
    errorCode ||= rawState === "reauth_required"
      ? "REAUTH_REQUIRED"
      : rawState === "session_not_found"
        ? "SESSION_NOT_FOUND"
        : "AUTHORIZATION_FAILED";
  } else {
    connected = false;
    authorized = false;
    stateCode = "failed";
    errorCode = "AUTHORIZATION_FAILED";
    errorMessage ||= copy("settings.token_plan.console_session.verify_error");
  }

  const projected = {
    connected,
    authorized,
    session_ref: String(nativeStatus?.session_ref || ""),
    state_code: stateCode,
    quota_sync_status: CODEX_QUOTA_SYNC_STATUSES.has(nativeStatus?.quota_sync_status)
      ? nativeStatus.quota_sync_status
      : "idle",
    error_code: errorCode,
    error_message: errorMessage,
  };
  const quota = projectCodexQuota(nativeStatus?.quota);
  if (quota) projected.quota = quota;
  return projected;
}

function formatCodexCountdown(remainingMs) {
  const seconds = Math.max(0, Math.ceil(Number(remainingMs || 0) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function buildCodexDiagnostic({ session, nativeStatus, stage, startedAt, deadlineAt, now, buildInfo }) {
  const sessionRef = String(session?.session_ref || nativeStatus?.session_ref || "");
  const sessionTail = (sessionRef.split("/").filter(Boolean).at(-1) || "unknown").slice(-8);
  const rawErrorCode = String(nativeStatus?.error_code || session?.last_error_code || "");
  const errorCode = CODEX_STABLE_ERROR_CODES.has(rawErrorCode) ? rawErrorCode : "UNKNOWN";
  const quotaSyncStatus = CODEX_QUOTA_SYNC_STATUSES.has(nativeStatus?.quota_sync_status)
    ? nativeStatus.quota_sync_status
    : "unknown";
  const elapsedMs = startedAt ? Math.max(0, now - startedAt) : 0;
  const remainingMs = deadlineAt ? Math.max(0, deadlineAt - now) : 0;
  const appVersion = /^\d+\.\d+\.\d+$/.test(String(buildInfo?.app_version || ""))
    ? buildInfo.app_version
    : "unavailable";
  const headSha = /^[a-f0-9]{40}$/.test(String(buildInfo?.head_sha || ""))
    ? buildInfo.head_sha
    : "unavailable";
  return [
    `app_version=${appVersion}`,
    `git_sha=${headSha}`,
    `stage=${stage || "unknown"}`,
    `error_code=${errorCode}`,
    `quota_sync_status=${quotaSyncStatus}`,
    `elapsed_seconds=${Math.floor(elapsedMs / 1000)}`,
    `remaining_seconds=${Math.ceil(remainingMs / 1000)}`,
    `session_tail=${sessionTail}`,
  ].join("\n");
}

function normalizeRecords(value) {
  return Array.isArray(value) ? value : [];
}

function findCatalogPlan(catalog, providerId, planId) {
  if (!providerId || providerId === "custom" || !planId || planId === "custom") return null;
  const provider = catalog.find((p) => p.id === providerId);
  return provider?.plans?.find((p) => p.plan_id === planId) || null;
}

function enrichRecordWithCatalog(record, catalog) {
  const plan = findCatalogPlan(catalog, record.provider_id, record.plan_id);
  if (!plan) return record;
  const next = { ...record };
  if (!next.total_quota_display && plan.total_quota_display) {
    next.total_quota_display = plan.total_quota_display;
  }
  if (Number(plan.total_quota) > 0 && (!next.total_quota || next.total_quota === 0)) {
    next.total_quota = Number(plan.total_quota);
  }
  const hasLiveQuota = Array.isArray(next.quota_windows) && next.quota_windows.length > 0;
  if (!hasLiveQuota && next.sync_status !== "success" && Number(next.total_quota) > 0
    && Number(next.remaining_quota) > Number(next.total_quota)) {
    next.remaining_quota = 0;
    next.used_quota = 0;
  }
  return next;
}

function mergeCatalogQuotaIntoForm(formState, catalog, providerId, planId) {
  const plan = findCatalogPlan(catalog, providerId, planId);
  if (!plan) return formState;
  const hasLiveQuota = Array.isArray(formState.quota_windows) && formState.quota_windows.length > 0;
  const next = {
    ...formState,
    total_quota: Number(plan.total_quota || 0),
    total_quota_display: plan.total_quota_display || "",
    quota_kind: plan.quota_kind || formState.quota_kind,
    quota_unit: plan.quota_unit || formState.quota_unit,
    quota_source: "catalog",
  };
  if (!hasLiveQuota && formState.sync_status !== "success") {
    if (Number(formState.total_quota || 0) === 0 && Number(formState.remaining_quota || 0) > 0) {
      next.remaining_quota = 0;
      next.used_quota = 0;
    }
  }
  return next;
}

export function resolveConsoleSessionForRecord(record, sessions) {
  if (!record || !Array.isArray(sessions)) return null;
  const bindingId = record.detection_config?.official_account?.account_binding_id;
  if (!bindingId) return null;
  return sessions.find((s) => s.id === bindingId) || null;
}

function resolveFormProviderSession(form, sessions, records, providerId) {
  if (form.provider_id !== providerId || !Array.isArray(sessions)) return null;
  const bindingId = form.detection_config?.official_account?.account_binding_id;
  if (bindingId) {
    return sessions.find((s) => s.id === bindingId) || null;
  }
  const boundByOthers = new Set(
    (Array.isArray(records) ? records : [])
      .filter((r) => r.id !== form.id && r.provider_id === providerId)
      .map((r) => r.detection_config?.official_account?.account_binding_id)
      .filter(Boolean),
  );
  const statusPriority = (status) => {
    if (status === "connected") return 3;
    if (["pending_login", "login_started", "awaiting_verification"].includes(status)) return 2;
    return 1;
  };
  const sessionTimestamp = (session) => {
    const parsed = Date.parse(
      session?.last_verified_at
      || session?.updated_at
      || session?.created_at
      || "",
    );
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return sessions
    .filter((s) => s.provider_id === providerId && !boundByOthers.has(s.id))
    .sort((left, right) => {
      const byStatus = statusPriority(right.status) - statusPriority(left.status);
      if (byStatus !== 0) return byStatus;
      const byTimestamp = sessionTimestamp(right) - sessionTimestamp(left);
      if (byTimestamp !== 0) return byTimestamp;
      return String(right.id || "").localeCompare(String(left.id || ""));
    })[0] || null;
}

function resolveFormCodexSession(form, sessions, records) {
  return resolveFormProviderSession(form, sessions, records, "codex");
}

function resolveFormClaudeSession(form, sessions, records) {
  return resolveFormProviderSession(form, sessions, records, "claude");
}

function resolveFormCursorSession(form, sessions, records) {
  return resolveFormProviderSession(form, sessions, records, "cursor");
}

function resolveFormTraeSession(form, sessions, records) {
  return resolveFormProviderSession(form, sessions, records, "trae");
}

function resolveFormKimiSession(form, sessions, records) {
  if (form.plan_id === "kimi_api_budget") return null;
  return resolveFormProviderSession(form, sessions, records, "kimi");
}

function computeConsoleStage(session, connectingConsole) {
  if (!session) return "disconnected";
  if (session.last_error_code === "DESKTOP_SESSION_NOT_VERIFIED") {
    return "desktop_not_verified";
  }
  switch (session.status) {
    case "connected":
      return "connected";
    case "awaiting_verification":
    case "login_started":
      return "awaiting_verification";
    case "pending_login":
      return connectingConsole ? "login_started" : "awaiting_verification";
    case "expired":
    case "revoked":
    case "failed":
    case "reauth_required":
    case "session_not_found":
      return "failed";
    default:
      return "failed";
  }
}

function consoleStatusLabel(session) {
  if (!session) return null;
  const statusLabels = {
    connected: copy("settings.token_plan.console_session.status_connected"),
    awaiting_verification: copy("settings.token_plan.console_session.status_awaiting_verification"),
    login_started: copy("settings.token_plan.console_session.status_login_started"),
    pending_login: copy("settings.token_plan.console_session.status_pending_login"),
    expired: copy("settings.token_plan.console_session.status_expired"),
    revoked: copy("settings.token_plan.console_session.status_revoked"),
    failed: copy("settings.token_plan.console_session.status_failed"),
  };
  return statusLabels[session.status] || copy("settings.token_plan.console_session.status_failed");
}

function buildOfficialAccountPayload(form, accountBindingId, providerHomeUrl, extraOfficial = {}) {
  return {
    ...form.detection_config?.official_account,
    account_binding_id: accountBindingId,
    provider_home_url: providerHomeUrl,
    ...extraOfficial,
  };
}

function AuthorizedOperation({ allowed, children }) {
  if (!allowed) return null;
  return children;
}

export function WebviewConsoleConnectPanel({
  descCopyKey,
  connectCopyKey,
  loginStartedDescCopyKey,
  providerHomeLinkId,
  stage,
  session,
  statusLabel,
  loadingConsoleSessions,
  connectingConsole,
  consoleSessionError,
  onConnect,
  onSync,
  onDelete,
  onAddAccount,
  testIdPrefix,
  syncing,
  syncDisabled,
  operations = AUTHORIZATION_DEFAULT.operations,
}) {
  const renderDisconnectAction = () => {
    return (
      <AuthorizedOperation allowed={operations.delete && session?.id && session?.session_ref}>
        <button
          type="button"
          onClick={() => onDelete(session.id, session.session_ref)}
          data-testid={`detection-disconnect-${testIdPrefix}`}
          className="text-xs text-oai-gray-500 underline hover:text-oai-gray-700 dark:text-oai-gray-400 dark:hover:text-oai-gray-200"
        >
          {copy("settings.token_plan.console_session.disconnect")}
        </button>
      </AuthorizedOperation>
    );
  };
  return (
    <div className="space-y-3">
      <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
        {copy(descCopyKey)}
      </div>
      {providerHomeLinkId ? (
        <div className="text-xs text-oai-gray-400 dark:text-oai-gray-500">
          {copy("settings.token_plan.detection.official_account.url_label")}: {" "}
          <ProviderHomeLink
            linkId={providerHomeLinkId}
            testId={`detection-${testIdPrefix}-provider-link`}
          />
        </div>
      ) : null}
      {consoleSessionError && (
        <div className="text-xs text-red-500 dark:text-red-400">{consoleSessionError}</div>
      )}
      {loadingConsoleSessions ? (
        <div className="text-xs text-oai-gray-500">
          {copy("settings.token_plan.console_session.loading")}
        </div>
      ) : stage === "disconnected" ? (
        <AuthorizedOperation allowed={operations.start}>
          <button
            type="button"
            onClick={onConnect}
            disabled={connectingConsole}
            data-testid={`detection-connect-${testIdPrefix}`}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
              "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
              "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
            )}
          >
            <Link2 className="h-3.5 w-3.5" aria-hidden />
            {connectingConsole
              ? copy("settings.token_plan.console_session.connecting")
              : copy(connectCopyKey)}
          </button>
        </AuthorizedOperation>
      ) : stage === "login_started" ? (
        <div className="space-y-2" data-testid={`detection-${testIdPrefix}-login-started`}>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-500" aria-hidden />
            <div className="text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
              {copy("settings.token_plan.console_session.status_login_started")}
            </div>
          </div>
          <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
            {copy(loginStartedDescCopyKey)}
          </div>
        </div>
      ) : stage === "awaiting_verification" ? (
        <div className="space-y-2" data-testid={`detection-${testIdPrefix}-awaiting`}>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-500" aria-hidden />
            <div>
              <div className="text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
                {copy("settings.token_plan.console_session.safe_account_label")}
              </div>
              <div className="text-xs text-amber-600 dark:text-amber-300">
                {copy("settings.token_plan.console_session.status_awaiting_verification")}
              </div>
            </div>
          </div>
          <AuthorizedOperation allowed={operations.verify}>
            <button
              type="button"
              onClick={onConnect}
              disabled={connectingConsole}
              data-testid={`detection-${testIdPrefix}-resume`}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
                "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
                "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
              )}
            >
              <Link2 className="h-3.5 w-3.5" aria-hidden />
              {copy("settings.token_plan.console_session.retry")}
            </button>
          </AuthorizedOperation>
          {renderDisconnectAction()}
        </div>
      ) : stage === "failed" || stage === "desktop_not_verified" ? (
        <div className="space-y-2" data-testid={`detection-${testIdPrefix}-failed`}>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-red-500" aria-hidden />
            <div>
              <div className="text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
                {copy("settings.token_plan.console_session.safe_account_label")}
              </div>
              <div className="text-xs text-red-500 dark:text-red-400">
                {statusLabel}
              </div>
            </div>
          </div>
          <AuthorizedOperation allowed={operations.start}>
            <button
              type="button"
              onClick={onConnect}
              disabled={connectingConsole}
              data-testid={`detection-${testIdPrefix}-retry`}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
                "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
                "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
              )}
            >
              <Link2 className="h-3.5 w-3.5" aria-hidden />
              {copy("settings.token_plan.console_session.retry")}
            </button>
          </AuthorizedOperation>
          {renderDisconnectAction()}
        </div>
      ) : (
        <div className="space-y-2" data-testid={`detection-${testIdPrefix}-connected`}>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />
            <div>
              <div className="text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
                {copy("settings.token_plan.console_session.safe_account_label")}
              </div>
              <div className="text-xs text-emerald-600 dark:text-emerald-300">
                {statusLabel}
              </div>
            </div>
          </div>
          <AuthorizedOperation allowed={operations.sync}>
            <button
              type="button"
              onClick={onSync}
              disabled={syncDisabled}
              data-testid={`detection-sync-${testIdPrefix}`}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
                "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
                "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
              )}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              {syncing
                ? copy("settings.token_plan.official_sync.syncing")
                : copy("settings.token_plan.official_sync.connect")}
            </button>
          </AuthorizedOperation>
          {renderDisconnectAction()}
          <AuthorizedOperation allowed={operations.start && onAddAccount}>
            <button
              type="button"
              onClick={onAddAccount}
              data-testid={`detection-add-account-${testIdPrefix}`}
              className="ml-3 text-xs font-medium text-oai-brand-600 underline hover:text-oai-brand-700 dark:text-oai-brand-400"
            >
              {copy("settings.token_plan.console_session.add_account")}
            </button>
          </AuthorizedOperation>
        </div>
      )}
    </div>
  );
}

function normalizeCatalog(value) {
  const providers = Array.isArray(value?.providers) ? value.providers : [];
  return providers.map((p) => ({
    id: String(p?.id || ""),
    name: String(p?.name || ""),
    plans: Array.isArray(p?.plans) ? p.plans : [],
  }));
}

function SortableTokenPlanCard({
  record,
  onEdit,
  onRefresh,
  onDelete,
  onKeyboardMove,
  refreshing,
  saving,
  usageLimits,
  loadingUsageLimits,
  showFullEmail,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: record.id });
  const planLabel = record.plan_label || record.id;
  const detailId = `token-plan-detail-${record.id}`;
  const style = { transform: CSS.Transform.toString(transform), transition };
  const providerKey = String(record.provider_id || record.source || "").toLowerCase();
  const quotaWindows = Array.isArray(record.quota_windows) ? record.quota_windows : [];
  const headlineWindow = providerKey === "cursor"
    ? quotaWindows.find((window) => window.lane_id === "overall")
      || quotaWindows.find((window) => window.kind === "total")
      || quotaWindows.find((window) => window.kind === "rolling_weekly")
    : providerKey === "codex"
      ? quotaWindows.find((window) => window.kind === "rolling_5_hour") || quotaWindows.find((window) => window.kind === "rolling_weekly")
      : null;
  const headlineTotal = Number(headlineWindow?.total);
  const headlineRemaining = Number(headlineWindow?.remaining);
  const headlineUsed = Number(headlineWindow?.used);
  const totalQuota = Number.isFinite(headlineTotal) ? headlineTotal : Number(record.total_quota ?? 0);
  const remainingQuota = Number.isFinite(headlineRemaining) ? headlineRemaining : Number(record.remaining_quota ?? 0);
  const usedQuota = Number.isFinite(headlineUsed)
    ? headlineUsed
    : Number(record.used_quota ?? Math.max(0, totalQuota - remainingQuota));
  const displayStatus = tokenPlanDisplayStatus(record);
  const hasDetectionConfigured = record.detection_method && record.detection_method !== "not_configured";
  const providerReportedFields = hasDetectionConfigured && Array.isArray(record.provider_reported_fields)
    ? new Set(record.provider_reported_fields)
    : null;
  const reportedQuotaWindows = !providerReportedFields || providerReportedFields.has("quota_windows")
    ? quotaWindows
    : [];
  const hasCompleteReportedHeadline = !providerReportedFields
    || ["total_quota", "used_quota", "remaining_quota"].every((field) => providerReportedFields.has(field));
  const detailWindows = reportedQuotaWindows.length
    ? reportedQuotaWindows
    : hasCompleteReportedHeadline && totalQuota > 0
      ? [{ kind: "total", total: totalQuota, used: usedQuota, remaining: remainingQuota }]
      : [];
  const accountLabel = authorizedTokenPlanAccount(record);
  const displayedAccountLabel = showFullEmail ? accountLabel : maskTokenPlanEmail(accountLabel);
  const subscriptionCurrency = String(record.subscription_currency || "CNY").toUpperCase();
  const subscriptionAmount = Number(record.subscription_amount).toLocaleString();
  const subscriptionSummary = record.subscription_amount > 0
    ? subscriptionCurrency === "CNY"
      ? copy("settings.token_plan.subscription_cost_cny", { amount: subscriptionAmount })
      : subscriptionCurrency === "USD"
        ? copy("settings.token_plan.subscription_cost_usd", { amount: subscriptionAmount })
        : `${subscriptionCurrency} ${subscriptionAmount}`
    : copy("settings.token_plan.subscription_cost_placeholder");
  const expiryValue = tokenPlanExpiryValue(record);
  const [validitySummary, validityDate] = formatTokenPlanValidity(expiryValue).split(" · ");
  const providerTitle = record.provider_id && record.provider_id !== "custom"
    && String(record.provider_id).toLowerCase() !== String(record.source).toLowerCase()
    ? `${record.source} / ${record.provider_id}`
    : record.source;

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid="token-plan-card"
      data-expanded="true"
      className={cn(
        "tt-token-plan-card tt-token-plan-card--reference tt-token-service-card tt-surface-nested rounded-lg border p-2",
        isDragging && "relative z-10 bg-white shadow-lg dark:bg-oai-gray-900",
      )}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={copy("settings.token_plan.drag", { plan: planLabel })}
          className="inline-flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded text-oai-gray-400 hover:bg-oai-gray-100 hover:text-oai-gray-700 active:cursor-grabbing dark:hover:bg-oai-gray-800 dark:hover:text-oai-gray-200"
          {...attributes}
          {...listeners}
          onKeyDown={(event) => {
            if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
              event.preventDefault();
              onKeyboardMove(record.id, event.key === "ArrowUp" ? -1 : 1);
              return;
            }
            listeners?.onKeyDown?.(event);
          }}
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>
        <div className="tt-token-plan-card-toggle flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className={cn("tt-token-provider-mark", `tt-token-provider-mark--${record.provider_id || record.source || "custom"}`)} aria-hidden="true">
            <ProviderIcon provider={record.provider_id || record.source} size={14} />
          </span>
          <span data-testid="token-plan-card-copy" className="tt-token-plan-copy min-w-0">
            <span
              className="tt-token-plan-full"
              data-provider-label={record.provider_id && record.provider_id !== "custom" ? `${record.source} / ${record.provider_id}` : record.source}
              data-plan-label={record.plan_label}
            >
              <span className="tt-token-plan-full-text">
                {`${providerTitle} / ${record.plan_label}`}
              </span>
            </span>
            <span data-testid="token-plan-card-identity-meta" className="tt-token-plan-card-identity-meta">
              <span
                className={cn("tt-token-plan-card-account", showFullEmail && "tt-token-plan-card-account--full")}
                title={displayedAccountLabel}
              >
                {displayedAccountLabel || copy("settings.token_plan.value_unavailable")}
              </span>
              <span className="tt-token-plan-card-cost">{subscriptionSummary}</span>
            </span>
          </span>
          <span
            data-testid="token-plan-status"
            data-status={displayStatus.kind}
            title={tokenPlanStatusLabel(displayStatus.kind)}
            className={cn("tt-token-plan-status", "tt-token-plan-status--corner", `tt-token-plan-status--${displayStatus.kind}`)}
          >
            <span className="sr-only">{tokenPlanStatusLabel(displayStatus.kind)}</span>
          </span>
        </div>
      </div>

      <div id={detailId} data-testid={detailId} className="tt-token-plan-card-detail">
        <TokenPlanQuotaWindows providerId={providerKey} windows={detailWindows} />
        {isCodexSource(record.source) && !quotaWindows.length ? <CodexQuotaBlock codexData={usageLimits?.codex} loading={loadingUsageLimits} /> : null}
        <div data-testid="active-token-plan-summary" className="tt-token-plan-card-summary">
          <span data-testid="token-plan-validity" className="tt-token-plan-summary-expiry tt-token-plan-summary-expiry--single-line">
            <CalendarDays aria-hidden="true" />
            <span>{validitySummary}</span>
            {validityDate ? <span className="tt-token-plan-validity-date">· {validityDate}</span> : null}
          </span>
        </div>
        {tokenPlanHasSyncFailure(record) ? (
          <div
            data-testid="token-plan-failure-reason"
            className="tt-token-plan-failure-reason"
            role={record.provider_id === "xiaomi_mimo" ? "alert" : "status"}
            tabIndex={record.provider_id === "xiaomi_mimo" ? -1 : undefined}
          >
            <ShieldAlert aria-hidden="true" />
            <span>{copy("settings.token_plan.failure_reason", {
              reason: record.last_error_message || record.last_refresh_error || copy("settings.token_plan.failure_reason_unavailable"),
            })}</span>
          </div>
        ) : null}
        <div className="tt-token-plan-card-actions">
          <button type="button" onClick={() => onEdit(record)} disabled={saving}>
            {copy("settings.token_plan.edit")}
          </button>
          <button
            type="button"
            title={copy("settings.token_plan.refresh")}
            aria-label={copy("settings.token_plan.refresh")}
            onClick={() => onRefresh(record.id)}
            disabled={refreshing || saving}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} aria-hidden />
            {copy("settings.token_plan.refresh")}
          </button>
          <button type="button" aria-label={copy("settings.token_plan.delete", { plan: planLabel })} onClick={() => onDelete(record)} disabled={saving}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            {copy("settings.token_plan.delete_short")}
          </button>
        </div>
      </div>
    </div>
  );
}

function tokenPlanQuotaWindowLabel(providerId, window) {
  const kind = window?.kind;
  const officialLabel = String(window?.model_label || window?.model_name || window?.model || "").trim();
  if (officialLabel) return officialLabel;
  if (providerId === "cursor") {
    if (kind === "total") return copy("settings.token_plan.cursor.total_usage");
    if (kind === "team_pool") return copy("settings.token_plan.cursor.team_pool_usage");
    if (kind === "auto_composer") return copy("settings.token_plan.cursor.auto_composer_usage");
    if (kind === "api") return copy("settings.token_plan.cursor.api_usage");
  }
  if (providerId === "codex") {
    if (kind === "rolling_5_hour") return copy("settings.token_plan.codex_quota.5h");
    if (kind === "rolling_weekly") return copy("settings.token_plan.codex_quota.7d");
    if (kind === "gpt_5_3_codex_spark_5_hour") return copy("settings.token_plan.codex_quota.spark_5h");
    if (kind === "gpt_5_3_codex_spark_weekly") return copy("settings.token_plan.codex_quota.spark_7d");
  }
  return kind === "rolling_5_hour"
    ? copy("settings.token_plan.glm.window_5h")
    : copy("settings.token_plan.glm.window_weekly");
}

function formatQuotaWindowReset(value) {
  const raw = String(value ?? "").trim();
  const timestamp = /^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleString()
    : copy("settings.token_plan.reset_unavailable");
}

function formatTokenPlanValidity(value, now = new Date()) {
  const timestamp = tokenPlanExpiryTimestamp(value);
  if (timestamp === null) return copy("settings.token_plan.validity_unset");

  const totalMinutes = Math.max(0, Math.floor((timestamp - now.getTime()) / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const remaining = days > 0
    ? copy("settings.token_plan.validity_days_hours", { days, hours })
    : hours > 0
      ? copy("settings.token_plan.validity_hours_minutes", { hours, minutes })
      : copy("settings.token_plan.validity_minutes", { minutes });
  const date = new Date(timestamp);
  const pad = (part) => String(part).padStart(2, "0");
  const dateTime = `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return copy("settings.token_plan.validity_summary", { remaining, date: dateTime });
}

function normalizeTokenPlanQuotaWindows(providerId, windows) {
  const items = Array.isArray(windows) ? windows : [];
  if (providerId !== "cursor") return items;
  const priority = ["total", "rolling_weekly", "team_pool", "auto_composer", "api"];
  const seen = new Set();
  return [...items]
    .sort((left, right) => priority.indexOf(left.kind) - priority.indexOf(right.kind))
    .reduce((result, window) => {
      const normalizedKind = window.kind === "rolling_weekly" ? "total" : window.kind;
      if (seen.has(normalizedKind)) return result;
      seen.add(normalizedKind);
      result.push(normalizedKind === window.kind ? window : { ...window, kind: normalizedKind });
      return result;
    }, []);
}

function quotaWindowNumbers(window) {
  const total = Number(window?.total);
  const percentage = Number(window?.percentage);
  const reportedUsed = Number(window?.used);
  const reportedRemaining = Number(window?.remaining);
  const used = Number.isFinite(reportedUsed)
    ? reportedUsed
    : Number.isFinite(total) && Number.isFinite(percentage)
      ? total * percentage / 100
      : Number.isFinite(total) && Number.isFinite(reportedRemaining)
        ? total - reportedRemaining
        : null;
  const remaining = Number.isFinite(reportedRemaining)
    ? reportedRemaining
    : Number.isFinite(total) && Number.isFinite(used)
      ? total - used
      : null;
  const usedPercent = Number.isFinite(percentage)
    ? percentage
    : Number.isFinite(total) && total > 0 && Number.isFinite(used)
      ? used / total * 100
      : null;
  return { total: Number.isFinite(total) ? total : null, used, remaining, usedPercent };
}

function TokenPlanQuotaWindows({ providerId, windows }) {
  const items = normalizeTokenPlanQuotaWindows(providerId, windows);
  if (!items.length) return null;
  return (
    <div className="tt-token-plan-quota-windows">
      <span>{copy("settings.token_plan.quota_windows")}</span>
      <div>
        {items.map((window, index) => {
          const values = quotaWindowNumbers(window);
          const progressPercent = values.usedPercent === null ? 0 : Math.max(0, Math.min(100, values.usedPercent));
          const progressTone = tokenPlanQuotaProgressTone(progressPercent);
          return (
          <div key={`${window.kind || "window"}-${index}`} data-testid="token-plan-quota-window" className="tt-token-plan-quota-window">
            <div className="tt-token-plan-quota-window-head">
              <strong>
                {window.kind === "total" ? null : <Clock aria-hidden="true" />}
                {tokenPlanQuotaWindowLabel(providerId, window)}
              </strong>
              <span data-testid="token-plan-quota-window-percent" className="tt-token-plan-quota-window-percent">
                {Math.round(progressPercent)}%
              </span>
            </div>
            <span
              className="tt-token-plan-progress"
              data-tone={progressTone}
              role="progressbar"
              aria-label={tokenPlanQuotaWindowLabel(providerId, window)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progressPercent)}
            ><i style={{ width: `${progressPercent}%` }} /></span>
            <small data-testid="token-plan-quota-window-reset">
              {copy("settings.token_plan.quota_window_reset")}: {window.resets_at
                ? formatQuotaWindowReset(window.resets_at)
                : copy("settings.token_plan.reset_unavailable")}
            </small>
          </div>
          );
        })}
      </div>
    </div>
  );
}

function ExpiredTokenPlanRow({ record, onEdit }) {
  const providerKey = String(record.provider_id || record.source || "custom").toLowerCase();
  const endedAt = tokenPlanExpiryValue(record) ?? "—";
  const subscriptionCost = Number(record.subscription_amount) > 0
    ? ` · ${record.subscription_currency || "USD"} ${Number(record.subscription_amount).toLocaleString()}`
    : "";
  return (
    <div data-testid="expired-token-plan-row" className="flex items-center gap-3 rounded-md border border-oai-gray-200 px-3 py-2 dark:border-oai-gray-800">
      <span className={cn("tt-token-provider-mark", `tt-token-provider-mark--${providerKey}`)} aria-hidden="true">
        {["codex", "cursor", "trae"].includes(providerKey)
          ? <ProviderIcon provider={providerKey} size={22} />
          : String(record.source || "T").slice(0, 1).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-oai-gray-800 dark:text-oai-gray-200">
          {record.source} / {record.plan_label || record.id}
        </div>
        <div className="mt-0.5 text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy("settings.token_plan.expired_at")} {endedAt}
          {subscriptionCost}
        </div>
      </div>
      <span className="shrink-0 rounded bg-oai-gray-100 px-2 py-1 text-xs font-medium text-oai-gray-500 dark:bg-oai-gray-800 dark:text-oai-gray-400">
        {copy("settings.token_plan.status_expired")}
      </span>
      <button type="button" onClick={() => onEdit(record)} className="shrink-0 text-xs font-medium text-oai-brand hover:text-oai-brand-dark">
        {copy("settings.token_plan.edit")}
      </button>
    </div>
  );
}

function ScheduledTokenPlanRow({ record, onEdit }) {
  const providerKey = String(record.provider_id || record.source || "custom").toLowerCase();
  const startsAt = tokenPlanStartValue(record) ?? "—";
  const subscriptionCost = Number(record.subscription_amount) > 0
    ? ` · ${record.subscription_currency || "USD"} ${Number(record.subscription_amount).toLocaleString()}`
    : "";
  return (
    <div data-testid="scheduled-token-plan-row" className="flex items-center gap-3 rounded-md border border-oai-gray-200 px-3 py-2 dark:border-oai-gray-800">
      <span className={cn("tt-token-provider-mark", `tt-token-provider-mark--${providerKey}`)} aria-hidden="true">
        {["codex", "cursor", "trae"].includes(providerKey)
          ? <ProviderIcon provider={providerKey} size={22} />
          : String(record.source || "T").slice(0, 1).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-oai-gray-800 dark:text-oai-gray-200">
          {record.source} / {record.plan_label || record.id}
        </div>
        <div className="mt-0.5 text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy("settings.token_plan.starts_at")} {startsAt}
          {subscriptionCost}
        </div>
      </div>
      <span className="shrink-0 rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
        {copy("settings.token_plan.status_scheduled")}
      </span>
      <button type="button" onClick={() => onEdit(record)} className="shrink-0 text-xs font-medium text-oai-brand hover:text-oai-brand-dark">
        {copy("settings.token_plan.edit")}
      </button>
    </div>
  );
}

function TokenPlanPagination({ pagination, onPageChange, testId }) {
  if (pagination.pageCount <= 1) return null;
  return (
    <nav data-testid={testId} className="tt-token-plan-pagination" aria-label={copy("settings.token_plan.pagination.status", { current: pagination.page + 1, total: pagination.pageCount })}>
      <button
        type="button"
        disabled={pagination.page === 0}
        onClick={() => onPageChange(pagination.page - 1)}
      >
        {copy("settings.token_plan.pagination.previous")}
      </button>
      <span>{copy("settings.token_plan.pagination.status", { current: pagination.page + 1, total: pagination.pageCount })}</span>
      <button
        type="button"
        disabled={pagination.page >= pagination.pageCount - 1}
        onClick={() => onPageChange(pagination.page + 1)}
      >
        {copy("settings.token_plan.pagination.next")}
      </button>
    </nav>
  );
}

export function TokenPlanSection({ listOnly = false, editorPlanId = "", onNavigate = () => {}, onSummaryChange }) {
  const cachedPlanData = useRef(
    listOnly && !editorPlanId ? readCostSettingsSessionCache("token-plans") : null,
  ).current;
  const [records, setRecords] = useState(cachedPlanData?.records || []);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(!cachedPlanData);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [refreshingId, setRefreshingId] = useState("");
  const [error, setError] = useState("");
  const [savedNotice, setSavedNotice] = useState(false);
  const [usageLimits, setUsageLimits] = useState(null);
  const [loadingUsageLimits, setLoadingUsageLimits] = useState(false);
  const [catalog, setCatalog] = useState(cachedPlanData?.catalog || []);
  const [catalogError, setCatalogError] = useState("");
  const [loadingCatalog, setLoadingCatalog] = useState(false);

  // W03C: Xiaomi MiMo console session state
  const [consoleSessions, setConsoleSessions] = useState([]);
  const [loadingConsoleSessions, setLoadingConsoleSessions] = useState(true);
  const [consoleSessionError, setConsoleSessionError] = useState("");
  const [connectingConsole, setConnectingConsole] = useState(false);
  const [codexNativeStatuses, setCodexNativeStatuses] = useState({});
  const [codexAttempt, setCodexAttempt] = useState(null);
  const [codexNow, setCodexNow] = useState(() => Date.now());
  const [codexPersistFailure, setCodexPersistFailure] = useState(null);
  const [codexWarning, setCodexWarning] = useState(null);
  const [codexDisconnectingSessionRef, setCodexDisconnectingSessionRef] = useState("");
  const [codexDisconnectRetry, setCodexDisconnectRetry] = useState(null);

  // W03-R3D: API Key input lives in separate state — NEVER stored in form or
  // serialized into the plan record.  It is only sent once to the secrets
  // endpoint which returns an api_key_ref, and the ref is what gets saved.
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [planRefreshTargetId, setPlanRefreshTargetId] = useState("");
  const [expiredPlansOpen, setExpiredPlansOpen] = useState(false);
  const [scheduledPlansOpen, setScheduledPlansOpen] = useState(false);
  const [activePage, setActivePage] = useState(0);
  const [expiredPage, setExpiredPage] = useState(0);
  const [scheduledPage, setScheduledPage] = useState(0);
  const [showFullEmail, setShowFullEmail] = useState(readTokenPlanFullEmailPreference);
  const [editorInitialized, setEditorInitialized] = useState(false);
  const [editorMissing, setEditorMissing] = useState(false);
  const recordsRef = useRef(records);
  const consoleSessionsRef = useRef(consoleSessions);
  const refreshRef = useRef(null);
  const refreshingPlanIdsRef = useRef(new Set());
  const fullEmailRefreshAttemptedIdsRef = useRef(new Set());
  const autoCodexRefreshBusyRef = useRef(false);
  const codexAttemptTokensRef = useRef(new Map());
  const codexCancelPromiseRef = useRef(new Map());
  const codexCancelPersistedRefs = useRef(new Set());
  const codexDisconnectPromiseRef = useRef(new Map());
  const codexNativeDisconnectedRefs = useRef(new Set());
  const codexInitialReconcileDoneRef = useRef(false);
  const codexAlertRef = useRef(null);
  recordsRef.current = records;
  consoleSessionsRef.current = consoleSessions;
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => () => {
    for (const attemptToken of codexAttemptTokensRef.current.values()) {
      attemptToken.cancelled = true;
    }
    codexAttemptTokensRef.current.clear();
    codexCancelPromiseRef.current.clear();
    codexCancelPersistedRefs.current.clear();
    codexDisconnectPromiseRef.current.clear();
    codexNativeDisconnectedRefs.current.clear();
  }, []);

  useEffect(() => {
    if (cachedPlanData) return undefined;
    let cancelled = false;
    setLoading(true);
    setLoadingCatalog(true);
    Promise.all([getTokenPlans(), getTokenPlanCatalog().catch((err) => {
      if (!cancelled) setCatalogError(err?.message || "");
      return { providers: [{ id: "custom", name: copy("settings.token_plan.custom_plan"), plans: [] }] };
    })])
      .then(([plansResult, catalogResult]) => {
        if (cancelled) return;
        const cat = normalizeCatalog(catalogResult);
        const nextRecords = normalizeRecords(plansResult?.records).map((r) => enrichRecordWithCatalog(r, cat));
        setCatalog(cat);
        setRecords(nextRecords);
        writeCostSettingsSessionCache("token-plans", { records: nextRecords, catalog: cat });
        setError("");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || copy("settings.token_plan.load_error"));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setLoadingCatalog(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cachedPlanData]);

  useEffect(() => {
    if (!loading) writeCostSettingsSessionCache("token-plans", { records, catalog });
  }, [catalog, loading, records]);

  useEffect(() => {
    const hasCodexRecord = records.some((r) => isCodexSource(r.source));
    if (!hasCodexRecord || loading) return;

    let cancelled = false;
    setLoadingUsageLimits(true);
    getUsageLimits()
      .then((result) => {
        if (cancelled) return;
        setUsageLimits(result);
      })
      .catch((err) => {
        if (cancelled) return;
        setUsageLimits({
          codex: {
            configured: true,
            error: err?.message || copy("settings.token_plan.codex_quota.error"),
          },
        });
      })
      .finally(() => {
        if (!cancelled) setLoadingUsageLimits(false);
      });
    return () => {
      cancelled = true;
    };
  }, [records, loading]);

  // W03C: Load console sessions
  useEffect(() => {
    let cancelled = false;
    setLoadingConsoleSessions(true);
    setConsoleSessionError("");
    getConsoleSessions()
      .then((result) => {
        if (cancelled) return;
        setConsoleSessions(Array.isArray(result?.sessions) ? result.sessions : []);
      })
      .catch((err) => {
        if (cancelled) return;
        // "该功能仅桌面端支持" is expected in web/vite environment
        if (err?.message?.includes("桌面端")) {
          setConsoleSessions([]);
        } else {
          setConsoleSessionError(err?.message || "");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingConsoleSessions(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const xiaomiMimoSession = useMemo(() => {
    return consoleSessions.find((s) => s.provider_id === "xiaomi_mimo") || null;
  }, [consoleSessions]);

  const glmSession = useMemo(() => {
    return consoleSessions.find((s) => s.provider_id === "glm") || null;
  }, [consoleSessions]);

  const formCodexSession = useMemo(() => {
    if (form.provider_id !== "codex") return null;
    return resolveFormCodexSession(form, consoleSessions, records);
  }, [form.provider_id, form.id, form.detection_config?.official_account?.account_binding_id, consoleSessions, records]);

  const currentCodexNativeStatus = formCodexSession?.session_ref
    ? codexNativeStatuses[formCodexSession.session_ref] || null
    : null;

  const formClaudeSession = useMemo(() => {
    if (form.provider_id !== "claude") return null;
    if (isClaudeRoutingMode(form.provider_id, form.plan_id, form.detection_config?.official_account?.claude_account_mode)) {
      return null;
    }
    return resolveFormClaudeSession(form, consoleSessions, records);
  }, [form.provider_id, form.plan_id, form.id, form.detection_config?.official_account?.claude_account_mode, form.detection_config?.official_account?.account_binding_id, consoleSessions, records]);

  const formCursorSession = useMemo(() => {
    if (form.provider_id !== "cursor") return null;
    return resolveFormCursorSession(form, consoleSessions, records);
  }, [form.provider_id, form.id, form.detection_config?.official_account?.account_binding_id, consoleSessions, records]);

  const formTraeSession = useMemo(() => {
    if (form.provider_id !== "trae") return null;
    return resolveFormTraeSession(form, consoleSessions, records);
  }, [form.provider_id, form.id, form.detection_config?.official_account?.account_binding_id, consoleSessions, records]);

  const formKimiSession = useMemo(() => {
    if (form.provider_id !== "kimi" || form.plan_id === "kimi_api_budget") return null;
    return resolveFormKimiSession(form, consoleSessions, records);
  }, [form.provider_id, form.plan_id, form.id, form.detection_config?.official_account?.account_binding_id, consoleSessions, records]);

  const xiaomiMimoStatusLabel = useMemo(() => {
    if (!xiaomiMimoSession) return null;
    const statusLabels = {
      connected: copy("settings.token_plan.console_session.status_connected"),
      awaiting_verification: copy("settings.token_plan.console_session.status_awaiting_verification"),
      login_started: copy("settings.token_plan.console_session.status_login_started"),
      pending_login: copy("settings.token_plan.console_session.status_pending_login"),
      expired: copy("settings.token_plan.console_session.status_expired"),
      revoked: copy("settings.token_plan.console_session.status_revoked"),
      failed: copy("settings.token_plan.console_session.status_failed"),
    };
    return (
      statusLabels[xiaomiMimoSession.status] ||
      copy("settings.token_plan.console_session.status_failed")
    );
  }, [xiaomiMimoSession]);

  const glmStatusLabel = useMemo(() => {
    if (!glmSession) return null;
    const statusLabels = {
      connected: copy("settings.token_plan.console_session.status_connected"),
      awaiting_verification: copy("settings.token_plan.console_session.status_awaiting_verification"),
      login_started: copy("settings.token_plan.console_session.status_login_started"),
      pending_login: copy("settings.token_plan.console_session.status_pending_login"),
      expired: copy("settings.token_plan.console_session.status_expired"),
      revoked: copy("settings.token_plan.console_session.status_revoked"),
      failed: copy("settings.token_plan.console_session.status_failed"),
    };
    return (
      statusLabels[glmSession.status] ||
      copy("settings.token_plan.console_session.status_failed")
    );
  }, [glmSession]);

  const xiaomiMimoStage = useMemo(() => {
    if (!xiaomiMimoSession) return "disconnected";
    if (xiaomiMimoSession.last_error_code === "DESKTOP_SESSION_NOT_VERIFIED") {
      return "desktop_not_verified";
    }
    switch (xiaomiMimoSession.status) {
      case "connected":
        return "connected";
      case "awaiting_verification":
      case "login_started":
        return "awaiting_verification";
      case "pending_login":
        return connectingConsole ? "login_started" : "awaiting_verification";
      case "expired":
      case "revoked":
      case "failed":
        return "failed";
      default:
        return "awaiting_verification";
    }
  }, [xiaomiMimoSession, connectingConsole]);

  const glmStage = useMemo(() => {
    if (!glmSession) return "disconnected";
    if (glmSession.last_error_code === "DESKTOP_SESSION_NOT_VERIFIED") {
      return "desktop_not_verified";
    }
    switch (glmSession.status) {
      case "connected":
        return "connected";
      case "awaiting_verification":
      case "login_started":
        return "awaiting_verification";
      case "pending_login":
        return connectingConsole ? "login_started" : "awaiting_verification";
      case "expired":
      case "revoked":
      case "failed":
        return "failed";
      default:
        return "awaiting_verification";
    }
  }, [glmSession, connectingConsole]);

  const codexStage = useMemo(
    () => {
      if (currentCodexNativeStatus?.state_code === "login_started") return "login_started";
      if (["reauth_required", "failed", "session_not_found"].includes(currentCodexNativeStatus?.state_code)) {
        return "failed";
      }
      return formCodexSession
        ? computeConsoleStage(formCodexSession, connectingConsole)
        : "disconnected";
    },
    [formCodexSession, connectingConsole, currentCodexNativeStatus],
  );

  const claudeStage = useMemo(() => computeConsoleStage(formClaudeSession, connectingConsole), [formClaudeSession, connectingConsole]);

  useEffect(() => {
    if (codexStage !== "failed" || consoleSessionError || codexWarning) return undefined;
    const timer = window.setTimeout(() => codexAlertRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [codexStage, consoleSessionError, codexWarning, formCodexSession?.id]);

  const cursorStage = useMemo(() => computeConsoleStage(formCursorSession, connectingConsole), [formCursorSession, connectingConsole]);

  const traeStage = useMemo(() => computeConsoleStage(formTraeSession, connectingConsole), [formTraeSession, connectingConsole]);

  const kimiStage = useMemo(() => computeConsoleStage(formKimiSession, connectingConsole), [formKimiSession, connectingConsole]);

  const codexStatusLabel = useMemo(() => consoleStatusLabel(formCodexSession), [formCodexSession]);
  const formCodexAttempt = formCodexSession?.session_ref
    ? (codexAttemptTokensRef.current.get(formCodexSession.session_ref)
      || (codexAttempt?.sessionRef === formCodexSession.session_ref ? codexAttempt : null))
    : null;
  const formCodexDisconnectRetry = formCodexSession?.session_ref
    && codexDisconnectRetry?.sessionRef === formCodexSession.session_ref
    ? codexDisconnectRetry
    : null;
  const codexRemainingMs = formCodexAttempt?.deadlineAt
    ? Math.max(0, formCodexAttempt.deadlineAt - codexNow)
    : XIAOMI_AUTH_TIMEOUT_MS;

  const claudeStatusLabel = useMemo(() => consoleStatusLabel(formClaudeSession), [formClaudeSession]);

  const cursorStatusLabel = useMemo(() => consoleStatusLabel(formCursorSession), [formCursorSession]);

  const traeStatusLabel = useMemo(() => consoleStatusLabel(formTraeSession), [formTraeSession]);

  const kimiStatusLabel = useMemo(() => consoleStatusLabel(formKimiSession), [formKimiSession]);

  const rememberCodexNativeStatus = (nativeStatus) => {
    const sessionRef = String(nativeStatus?.session_ref || "");
    if (!sessionRef) return;
    setCodexNativeStatuses((previous) => previous[sessionRef] === nativeStatus
      ? previous
      : { ...previous, [sessionRef]: nativeStatus });
  };

  const replaceConsoleSession = (session) => {
    if (!session?.id) return;
    setConsoleSessions((previous) => {
      const exists = previous.some((item) => item.id === session.id);
      if (!exists) return [...previous, session];
      return previous.map((item) => item.id === session.id ? session : item);
    });
  };

  const codexDisconnectBlocksRefresh = (sessionRef) => Boolean(
    sessionRef
    && (codexDisconnectPromiseRef.current.has(sessionRef)
      || codexNativeDisconnectedRefs.current.has(sessionRef)),
  );

  const finishCodexAttempt = (attempt) => {
    if (!attempt?.sessionRef) return;
    if (codexAttemptTokensRef.current.get(attempt.sessionRef) === attempt) {
      codexAttemptTokensRef.current.delete(attempt.sessionRef);
    }
    setCodexAttempt((current) => current?.sessionRef === attempt.sessionRef ? null : current);
  };

  const rememberCodexPersistFailure = (sessionId, nativeStatus, error) => {
    const message = error?.message || copy("settings.token_plan.codex.local_persist_failed");
    setCodexPersistFailure({ sessionId, nativeStatus, message });
    setConsoleSessionError(`LOCAL_SESSION_PERSIST_FAILED: ${message}`);
    window.setTimeout(() => codexAlertRef.current?.focus(), 0);
  };

  const invokeCodexCancelOnce = (sessionRef, reason) => {
    const current = codexCancelPromiseRef.current.get(sessionRef);
    if (current) return current;
    const promise = cancelCodexConsoleLogin(sessionRef, reason);
    codexCancelPromiseRef.current.set(sessionRef, promise);
    void promise.catch(() => {
      if (codexCancelPromiseRef.current.get(sessionRef) === promise) {
        codexCancelPromiseRef.current.delete(sessionRef);
      }
    });
    return promise;
  };

  const persistCodexNativeStatus = async (sessionId, nativeStatus, options = {}) => {
    rememberCodexNativeStatus(nativeStatus);
    const localStatus = projectCodexStatusForLocal(nativeStatus);
    try {
      const verified = await verifyConsoleSession(sessionId, localStatus);
      const cleanDisconnected = localStatus.state_code === "disconnected"
        && localStatus.connected === false
        && localStatus.authorized === false
        && !localStatus.error_code
        && !localStatus.error_message;
      if (cleanDisconnected && Array.isArray(verified?.sessions)) {
        setConsoleSessions(verified.sessions);
      } else if (cleanDisconnected) {
        setConsoleSessions((previous) => previous.filter((session) => session.id !== sessionId));
      } else if (verified?.session) {
        replaceConsoleSession(verified.session);
      }
      return verified?.session || null;
    } catch (error) {
      if (options.reconcileOnFailure !== false) {
        const attemptToken = options.attemptToken;
        if (attemptToken) attemptToken.cancelled = true;
        setConnectingConsole(false);
        let reconciled = null;
        try {
          reconciled = await invokeCodexCancelOnce(
            nativeStatus?.session_ref || attemptToken?.sessionRef,
            "user_cancelled",
          );
          rememberCodexNativeStatus(reconciled);
          if (attemptToken && !CODEX_NATIVE_PENDING_STATES.has(reconciled?.state_code)) {
            finishCodexAttempt(attemptToken);
          }
        } catch {
          // The local write error remains the actionable failure. Native transport
          // details are intentionally not copied into the diagnostic surface.
        }
        rememberCodexPersistFailure(sessionId, reconciled || nativeStatus, error);
        return null;
      }
      rememberCodexPersistFailure(sessionId, nativeStatus, error);
      return null;
    }
  };

  const cancelCodexAttempt = async (reason, attemptOverride = null) => {
    const attempt = attemptOverride
      || (formCodexSession?.session_ref
        ? (codexAttemptTokensRef.current.get(formCodexSession.session_ref)
          || (codexAttempt?.sessionRef === formCodexSession.session_ref ? codexAttempt : null))
        : null)
      || null;
    if (!attempt?.sessionRef) return null;
    attempt.cancelled = true;
    setConnectingConsole(false);
    try {
      const nativeStatus = await invokeCodexCancelOnce(attempt.sessionRef, reason);
      rememberCodexNativeStatus(nativeStatus);
      if (attempt.sessionId && !codexCancelPersistedRefs.current.has(attempt.sessionRef)) {
        codexCancelPersistedRefs.current.add(attempt.sessionRef);
        await persistCodexNativeStatus(attempt.sessionId, nativeStatus, {
          reconcileOnFailure: false,
          attemptToken: attempt,
        });
      }
      if (["failed", "reauth_required", "session_not_found"].includes(nativeStatus?.state_code)) {
        setConsoleSessionError("");
      } else if (nativeStatus?.error_message) {
        setConsoleSessionError(nativeStatus.error_message);
      }
      if (!CODEX_NATIVE_PENDING_STATES.has(nativeStatus?.state_code)) finishCodexAttempt(attempt);
      return nativeStatus;
    } catch (error) {
      setConsoleSessionError(error?.message || copy("settings.token_plan.codex.cancel_failed"));
      return null;
    }
  };

  const retryCodexLocalPersist = async () => {
    if (!codexPersistFailure) return;
    const verified = await persistCodexNativeStatus(
      codexPersistFailure.sessionId,
      codexPersistFailure.nativeStatus,
      { reconcileOnFailure: false },
    );
    if (!verified) return;
    setCodexPersistFailure(null);
    setConsoleSessionError("");
  };

  const reopenCurrentCodexLogin = async () => {
    const session = formCodexSession;
    if (!session?.session_ref) return;
    try {
      const nativeStatus = await reopenCodexConsoleLogin(session.session_ref);
      await persistCodexNativeStatus(session.id, nativeStatus, {
        attemptToken: codexAttemptTokensRef.current.get(session.session_ref),
      });
    } catch (error) {
      setConsoleSessionError(error?.message || copy("settings.token_plan.codex.reopen_failed"));
    }
  };

  const copyCurrentCodexDiagnostic = async () => {
    const now = Date.now();
    const buildInfo = await getTokenEyesBuildInfo().catch(() => null);
    const diagnostic = buildCodexDiagnostic({
      session: formCodexSession,
      nativeStatus: currentCodexNativeStatus,
      stage: codexStage,
      startedAt: formCodexAttempt?.startedAt,
      deadlineAt: formCodexAttempt?.deadlineAt,
      now,
      buildInfo,
    });
    try {
      await navigator.clipboard.writeText(diagnostic);
    } catch {
      setConsoleSessionError(copy("settings.token_plan.codex.copy_diagnostic_failed"));
    }
  };

  const cleanupCurrentLegacyCodexAuth = async () => {
    const sessionRef = formCodexSession?.session_ref;
    if (!sessionRef || currentCodexNativeStatus?.legacy_auth_present !== true) return;
    if (!window.confirm(copy("settings.token_plan.codex.legacy_cleanup_confirm"))) return;
    try {
      const nativeStatus = await cleanupLegacyCodexAuthFile(sessionRef);
      rememberCodexNativeStatus(nativeStatus);
      if (nativeStatus?.error_code === "LEGACY_CREDENTIAL_CLEANUP_FAILED") {
        setCodexWarning(nativeStatus);
        window.setTimeout(() => codexAlertRef.current?.focus(), 0);
      } else {
        setCodexWarning(null);
      }
    } catch {
      setCodexWarning({
        error_code: "LEGACY_CREDENTIAL_CLEANUP_FAILED",
        error_message: copy("settings.token_plan.codex.legacy_cleanup_failed"),
      });
      window.setTimeout(() => codexAlertRef.current?.focus(), 0);
    }
  };

  const renderCodexAttemptControls = () => (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-oai-gray-500 dark:text-oai-gray-400">
        <span>{copy("settings.token_plan.codex.current_step")}</span>
        <span data-testid="detection-codex-countdown" className="font-mono tabular-nums">
          {formatCodexCountdown(codexRemainingMs)}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="detection-codex-cancel"
          onClick={() => void cancelCodexAttempt("user_cancelled", formCodexAttempt)}
          className="tt-product-focusable rounded-md border border-oai-gray-200 px-2.5 py-1.5 text-xs dark:border-oai-gray-700"
        >
          {copy("settings.token_plan.codex.cancel")}
        </button>
        <button
          type="button"
          data-testid="detection-codex-reopen"
          onClick={() => void reopenCurrentCodexLogin()}
          disabled={!formCodexSession?.session_ref}
          className="tt-product-focusable rounded-md border border-oai-gray-200 px-2.5 py-1.5 text-xs disabled:opacity-50 dark:border-oai-gray-700"
        >
          {copy("settings.token_plan.codex.reopen")}
        </button>
        <button
          type="button"
          data-testid="detection-codex-copy-diagnostic"
          onClick={() => void copyCurrentCodexDiagnostic()}
          className="tt-product-focusable rounded-md border border-oai-gray-200 px-2.5 py-1.5 text-xs dark:border-oai-gray-700"
        >
          {copy("settings.token_plan.codex.copy_diagnostic")}
        </button>
      </div>
    </div>
  );

  const handleConnectXiaomiMimo = async () => {
    if (connectingConsole) return;
    setConsoleSessionError("");
    if (!form.source) {
      setConsoleSessionError(copy("settings.token_plan.console_session.source_required"));
      return;
    }

    setConnectingConsole(true);
    const resumableSession = xiaomiMimoSession && [
      "pending_login",
      "login_started",
      "awaiting_verification",
    ].includes(xiaomiMimoSession.status)
      ? xiaomiMimoSession
      : null;
    const sessionRef = resumableSession?.session_ref
      || `token-plan/xiaomi_mimo/session/${crypto.randomUUID()}`;
    let createdSession = resumableSession;
    let quotaReady = false;
    try {
      if (!createdSession && xiaomiMimoSession) {
        await deleteConsoleSession(xiaomiMimoSession.id);
        await deleteXiaomiMimoConsoleSession(xiaomiMimoSession.session_ref).catch(() => {});
        setConsoleSessions((previous) => previous.filter((session) => session.id !== xiaomiMimoSession.id));
      }

      if (!createdSession) {
        const created = await createConsoleSession({
          provider_id: "xiaomi_mimo",
          auth_kind: "official_console_session",
          display_name: copy("settings.token_plan.console_session.mimo_display_name"),
          session_ref: sessionRef,
        });
        createdSession = created.session;
        setConsoleSessions(Array.isArray(created.sessions) ? created.sessions : []);

        await openXiaomiMimoConsoleLogin(sessionRef);
      }

      const deadline = Date.now() + XIAOMI_AUTH_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const nativeStatus = await verifyXiaomiMimoConsoleSession(sessionRef);
        if (nativeStatus?.connected && nativeStatus?.quota) {
          quotaReady = true;
          const nativeResult = {
            connected: true,
            session_ref: nativeStatus.session_ref || sessionRef,
            state_code: "connected",
            error_code: "",
            error_message: "",
            quota: projectNativeQuotaForLocal(nativeStatus.quota, new Date().toISOString()),
          };
          const verified = await verifyConsoleSession(createdSession.id, nativeResult);
          const accountBindingId = verified.session?.id || createdSession.id;
          const now = new Date().toISOString();
          const saved = await saveTokenPlan({
            ...form,
            used_quota: Number(nativeStatus.quota.used_quota || 0),
            remaining_quota: Number(nativeStatus.quota.remaining_quota || 0),
            total_quota: Number(nativeStatus.quota.total_quota || form.total_quota || 0),
            expires_at: nativeStatus.quota.expires_at || form.expires_at || "",
            ...projectNativeQuotaSnapshot(nativeStatus.quota, now),
            detection_method: "official_account",
            detection_config: {
              ...form.detection_config,
              official_account: {
                ...form.detection_config.official_account,
                account_binding_id: accountBindingId,
              },
            },
            sync_status: "success",
            last_synced_at: now,
            last_sync_attempt_at: now,
            last_error_code: "",
            last_error_message: "",
            last_refresh_status: "success",
            last_refresh_error: "",
            last_refresh_at: now,
            next_refresh_at: "",
          });
          await deleteXiaomiMimoConsoleSession(sessionRef);
          setConsoleSessions((previous) => previous.map((session) =>
            session.id === accountBindingId ? verified.session : session
          ));
          setRecords(normalizeRecords(saved.records));
          setForm(EMPTY_FORM);
          setFormOpen(false);
          setSavedNotice(true);
          return;
        }

        if (nativeStatus?.state_code === "session_not_found") {
          throw new Error(nativeStatus.error_message || copy("settings.token_plan.console_session.window_closed"));
        }
        if (["reauth_required", "temporary", "unsupported", "failed"].includes(nativeStatus?.state_code)) {
          throw new Error(nativeStatus.error_message || copy("settings.token_plan.console_session.verify_error"));
        }
        await wait(XIAOMI_AUTH_POLL_MS);
      }
      throw new Error(copy("settings.token_plan.console_session.timeout"));
    } catch (err) {
      if (createdSession && !quotaReady) {
        await deleteXiaomiMimoConsoleSession(sessionRef).catch(() => {});
        await deleteConsoleSession(createdSession.id).catch(() => {});
        setConsoleSessions((previous) => previous.filter((session) => session.id !== createdSession.id));
      }
      setConsoleSessionError(err?.message || copy("settings.token_plan.console_session.connect_error"));
    } finally {
      setConnectingConsole(false);
    }
  };

  const handleConnectGlm = async () => {
    if (connectingConsole) return;
    setConsoleSessionError("");
    if (!form.source) {
      setConsoleSessionError(copy("settings.token_plan.console_session.source_required"));
      return;
    }

    setConnectingConsole(true);
    const resumableSession = glmSession && [
      "pending_login",
      "login_started",
      "awaiting_verification",
    ].includes(glmSession.status)
      ? glmSession
      : null;
    const sessionRef = resumableSession?.session_ref
      || `token-plan/glm/session/${crypto.randomUUID()}`;
    let createdSession = resumableSession;
    let balanceReady = false;
    try {
      if (!createdSession && glmSession) {
        await deleteConsoleSession(glmSession.id);
        await deleteGlmConsoleSession(glmSession.session_ref).catch(() => {});
        setConsoleSessions((previous) => previous.filter((session) => session.id !== glmSession.id));
      }

      if (!createdSession) {
        const created = await createConsoleSession({
          provider_id: "glm",
          auth_kind: "official_console_session",
          display_name: copy("settings.token_plan.glm.account_display_name"),
          session_ref: sessionRef,
        });
        createdSession = created.session;
        setConsoleSessions(Array.isArray(created.sessions) ? created.sessions : []);
        await openGlmConsoleLogin(sessionRef);
      }

      const deadline = Date.now() + XIAOMI_AUTH_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const nativeStatus = await verifyGlmConsoleSession(sessionRef);
        if (nativeStatus?.connected && nativeStatus?.balance) {
          balanceReady = true;
          const nativeResult = {
            connected: true,
            session_ref: nativeStatus.session_ref || sessionRef,
            state_code: "connected",
            error_code: "",
            error_message: "",
            balance: nativeStatus.balance,
          };
          const verified = await verifyConsoleSession(createdSession.id, nativeResult);
          const accountBindingId = verified.session?.id || createdSession.id;
          const now = new Date().toISOString();
          let officialApiKeyRef = form.detection_config?.official_account?.api_key_ref || "";
          if (apiKeyInput.trim()) {
            const secretResult = await saveTokenPlanSecret({
              provider_id: "glm",
              purpose: "usage-api",
              secret: apiKeyInput.trim(),
            });
            if (secretResult?.ok && secretResult?.api_key_ref) {
              officialApiKeyRef = secretResult.api_key_ref;
            }
          }
          const saved = await saveTokenPlan({
            ...form,
            detection_method: "official_account",
            detection_config: {
              ...form.detection_config,
              official_account: {
                ...form.detection_config.official_account,
                account_binding_id: accountBindingId,
                api_key_ref: officialApiKeyRef,
                provider_home_url: resolveProviderHomeUrl("glm"),
              },
            },
            provider_reported_fields: [],
            provider_reported_at: "",
            sync_status: "success",
            last_synced_at: now,
            last_sync_attempt_at: now,
            last_error_code: "",
            last_error_message: "",
            refresh_enabled: true,
            refresh_method: "official_api",
            refresh_interval_minutes: 5,
          });
          setConsoleSessions((previous) => previous.map((session) =>
            session.id === accountBindingId ? verified.session : session
          ));
          const savedRecord = (saved.records || []).find((r) => r.id === saved.record?.id)
            || saved.record
            || saved.records?.[saved.records.length - 1];
          if (savedRecord?.id) {
            try {
              const refreshed = await refreshTokenPlan(savedRecord.id);
              setRecords(normalizeRecords(refreshed?.records || saved.records));
            } catch {
              setRecords(normalizeRecords(saved.records));
            }
          } else {
            setRecords(normalizeRecords(saved.records));
          }
          await deleteGlmConsoleSession(sessionRef);
          setForm(EMPTY_FORM);
          setApiKeyInput("");
          setFormOpen(false);
          setSavedNotice(true);
          return;
        }

        if (nativeStatus?.state_code === "session_not_found") {
          throw new Error(nativeStatus.error_message || copy("settings.token_plan.console_session.window_closed"));
        }
        if (["unsupported", "failed"].includes(nativeStatus?.state_code)) {
          throw new Error(nativeStatus.error_message || copy("settings.token_plan.console_session.verify_error"));
        }
        await wait(XIAOMI_AUTH_POLL_MS);
      }
      throw new Error(copy("settings.token_plan.glm.connect_timeout"));
    } catch (err) {
      if (createdSession && !balanceReady) {
        await deleteGlmConsoleSession(sessionRef).catch(() => {});
        await deleteConsoleSession(createdSession.id).catch(() => {});
        setConsoleSessions((previous) => previous.filter((session) => session.id !== createdSession.id));
      }
      setConsoleSessionError(err?.message || copy("settings.token_plan.console_session.connect_error"));
    } finally {
      setConnectingConsole(false);
    }
  };

  const handleConnectCodex = async ({ record = null } = {}) => {
    if (connectingConsole) return;
    const codexForm = record || form;
    setConsoleSessionError("");
    setCodexPersistFailure(null);
    setCodexWarning(null);
    if (!codexForm.source) {
      setConsoleSessionError(copy("settings.token_plan.console_session.source_required"));
      return;
    }

    setConnectingConsole(true);
    const candidateSession = record
      ? resolveConsoleSessionForRecord(record, consoleSessionsRef.current)
      : formCodexSession;
    const resumableSession = candidateSession && [
      "pending_login",
      "login_started",
      "awaiting_verification",
    ].includes(candidateSession.status)
      ? candidateSession
      : null;
    const explicitReauthorization = Boolean(candidateSession && !resumableSession);
    let sessionRef = resumableSession?.session_ref
      || `token-plan/codex/session/${crypto.randomUUID()}`;
    let createdSession = resumableSession;
    let authorizationReady = false;
    let attemptToken = null;
    try {
      let nativeStatus = null;
      if (createdSession) {
        nativeStatus = await verifyCodexConsoleSession(sessionRef);
      } else if (candidateSession) {
        await deleteConsoleSession(candidateSession.id);
        setConsoleSessions((previous) => previous.filter((session) => session.id !== candidateSession.id));
      }
      if (!createdSession) {
        const created = await createConsoleSession({
          provider_id: "codex",
          auth_kind: "official_console_session",
          display_name: copy("settings.token_plan.console_session.safe_account_label"),
          session_ref: sessionRef,
        });
        createdSession = created.session;
        setConsoleSessions(Array.isArray(created.sessions) ? created.sessions : []);
        setForm((current) => {
          if (current.provider_id !== "codex" || (codexForm.id && current.id !== codexForm.id)) {
            return current;
          }
          return {
            ...current,
            detection_config: {
              ...current.detection_config,
              official_account: {
                ...current.detection_config?.official_account,
                account_binding_id: createdSession.id,
                session_ref: sessionRef,
              },
            },
          };
        });
        nativeStatus = explicitReauthorization
          ? await reauthorizeCodexConsoleLogin(sessionRef)
          : await openCodexConsoleLogin(sessionRef);
      }

      const parsedStartedAt = Date.parse(createdSession?.created_at || "");
      const startedAt = resumableSession && Number.isFinite(parsedStartedAt)
        ? parsedStartedAt
        : Date.now();
      const deadline = startedAt + XIAOMI_AUTH_TIMEOUT_MS;
      attemptToken = {
        cancelled: false,
        sessionId: createdSession.id,
        sessionRef,
        startedAt,
        deadlineAt: deadline,
      };
      codexAttemptTokensRef.current.set(sessionRef, attemptToken);
      setCodexAttempt({ sessionId: createdSession.id, sessionRef, startedAt, deadlineAt: deadline });
      setCodexNow(Date.now());

      let verifyWithoutWaiting = !resumableSession;
      for (;;) {
        if (attemptToken.cancelled) return;
        const persisted = await persistCodexNativeStatus(createdSession.id, nativeStatus, {
          attemptToken,
        });
        if (!persisted || attemptToken.cancelled) return;

        const authorizationComplete = isCodexAuthorizationComplete(nativeStatus);
        if (authorizationComplete) {
          authorizationReady = true;
          const accountBindingId = persisted.id || createdSession.id;

          let quotaStatus;
          try {
            quotaStatus = await syncCodexConsoleQuota(sessionRef);
          } catch {
            quotaStatus = {
              connected: true,
              authorized: true,
              session_ref: sessionRef,
              state_code: "authorized",
              quota_sync_status: "error",
              error_code: "QUOTA_SYNC_FAILED",
              error_message: copy("settings.token_plan.codex.quota_sync_failed"),
            };
          }
          const quotaSession = await persistCodexNativeStatus(createdSession.id, quotaStatus, {
            attemptToken,
          });
          if (!quotaSession) return;
          const projectedQuotaStatus = projectCodexStatusForLocal(quotaStatus);
          if (!projectedQuotaStatus.authorized
            || !projectedQuotaStatus.connected
            || !["authorized", "connected"].includes(projectedQuotaStatus.state_code)) {
            setConsoleSessionError(projectedQuotaStatus.error_message || copy("settings.token_plan.console_session.verify_error"));
            return;
          }
          const quotaAvailable = projectedQuotaStatus.state_code === "connected" && Boolean(projectedQuotaStatus.quota);
          const quotaResult = {
            connected: true,
            authorized: true,
            session_ref: projectedQuotaStatus.session_ref || sessionRef,
            state_code: quotaAvailable ? "connected" : "authorized",
            quota_sync_status: quotaAvailable ? "success" : "error",
            error_code: quotaAvailable ? "" : (projectedQuotaStatus.error_code || "QUOTA_SYNC_FAILED"),
            error_message: quotaAvailable
              ? ""
              : (projectedQuotaStatus.error_message || copy("settings.token_plan.codex.quota_sync_failed")),
            ...(quotaAvailable ? { quota: projectedQuotaStatus.quota } : {}),
          };
          if (quotaResult.state_code !== projectedQuotaStatus.state_code
            || quotaResult.error_code !== projectedQuotaStatus.error_code
            || quotaResult.quota_sync_status !== projectedQuotaStatus.quota_sync_status) {
            const normalizedQuotaSession = await persistCodexNativeStatus(createdSession.id, quotaResult, {
              attemptToken,
            });
            if (!normalizedQuotaSession) return;
          }
          const now = new Date().toISOString();
          const saved = await saveTokenPlan({
            ...codexForm,
            refresh_enabled: false,
            refresh_method: "manual",
            used_quota: quotaAvailable
              ? Number(projectedQuotaStatus.quota.used_quota || 0)
              : Number(codexForm.used_quota || 0),
            remaining_quota: quotaAvailable
              ? Number(projectedQuotaStatus.quota.remaining_quota || 0)
              : Number(codexForm.remaining_quota || 0),
            total_quota: Number(selectedPlan?.total_quota || codexForm.total_quota || 0),
            total_quota_display: selectedPlan?.total_quota_display || codexForm.total_quota_display || "",
            quota_windows: quotaAvailable
              ? (projectedQuotaStatus.quota.quota_windows || [])
              : (codexForm.quota_windows || []),
            expires_at: codexForm.expires_at || "",
            ...(quotaAvailable ? projectNativeQuotaSnapshot(projectedQuotaStatus.quota, now) : {}),
            detection_method: "official_account",
            detection_config: {
              ...codexForm.detection_config,
              official_account: {
                ...codexForm.detection_config?.official_account,
                account_binding_id: accountBindingId,
                session_ref: sessionRef,
                provider_home_url: resolveProviderHomeUrl("codex"),
              },
            },
            sync_status: quotaAvailable ? "success" : "failed",
            last_synced_at: quotaAvailable ? now : (codexForm.last_synced_at || ""),
            last_sync_attempt_at: now,
            last_error_code: quotaResult.error_code,
            last_error_message: quotaResult.error_message,
          });
          setRecords(normalizeRecords(saved.records));
          setForm(EMPTY_FORM);
          setFormOpen(false);
          setSavedNotice(true);
          finishCodexAttempt(attemptToken);
          return;
        }

        if (!CODEX_NATIVE_PENDING_STATES.has(nativeStatus?.state_code)) {
          finishCodexAttempt(attemptToken);
          setConsoleSessionError("");
          window.setTimeout(() => codexAlertRef.current?.focus(), 0);
          return;
        }
        if (Date.now() >= deadline) {
          await cancelCodexAttempt("timeout", attemptToken);
          return;
        }
        if (!verifyWithoutWaiting) await wait(XIAOMI_AUTH_POLL_MS);
        verifyWithoutWaiting = false;
        if (attemptToken.cancelled) return;
        nativeStatus = await verifyCodexConsoleSession(sessionRef);
      }
    } catch (err) {
      if (attemptToken?.cancelled) return;
      if (createdSession && !authorizationReady && !attemptToken?.cancelled) {
        const fallbackAttempt = attemptToken || {
          cancelled: false,
          sessionId: createdSession.id,
          sessionRef,
          startedAt: Date.now(),
          deadlineAt: Date.now() + XIAOMI_AUTH_TIMEOUT_MS,
        };
        await cancelCodexAttempt("user_cancelled", fallbackAttempt);
      }
      setConsoleSessionError(err?.message || copy("settings.token_plan.console_session.connect_error"));
    } finally {
      if (codexAttemptTokensRef.current.get(sessionRef) === attemptToken || !attemptToken) {
        setConnectingConsole(false);
      }
    }
  };

  const runQuotaConsoleConnect = async ({
    providerId,
    sessionPrefix,
    providerHomeUrl,
    displayNameSuffix,
    resumableSession,
    openLogin,
    verifySession,
    deleteNativeSession,
    retainNativeSession = false,
    connectTimeoutCopyKey,
    officialExtra = {},
  }) => {
    if (connectingConsole) return;
    setConsoleSessionError("");
    if (!form.source) {
      setConsoleSessionError(copy("settings.token_plan.console_session.source_required"));
      return;
    }

    setConnectingConsole(true);
    const isRetainedQuotaRetry = retainNativeSession
      && resumableSession?.status === "failed"
      && resumableSession?.last_error_code === "QUOTA_SYNC_FAILED";
    const activeResumable = resumableSession && ([
      "pending_login",
      "login_started",
      "awaiting_verification",
    ].includes(resumableSession.status) || isRetainedQuotaRetry)
      ? resumableSession
      : null;
    let sessionRef = activeResumable?.session_ref
      || `token-plan/${sessionPrefix}/session/${crypto.randomUUID()}`;
    let createdSession = activeResumable;
    let quotaReady = false;
    let publicErrorCopyKey = "settings.token_plan.console_session.connect_error";
    const persistSafeFailure = async (stateCode, errorCode) => {
      if (!createdSession || !retainNativeSession) return;
      const verified = await verifyConsoleSession(createdSession.id, {
        connected: false,
        authorized: false,
        session_ref: sessionRef,
        state_code: stateCode,
        error_code: errorCode,
        error_message: "",
      }).catch(() => null);
      if (verified?.session) {
        setConsoleSessions((previous) => previous.map((session) =>
          session.id === createdSession.id ? verified.session : session
        ));
      }
    };
    try {
      if (createdSession) {
        const resumableStatus = await verifySession(sessionRef).catch(() => null);
        if (resumableStatus?.state_code === "session_not_found") {
          const staleSessionId = createdSession.id;
          await deleteConsoleSession(staleSessionId).catch(() => {});
          setConsoleSessions((previous) => previous.filter((session) => session.id !== staleSessionId));
          createdSession = null;
          sessionRef = `token-plan/${sessionPrefix}/session/${crypto.randomUUID()}`;
        }
      }
      if (!createdSession) {
        const created = await createConsoleSession({
          provider_id: providerId,
          auth_kind: "official_console_session",
          display_name: `${displayNameSuffix} · ${copy("settings.token_plan.console_session.safe_account_label")}`,
          session_ref: sessionRef,
        });
        createdSession = created.session;
        setConsoleSessions(Array.isArray(created.sessions) ? created.sessions : []);
        await openLogin(sessionRef);
      }

      const deadline = Date.now() + quotaConsoleAuthTimeoutMs(providerId);
      while (Date.now() < deadline) {
        const nativeStatus = await verifySession(sessionRef);
        if (nativeStatus?.connected && nativeStatus?.quota) {
          quotaReady = true;
          const nativeResult = {
            connected: true,
            session_ref: nativeStatus.session_ref || sessionRef,
            state_code: "connected",
            error_code: "",
            error_message: "",
            quota: projectNativeQuotaForLocal(nativeStatus.quota, new Date().toISOString()),
          };
          const verified = await verifyConsoleSession(createdSession.id, nativeResult);
          const accountBindingId = verified.session?.id || createdSession.id;
          const now = new Date().toISOString();
          const saved = await saveTokenPlan({
            ...form,
            used_quota: Number(nativeStatus.quota.used_quota || 0),
            remaining_quota: Number(nativeStatus.quota.remaining_quota || 0),
            total_quota: Number(nativeStatus.quota.total_quota || selectedPlan?.total_quota || form.total_quota || 0),
            total_quota_display: selectedPlan?.total_quota_display || form.total_quota_display || "",
            quota_windows: nativeStatus.quota.quota_windows || [],
            expires_at: form.expires_at || "",
            ...projectNativeQuotaSnapshot(nativeStatus.quota, now),
            detection_method: "official_account",
            detection_config: {
              ...form.detection_config,
              official_account: buildOfficialAccountPayload(
                form,
                accountBindingId,
                providerHomeUrl,
                {
                  ...officialExtra,
                  session_ref: sessionRef,
                  account_id: nativeStatus.quota.account_id || "",
                  display_name: nativeStatus.quota.display_name || "",
                  plan_name: nativeStatus.quota.plan_name || "",
                },
              ),
            },
            sync_status: "success",
            last_synced_at: now,
            last_sync_attempt_at: now,
            last_error_code: "",
            last_error_message: "",
            last_refresh_status: "success",
            last_refresh_error: "",
            last_refresh_at: now,
            next_refresh_at: "",
          });
          if (!retainNativeSession) {
            await deleteNativeSession(sessionRef);
          }
          setConsoleSessions((previous) => previous.map((session) =>
            session.id === accountBindingId ? verified.session : session
          ));
          setRecords(normalizeRecords(saved.records));
          setForm(EMPTY_FORM);
          setFormOpen(false);
          setSavedNotice(true);
          return;
        }

        if (nativeStatus?.state_code === "session_not_found") {
          publicErrorCopyKey = "settings.token_plan.console_session.window_closed";
          await persistSafeFailure("session_not_found", "SESSION_NOT_FOUND");
          throw new Error(copy(publicErrorCopyKey));
        }
        // Auth may succeed while usage fails — surface sync_failed; do not treat as connected 0%.
        if (["unsupported", "failed", "sync_failed", "reauth_required"].includes(nativeStatus?.state_code)) {
          publicErrorCopyKey = "settings.token_plan.console_session.verify_error";
          const publicErrorCode = nativeStatus.state_code === "sync_failed"
            ? "QUOTA_SYNC_FAILED"
            : nativeStatus.state_code === "reauth_required"
              ? "REAUTH_REQUIRED"
              : nativeStatus.state_code === "unsupported"
                ? "UNSUPPORTED"
                : "AUTHORIZATION_FAILED";
          await persistSafeFailure(nativeStatus.state_code, publicErrorCode);
          throw new Error(copy(publicErrorCopyKey));
        }
        await wait(XIAOMI_AUTH_POLL_MS);
      }
      publicErrorCopyKey = connectTimeoutCopyKey;
      throw new Error(copy(publicErrorCopyKey));
    } catch {
      if (createdSession && !quotaReady && !retainNativeSession) {
        // retainNativeSession keeps per-account auth.json so reconnect can retry usage sync
        // without wiping a just-authorized Cursor/Trae account on a transient sync_failed.
        await deleteNativeSession(sessionRef).catch(() => {});
        await deleteConsoleSession(createdSession.id).catch(() => {});
        setConsoleSessions((previous) => previous.filter((session) => session.id !== createdSession.id));
      }
      setConsoleSessionError(copy(publicErrorCopyKey));
    } finally {
      setConnectingConsole(false);
    }
  };

  const handleConnectClaude = () => runQuotaConsoleConnect({
    providerId: "claude",
    sessionPrefix: "claude",
    providerHomeUrl: resolveProviderHomeUrl("claude"),
    displayNameSuffix: "Claude",
    resumableSession: formClaudeSession,
    openLogin: openClaudeConsoleLogin,
    verifySession: verifyClaudeConsoleSession,
    deleteNativeSession: deleteClaudeConsoleSession,
    connectTimeoutCopyKey: "settings.token_plan.claude.connect_timeout",
    officialExtra: { claude_account_mode: "official" },
  });

  const handleConnectCursor = () => runQuotaConsoleConnect({
    providerId: "cursor",
    sessionPrefix: "cursor",
    providerHomeUrl: resolveProviderHomeUrl("cursor"),
    displayNameSuffix: "Cursor",
    resumableSession: formCursorSession,
    openLogin: openCursorConsoleLogin,
    verifySession: verifyCursorConsoleSession,
    deleteNativeSession: deleteCursorConsoleSession,
    retainNativeSession: true,
    connectTimeoutCopyKey: "settings.token_plan.cursor.connect_timeout",
  });

  const handleConnectTrae = () => runQuotaConsoleConnect({
    providerId: "trae",
    sessionPrefix: "trae",
    providerHomeUrl: resolveProviderHomeUrl("trae"),
    displayNameSuffix: "Trae CN",
    resumableSession: formTraeSession,
    openLogin: openTraeConsoleLogin,
    verifySession: verifyTraeConsoleSession,
    deleteNativeSession: deleteTraeConsoleSession,
    retainNativeSession: true,
    connectTimeoutCopyKey: "settings.token_plan.trae.connect_timeout",
  });

  const handleConnectKimi = () => runQuotaConsoleConnect({
    providerId: "kimi",
    sessionPrefix: "kimi",
    providerHomeUrl: resolveProviderHomeUrl("kimi", form.plan_id),
    displayNameSuffix: "Kimi Code",
    resumableSession: formKimiSession,
    openLogin: openKimiConsoleLogin,
    verifySession: verifyKimiConsoleSession,
    deleteNativeSession: deleteKimiConsoleSession,
    connectTimeoutCopyKey: "settings.token_plan.kimi.connect_timeout",
  });

  const handleAddDetectedAccount = () => {
    setConsoleSessionError("");
    setSavedNotice(false);
    setForm((current) => ({
      ...current,
      id: "",
      notes: "",
      used_quota: 0,
      remaining_quota: 0,
      quota_windows: [],
      provider_reported_at: "",
      sync_status: "",
      last_synced_at: "",
      last_sync_attempt_at: "",
      last_error_code: "",
      last_error_message: "",
      detection_config: {
        ...current.detection_config,
        official_account: {
          ...(current.detection_config?.official_account || {}),
          account_binding_id: "",
        },
      },
    }));
  };

  const handleDeleteConsoleSession = async (sessionId, sessionRef) => {
    try {
      await deleteConsoleSession(sessionId);
      try {
        await deleteXiaomiMimoConsoleSession(sessionRef);
      } catch {
        // Native session may already be gone; ignore.
      }
      setConsoleSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      setConsoleSessionError(err?.message || copy("settings.token_plan.console_session.delete_error"));
    }
  };

  const handleDeleteGlmConsoleSession = async (sessionId, sessionRef) => {
    try {
      await deleteConsoleSession(sessionId);
      try {
        await deleteGlmConsoleSession(sessionRef);
      } catch {
        // Native session may already be gone; ignore.
      }
      setConsoleSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      setConsoleSessionError(err?.message || copy("settings.token_plan.console_session.delete_error"));
    }
  };

  const handleDeleteCodexConsoleSession = (sessionId, sessionRef) => {
    const current = codexDisconnectPromiseRef.current.get(sessionRef);
    if (current) return current;
    const promise = (async () => {
      setCodexDisconnectingSessionRef(sessionRef);
      setConsoleSessionError("");
      try {
        if (!codexNativeDisconnectedRefs.current.has(sessionRef)) {
          const nativeStatus = await deleteCodexConsoleSession(sessionRef);
          rememberCodexNativeStatus(nativeStatus);
          const disconnected = nativeStatus?.state_code === "disconnected"
            && nativeStatus?.authorized === false
            && nativeStatus?.connected === false
            && !String(nativeStatus?.error_code || "").trim()
            && !String(nativeStatus?.error_message || "").trim();
          if (!disconnected) {
            if (nativeStatus) {
              await persistCodexNativeStatus(sessionId, {
                connected: true,
                authorized: true,
                session_ref: sessionRef,
                state_code: "authorized",
                quota_sync_status: "idle",
                error_code: "CODEX_LOGOUT_FAILED",
                error_message: nativeStatus.error_message || copy("settings.token_plan.codex.logout_failed"),
                legacy_auth_present: nativeStatus.legacy_auth_present === true,
              }, { reconcileOnFailure: false });
            }
            setConsoleSessionError(
              nativeStatus?.error_message
              || copy("settings.token_plan.codex.logout_failed"),
            );
            window.setTimeout(() => codexAlertRef.current?.focus(), 0);
            return;
          }
          codexNativeDisconnectedRefs.current.add(sessionRef);
        }

        try {
          await deleteConsoleSession(sessionId);
        } catch {
          setCodexDisconnectRetry({ sessionRef });
          setConsoleSessionError(
            `LOCAL_SESSION_PERSIST_FAILED: ${copy("settings.token_plan.codex.local_persist_failed")}`,
          );
          window.setTimeout(() => codexAlertRef.current?.focus(), 0);
          return;
        }

        setConsoleSessions((previous) => previous.filter((session) => session.id !== sessionId));
        setCodexDisconnectRetry((retry) => retry?.sessionRef === sessionRef ? null : retry);
        setConsoleSessionError("");
      } catch {
        setConsoleSessionError(copy("settings.token_plan.codex.logout_failed"));
        window.setTimeout(() => codexAlertRef.current?.focus(), 0);
      } finally {
        if (codexDisconnectPromiseRef.current.get(sessionRef) === promise) {
          codexDisconnectPromiseRef.current.delete(sessionRef);
        }
        setCodexDisconnectingSessionRef((currentRef) => currentRef === sessionRef ? "" : currentRef);
      }
    })();
    codexDisconnectPromiseRef.current.set(sessionRef, promise);
    return promise;
  };

  const handleDeleteClaudeConsoleSession = async (sessionId, sessionRef) => {
    try {
      await deleteConsoleSession(sessionId);
      try {
        await deleteClaudeConsoleSession(sessionRef);
      } catch {
        // Native session may already be gone; ignore.
      }
      setConsoleSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      setConsoleSessionError(err?.message || copy("settings.token_plan.console_session.delete_error"));
    }
  };

  const handleDeleteCursorConsoleSession = async (sessionId, sessionRef) => {
    try {
      await deleteConsoleSession(sessionId);
      try {
        await deleteCursorConsoleSession(sessionRef);
      } catch {
        // Native session may already be gone; ignore.
      }
      setConsoleSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      setConsoleSessionError(err?.message || copy("settings.token_plan.console_session.delete_error"));
    }
  };

  const handleDeleteTraeConsoleSession = async (sessionId, sessionRef) => {
    try {
      await deleteTraeConsoleSession(sessionRef);
      await deleteConsoleSession(sessionId);
      setConsoleSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch {
      setConsoleSessionError(copy("settings.token_plan.console_session.delete_error"));
    }
  };

  const handleDeleteKimiConsoleSession = async (sessionId, sessionRef) => {
    try {
      await deleteConsoleSession(sessionId);
      try {
        await deleteKimiConsoleSession(sessionRef);
      } catch {
        // Native session may already be gone; ignore.
      }
      setConsoleSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      setConsoleSessionError(err?.message || copy("settings.token_plan.console_session.delete_error"));
    }
  };

  const currentProvider = useMemo(() => {
    return catalog.find((p) => p.id === form.provider_id) || null;
  }, [catalog, form.provider_id]);

  const planOptions = useMemo(() => {
    const plans = currentProvider?.plans || [];
    const opts = plans.map((p) => ({ value: p.plan_id, label: p.display_name }));
    if (form.provider_id === "custom") {
      opts.push({ value: "custom", label: copy("settings.token_plan.custom_plan") });
    }
    return opts;
  }, [currentProvider, form.provider_id]);
  const agentOptions = useMemo(
    () => DASHBOARD_AGENTS.map((agent) => ({ value: agent.id, label: agent.displayName })),
    [],
  );

  const selectedPlan = useMemo(() => {
    if (form.provider_id === "custom" || form.plan_id === "custom") return null;
    return currentProvider?.plans?.find((p) => p.plan_id === form.plan_id) || null;
  }, [currentProvider, form.provider_id, form.plan_id]);

  const isCatalogPlan = form.provider_id !== "custom" && form.plan_id !== "custom" && selectedPlan;
  const isManual = form.provider_id === "custom" || form.plan_id === "custom";
  const supportsOfficialAccountDetection = Boolean(isCatalogPlan) &&
    providerSupportsOfficialAccountDetection(
      form.provider_id,
      form.plan_id,
      form.detection_config?.official_account?.claude_account_mode,
    );
  const claudeRoutingMode = isClaudeRoutingMode(
    form.provider_id,
    form.plan_id,
    form.detection_config?.official_account?.claude_account_mode,
  );
  const isStaticCatalogPlan = Boolean(isCatalogPlan) && !supportsOfficialAccountDetection;
  const showRefreshControls = !isCatalogPlan;
  // W03-R3D: When a detection method is configured, disable manual quota entry.
  // Detection is the primary path — used_quota/remaining_quota/expires_at come from the detection source.
  const hasDetectionConfigured = form.detection_method && form.detection_method !== "not_configured";

  const updateField = (field) => (event) => {
    const value = event.target.value;
    setForm((current) => {
      const next = {
        ...current,
        [field]: ["total_quota", "used_quota", "remaining_quota", "refresh_interval_minutes"].includes(field)
          ? Number(value || 0)
          : value,
      };
      if (field === "provider_id") {
        const provider = catalog.find((p) => p.id === value);
        const firstPlan = value !== "custom" ? provider?.plans?.[0] : null;
        if (firstPlan) {
          next.plan_id = firstPlan.plan_id;
          next.plan_label = firstPlan.display_name;
          next.quota_kind = firstPlan.quota_kind || "unknown";
          next.quota_unit = firstPlan.quota_unit || "tokens";
          next.total_quota = Number(firstPlan.total_quota || 0);
          next.total_quota_display = firstPlan.total_quota_display || "";
          next.quota_catalog_version = "";
          next.quota_source = "catalog";
        } else {
          next.plan_id = value === "custom" ? "custom" : "";
          next.plan_label = "";
          next.quota_kind = "manual";
          next.quota_unit = "tokens";
          next.total_quota = 0;
          next.total_quota_display = "";
          next.quota_catalog_version = "";
          next.quota_source = "manual";
        }
        // W03-R3B: reset detection fields when provider changes
        next.detection_method = "";
        next.detection_config = { ...EMPTY_FORM.detection_config };
        if (firstPlan) {
          next.refresh_enabled = false;
          next.refresh_method = "manual";
          next.credential_ref = "";
          return applyOfficialAccountDefaults(next, value, next.plan_id);
        }
        // W03-R3D: reset API Key input when provider changes
        setApiKeyInput("");
      }
      if (field === "plan_id") {
        const provider = catalog.find((p) => p.id === current.provider_id);
        const plan = provider?.plans?.find((p) => p.plan_id === value);
        if (plan) {
          next.plan_label = plan.display_name;
          next.quota_kind = plan.quota_kind || "unknown";
          next.quota_unit = plan.quota_unit || "tokens";
          next.total_quota = Number(plan.total_quota || 0);
          next.total_quota_display = plan.total_quota_display || "";
          next.quota_catalog_version = "";
          next.quota_source = "catalog";
          next.used_quota = 0;
          next.remaining_quota = 0;
          next.quota_windows = [];
          if (current.id) {
            setPlanRefreshTargetId(current.id);
          }
          return applyOfficialAccountDefaults(next, current.provider_id, value);
        } else {
          next.plan_label = current.plan_label;
          next.quota_kind = "manual";
          next.quota_unit = "tokens";
          next.quota_source = "manual";
        }
      }
      return next;
    });
    setSavedNotice(false);
  };

  const updateCheckbox = (field) => (event) => {
    const checked = event.target.checked;
    setForm((current) => ({
      ...current,
      [field]: checked,
    }));
    setSavedNotice(false);
  };

  const updateClaudeAccountMode = (event) => {
    const value = event.target.value;
    setForm((current) => ({
      ...current,
      detection_method: value === "routing" ? "" : current.detection_method,
      detection_config: {
        ...current.detection_config,
        official_account: {
          ...(current.detection_config?.official_account || EMPTY_FORM.detection_config.official_account),
          claude_account_mode: value,
        },
      },
    }));
    setSavedNotice(false);
  };

  // W03-R3B: detection method selector
  const updateDetectionMethod = (event) => {
    const value = event.target.value;
    setForm((current) => ({
      ...current,
      detection_method: value,
    }));
    setSavedNotice(false);
  };

  // W03-R3C: update nested custom_api detection config fields
  const updateCustomApiField = (field) => (event) => {
    const value = event.target.value;
    setForm((current) => ({
      ...current,
      detection_config: {
        ...current.detection_config,
        custom_api: {
          ...(current.detection_config?.custom_api || EMPTY_FORM.detection_config.custom_api),
          [field]: value,
        },
      },
    }));
    setSavedNotice(false);
  };

  const updateCustomApiMappingField = (field) => (event) => {
    const value = event.target.value;
    setForm((current) => ({
      ...current,
      detection_config: {
        ...current.detection_config,
        custom_api: {
          ...(current.detection_config?.custom_api || EMPTY_FORM.detection_config.custom_api),
          response_mapping: {
            ...(current.detection_config?.custom_api?.response_mapping || EMPTY_FORM.detection_config.custom_api.response_mapping),
            [field]: value,
          },
        },
      },
    }));
    setSavedNotice(false);
  };

  const openNewForm = () => {
    if (listOnly) {
      onNavigate("/settings/cost/token-plans/new");
      return;
    }
    setForm(EMPTY_FORM);
    setApiKeyInput("");
    setFormOpen(true);
    setSavedNotice(false);
    setError("");
  };

  const closeForm = () => {
    setForm(EMPTY_FORM);
    setApiKeyInput("");
    setFormOpen(false);
    setSavedNotice(false);
    if (editorPlanId) onNavigate("/settings/cost");
  };

  const save = async ({ keepOpen = false } = {}) => {
    setSaving(true);
    setError("");
    setSavedNotice(false);
    try {
      // W03-R3D P0: If the user entered an API Key and detection_method is
      // custom_api, save the secret first via the secrets endpoint to get
      // an api_key_ref.  The api_key_ref is what gets persisted — the raw
      // API Key is never stored in config.json or the plan record.
      //
      // W03-R3D P1 fix: ALWAYS save when the user typed a new key, even if
      // an old api_key_ref already exists.  The in-memory credential store
      // is volatile — after a server restart the old ref is stale and the
      // user MUST be able to re-enter / rotate the key.  Only when the
      // input is empty do we fall back to the existing ref (preserve it).
      let apiKeyRef = form.detection_config?.custom_api?.api_key_ref || "";
      let officialApiKeyRef = form.detection_config?.official_account?.api_key_ref || "";
      if (form.detection_method === "custom_api" && apiKeyInput.trim()) {
        const secretResult = await saveTokenPlanSecret({
          provider_id: form.provider_id || "xiaomi_mimo",
          purpose: "custom-api",
          secret: apiKeyInput.trim(),
        });
        if (!secretResult?.ok || !secretResult?.api_key_ref) {
          throw new Error(
            secretResult?.error || copy("settings.token_plan.secret_save_error"),
          );
        }
        apiKeyRef = secretResult.api_key_ref;
      }
      if (
        form.provider_id === "glm" &&
        form.detection_method === "official_account" &&
        apiKeyInput.trim()
      ) {
        const secretResult = await saveTokenPlanSecret({
          provider_id: "glm",
          purpose: "usage-api",
          secret: apiKeyInput.trim(),
        });
        if (!secretResult?.ok || !secretResult?.api_key_ref) {
          throw new Error(
            secretResult?.error || copy("settings.token_plan.secret_save_error"),
          );
        }
        officialApiKeyRef = secretResult.api_key_ref;
      }
      if (
        form.provider_id === "kimi" &&
        form.detection_method === "official_account" &&
        form.plan_id === "kimi_api_budget" &&
        apiKeyInput.trim()
      ) {
        const secretResult = await saveTokenPlanSecret({
          provider_id: "kimi",
          purpose: "balance-api",
          secret: apiKeyInput.trim(),
        });
        if (!secretResult?.ok || !secretResult?.api_key_ref) {
          throw new Error(
            secretResult?.error || copy("settings.token_plan.secret_save_error"),
          );
        }
        officialApiKeyRef = secretResult.api_key_ref;
      }
      if (
        form.provider_id === "minimax" &&
        form.detection_method === "official_account" &&
        form.plan_id === "minimax_manual_quota" &&
        apiKeyInput.trim()
      ) {
        const secretResult = await saveTokenPlanSecret({
          provider_id: "minimax",
          purpose: "token-plan-api",
          secret: apiKeyInput.trim(),
        });
        if (!secretResult?.ok || !secretResult?.api_key_ref) {
          throw new Error(
            secretResult?.error || copy("settings.token_plan.secret_save_error"),
          );
        }
        officialApiKeyRef = secretResult.api_key_ref;
      }
      if (
        form.provider_id === "aliyun_bailian" &&
        form.detection_method === "official_account" &&
        form.plan_id === "aliyun_bailian_manual_quota" &&
        apiKeyInput.trim()
      ) {
        const secretResult = await saveTokenPlanSecret({
          provider_id: "aliyun_bailian",
          purpose: "coding-plan-api",
          secret: apiKeyInput.trim(),
        });
        if (!secretResult?.ok || !secretResult?.api_key_ref) {
          throw new Error(
            secretResult?.error || copy("settings.token_plan.secret_save_error"),
          );
        }
        officialApiKeyRef = secretResult.api_key_ref;
      }

      // W03-R3B: build save payload with R3A contract detection fields.
      // Never send API key / cookie / authorization in the plan record.
      const payload = {
        ...form,
        // Strip forbidden fields per R3A contract
        api_key: undefined,
        apiKey: undefined,
        cookie: undefined,
        authorization: undefined,
        authorization_header: undefined,
        bearer: undefined,
        token: undefined,
        password: undefined,
      };
      const catalogPlanForSave = findCatalogPlan(catalog, form.provider_id, form.plan_id);
      if (catalogPlanForSave) {
        payload.total_quota = Number(catalogPlanForSave.total_quota || 0);
        payload.total_quota_display = catalogPlanForSave.total_quota_display || "";
        payload.quota_source = "catalog";
      }
      if (isCatalogPlan) {
        if (
          form.detection_method === "official_account"
          && providerSupportsOfficialAccountDetection(
            form.provider_id,
            form.plan_id,
            form.detection_config?.official_account?.claude_account_mode,
          )
        ) {
          const nativeCodexSync = form.provider_id === "codex" && formCodexSession?.status === "connected";
          payload.refresh_enabled = !nativeCodexSync;
          payload.refresh_method = nativeCodexSync ? "manual" : "official_api";
          if (!nativeCodexSync) payload.refresh_interval_minutes = 5;
        } else {
          payload.refresh_enabled = false;
          payload.refresh_method = "manual";
          payload.credential_ref = "";
        }
        if (!supportsOfficialAccountDetection) {
          payload.detection_method = "";
        }
      }
      // Only include detection_config if detection_method is set
      if (!payload.detection_method) {
        delete payload.detection_config;
      } else if (payload.detection_method === "custom_api" && apiKeyRef) {
        // W03-R3D: Write the api_key_ref into the detection config
        payload.detection_config = {
          ...payload.detection_config,
          custom_api: {
            ...(payload.detection_config?.custom_api || EMPTY_FORM.detection_config.custom_api),
            api_key_ref: apiKeyRef,
          },
        };
      } else if (
        payload.detection_method === "official_account" &&
        form.provider_id === "glm"
      ) {
        payload.detection_config = {
          ...payload.detection_config,
          official_account: {
            ...(payload.detection_config?.official_account || EMPTY_FORM.detection_config.official_account),
            api_key_ref: officialApiKeyRef,
            provider_home_url: resolveProviderHomeUrl("glm"),
            account_binding_id: glmSession?.id
              || payload.detection_config?.official_account?.account_binding_id
              || "",
          },
        };
      } else if (
        payload.detection_method === "official_account" &&
        form.provider_id === "kimi"
      ) {
        payload.detection_config = {
          ...payload.detection_config,
          official_account: {
            ...(payload.detection_config?.official_account || EMPTY_FORM.detection_config.official_account),
            ...(form.plan_id === "kimi_api_budget" ? { api_key_ref: officialApiKeyRef } : {}),
            provider_home_url: resolveProviderHomeUrl("kimi", form.plan_id),
          },
        };
      } else if (
        payload.detection_method === "official_account" &&
        form.provider_id === "minimax"
      ) {
        payload.detection_config = {
          ...payload.detection_config,
          official_account: {
            ...(payload.detection_config?.official_account || EMPTY_FORM.detection_config.official_account),
            api_key_ref: officialApiKeyRef,
            provider_home_url: resolveProviderHomeUrl("minimax"),
          },
        };
      } else if (
        payload.detection_method === "official_account" &&
        form.provider_id === "aliyun_bailian"
      ) {
        payload.detection_config = {
          ...payload.detection_config,
          official_account: {
            ...(payload.detection_config?.official_account || EMPTY_FORM.detection_config.official_account),
            api_key_ref: officialApiKeyRef,
            provider_home_url: resolveProviderHomeUrl("aliyun_bailian", form.plan_id),
          },
        };
      } else if (
        payload.detection_method === "official_account" &&
        form.provider_id === "codex"
      ) {
        payload.credential_ref = "";
        payload.detection_config = {
          ...payload.detection_config,
          official_account: {
            ...(payload.detection_config?.official_account || EMPTY_FORM.detection_config.official_account),
            provider_home_url: resolveProviderHomeUrl("codex"),
            account_binding_id: formCodexSession?.status === "connected" ? formCodexSession.id : "",
          },
        };
      } else if (
        payload.detection_method === "official_account" &&
        form.provider_id === "claude" &&
        !isClaudeRoutingMode(form.provider_id, form.plan_id, form.detection_config?.official_account?.claude_account_mode)
      ) {
        payload.credential_ref = "";
        payload.detection_config = {
          ...payload.detection_config,
          official_account: {
            ...(payload.detection_config?.official_account || EMPTY_FORM.detection_config.official_account),
            claude_account_mode: "official",
            provider_home_url: resolveProviderHomeUrl("claude"),
            account_binding_id: formClaudeSession?.id
              || payload.detection_config?.official_account?.account_binding_id
              || "",
          },
        };
      } else if (
        payload.detection_method === "official_account" &&
        form.provider_id === "cursor"
      ) {
        payload.detection_config = {
          ...payload.detection_config,
          official_account: {
            ...(payload.detection_config?.official_account || EMPTY_FORM.detection_config.official_account),
            provider_home_url: resolveProviderHomeUrl("cursor"),
            account_binding_id: formCursorSession?.id
              || payload.detection_config?.official_account?.account_binding_id
              || "",
          },
        };
      }
      if (isClaudeRoutingMode(form.provider_id, form.plan_id, form.detection_config?.official_account?.claude_account_mode)) {
        payload.detection_method = "";
        payload.refresh_enabled = false;
        payload.refresh_method = "manual";
        payload.credential_ref = "";
        payload.detection_config = {
          ...payload.detection_config,
          official_account: {
            ...(payload.detection_config?.official_account || EMPTY_FORM.detection_config.official_account),
            claude_account_mode: "routing",
            provider_home_url: resolveProviderLinkUrl("catalog-claude-console"),
          },
        };
      }
      if (payload.detection_method && payload.detection_method !== "not_configured") {
        for (const providerOwnedField of [
          "total_quota",
          "used_quota",
          "remaining_quota",
          "quota_windows",
          "provider_reported_fields",
          "provider_reported_at",
          "expires_at",
        ]) {
          delete payload[providerOwnedField];
        }
      }
      payload.notes = String(form.notes || "").trim().slice(0, 200);
      const result = await saveTokenPlan(payload);
      let nextRecords = normalizeRecords(result?.records);
      const savedId = result?.record?.id
        || nextRecords.find((r) => r.id === payload.id)?.id
        || nextRecords[nextRecords.length - 1]?.id;
      if (
        savedId &&
        payload.detection_method === "official_account" &&
        providerSupportsOfficialAccountDetection(
          payload.provider_id,
          payload.plan_id,
          payload.detection_config?.official_account?.claude_account_mode,
        )
      ) {
        const glmApiKeyRef = payload.provider_id === "glm"
          ? (officialApiKeyRef || payload.detection_config?.official_account?.api_key_ref || "")
          : "";
        const skipBackendRefreshOnSave = (payload.provider_id === "glm" && !glmApiKeyRef)
          || (payload.provider_id === "codex" && formCodexSession?.status === "connected")
          || ["claude", "cursor"].includes(payload.provider_id)
          || (payload.provider_id === "kimi" && payload.plan_id !== "kimi_api_budget");
        if (!skipBackendRefreshOnSave) {
          try {
            const refreshed = await refreshTokenPlan(savedId);
            nextRecords = normalizeRecords(refreshed?.records || nextRecords);
          } catch {
            // Save succeeded; refresh failure is surfaced on next manual sync.
          }
        }
      }
      setRecords(nextRecords);
      if (!keepOpen) {
        setForm(EMPTY_FORM);
        setApiKeyInput("");
        setFormOpen(false);
      } else if (savedId) {
        const savedRecord = nextRecords.find((record) => record.id === savedId);
        if (savedRecord) {
          setForm((current) => ({
            ...current,
            id: savedRecord.id,
            plan_id: savedRecord.plan_id || current.plan_id,
            plan_label: savedRecord.plan_label || current.plan_label,
            used_quota: Number(savedRecord.used_quota ?? current.used_quota),
            remaining_quota: Number(savedRecord.remaining_quota ?? current.remaining_quota),
            total_quota: Number(savedRecord.total_quota ?? current.total_quota),
            quota_windows: savedRecord.quota_windows || current.quota_windows,
            sync_status: savedRecord.sync_status || current.sync_status,
            last_error_code: savedRecord.last_error_code || "",
            last_error_message: savedRecord.last_error_message || "",
            detection_config: savedRecord.detection_config || current.detection_config,
          }));
        }
      }
      setSavedNotice(true);
      if (!keepOpen && editorPlanId) onNavigate("/settings/cost");
      return { savedId, records: nextRecords };
    } catch (err) {
      setError(err?.message || copy("settings.token_plan.save_error"));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const refresh = async (id) => {
    const guardedPlan = recordsRef.current.find((record) => record.id === id);
    const guardedSession = guardedPlan
      ? resolveConsoleSessionForRecord(guardedPlan, consoleSessionsRef.current)
      : null;
    if (guardedPlan?.provider_id === "codex"
      && guardedPlan.detection_method === "official_account"
      && codexDisconnectBlocksRefresh(guardedSession?.session_ref)) {
      return;
    }
    if (refreshingPlanIdsRef.current.has(id)) return;
    refreshingPlanIdsRef.current.add(id);
    setRefreshingId(id);
    setError("");
    try {
      // For xiaomi_mimo plans with official_account detection and a
      // connected console session, fetch fresh quota via the Tauri
      // bridge (same-session WebView) before calling the backend refresh.
      const plan = records.find((r) => r.id === id);
      const recordConsoleSession = plan ? resolveConsoleSessionForRecord(plan, consoleSessions) : null;
      if (
        plan &&
        plan.provider_id === "glm" &&
        plan.detection_method === "official_account" &&
        glmSession &&
        glmSession.status === "connected" &&
        glmSession.session_ref
      ) {
        // GLM 官网登录仅用于余额展示；Token 窗口额度走后端 API Key 刷新，不写入 total_quota。
      }
      if (
        plan &&
        plan.provider_id === "codex" &&
        plan.detection_method === "official_account" &&
        recordConsoleSession &&
        recordConsoleSession.status === "connected" &&
        recordConsoleSession.session_ref
      ) {
        if (codexDisconnectBlocksRefresh(recordConsoleSession.session_ref)) return;
        let nativeStatus;
        try {
          nativeStatus = await syncCodexConsoleQuota(recordConsoleSession.session_ref);
        } catch {
          nativeStatus = {
            connected: true,
            authorized: true,
            session_ref: recordConsoleSession.session_ref,
            state_code: "authorized",
            quota_sync_status: "error",
            error_code: "QUOTA_SYNC_FAILED",
            error_message: copy("settings.token_plan.codex.quota_sync_failed"),
          };
        }
        if (codexDisconnectBlocksRefresh(recordConsoleSession.session_ref)) return;
        const projectedStatus = projectCodexStatusForLocal(nativeStatus);
        const now = new Date().toISOString();
        let verified;
        try {
          verified = await verifyConsoleSession(recordConsoleSession.id, projectedStatus);
        } catch {
          setError(`LOCAL_SESSION_PERSIST_FAILED: ${copy("settings.token_plan.codex.local_persist_failed")}`);
          return;
        }
        if (codexDisconnectBlocksRefresh(recordConsoleSession.session_ref)) return;
        if (!verified?.session) {
          setError(`LOCAL_SESSION_PERSIST_FAILED: ${copy("settings.token_plan.codex.local_persist_failed")}`);
          return;
        }
        replaceConsoleSession(verified.session);

        const quotaAvailable = projectedStatus.state_code === "connected" && Boolean(projectedStatus.quota);
        if (quotaAvailable) {
          try {
            const catalogPlan = findCatalogPlan(catalog, plan.provider_id, plan.plan_id);
            const result = await saveTokenPlan({
              ...plan,
              used_quota: Number(projectedStatus.quota.used_quota || 0),
              remaining_quota: Number(projectedStatus.quota.remaining_quota || 0),
              total_quota: Number(catalogPlan?.total_quota || plan.total_quota || 0),
              total_quota_display: catalogPlan?.total_quota_display || plan.total_quota_display || "",
              quota_windows: projectedStatus.quota.quota_windows || plan.quota_windows || [],
              expires_at: plan.expires_at || "",
              ...projectNativeQuotaSnapshot(projectedStatus.quota, now),
              sync_status: "success",
              last_synced_at: new Date().toISOString(),
              last_sync_attempt_at: now,
              last_error_code: "",
              last_error_message: "",
              last_refresh_status: "success",
              last_refresh_error: "",
              last_refresh_at: now,
            });
            setRecords(normalizeRecords(result?.records));
            return { codexReauthRequired: false };
          } catch (err) {
            setError(err?.message || copy("settings.token_plan.refresh_failed"));
            return;
          }
        }
        const reauthRequired = projectedStatus.state_code === "reauth_required";
        const reconnectRequired = reauthRequired || projectedStatus.quota_sync_status === "error";
        const errorCode = projectedStatus.error_code
          || (reauthRequired ? "REAUTH_REQUIRED" : "QUOTA_SYNC_FAILED");
        const errorMessage = projectedStatus.error_message
          || (reauthRequired
            ? copy("settings.token_plan.codex_quota.reauth")
            : copy("settings.token_plan.codex.quota_sync_failed"));
        const result = await saveTokenPlan({
          ...plan,
          sync_status: reauthRequired ? "reauth_required" : "failed",
          last_sync_attempt_at: now,
          last_error_code: errorCode,
          last_error_message: errorMessage,
          last_refresh_status: "failed",
          last_refresh_error: errorMessage,
          last_refresh_at: now,
        });
        setRecords(normalizeRecords(result?.records));
        setError(errorMessage);
        return { codexReauthRequired: reconnectRequired };
      }
      if (
        plan &&
        plan.provider_id === "codex" &&
        plan.detection_method === "official_account"
      ) {
        const now = new Date().toISOString();
        const errorMessage = copy("settings.token_plan.codex_quota.reauth");
        const result = await saveTokenPlan({
          ...plan,
          sync_status: "reauth_required",
          last_sync_attempt_at: now,
          last_error_code: "SESSION_NOT_FOUND",
          last_error_message: errorMessage,
          last_refresh_status: "failed",
          last_refresh_error: errorMessage,
          last_refresh_at: now,
        });
        setRecords(normalizeRecords(result?.records));
        setError(errorMessage);
        return { codexReauthRequired: true };
      }
      const webviewQuotaProviders = [
        { id: "claude", verify: verifyClaudeConsoleSession, skip: isClaudeRoutingMode(plan?.provider_id, plan?.plan_id, plan?.detection_config?.official_account?.claude_account_mode) },
        { id: "cursor", verify: verifyCursorConsoleSession },
        { id: "trae", verify: verifyTraeConsoleSession },
        { id: "kimi", verify: verifyKimiConsoleSession, skip: plan?.plan_id === "kimi_api_budget" },
      ];
      for (const entry of webviewQuotaProviders) {
        const boundSessionRef = recordConsoleSession?.session_ref
          || plan?.detection_config?.official_account?.session_ref
          || "";
        if (
          plan &&
          plan.provider_id === entry.id &&
          !entry.skip &&
          plan.detection_method === "official_account" &&
          boundSessionRef
        ) {
          try {
            const nativeStatus = await entry.verify(boundSessionRef);
            if (nativeStatus?.connected && nativeStatus?.quota) {
              const catalogPlan = findCatalogPlan(catalog, plan.provider_id, plan.plan_id);
              const now = new Date().toISOString();
              await saveTokenPlan({
                ...plan,
                used_quota: Number(nativeStatus.quota.used_quota || 0),
                remaining_quota: Number(nativeStatus.quota.remaining_quota || 0),
                total_quota: Number(nativeStatus.quota.total_quota || catalogPlan?.total_quota || plan.total_quota || 0),
                total_quota_display: catalogPlan?.total_quota_display || plan.total_quota_display || "",
                quota_windows: nativeStatus.quota.quota_windows || plan.quota_windows || [],
                expires_at: plan.expires_at || "",
                ...projectNativeQuotaSnapshot(nativeStatus.quota, now),
                detection_config: {
                  ...plan.detection_config,
                  official_account: buildOfficialAccountPayload(
                    plan,
                    plan.detection_config?.official_account?.account_binding_id || recordConsoleSession?.id || "",
                    plan.detection_config?.official_account?.provider_home_url || "",
                    {
                      session_ref: nativeStatus.session_ref || boundSessionRef,
                      account_id: nativeStatus.quota.account_id
                        || plan.detection_config?.official_account?.account_id
                        || "",
                      display_name: nativeStatus.quota.display_name
                        || plan.detection_config?.official_account?.display_name
                        || "",
                      plan_name: nativeStatus.quota.plan_name
                        || plan.detection_config?.official_account?.plan_name
                        || "",
                    },
                  ),
                },
                sync_status: "success",
                last_synced_at: now,
                last_sync_attempt_at: now,
                last_error_code: "",
                last_error_message: "",
                last_refresh_status: "success",
                last_refresh_error: "",
                last_refresh_at: now,
              });
              const plansResult = await getTokenPlans();
              setRecords(normalizeRecords(plansResult?.records));
              setRefreshingId("");
              return;
            }
            const reauthRequired = ["session_not_found", "reauth_required"].includes(nativeStatus?.state_code);
            const syncFailed = nativeStatus?.state_code === "sync_failed";
            const errorCode = nativeStatus?.error_code
              || (reauthRequired ? "SESSION_NOT_FOUND" : (syncFailed ? "SYNC_FAILED" : "QUOTA_SYNC_FAILED"));
            const errorMessage = nativeStatus?.error_message
              || (reauthRequired
                ? copy("settings.token_plan.console_session.window_closed")
                : copy("settings.token_plan.refresh_failed"));
            if (recordConsoleSession?.id) {
              const localStatus = projectNativeStatusForLocal(nativeStatus || {
                connected: false,
                session_ref: boundSessionRef,
                state_code: reauthRequired ? "session_not_found" : (syncFailed ? "sync_failed" : "failed"),
                error_code: errorCode,
                error_message: errorMessage,
              }, boundSessionRef);
              const verified = await verifyConsoleSession(recordConsoleSession.id, localStatus).catch(() => null);
              if (verified?.session) {
                setConsoleSessions((previous) => previous.map((session) =>
                  session.id === recordConsoleSession.id ? verified.session : session
                ));
              }
            }
            const now = new Date().toISOString();
            const result = await saveTokenPlan({
              ...plan,
              sync_status: reauthRequired ? "reauth_required" : "failed",
              last_sync_attempt_at: now,
              last_error_code: errorCode,
              last_error_message: errorMessage,
              last_refresh_status: "failed",
              last_refresh_error: errorMessage,
              last_refresh_at: now,
            });
            setRecords(normalizeRecords(result?.records));
            setError(errorMessage);
            return;
          } catch (err) {
            const now = new Date().toISOString();
            const errorMessage = err?.message || copy("settings.token_plan.refresh_failed");
            const result = await saveTokenPlan({
              ...plan,
              sync_status: "failed",
              last_sync_attempt_at: now,
              last_error_code: "QUOTA_SYNC_FAILED",
              last_error_message: errorMessage,
              last_refresh_status: "failed",
              last_refresh_error: errorMessage,
              last_refresh_at: now,
            });
            setRecords(normalizeRecords(result?.records));
            setError(errorMessage);
            return;
          }
        }
      }
      if (
        plan &&
        plan.provider_id === "xiaomi_mimo" &&
        plan.detection_method === "official_account" &&
        xiaomiMimoSession &&
        xiaomiMimoSession.status === "connected" &&
        xiaomiMimoSession.session_ref
      ) {
        try {
          const nativeStatus = await verifyXiaomiMimoConsoleSession(
            xiaomiMimoSession.session_ref
          );
          if (nativeStatus?.quota) {
            const now = new Date().toISOString();
            // Update the plan directly with fresh quota from the native bridge
            await saveTokenPlan({
              ...plan,
              used_quota: Number(nativeStatus.quota.used_quota || 0),
              remaining_quota: Number(nativeStatus.quota.remaining_quota || 0),
              total_quota: Number(nativeStatus.quota.total_quota || plan.total_quota),
              expires_at: nativeStatus.quota.expires_at || plan.expires_at || "",
              ...projectNativeQuotaSnapshot(nativeStatus.quota, now),
              sync_status: "success",
              last_synced_at: now,
              last_sync_attempt_at: now,
              last_error_code: "",
              last_error_message: "",
              last_refresh_status: "success",
              last_refresh_error: "",
              last_refresh_at: now,
            });
            // Re-fetch records to reflect the update
            const plansResult = await getTokenPlans();
            setRecords(normalizeRecords(plansResult?.records));
            setRefreshingId("");
            return;
          }
          const nativeState = String(nativeStatus?.state_code || "").trim();
          if (["reauth_required", "temporary", "unsupported"].includes(nativeState)) {
            const now = new Date().toISOString();
            const errorMessage = nativeStatus?.error_message || copy("settings.token_plan.refresh_failed");
            const result = await saveTokenPlan({
              ...plan,
              sync_status: nativeState,
              last_sync_attempt_at: now,
              last_error_code: nativeStatus?.error_code || nativeState.toUpperCase(),
              last_error_message: errorMessage,
              last_refresh_status: "failed",
              last_refresh_error: errorMessage,
              last_refresh_at: now,
            });
            setRecords(normalizeRecords(result?.records));
            return;
          }
        } catch (_) {
          // Native fetch failed; fall through to backend refresh
        }
      }
      // Standard backend refresh path
      const result = await refreshTokenPlan(id);
      const nextRecords = normalizeRecords(result?.records);
      setRecords(nextRecords);
      const refreshedPlan = result?.plan || nextRecords.find((record) => record.id === id);
      setForm((current) => {
        if (current.id !== id || !refreshedPlan) return current;
        return {
          ...current,
          plan_id: refreshedPlan.plan_id || current.plan_id,
          plan_label: refreshedPlan.plan_label || current.plan_label,
          used_quota: Number(refreshedPlan.used_quota ?? current.used_quota),
          remaining_quota: Number(refreshedPlan.remaining_quota ?? current.remaining_quota),
          total_quota: Number(refreshedPlan.total_quota ?? current.total_quota),
          total_quota_display: refreshedPlan.total_quota_display || current.total_quota_display,
          expires_at: refreshedPlan.expires_at ?? current.expires_at,
          quota_windows: refreshedPlan.quota_windows || current.quota_windows,
          sync_status: refreshedPlan.sync_status || current.sync_status,
        };
      });
      if (refreshedPlan?.last_refresh_status === "failed") {
        setError(refreshedPlan?.last_refresh_error || copy("settings.token_plan.refresh_failed"));
      }
    } catch (err) {
      setError(err?.message || copy("settings.token_plan.refresh_failed"));
    } finally {
      refreshingPlanIdsRef.current.delete(id);
      setRefreshingId("");
    }
  };
  refreshRef.current = refresh;

  useEffect(() => {
    if (loadingConsoleSessions || codexInitialReconcileDoneRef.current) return;
    codexInitialReconcileDoneRef.current = true;
    const pendingSessions = consoleSessionsRef.current.filter((session) =>
      session.provider_id === "codex"
      && ["pending_login", "login_started", "awaiting_verification"].includes(session.status)
    );
    if (pendingSessions.length === 0) return;
    let cancelled = false;
    const attemptTokens = pendingSessions.map((session) => {
      const parsedStartedAt = Date.parse(session.created_at || "");
      const startedAt = Number.isFinite(parsedStartedAt) ? parsedStartedAt : Date.now();
      const attemptToken = {
        cancelled: false,
        sessionId: session.id,
        sessionRef: session.session_ref,
        startedAt,
        deadlineAt: startedAt + XIAOMI_AUTH_TIMEOUT_MS,
      };
      codexAttemptTokensRef.current.set(session.session_ref, attemptToken);
      setCodexAttempt({
        sessionId: session.id,
        sessionRef: session.session_ref,
        startedAt,
        deadlineAt: attemptToken.deadlineAt,
      });
      setCodexNow(Date.now());
      void (async () => {
        try {
          for (;;) {
            if (cancelled || attemptToken.cancelled) return;
            const nativeStatus = await verifyCodexConsoleSession(session.session_ref);
            if (cancelled || attemptToken.cancelled) return;
            const persisted = await persistCodexNativeStatus(session.id, nativeStatus, { attemptToken });
            if (!persisted || attemptToken.cancelled) return;
            if (isCodexAuthorizationComplete(nativeStatus)
              || !CODEX_NATIVE_PENDING_STATES.has(nativeStatus?.state_code)) {
              finishCodexAttempt(attemptToken);
              return;
            }
            if (Date.now() >= attemptToken.deadlineAt) {
              await cancelCodexAttempt("timeout", attemptToken);
              return;
            }
            await wait(XIAOMI_AUTH_POLL_MS);
          }
        } catch (error) {
          if (!cancelled) {
            setConsoleSessionError(error?.message || copy("settings.token_plan.console_session.verify_error"));
          }
        }
      })();
      return attemptToken;
    });
    return () => {
      cancelled = true;
      for (const attemptToken of attemptTokens) {
        attemptToken.cancelled = true;
        if (codexAttemptTokensRef.current.get(attemptToken.sessionRef) === attemptToken) {
          codexAttemptTokensRef.current.delete(attemptToken.sessionRef);
        }
      }
    };
  }, [loadingConsoleSessions]);

  useEffect(() => {
    const isActive = (attemptToken) => {
      if (!attemptToken?.deadlineAt || attemptToken.cancelled) return false;
      const stateCode = codexNativeStatuses[attemptToken.sessionRef]?.state_code;
      return !["authorized", "connected", "reauth_required", "failed", "session_not_found", "disconnected"].includes(stateCode);
    };
    if (![...codexAttemptTokensRef.current.values()].some(isActive)) return undefined;
    const tick = () => {
      const now = Date.now();
      setCodexNow(now);
      for (const attemptToken of codexAttemptTokensRef.current.values()) {
        if (isActive(attemptToken) && now >= attemptToken.deadlineAt) {
          void cancelCodexAttempt("timeout", attemptToken);
        }
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [codexAttempt, codexNativeStatuses]);

  useEffect(() => {
    if (!formOpen || form.provider_id !== "codex") return;
    if (consoleSessionError || codexWarning || codexPersistFailure || codexStage === "failed") {
      const timer = window.setTimeout(() => codexAlertRef.current?.focus(), 50);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [codexPersistFailure, codexStage, codexWarning, consoleSessionError, form.plan_id, form.provider_id, formOpen]);

  useEffect(() => {
    if (!showFullEmail) {
      fullEmailRefreshAttemptedIdsRef.current.clear();
      return;
    }
    if (loading) return;
    recordsRef.current
      .filter((record) => record.provider_id === "cursor"
        && record.detection_method === "official_account"
        && authorizedTokenPlanAccount(record).includes("*"))
      .forEach((record) => {
        if (!record.id || fullEmailRefreshAttemptedIdsRef.current.has(record.id)) return;
        fullEmailRefreshAttemptedIdsRef.current.add(record.id);
        void refreshRef.current?.(record.id);
      });
  }, [loading, records, showFullEmail]);

  useEffect(() => {
    if (loading) return undefined;
    let cancelled = false;
    const run = async () => {
      if (cancelled || autoCodexRefreshBusyRef.current || document.visibilityState === "hidden") return;
      const ids = recordsRef.current
        .filter((record) => {
          if (record.provider_id !== "codex" || record.detection_method !== "official_account") return false;
          const session = resolveConsoleSessionForRecord(record, consoleSessionsRef.current);
          return session?.status === "connected"
            && !codexDisconnectBlocksRefresh(session.session_ref);
        })
        .map((record) => record.id)
        .filter(Boolean);
      if (ids.length === 0) return;
      autoCodexRefreshBusyRef.current = true;
      try {
        for (const id of ids) {
          if (cancelled) break;
          await refreshRef.current?.(id);
        }
      } finally {
        autoCodexRefreshBusyRef.current = false;
      }
    };
    const onFocus = () => void run();
    const timer = window.setInterval(run, 60_000);
    window.addEventListener("focus", onFocus);
    void run();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [loading]);

  useEffect(() => {
    if (!planRefreshTargetId) return;
    const id = planRefreshTargetId;
    let cancelled = false;
    (async () => {
      setPlanRefreshTargetId("");
      if (form.detection_method !== "official_account" || form.id !== id) return;
      try {
        await save({ keepOpen: true });
        if (!cancelled) await refresh(id);
      } catch {
        // save/refresh errors are surfaced via setError in those handlers
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planRefreshTargetId, form.detection_method, form.id]);

  const handleOfficialAccountSync = async () => {
    setConsoleSessionError("");
    setError("");
    if (!form.source.trim()) {
      setConsoleSessionError(copy("settings.token_plan.console_session.source_required"));
      return;
    }
    if (form.provider_id === "glm") {
      if (glmSession?.status === "connected" && (apiKeyInput.trim() || form.detection_config?.official_account?.api_key_ref)) {
        await save({ keepOpen: true });
        if (form.id) {
          await refresh(form.id);
        }
        return;
      }
      await handleConnectGlm();
      return;
    }
    if (form.provider_id === "xiaomi_mimo") {
      await handleConnectXiaomiMimo();
      return;
    }
    if (form.provider_id === "codex") {
      if (formCodexSession?.status === "connected" && form.id) {
        const saved = await save({ keepOpen: true });
        if (!saved?.savedId) return;
        const refreshResult = await refresh(form.id);
        if (refreshResult?.codexReauthRequired) {
          await handleConnectCodex({ record: form });
        }
        return;
      }
      await handleConnectCodex();
      return;
    }
    if (form.provider_id === "claude" && !claudeRoutingMode) {
      if (formClaudeSession?.status === "connected" && form.id) {
        await save({ keepOpen: true });
        await refresh(form.id);
        return;
      }
      await handleConnectClaude();
      return;
    }
    if (form.provider_id === "cursor") {
      if (formCursorSession?.status === "connected" && form.id) {
        await save({ keepOpen: true });
        await refresh(form.id);
        return;
      }
      await handleConnectCursor();
      return;
    }
    if (form.provider_id === "trae") {
      if (formTraeSession?.status === "connected" && form.id) {
        await save({ keepOpen: true });
        await refresh(form.id);
        return;
      }
      await handleConnectTrae();
      return;
    }
    if (form.provider_id === "kimi" && form.plan_id !== "kimi_api_budget") {
      if (formKimiSession?.status === "connected" && form.id) {
        await save({ keepOpen: true });
        await refresh(form.id);
        return;
      }
      await handleConnectKimi();
      return;
    }
    if (providerNeedsApiKeyForOfficialSync(form.provider_id, form.plan_id)) {
      const hasKey = Boolean(
        apiKeyInput.trim() || form.detection_config?.official_account?.api_key_ref,
      );
      if (!hasKey) {
        setConsoleSessionError(copy("settings.token_plan.official_sync.api_key_required"));
        return;
      }
    }
    setForm((current) => applyOfficialAccountDefaults(current, current.provider_id, current.plan_id));
    if (form.id) {
      await save({ keepOpen: true });
      await refresh(form.id);
      return;
    }
    await save();
  };

  const editRecord = (record) => {
    const isLegacy = !record.provider_id;
    // W03E-R3E: Normalize legacy refresh_method=cookie_scrape to "manual" at
    // the record→form boundary. cookie_scrape is no longer a user-selectable
    // path; the backend keeps its legacy read/reject branch, but editing an
    // old record must never re-save cookie_scrape or show an invalid select
    // value. This is the single normalization point — render branches do not
    // need to repeat this check.
    const rawRefreshMethod = record.refresh_method || "manual";
    const normalizedRefreshMethod = LEGACY_REFRESH_METHODS.has(rawRefreshMethod)
      ? rawRefreshMethod
      : "manual";
    // W03-R3B: preserve detection fields from existing records
    const detectionConfig = record.detection_config
      ? {
          official_account: {
            provider_home_url: record.detection_config?.official_account?.provider_home_url || "",
            account_binding_id: record.detection_config?.official_account?.account_binding_id || "",
            claude_account_mode: record.detection_config?.official_account?.claude_account_mode || "",
            api_key_ref: record.detection_config?.official_account?.api_key_ref || "",
          },
          custom_api: {
            api_key_ref: record.detection_config?.custom_api?.api_key_ref || "",
            api_format: record.detection_config?.custom_api?.api_format || "",
            request_url: record.detection_config?.custom_api?.request_url || "",
            official_url: record.detection_config?.custom_api?.official_url || "",
            method: record.detection_config?.custom_api?.method || "GET",
            response_mapping: {
              total_quota_path: record.detection_config?.custom_api?.response_mapping?.total_quota_path || "",
              used_quota_path: record.detection_config?.custom_api?.response_mapping?.used_quota_path || "",
              remaining_quota_path: record.detection_config?.custom_api?.response_mapping?.remaining_quota_path || "",
              expires_at_path: record.detection_config?.custom_api?.response_mapping?.expires_at_path || "",
            },
          },
        }
      : { ...EMPTY_FORM.detection_config };
    setForm(() => {
      const base = applyOfficialAccountDefaults({
        ...EMPTY_FORM,
        ...record,
        provider_id: isLegacy ? "custom" : record.provider_id,
        plan_id: isLegacy ? "custom" : record.plan_id,
        quota_source: isLegacy ? "manual" : (record.quota_source || "manual"),
        refresh_method: normalizedRefreshMethod,
        detection_method: record.detection_method || "",
        detection_config: detectionConfig,
      }, isLegacy ? "custom" : record.provider_id, isLegacy ? "custom" : record.plan_id);
      if (record.detection_method && record.detection_method !== "official_account") {
        return {
          ...EMPTY_FORM,
          ...record,
          provider_id: isLegacy ? "custom" : record.provider_id,
          plan_id: isLegacy ? "custom" : record.plan_id,
          quota_source: isLegacy ? "manual" : (record.quota_source || "manual"),
          refresh_method: normalizedRefreshMethod,
          detection_method: record.detection_method,
          detection_config: detectionConfig,
        };
      }
      return mergeCatalogQuotaIntoForm(
        base,
        catalog,
        isLegacy ? "custom" : record.provider_id,
        isLegacy ? "custom" : record.plan_id,
      );
    });
    // W03-R3D: Never pre-fill the API Key field — it must be re-entered.
    // The api_key_ref is preserved in detection_config for existing records.
    setApiKeyInput("");
    setFormOpen(true);
    setSavedNotice(false);
    setError("");
  };

  const openRecordEditor = (record) => {
    if (listOnly) {
      onNavigate(`/settings/cost/token-plans/${encodeURIComponent(record.id)}/edit`);
      return;
    }
    editRecord(record);
  };

  useEffect(() => {
    if (!editorPlanId || loading || editorInitialized) return;
    if (editorPlanId === "new") {
      setForm(EMPTY_FORM);
      setApiKeyInput("");
      setFormOpen(true);
      setEditorInitialized(true);
      return;
    }
    const record = records.find((item) => item.id === editorPlanId);
    if (!record) {
      setEditorMissing(true);
      setEditorInitialized(true);
      return;
    }
    editRecord(record);
    setEditorInitialized(true);
  }, [editorInitialized, editorPlanId, loading, records]);

  const handlePlanDragEnd = async ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const previous = records;
    const movableRecords = previous.filter(isUsableTokenPlan);
    const oldIndex = movableRecords.findIndex((record) => record.id === active.id);
    const newIndex = movableRecords.findIndex((record) => record.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const optimistic = mergeUsableTokenPlanOrder(
      previous,
      arrayMove(movableRecords, oldIndex, newIndex),
    )
      .map((record, index) => ({ ...record, display_order: index }));
    setRecords(optimistic);
    setError("");
    try {
      const result = await reorderTokenPlans(optimistic.map((record) => record.id));
      setRecords(normalizeRecords(result?.records));
    } catch (err) {
      setRecords(previous);
      setError(err?.message || copy("settings.token_plan.reorder_error"));
    }
  };

  const handlePlanKeyboardMove = async (id, direction) => {
    const movableRecords = records.filter(isUsableTokenPlan);
    const oldIndex = movableRecords.findIndex((record) => record.id === id);
    const newIndex = Math.max(0, Math.min(movableRecords.length - 1, oldIndex + direction));
    if (oldIndex === -1 || oldIndex === newIndex) return;
    const previous = records;
    const reorderedActive = arrayMove(movableRecords, oldIndex, newIndex);
    const optimistic = mergeUsableTokenPlanOrder(previous, reorderedActive)
      .map((record, index) => ({ ...record, display_order: index }));
    setRecords(optimistic);
    setError("");
    try {
      const result = await reorderTokenPlans(optimistic.map((record) => record.id));
      setRecords(normalizeRecords(result?.records));
    } catch (err) {
      setRecords(previous);
      setError(err?.message || copy("settings.token_plan.reorder_error"));
    }
  };

  const removeRecord = async (record) => {
    const planLabel = record?.plan_label || record?.id || "";
    // eslint-disable-next-line no-alert
    if (!window.confirm(copy("settings.token_plan.confirm_delete", { plan: planLabel }))) return;
    setDeletingId(record.id);
    setError("");
    try {
      const result = await deleteTokenPlan(record.id);
      setRecords(normalizeRecords(result?.records));
    } catch (err) {
      setError(err?.message || copy("settings.token_plan.delete_error"));
    } finally {
      setDeletingId("");
    }
  };

  const canSave = formOpen && !loading && !saving && form.source.trim() && form.plan_label.trim();

  const showEmptyCatalog = formOpen &&
    form.provider_id !== "custom" &&
    form.provider_id &&
    currentProvider &&
    currentProvider.plans.length === 0;

  const displayTotalQuota = useMemo(() => {
    if (isCatalogPlan) {
      return selectedPlan.total_quota_display || formatQuota(selectedPlan.total_quota);
    }
    if (form.quota_kind === "unknown") {
      return copy("settings.token_plan.unknown_quota");
    }
    return formatQuota(form.total_quota);
  }, [isCatalogPlan, selectedPlan, form.quota_kind, form.total_quota]);

  const activeRecords = records.filter(isUsableTokenPlan);
  const scheduledRecords = records.filter(isScheduledTokenPlanRecord);
  const expiredRecords = records.filter(isExpiredTokenPlanRecord);
  const hasScheduledRecords = Boolean(scheduledRecords.length);
  const hasExpiredRecords = Boolean(expiredRecords.length);
  const activePagination = paginateTokenPlans(activeRecords, activePage);
  const scheduledPagination = paginateTokenPlans(scheduledRecords, scheduledPage);
  const expiredPagination = paginateTokenPlans(expiredRecords, expiredPage);
  const attentionCount = countAttentionTokenPlans(activeRecords);
  const activeCostCny = activeRecords.reduce((total, record) => (
    String(record.subscription_currency || "CNY").toUpperCase() === "CNY"
      ? total + Number(record.subscription_amount || 0)
      : total
  ), 0);
  useEffect(() => {
    onSummaryChange?.({ activeCount: activeRecords.length, attentionCount, costCny: activeCostCny });
  }, [activeCostCny, activeRecords.length, attentionCount, onSummaryChange]);
  return (
    <SectionCard
      title={copy("settings.section.token_plan")}
      subtitle={copy("settings.token_plan.subtitle")}
      icon={Package}
      iconTone="violet"
      collapsible={!editorPlanId}
      defaultOpen={false}
      storageKey={!editorPlanId ? "cost.token-plans" : null}
      collapsedSummaryContent={(
        <span className="tt-token-plan-summary-labels">
          <span
            className="tt-collapsed-summary"
            data-testid="settings-section-collapsed-summary"
            data-tone="violet"
            data-summary={copy("settings.token_plan.collapsed_summary", { count: records.length })}
          >
            {copy("settings.token_plan.collapsed_summary", { count: records.length })}
          </span>
          <span className="tt-token-plan-count tt-token-plan-count--active">
            {copy("settings.token_plan.count_active", { count: activeRecords.length })}
          </span>
          <span className="tt-token-plan-count tt-token-plan-count--watch">
            {copy("settings.token_plan.count_watch", { count: attentionCount })}
          </span>
        </span>
      )}
      collapsedSummaryTone="violet"
      action={!editorPlanId ? (
        <div className="tt-token-plan-actions flex items-center gap-2">
          <button
            type="button"
            data-testid="token-plan-email-visibility"
            aria-label={copy(showFullEmail
              ? "settings.token_plan.email.hide"
              : "settings.token_plan.email.show_full")}
            title={copy(showFullEmail
              ? "settings.token_plan.email.hide"
              : "settings.token_plan.email.show_full")}
            onClick={() => {
              const next = !showFullEmail;
              setShowFullEmail(next);
              try {
                window.localStorage.setItem(TOKEN_PLAN_FULL_EMAIL_KEY, next ? "1" : "0");
              } catch {
                // The preference remains active for this session when storage is unavailable.
              }
            }}
            className="tt-cost-header-action"
          >
            {showFullEmail ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
            {copy(showFullEmail
              ? "settings.token_plan.email.hide"
              : "settings.token_plan.email.show_full")}
          </button>
          <button type="button" onClick={() => activeRecords.forEach((record) => refresh(record.id))} disabled={loading || Boolean(refreshingId)} className="tt-cost-header-action">
            <RefreshCw className={cn("h-3.5 w-3.5", refreshingId && "animate-spin")} aria-hidden />
            {copy("settings.token_plan.batch_refresh")}
          </button>
          <button
            type="button"
            onClick={openNewForm}
            disabled={loading || saving}
            className="tt-cost-header-action tt-cost-header-action-primary"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {copy("settings.token_plan.add")}
          </button>
        </div>
      ) : null}
    >
      {!editorPlanId && <div className="border-b border-oai-gray-200 pb-3 dark:border-oai-gray-800">
        {records.length === 0 ? (
          <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
            {copy("settings.token_plan.empty")}
          </div>
        ) : (
          <>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handlePlanDragEnd}>
            <SortableContext items={activePagination.records.map((record) => record.id)} strategy={rectSortingStrategy}>
              <div
                data-testid="active-token-plan-grid"
                className="tt-token-plan-grid"
                style={{ "--tt-token-plan-columns": 5 }}
              >
                {activePagination.records.map((record) => (
                  <SortableTokenPlanCard
                    key={record.id}
                    record={record}
                    onEdit={openRecordEditor}
                    onRefresh={refresh}
                    onDelete={removeRecord}
                    onKeyboardMove={handlePlanKeyboardMove}
                    refreshing={refreshingId === record.id}
                    saving={saving || deletingId === record.id}
                    usageLimits={usageLimits}
                    loadingUsageLimits={loadingUsageLimits}
                    showFullEmail={showFullEmail}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          <TokenPlanPagination pagination={activePagination} onPageChange={setActivePage} testId="active-token-plan-pagination" />
          {hasScheduledRecords && (
            <section data-testid="scheduled-token-plans" className="mt-3 rounded-md border border-oai-gray-200 dark:border-oai-gray-800">
              <button
                type="button"
                onClick={() => setScheduledPlansOpen((open) => !open)}
                aria-expanded={scheduledPlansOpen}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
              >
                <strong className="text-sm font-medium text-oai-gray-700 dark:text-oai-gray-300">
                  {copy("settings.token_plan.scheduled_group", { count: scheduledRecords.length })}
                </strong>
                {scheduledPlansOpen ? <ChevronUp className="h-4 w-4 text-oai-gray-400" /> : <ChevronDown className="h-4 w-4 text-oai-gray-400" />}
              </button>
              {scheduledPlansOpen ? (
                <div className="border-t border-oai-gray-100 p-2 dark:border-oai-gray-800">
                  <div className="tt-token-plan-grid tt-token-plan-grid--expired">
                    {scheduledPagination.records.map((record) => <ScheduledTokenPlanRow key={record.id} record={record} onEdit={openRecordEditor} />)}
                  </div>
                  <TokenPlanPagination pagination={scheduledPagination} onPageChange={setScheduledPage} testId="scheduled-token-plan-pagination" />
                </div>
              ) : null}
            </section>
          )}
          {hasExpiredRecords && (
            <section data-testid="expired-token-plans" className="mt-3 rounded-md border border-oai-gray-200 dark:border-oai-gray-800">
              <button
                type="button"
                onClick={() => setExpiredPlansOpen((open) => !open)}
                aria-expanded={expiredPlansOpen}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
              >
                <strong className="text-sm font-medium text-oai-gray-700 dark:text-oai-gray-300">
                  {copy("settings.token_plan.expired_group", { count: expiredRecords.length })}
                </strong>
                {expiredPlansOpen ? <ChevronUp className="h-4 w-4 text-oai-gray-400" /> : <ChevronDown className="h-4 w-4 text-oai-gray-400" />}
              </button>
              {expiredPlansOpen ? (
                <div className="border-t border-oai-gray-100 p-2 dark:border-oai-gray-800">
                  <div className="tt-token-plan-grid tt-token-plan-grid--expired">
                    {expiredPagination.records.map((record) => <ExpiredTokenPlanRow key={record.id} record={record} onEdit={openRecordEditor} />)}
                  </div>
                  <TokenPlanPagination pagination={expiredPagination} onPageChange={setExpiredPage} testId="expired-token-plan-pagination" />
                </div>
              ) : null}
            </section>
          )}
          </>
        )}
      </div>}

      {editorMissing && (
        <div className="rounded-md border border-oai-gray-200 px-4 py-6 text-center dark:border-oai-gray-800">
          <p className="text-sm text-oai-gray-600 dark:text-oai-gray-300">
            {copy("settings.token_plan.editor_missing")}
          </p>
          <button
            type="button"
            onClick={() => onNavigate("/settings/cost")}
            className="mt-3 text-sm font-medium text-oai-brand hover:underline"
          >
            {copy("settings.token_plan.back_to_cost")}
          </button>
        </div>
      )}

      {formOpen && (
        <div className="mt-3 rounded-md border border-oai-gray-200 px-3 py-3 dark:border-oai-gray-800">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-oai-gray-900 dark:text-oai-gray-100">
              {form.id ? copy("settings.token_plan.form_title_edit") : copy("settings.token_plan.form_title_new")}
            </div>
            <button
              type="button"
              onClick={closeForm}
              disabled={saving}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-oai-gray-500 hover:bg-oai-gray-100 hover:text-oai-gray-900 disabled:opacity-50 dark:text-oai-gray-400 dark:hover:bg-oai-gray-800 dark:hover:text-oai-gray-100"
              aria-label={copy("settings.token_plan.cancel")}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <CardSelectInput
              label={copy("settings.token_plan.agent_source")}
              value={form.source}
              onChange={updateField("source")}
              disabled={loading || saving}
              options={[{ value: "", label: "" }, ...agentOptions]}
              testIdPrefix="token-plan-agent-card-select"
            />
            <CardSelectInput
              label={copy("settings.token_plan.provider")}
              value={form.provider_id}
              onChange={updateField("provider_id")}
              disabled={loading || saving || loadingCatalog}
              options={[{ value: "", label: "" }, ...catalog.map((p) => ({ value: p.id, label: p.name }))]}
              testIdPrefix="token-plan-provider-card-select"
            />
            <CardSelectInput
              label={copy("settings.token_plan.plan")}
              value={form.plan_id}
              onChange={updateField("plan_id")}
              disabled={loading || saving || !form.provider_id}
              options={[{ value: "", label: "" }, ...planOptions]}
              testIdPrefix="token-plan-plan-card-select"
            />
            {isManual && (
              <TextInput
                label={copy("settings.token_plan.plan_label")}
                value={form.plan_label}
                onChange={updateField("plan_label")}
                disabled={loading || saving}
              />
            )}
            {isCatalogPlan ? (
              <TextInput
                label={copy("settings.token_plan.total_quota")}
                value={displayTotalQuota}
                onChange={() => {}}
                disabled
                hint={selectedPlan?.total_quota_display || undefined}
              />
            ) : (
              <NumberInput
                label={copy("settings.token_plan.total_quota")}
                value={form.total_quota}
                onChange={updateField("total_quota")}
                disabled={loading || saving}
              />
            )}
            <NumberInput
              label={copy("settings.token_plan.used_quota")}
              value={form.used_quota}
              onChange={updateField("used_quota")}
              disabled={loading || saving || hasDetectionConfigured}
              hint={hasDetectionConfigured ? copy("settings.token_plan.quota_from_detection") : undefined}
            />
            <NumberInput
              label={copy("settings.token_plan.remaining_quota")}
              value={form.remaining_quota}
              onChange={updateField("remaining_quota")}
              disabled={loading || saving || hasDetectionConfigured}
              hint={hasDetectionConfigured ? copy("settings.token_plan.quota_from_detection") : undefined}
            />
            <TextInput
              label={copy("settings.token_plan.expires_at")}
              value={form.expires_at}
              onChange={updateField("expires_at")}
              disabled={loading || saving || hasDetectionConfigured}
              placeholder={hasDetectionConfigured ? "" : "2026-12-31"}
              hint={hasDetectionConfigured ? copy("settings.token_plan.quota_from_detection") : undefined}
            />
            <NumberInput
              label={copy("settings.token_plan.subscription_cost")}
              value={form.subscription_amount}
              onChange={updateField("subscription_amount")}
              disabled={loading || saving}
            />
            <SelectInput
              label={copy("settings.token_plan.subscription_currency")}
              value={form.subscription_currency}
              onChange={updateField("subscription_currency")}
              disabled={loading || saving}
              options={[{ value: "CNY", label: "CNY" }, { value: "USD", label: "USD" }]}
            />
            <SelectInput
              label={copy("settings.token_plan.subscription_cycle_label")}
              value={form.subscription_cycle}
              onChange={updateField("subscription_cycle")}
              disabled={loading || saving}
              options={["monthly", "yearly", "one_time"].map((value) => ({
                value,
                label: copy(`settings.token_plan.subscription_cycle.${value}`),
              }))}
            />
            <TextInput
              label={copy("settings.token_plan.subscription_start")}
              value={form.subscription_start_date}
              onChange={updateField("subscription_start_date")}
              disabled={loading || saving}
              placeholder="2026-07-22"
            />
            <TextInput
              label={copy("settings.token_plan.subscription_end")}
              value={form.subscription_end_date}
              onChange={updateField("subscription_end_date")}
              disabled={loading || saving}
              placeholder="2026-08-22"
            />
            <TextInput
              label={copy("settings.token_plan.notes")}
              value={form.notes}
              onChange={updateField("notes")}
              disabled={loading || saving}
              placeholder={copy("settings.token_plan.notes_placeholder")}
              maxLength={200}
              inputTestId="token-plan-form-notes"
            />
            {showRefreshControls && (
              <SelectInput
                label={copy("settings.token_plan.refresh_method")}
                value={form.refresh_method}
                onChange={updateField("refresh_method")}
                disabled={loading || saving}
                options={REFRESH_METHOD_OPTIONS.map((m) => ({ value: m, label: copy(`settings.token_plan.refresh_method.${m}`) }))}
              />
            )}
            {showRefreshControls && (
              <SelectInput
                label={copy("settings.token_plan.refresh_interval")}
                value={String(form.refresh_interval_minutes)}
                onChange={updateField("refresh_interval_minutes")}
                disabled={loading || saving}
                options={REFRESH_INTERVAL_OPTIONS.map((n) => ({ value: String(n), label: `${n} min` }))}
              />
            )}
            {showRefreshControls && (
              <TextInput
                label={copy("settings.token_plan.credential_ref")}
                value={form.credential_ref}
                onChange={updateField("credential_ref")}
                disabled={loading || saving}
                placeholder="codex_auth_json"
              />
            )}
            {showRefreshControls && (
              <label className="flex items-center gap-2 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={Boolean(form.refresh_enabled)}
                  onChange={updateCheckbox("refresh_enabled")}
                  disabled={loading || saving}
                  className="h-4 w-4 rounded border-oai-gray-300 text-oai-brand-600 focus:ring-oai-brand-500"
                />
                <span className="text-xs text-oai-gray-700 dark:text-oai-gray-300">
                  {copy("settings.token_plan.refresh_enabled")}
                </span>
              </label>
            )}
            {supportsOfficialAccountDetection && (
              <div className="sm:col-span-2 text-xs text-oai-gray-500 dark:text-oai-gray-400">
                {copy("settings.token_plan.official_detection_notice")}
              </div>
            )}
            {isStaticCatalogPlan && (
              <div
                className="sm:col-span-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
                data-testid="token-plan-static-catalog-notice"
              >
                <div className="mb-1 font-medium">
                  {copy("settings.token_plan.static_catalog_notice.title")}
                </div>
                <div>
                  {copy("settings.token_plan.static_catalog_notice.body")}
                </div>
              </div>
            )}
          </div>

          {/* W03-R3B: Detection method section — catalog plans with official API */}
          {form.provider_id === "claude" && isCatalogPlan && form.plan_id !== "claude_routing" && (
            <div className="mt-4 border-t border-oai-gray-200 pt-3 dark:border-oai-gray-800">
              <SelectInput
                label={copy("settings.token_plan.claude.account_mode")}
                value={form.detection_config?.official_account?.claude_account_mode || "official"}
                onChange={updateClaudeAccountMode}
                disabled={loading || saving}
                options={[
                  { value: "official", label: copy("settings.token_plan.claude.account_mode.official") },
                  { value: "routing", label: copy("settings.token_plan.claude.account_mode.routing") },
                ]}
                data-testid="claude-account-mode-select"
              />
              {claudeRoutingMode && (
                <div
                  className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
                  data-testid="claude-routing-notice"
                >
                  {copy("settings.token_plan.claude.routing_notice")}
                </div>
              )}
            </div>
          )}
          {supportsOfficialAccountDetection && (
            <div className="mt-4 border-t border-oai-gray-200 pt-3 dark:border-oai-gray-800">
              <div className="mb-2 text-sm font-medium text-oai-gray-900 dark:text-oai-gray-100">
                {copy("settings.token_plan.detection_method.label")}
              </div>
              <div className="grid gap-3 sm:grid-cols-1">
                <SelectInput
                  label={copy("settings.token_plan.detection_method.select")}
                  value={form.detection_method}
                  onChange={updateDetectionMethod}
                  disabled={loading || saving}
                  options={[
                    { value: "", label: copy("settings.token_plan.detection_method.none") },
                    { value: "official_account", label: copy("settings.token_plan.detection_method.official_account") },
                    { value: "custom_api", label: copy("settings.token_plan.detection_method.custom_api") },
                  ]}
                />
              </div>

              {/* Official account detection: console session connect inside the form */}
              {form.detection_method === "official_account" && (
                <div className="mt-3 rounded-md border border-oai-gray-200 px-3 py-2 dark:border-oai-gray-800">
                  <div className="mb-2 text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
                    {copy("settings.token_plan.detection.official_account.title")}
                  </div>
                  {form.provider_id === "glm" ? (
                    <div className="space-y-3">
                      <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
                        {copy("settings.token_plan.glm.setup_desc")}
                      </div>
                      <div className="text-xs text-oai-gray-400 dark:text-oai-gray-500">
                        {copy("settings.token_plan.detection.official_account.url_label")}:{" "}
                        <ProviderHomeLink
                          linkId={resolveProviderHomeLinkId("glm")}
                          testId="detection-glm-provider-link"
                        />
                      </div>
                      <label className="block text-xs text-oai-gray-600 dark:text-oai-gray-300">
                        {copy("settings.token_plan.glm.api_key")}
                        <input
                          type="password"
                          autoComplete="off"
                          value={apiKeyInput}
                          onChange={(event) => setApiKeyInput(event.target.value)}
                          placeholder={copy("settings.token_plan.glm.api_key_placeholder")}
                          className="mt-1 w-full rounded-md border border-oai-gray-200 bg-white px-2 py-1.5 text-xs dark:border-oai-gray-800 dark:bg-oai-gray-950"
                        />
                      </label>
                      {consoleSessionError && (
                        <div className="text-xs text-red-500 dark:text-red-400">
                          {consoleSessionError}
                        </div>
                      )}
                      {loadingConsoleSessions ? (
                        <div className="text-xs text-oai-gray-500">
                          {copy("settings.token_plan.console_session.loading")}
                        </div>
                      ) : glmStage === "disconnected" ? (
                        <button
                          type="button"
                          onClick={handleConnectGlm}
                          disabled={connectingConsole}
                          data-testid="detection-connect-glm"
                          className={cn(
                            "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
                            "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
                            "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
                          )}
                        >
                          <Link2 className="h-3.5 w-3.5" aria-hidden />
                          {connectingConsole
                            ? copy("settings.token_plan.console_session.connecting")
                            : copy("settings.token_plan.glm.connect_account")}
                        </button>
                      ) : glmStage === "login_started" ? (
                        <div className="space-y-2" data-testid="detection-glm-login-started">
                          <div className="flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 text-amber-500" aria-hidden />
                            <div className="text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
                              {copy("settings.token_plan.console_session.status_login_started")}
                            </div>
                          </div>
                          <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
                            {copy("settings.token_plan.console_session.login_started_desc")}
                          </div>
                        </div>
                      ) : glmStage === "awaiting_verification" ? (
                        <div className="space-y-2" data-testid="detection-glm-awaiting">
                          <div className="flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 text-amber-500" aria-hidden />
                            <div>
                              <div className="text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
                                {copy("settings.token_plan.console_session.safe_account_label")}
                              </div>
                              <div className="text-xs text-amber-600 dark:text-amber-300">
                                {copy("settings.token_plan.console_session.status_awaiting_verification")}
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={handleConnectGlm}
                            disabled={connectingConsole}
                            data-testid="detection-glm-resume"
                            className={cn(
                              "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
                              "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
                              "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
                            )}
                          >
                            <Link2 className="h-3.5 w-3.5" aria-hidden />
                            {copy("settings.token_plan.console_session.retry")}
                          </button>
                        </div>
                      ) : glmStage === "failed" || glmStage === "desktop_not_verified" ? (
                        <div className="space-y-2" data-testid="detection-glm-failed">
                          <div className="flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 text-red-500" aria-hidden />
                            <div>
                              <div className="text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
                                {copy("settings.token_plan.console_session.safe_account_label")}
                              </div>
                              <div className="text-xs text-red-500 dark:text-red-400">
                                {glmStatusLabel}
                              </div>
                              {glmSession?.last_error_message && (
                                <div className="text-xs text-red-500 dark:text-red-400">
                                  {glmSession.last_error_message}
                                </div>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={handleConnectGlm}
                            disabled={connectingConsole}
                            data-testid="detection-glm-retry"
                            className={cn(
                              "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
                              "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
                              "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
                            )}
                          >
                            <Link2 className="h-3.5 w-3.5" aria-hidden />
                            {copy("settings.token_plan.console_session.retry")}
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2" data-testid="detection-glm-connected">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-green-500" aria-hidden />
                            <div>
                              <div className="text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
                                {copy("settings.token_plan.console_session.safe_account_label")}
                              </div>
                              <div className="text-xs text-green-600 dark:text-green-300">
                                {glmStatusLabel}
                              </div>
                              {glmSession?.last_verified_at && (
                                <div className="text-xs text-oai-gray-400 dark:text-oai-gray-500">
                                  {copy("settings.token_plan.console_session.last_verified")}:{" "}
                                  {new Date(glmSession.last_verified_at).toLocaleString()}
                                </div>
                              )}
                            </div>
                          </div>
                          {glmSession?.balance && (
                            <div className="text-xs text-oai-gray-600 dark:text-oai-gray-300">
                              {copy("settings.token_plan.glm.balance")}:{" "}
                              {glmSession.balance.available_balance.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}{" "}
                              {glmSession.balance.currency}
                            </div>
                          )}
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={handleOfficialAccountSync}
                              disabled={connectingConsole || refreshingId === form.id || saving}
                              data-testid="detection-glm-sync"
                              className={cn(
                                "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
                                "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
                                "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
                              )}
                            >
                              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                              {(connectingConsole || refreshingId === form.id)
                                ? copy("settings.token_plan.official_sync.syncing")
                                : copy("settings.token_plan.official_sync.connect")}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteGlmConsoleSession(glmSession.id, glmSession.session_ref)}
                              className="text-xs text-red-600 dark:text-red-400"
                            >
                              {copy("settings.token_plan.console_session.disconnect")}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : form.provider_id === "kimi" ? (
                    form.plan_id === "kimi_api_budget" ? (
                      <div className="space-y-3">
                        <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
                          {copy("settings.token_plan.kimi.api_budget_desc")}
                        </div>
                        <div className="text-xs text-oai-gray-400 dark:text-oai-gray-500">
                          {copy("settings.token_plan.detection.official_account.url_label")}: {" "}
                          <ProviderHomeLink
                            linkId={resolveProviderHomeLinkId("kimi", form.plan_id)}
                            testId="detection-kimi-api-provider-link"
                          />
                        </div>
                        <label className="block text-xs text-oai-gray-600 dark:text-oai-gray-300">
                          {copy("settings.token_plan.kimi.api_key")}
                          <input
                            type="password"
                            autoComplete="off"
                            value={apiKeyInput}
                            onChange={(event) => setApiKeyInput(event.target.value)}
                            placeholder={copy("settings.token_plan.kimi.api_key_placeholder")}
                            className="mt-1 w-full rounded-md border border-oai-gray-200 bg-white px-2 py-1.5 text-xs dark:border-oai-gray-800 dark:bg-oai-gray-950"
                          />
                        </label>
                        {consoleSessionError && (
                          <div className="text-xs text-red-500 dark:text-red-400">{consoleSessionError}</div>
                        )}
                        {providerSupportsAuthorizationOperation("kimi", "sync") ? (
                          <button
                            type="button"
                            onClick={handleOfficialAccountSync}
                            disabled={refreshingId === form.id || saving}
                            data-testid="detection-sync-kimi"
                            className={cn(
                              "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
                              "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
                              "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
                            )}
                          >
                            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                            {refreshingId === form.id
                              ? copy("settings.token_plan.official_sync.syncing")
                              : copy("settings.token_plan.official_sync.connect")}
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <WebviewConsoleConnectPanel
                        descCopyKey="settings.token_plan.kimi.code_quota_desc"
                        connectCopyKey="settings.token_plan.kimi.connect_account"
                        loginStartedDescCopyKey="settings.token_plan.kimi.login_started_desc"
                        providerHomeLinkId={resolveProviderHomeLinkId("kimi", form.plan_id)}
                        stage={kimiStage}
                        session={formKimiSession}
                        statusLabel={kimiStatusLabel}
                        loadingConsoleSessions={loadingConsoleSessions}
                        connectingConsole={connectingConsole}
                        consoleSessionError={consoleSessionError}
                        onConnect={handleConnectKimi}
                        onSync={handleOfficialAccountSync}
                        onDelete={handleDeleteKimiConsoleSession}
                        onAddAccount={handleAddDetectedAccount}
                        testIdPrefix="kimi"
                        syncing={refreshingId === form.id || connectingConsole}
                        syncDisabled={refreshingId === form.id || saving || connectingConsole}
                        operations={providerAuthorizationState("kimi").operations}
                      />
                    )
                  ) : form.provider_id === "minimax" ? (
                    <div className="space-y-3">
                      <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
                        {copy("settings.token_plan.minimax.token_plan_desc")}
                      </div>
                      <div className="text-xs text-oai-gray-400 dark:text-oai-gray-500">
                        {copy("settings.token_plan.detection.official_account.url_label")}: {" "}
                        <ProviderHomeLink
                          linkId={resolveProviderHomeLinkId("minimax")}
                          testId="detection-minimax-provider-link"
                        />
                      </div>
                      {form.plan_id === "minimax_manual_quota" && (
                        <label className="block text-xs text-oai-gray-600 dark:text-oai-gray-300">
                          {copy("settings.token_plan.minimax.api_key")}
                          <input
                            type="password"
                            autoComplete="off"
                            value={apiKeyInput}
                            onChange={(event) => setApiKeyInput(event.target.value)}
                            placeholder={copy("settings.token_plan.minimax.api_key_placeholder")}
                            className="mt-1 w-full rounded-md border border-oai-gray-200 bg-white px-2 py-1.5 text-xs dark:border-oai-gray-800 dark:bg-oai-gray-950"
                          />
                        </label>
                      )}
                      {consoleSessionError && (
                        <div className="text-xs text-red-500 dark:text-red-400">{consoleSessionError}</div>
                      )}
                      {providerSupportsAuthorizationOperation("minimax", "sync") ? (
                        <button
                          type="button"
                          onClick={handleOfficialAccountSync}
                          disabled={refreshingId === form.id || saving}
                          data-testid="detection-sync-minimax"
                          className={cn(
                            "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
                            "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
                            "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
                          )}
                        >
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                          {refreshingId === form.id
                            ? copy("settings.token_plan.official_sync.syncing")
                            : copy("settings.token_plan.official_sync.connect")}
                        </button>
                      ) : null}
                    </div>
                  ) : form.provider_id === "aliyun_bailian" ? (
                    <div className="space-y-3">
                      <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
                        {copy("settings.token_plan.aliyun_bailian.coding_plan_desc")}
                      </div>
                      <div className="text-xs text-oai-gray-400 dark:text-oai-gray-500">
                        {copy("settings.token_plan.detection.official_account.url_label")}: {" "}
                        <ProviderHomeLink
                          linkId={resolveProviderHomeLinkId("aliyun_bailian", form.plan_id)}
                          testId="detection-aliyun-provider-link"
                        />
                      </div>
                      {form.plan_id === "aliyun_bailian_manual_quota" && (
                        <label className="block text-xs text-oai-gray-600 dark:text-oai-gray-300">
                          {copy("settings.token_plan.aliyun_bailian.api_key")}
                          <input
                            type="password"
                            autoComplete="off"
                            value={apiKeyInput}
                            onChange={(event) => setApiKeyInput(event.target.value)}
                            placeholder={copy("settings.token_plan.aliyun_bailian.api_key_placeholder")}
                            className="mt-1 w-full rounded-md border border-oai-gray-200 bg-white px-2 py-1.5 text-xs dark:border-oai-gray-800 dark:bg-oai-gray-950"
                          />
                        </label>
                      )}
                      {consoleSessionError && (
                        <div className="text-xs text-red-500 dark:text-red-400">{consoleSessionError}</div>
                      )}
                      <button
                        type="button"
                        onClick={handleOfficialAccountSync}
                        disabled={refreshingId === form.id || saving}
                        data-testid="detection-sync-aliyun"
                        className={cn(
                          "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
                          "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
                          "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
                        )}
                      >
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                        {refreshingId === form.id
                          ? copy("settings.token_plan.official_sync.syncing")
                          : copy("settings.token_plan.official_sync.connect")}
                      </button>
                    </div>
                  ) : form.provider_id === "codex" ? (
                    <div className="space-y-3">
                      <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
                        {copy("settings.token_plan.codex.official_desc")}
                      </div>
                      <div className="text-xs text-oai-gray-400 dark:text-oai-gray-500">
                        {copy("settings.token_plan.detection.official_account.url_label")}:{" "}
                        <ProviderHomeLink
                          linkId={resolveProviderHomeLinkId("codex")}
                          testId="detection-codex-provider-link"
                        />
                      </div>
                      {(consoleSessionError || codexWarning) && (
                        <div
                          ref={codexAlertRef}
                          tabIndex={-1}
                          role="alert"
                          aria-live="assertive"
                          data-testid="detection-codex-alert"
                          className="space-y-2 text-xs text-red-500 outline-none dark:text-red-400"
                        >
                          <div>
                            {codexWarning
                              ? `${codexWarning.error_code || "LEGACY_CREDENTIAL_CLEANUP_FAILED"}: ${codexWarning.error_message || copy("settings.token_plan.codex.legacy_cleanup_failed")}`
                              : consoleSessionError}
                          </div>
                          {codexPersistFailure ? (
                            <button
                              type="button"
                              data-testid="detection-codex-retry-save"
                              onClick={() => void retryCodexLocalPersist()}
                              className="tt-product-focusable rounded-md border border-oai-brand-300 px-2.5 py-1.5 text-xs text-oai-brand-700 dark:border-oai-brand-700 dark:text-oai-brand-300"
                            >
                              {copy("settings.token_plan.codex.retry_save")}
                            </button>
                          ) : null}
                        </div>
                      )}
                      {loadingConsoleSessions ? (
                        <div className="text-xs text-oai-gray-500">
                          {copy("settings.token_plan.console_session.loading")}
                        </div>
                      ) : codexStage === "disconnected" ? (
                        <button
                          type="button"
                          onClick={handleOfficialAccountSync}
                          disabled={connectingConsole}
                          data-testid="detection-connect-codex"
                          className={cn(
                            "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
                            "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
                            "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
                          )}
                        >
                          <Link2 className="h-3.5 w-3.5" aria-hidden />
                          {connectingConsole
                            ? copy("settings.token_plan.console_session.connecting")
                            : copy("settings.token_plan.codex.connect_account")}
                        </button>
                      ) : codexStage === "login_started" ? (
                        <div
                          className="space-y-2"
                          data-testid="detection-codex-login-started"
                          role="status"
                          aria-live="polite"
                        >
                          <div className="flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 text-amber-500" aria-hidden />
                            <div className="text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
                              {copy("settings.token_plan.console_session.status_login_started")}
                            </div>
                          </div>
                          <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
                            {copy("settings.token_plan.codex.login_started_desc")}
                          </div>
                          {renderCodexAttemptControls()}
                        </div>
                      ) : codexStage === "awaiting_verification" ? (
                        <div
                          className="space-y-2"
                          data-testid="detection-codex-awaiting"
                          role="status"
                          aria-live="polite"
                        >
                          <div className="flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 text-amber-500" aria-hidden />
                            <div>
                              <div className="text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
                                {copy("settings.token_plan.console_session.safe_account_label")}
                              </div>
                              <div className="text-xs text-amber-600 dark:text-amber-300">
                                {copy("settings.token_plan.console_session.status_awaiting_verification")}
                              </div>
                            </div>
                          </div>
                          {renderCodexAttemptControls()}
                        </div>
                      ) : codexStage === "failed" || codexStage === "desktop_not_verified" ? (
                        <div
                          ref={consoleSessionError || codexWarning ? undefined : codexAlertRef}
                          tabIndex={consoleSessionError || codexWarning ? undefined : -1}
                          className="space-y-2 outline-none"
                          data-testid="detection-codex-failed"
                          role={consoleSessionError || codexWarning ? undefined : "alert"}
                          aria-live={consoleSessionError || codexWarning ? undefined : "assertive"}
                        >
                          <div className="flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 text-red-500" aria-hidden />
                            <div>
                              <div className="text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
                                {copy("settings.token_plan.console_session.safe_account_label")}
                              </div>
                              <div className="text-xs text-red-500 dark:text-red-400">
                                {currentCodexNativeStatus?.error_message
                                  || formCodexSession?.last_error_message
                                  || codexStatusLabel}
                              </div>
                            </div>
                          </div>
                          <button
                            key={`codex-retry-${form.plan_id || "unknown"}`}
                            type="button"
                            onClick={handleOfficialAccountSync}
                            disabled={connectingConsole}
                            data-testid="detection-codex-retry"
                            autoFocus
                            className={cn(
                              "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
                              "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
                              "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
                            )}
                          >
                            <Link2 className="h-3.5 w-3.5" aria-hidden />
                            {copy("settings.token_plan.console_session.retry")}
                          </button>
                          {formCodexSession ? (
                            <button
                              type="button"
                              onClick={() => handleDeleteCodexConsoleSession(formCodexSession.id, formCodexSession.session_ref)}
                              disabled={codexDisconnectingSessionRef === formCodexSession.session_ref}
                              data-testid={formCodexDisconnectRetry
                                ? "detection-disconnect-codex-local-retry"
                                : "detection-disconnect-codex"}
                              className="ml-3 text-xs text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400"
                            >
                              {formCodexDisconnectRetry
                                ? copy("settings.token_plan.codex.retry_local_disconnect")
                                : copy("settings.token_plan.console_session.disconnect")}
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <div
                          className="space-y-2"
                          data-testid="detection-codex-connected"
                          role="status"
                          aria-live="polite"
                        >
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-green-500" aria-hidden />
                            <div>
                              <div className="text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
                                {copy("settings.token_plan.console_session.safe_account_label")}
                              </div>
                              <div className="text-xs text-green-600 dark:text-green-300">
                                {codexStatusLabel || copy("settings.token_plan.console_session.status_connected")}
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={handleOfficialAccountSync}
                            disabled={refreshingId === form.id || saving}
                            data-testid="detection-sync-codex"
                            className={cn(
                              "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
                              "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
                              "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
                            )}
                          >
                            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                            {refreshingId === form.id
                              ? copy("settings.token_plan.official_sync.syncing")
                              : copy("settings.token_plan.official_sync.connect")}
                          </button>
                          {formCodexSession ? (
                            <button
                              type="button"
                              onClick={() => handleDeleteCodexConsoleSession(formCodexSession.id, formCodexSession.session_ref)}
                              disabled={codexDisconnectingSessionRef === formCodexSession.session_ref}
                              data-testid={formCodexDisconnectRetry
                                ? "detection-disconnect-codex-local-retry"
                                : "detection-disconnect-codex"}
                              className="text-xs text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400"
                            >
                              {formCodexDisconnectRetry
                                ? copy("settings.token_plan.codex.retry_local_disconnect")
                                : copy("settings.token_plan.console_session.disconnect")}
                            </button>
                          ) : null}
                          {currentCodexNativeStatus?.legacy_auth_present === true ? (
                            <div
                              data-testid="detection-codex-legacy-warning"
                              className="space-y-1 rounded-md border border-amber-200 p-2 text-xs text-amber-700 dark:border-amber-900 dark:text-amber-300"
                            >
                              <div>{copy("settings.token_plan.codex.legacy_auth_warning")}</div>
                              <button
                                type="button"
                                data-testid="detection-codex-cleanup-legacy"
                                onClick={() => void cleanupCurrentLegacyCodexAuth()}
                                className="tt-product-focusable rounded-sm font-medium underline"
                              >
                                {copy("settings.token_plan.codex.cleanup_legacy")}
                              </button>
                            </div>
                          ) : null}
                          <button
                            type="button"
                            onClick={handleAddDetectedAccount}
                            data-testid="detection-add-account-codex"
                            className="ml-3 text-xs font-medium text-oai-brand-600 underline hover:text-oai-brand-700 dark:text-oai-brand-400"
                          >
                            {copy("settings.token_plan.console_session.add_account")}
                          </button>
                        </div>
                      )}
                    </div>
                  ) : form.provider_id === "claude" ? (
                    claudeRoutingMode ? (
                      <div className="space-y-3">
                        <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
                          {copy("settings.token_plan.claude.routing_notice")}
                        </div>
                      </div>
                    ) : (
                      <WebviewConsoleConnectPanel
                        descCopyKey="settings.token_plan.claude.official_desc"
                        connectCopyKey="settings.token_plan.claude.connect_account"
                        loginStartedDescCopyKey="settings.token_plan.claude.login_started_desc"
                        providerHomeLinkId={resolveProviderHomeLinkId("claude")}
                        stage={claudeStage}
                        session={formClaudeSession}
                        statusLabel={claudeStatusLabel}
                        loadingConsoleSessions={loadingConsoleSessions}
                        connectingConsole={connectingConsole}
                        consoleSessionError={consoleSessionError}
                        onConnect={handleConnectClaude}
                        onSync={handleOfficialAccountSync}
                      onDelete={handleDeleteClaudeConsoleSession}
                      onAddAccount={handleAddDetectedAccount}
                        testIdPrefix="claude"
                        syncing={refreshingId === form.id || connectingConsole}
                        syncDisabled={refreshingId === form.id || saving || connectingConsole}
                        operations={providerAuthorizationState("claude").operations}
                      />
                    )
                  ) : form.provider_id === "cursor" ? (
                    <WebviewConsoleConnectPanel
                      descCopyKey="settings.token_plan.cursor.official_desc"
                      connectCopyKey="settings.token_plan.cursor.connect_account"
                      loginStartedDescCopyKey="settings.token_plan.cursor.login_started_desc"
                      providerHomeLinkId={resolveProviderHomeLinkId("cursor")}
                      stage={cursorStage}
                      session={formCursorSession}
                      statusLabel={cursorStatusLabel}
                      loadingConsoleSessions={loadingConsoleSessions}
                      connectingConsole={connectingConsole}
                      consoleSessionError={consoleSessionError}
                      onConnect={handleConnectCursor}
                      onSync={handleOfficialAccountSync}
                      onDelete={handleDeleteCursorConsoleSession}
                      onAddAccount={handleAddDetectedAccount}
                      testIdPrefix="cursor"
                      syncing={refreshingId === form.id || connectingConsole}
                      syncDisabled={refreshingId === form.id || saving || connectingConsole}
                      operations={providerAuthorizationState("cursor").operations}
                    />
                  ) : form.provider_id === "trae" ? (
                    <WebviewConsoleConnectPanel
                      descCopyKey="settings.token_plan.trae.official_desc"
                      connectCopyKey="settings.token_plan.trae.connect_account"
                      loginStartedDescCopyKey="settings.token_plan.trae.login_started_desc"
                      providerHomeLinkId={resolveProviderHomeLinkId("trae")}
                      stage={traeStage}
                      session={formTraeSession}
                      statusLabel={traeStatusLabel}
                      loadingConsoleSessions={loadingConsoleSessions}
                      connectingConsole={connectingConsole}
                      consoleSessionError={consoleSessionError}
                      onConnect={handleConnectTrae}
                      onSync={handleOfficialAccountSync}
                      onDelete={handleDeleteTraeConsoleSession}
                      onAddAccount={handleAddDetectedAccount}
                      testIdPrefix="trae"
                      syncing={connectingConsole}
                      syncDisabled={saving || connectingConsole}
                      operations={providerAuthorizationState("trae").operations}
                    />
                  ) : form.provider_id === "xiaomi_mimo" ? (
                    <>
                  <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
                    {copy("settings.token_plan.detection.official_account.desc")}
                  </div>
                  <div className="mt-1 text-xs text-oai-gray-400 dark:text-oai-gray-500">
                    {copy("settings.token_plan.detection.official_account.url_label")}:{" "}
                    <ProviderHomeLink
                      linkId={resolveProviderHomeLinkId("xiaomi_mimo")}
                      testId="detection-xiaomi-provider-link"
                    />
                  </div>
                  {consoleSessionError && (
                    <div className="mt-2 text-xs text-red-500 dark:text-red-400">
                      {consoleSessionError}
                    </div>
                  )}
                  {loadingConsoleSessions ? (
                    <div className="mt-2 text-xs text-oai-gray-500">
                      {copy("settings.token_plan.console_session.loading")}
                    </div>
                  ) : xiaomiMimoStage === "disconnected" ? (
                    <div className="mt-2 space-y-2">
                      <button
                        type="button"
                        onClick={handleConnectXiaomiMimo}
                        disabled={connectingConsole}
                        data-testid="detection-connect-xiaomi"
                        className={cn(
                          "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
                          "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
                          "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
                        )}
                      >
                        <Link2 className="h-3.5 w-3.5" aria-hidden />
                        {connectingConsole
                          ? copy("settings.token_plan.console_session.connecting")
                          : copy("settings.token_plan.detection.official_account.connect")}
                      </button>
                    </div>
                  ) : xiaomiMimoStage === "login_started" ? (
                    <div className="mt-2 space-y-2" data-testid="detection-login-started">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-amber-500" aria-hidden />
                        <div className="text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
                          {copy("settings.token_plan.console_session.status_login_started")}
                        </div>
                      </div>
                      <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
                        {copy("settings.token_plan.console_session.login_started_desc")}
                      </div>
                    </div>
                  ) : xiaomiMimoStage === "awaiting_verification" ? (
                    <div className="mt-2 space-y-2" data-testid="detection-awaiting-verification">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-amber-500" aria-hidden />
                        <div>
                          <div className="text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
                            {copy("settings.token_plan.console_session.safe_account_label")}
                          </div>
                          <div className="text-xs text-amber-600 dark:text-amber-300">
                            {copy("settings.token_plan.console_session.status_awaiting_verification")}
                          </div>
                        </div>
                      </div>
                      <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
                        {copy("settings.token_plan.console_session.awaiting_verification_desc")}
                      </div>
                      <button
                        type="button"
                        onClick={handleConnectXiaomiMimo}
                        disabled={connectingConsole}
                        data-testid="detection-resume"
                        className={cn(
                          "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
                          "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
                          "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
                        )}
                      >
                        <Link2 className="h-3.5 w-3.5" aria-hidden />
                        {copy("settings.token_plan.console_session.retry")}
                      </button>
                    </div>
                  ) : xiaomiMimoStage === "failed" || xiaomiMimoStage === "desktop_not_verified" ? (
                    <div className="mt-2 space-y-2" data-testid="detection-failed">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-red-500" aria-hidden />
                        <div>
                          <div className="text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
                            {copy("settings.token_plan.console_session.safe_account_label")}
                          </div>
                          <div className="text-xs text-red-500 dark:text-red-400">
                            {xiaomiMimoStatusLabel}
                          </div>
                          {xiaomiMimoSession?.last_error_message && (
                            <div className="text-xs text-red-500 dark:text-red-400">
                              {xiaomiMimoSession.last_error_message}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleConnectXiaomiMimo}
                          disabled={connectingConsole}
                          data-testid="detection-retry"
                          className={cn(
                            "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
                            "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
                            "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
                          )}
                        >
                          <Link2 className="h-3.5 w-3.5" aria-hidden />
                          {copy("settings.token_plan.console_session.retry")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 space-y-2" data-testid="detection-connected">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-green-500" aria-hidden />
                          <div>
                            <div className="text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
                              {copy("settings.token_plan.console_session.safe_account_label")}
                            </div>
                            <div className="text-xs text-green-600 dark:text-green-300">
                              {xiaomiMimoStatusLabel}
                            </div>
                            {xiaomiMimoSession?.last_verified_at && (
                              <div className="text-xs text-oai-gray-400 dark:text-oai-gray-500">
                                {copy("settings.token_plan.console_session.last_verified")}:{" "}
                                {new Date(xiaomiMimoSession.last_verified_at).toLocaleString()}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                    </>
                  ) : null}
                </div>
              )}

              {/* W03-R3C: Custom API detection config */}
              {form.detection_method === "custom_api" && (
                <div className="mt-3 rounded-md border border-oai-gray-200 px-3 py-2 dark:border-oai-gray-800">
                  <div className="mb-2 text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
                    {copy("settings.token_plan.detection.custom_api.title")}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <TextInput
                      label={copy("settings.token_plan.detection.custom_api.api_key")}
                      value={apiKeyInput}
                      onChange={(e) => {
                        setApiKeyInput(e.target.value);
                        setSavedNotice(false);
                      }}
                      disabled={loading || saving}
                      placeholder="sk-..."
                    />
                    <SelectInput
                      label={copy("settings.token_plan.detection.custom_api.api_format")}
                      value={form.detection_config?.custom_api?.api_format || "json_path"}
                      onChange={updateCustomApiField("api_format")}
                      disabled={loading || saving}
                      options={[
                        { value: "json_path", label: "JSON Path" },
                        { value: "openai_compatible", label: "OpenAI Compatible" },
                        { value: "custom_mapping", label: copy("settings.token_plan.detection.custom_api.custom_mapping") },
                      ]}
                    />
                    <TextInput
                      label={copy("settings.token_plan.detection.custom_api.request_url")}
                      value={form.detection_config?.custom_api?.request_url || ""}
                      onChange={updateCustomApiField("request_url")}
                      disabled={loading || saving}
                      placeholder="https://api.example.com/v1/quota"
                    />
                    <TextInput
                      label={copy("settings.token_plan.detection.custom_api.official_url")}
                      value={form.detection_config?.custom_api?.official_url || ""}
                      onChange={updateCustomApiField("official_url")}
                      disabled={loading || saving}
                      placeholder="https://platform.example.com/token-plan"
                    />
                    <SelectInput
                      label={copy("settings.token_plan.detection.custom_api.method")}
                      value={form.detection_config?.custom_api?.method || "GET"}
                      onChange={updateCustomApiField("method")}
                      disabled={loading || saving}
                      options={[
                        { value: "GET", label: "GET" },
                        { value: "POST", label: "POST" },
                      ]}
                    />
                  </div>
                  <div className="mt-3 mb-1 text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
                    {copy("settings.token_plan.detection.custom_api.response_mapping")}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <TextInput
                      label={copy("settings.token_plan.detection.custom_api.total_quota_path")}
                      value={form.detection_config?.custom_api?.response_mapping?.total_quota_path || ""}
                      onChange={updateCustomApiMappingField("total_quota_path")}
                      disabled={loading || saving}
                      placeholder="$.data.total"
                    />
                    <TextInput
                      label={copy("settings.token_plan.detection.custom_api.used_quota_path")}
                      value={form.detection_config?.custom_api?.response_mapping?.used_quota_path || ""}
                      onChange={updateCustomApiMappingField("used_quota_path")}
                      disabled={loading || saving}
                      placeholder="$.data.used"
                    />
                    <TextInput
                      label={copy("settings.token_plan.detection.custom_api.remaining_quota_path")}
                      value={form.detection_config?.custom_api?.response_mapping?.remaining_quota_path || ""}
                      onChange={updateCustomApiMappingField("remaining_quota_path")}
                      disabled={loading || saving}
                      placeholder="$.data.remaining"
                    />
                    <TextInput
                      label={copy("settings.token_plan.detection.custom_api.expires_at_path")}
                      value={form.detection_config?.custom_api?.response_mapping?.expires_at_path || ""}
                      onChange={updateCustomApiMappingField("expires_at_path")}
                      disabled={loading || saving}
                      placeholder="$.data.expires_at"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {isCatalogPlan && (
            <div className="mt-2 text-xs text-oai-gray-500 dark:text-oai-gray-400">
              {copy("settings.token_plan.total_quota")}: <span>{displayTotalQuota}</span>
            </div>
          )}
          {showEmptyCatalog && (
            <div className="mt-2 text-xs text-oai-gray-500 dark:text-oai-gray-400">
              {copy("settings.token_plan.empty_catalog")}
            </div>
          )}
          {catalogError && formOpen && (
            <div className="mt-2 text-xs text-red-600 dark:text-red-400">
              {catalogError}
            </div>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeForm}
              disabled={saving}
              className="inline-flex h-8 items-center rounded-md border border-oai-gray-200 px-3 text-xs font-medium text-oai-gray-700 hover:bg-oai-gray-100 disabled:opacity-50 dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
            >
              {copy("settings.token_plan.cancel")}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!canSave}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
                "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
                "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
              )}
            >
              <Save className="h-3.5 w-3.5" aria-hidden />
              {saving ? copy("settings.token_plan.saving") : copy("settings.token_plan.save")}
            </button>
          </div>
        </div>
      )}

      {(error || savedNotice) && (
        <div className="pt-3 text-xs">
          {error ? (
            <span className="text-red-600 dark:text-red-400">{error}</span>
          ) : (
            <span className="text-oai-gray-500 dark:text-oai-gray-400">{copy("settings.token_plan.saved")}</span>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function SummaryMetric({ label, value }) {
  return (
    <div>
      <div className="text-oai-gray-500 dark:text-oai-gray-400">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-oai-gray-900 dark:text-oai-gray-100">{value}</div>
    </div>
  );
}

function CodexQuotaBlock({ codexData, loading }) {
  if (loading) {
    return (
      <div className="mt-2 pt-2 border-t border-oai-gray-200 dark:border-oai-gray-800">
        <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy("settings.token_plan.codex_quota.title")}
        </div>
      </div>
    );
  }

  if (!codexData) {
    return null;
  }

  if (!codexData.configured) {
    return (
      <div className="mt-2 pt-2 border-t border-oai-gray-200 dark:border-oai-gray-800">
        <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy("settings.token_plan.codex_quota.title")}
        </div>
        <div className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy("settings.token_plan.codex_quota.unconfigured")}
        </div>
      </div>
    );
  }

  if (codexData.auth_action_required === "reauth") {
    return (
      <div className="mt-2 pt-2 border-t border-oai-gray-200 dark:border-oai-gray-800">
        <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy("settings.token_plan.codex_quota.title")}
        </div>
        <div className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy("settings.token_plan.codex_quota.reauth")}
        </div>
      </div>
    );
  }

  if (codexData.error) {
    return (
      <div className="mt-2 pt-2 border-t border-oai-gray-200 dark:border-oai-gray-800">
        <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy("settings.token_plan.codex_quota.title")}
        </div>
        <div className="mt-1 text-xs text-red-600 dark:text-red-400">
          {`${copy("settings.token_plan.codex_quota.error")}: ${codexData.error}`}
        </div>
      </div>
    );
  }

  const hasAnyWindow =
    codexData.primary_window ||
    codexData.secondary_window ||
    codexData.spark_primary_window ||
    codexData.spark_secondary_window;

  if (!hasAnyWindow) {
    return (
      <div className="mt-2 pt-2 border-t border-oai-gray-200 dark:border-oai-gray-800">
        <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy("settings.token_plan.codex_quota.title")}
        </div>
        <div className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy("settings.token_plan.codex_quota.unavailable")}
        </div>
      </div>
    );
  }

  const renderWindow = (window, labelKey) => {
    if (!window) return null;
    const used = Number(window?.used_percent || 0);
    const remaining = Math.max(0, 100 - Math.round(Number.isFinite(used) ? used : 0));
    return (
      <div key={labelKey} className="flex items-center justify-between mt-1">
        <span className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy(labelKey)}
        </span>
        <span className="text-xs text-oai-gray-600 dark:text-oai-gray-300">
          {remaining}% {copy("settings.token_plan.codex_quota.remaining")}
          <span className="ml-2 text-oai-gray-400">
            {copy("settings.token_plan.codex_quota.reset")} {formatCodexReset(window.reset_at)}
          </span>
        </span>
      </div>
    );
  };

  return (
    <div className="mt-2 pt-2 border-t border-oai-gray-200 dark:border-oai-gray-800">
      <div className="text-xs font-medium text-oai-gray-500 dark:text-oai-gray-400">
        {copy("settings.token_plan.codex_quota.title")}
      </div>
      {renderWindow(codexData.primary_window, "settings.token_plan.codex_quota.5h")}
      {renderWindow(codexData.secondary_window, "settings.token_plan.codex_quota.7d")}
      {renderWindow(codexData.spark_primary_window, "settings.token_plan.codex_quota.spark_5h")}
      {renderWindow(codexData.spark_secondary_window, "settings.token_plan.codex_quota.spark_7d")}
    </div>
  );
}

function TextInput({ label, value, onChange, disabled, placeholder, hint, maxLength, inputTestId }) {
  const id = React.useId();
  return (
    <label className="block" htmlFor={id}>
      <span className="block text-xs text-oai-gray-500 dark:text-oai-gray-400">{label}</span>
      <input
        id={id}
        type="text"
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
        maxLength={maxLength}
        data-testid={inputTestId}
        className={inputClassName}
      />
      {hint ? (
        <span className="mt-1 block text-xs text-oai-gray-400 dark:text-oai-gray-500">{hint}</span>
      ) : null}
    </label>
  );
}

function NumberInput({ label, value, onChange, disabled, hint }) {
  const id = React.useId();
  return (
    <label className="block" htmlFor={id}>
      <span className="block text-xs text-oai-gray-500 dark:text-oai-gray-400">{label}</span>
      <input
        id={id}
        type="number"
        min="0"
        step="1"
        value={value}
        onChange={onChange}
        disabled={disabled}
        className={inputClassName}
      />
      {hint ? (
        <span className="mt-1 block text-xs text-oai-gray-400 dark:text-oai-gray-500">{hint}</span>
      ) : null}
    </label>
  );
}

function SelectInput({ label, value, onChange, disabled, options, "data-testid": dataTestId }) {
  return (
    <label className="block">
      <span className="block text-xs text-oai-gray-500 dark:text-oai-gray-400">{label}</span>
      <select
        value={value}
        onChange={onChange}
        disabled={disabled}
        data-testid={dataTestId}
        className={inputClassName}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </label>
  );
}

function CardSelectInput({ label, value, onChange, disabled, options, testIdPrefix }) {
  const [open, setOpen] = useState(false);
  const selectableOptions = options.filter((opt) => opt.value !== "");
  const selectedOption = options.find((opt) => opt.value === value);
  const selectedLabel = selectedOption?.label || "";

  const handleSelect = (nextValue) => {
    onChange({ target: { value: nextValue } });
    setOpen(false);
  };

  return (
    <div
      className="relative block"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <span className="block text-xs text-oai-gray-500 dark:text-oai-gray-400">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={onChange}
        disabled={disabled}
        className="sr-only"
        tabIndex={-1}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={cn(inputClassName, "flex items-center justify-between text-left")}
        data-testid={`${testIdPrefix}-trigger`}
        aria-expanded={open}
      >
        <span className="truncate">{selectedLabel}</span>
        <span aria-hidden className="ml-2 text-oai-gray-500">⌄</span>
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-oai-gray-200 bg-white p-1 shadow-lg dark:border-oai-gray-800 dark:bg-oai-gray-950"
          data-testid={`${testIdPrefix}-options`}
        >
          {selectableOptions.map((opt) => {
            const selected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={selected}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => handleSelect(opt.value)}
                className={cn(
                  "mb-1 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-colors last:mb-0",
                  selected
                    ? "border-oai-brand-500 bg-oai-brand-50 text-oai-gray-950 dark:border-oai-brand-400 dark:bg-oai-brand-500/10 dark:text-oai-gray-50"
                    : "border-oai-gray-200 bg-white text-oai-gray-800 hover:border-oai-brand-300 hover:bg-oai-gray-50 dark:border-oai-gray-800 dark:bg-oai-gray-950 dark:text-oai-gray-100 dark:hover:border-oai-brand-500/60 dark:hover:bg-oai-gray-900",
                )}
                data-testid={`${testIdPrefix}-option-${opt.value}`}
              >
                <span className="truncate">{opt.label}</span>
                {selected && <span aria-hidden className="ml-2 text-oai-brand-600">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const inputClassName = cn(
  "mt-1 h-9 w-full rounded-md border border-oai-gray-200 bg-white px-3 text-xs text-oai-gray-900 outline-none transition-colors",
  "placeholder:text-oai-gray-400 focus:border-oai-brand-500 focus:ring-2 focus:ring-oai-brand-500/20 disabled:opacity-60",
  "dark:border-oai-gray-800 dark:bg-oai-gray-950 dark:text-oai-gray-100 dark:placeholder:text-oai-gray-600",
);
