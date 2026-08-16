import React, { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import { cn } from "../../../lib/cn";
import { copy, getCopyLocale } from "../../../lib/copy";
import { formatTokenCount } from "../../../lib/format";
import { ProviderIcon } from "./ProviderIcon.jsx";

export const TOKEN_SERVICE_PAGE_SIZE = 5;

const PROVIDER_LABELS = {
  xiaomi_mimo: "Xiaomi",
  codex: "Codex",
  claude: "Claude",
  cursor: "Cursor",
  trae: "Trae",
  glm: "GLM",
  kimi: "Kimi",
  minimax: "MiniMax",
  aliyun_bailian: "阿里云百炼",
};

function toNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function expiryTimestamp(expiresAt) {
  const value = String(expiresAt || "").trim();
  if (!value) return null;
  if (/^\d{10,13}$/.test(value)) {
    const numeric = Number(value);
    const timestamp = value.length <= 10 ? numeric * 1000 : numeric;
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const timestamp = new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isExpired(expiresAt, now) {
  const timestamp = expiryTimestamp(expiresAt);
  return timestamp !== null && timestamp <= now.getTime();
}

const WINDOW_PRIORITY = [
  "rolling_5_hour",
  "rolling_weekly",
  "gpt_5_3_codex_spark_5_hour",
  "gpt_5_3_codex_spark_weekly",
  "total",
  "auto_composer",
  "api",
  "fast_request",
];
// Cockpit-aligned Cursor lanes: Total Usage / Auto+Composer / API Usage.
const CURSOR_WINDOW_PRIORITY = ["total", "rolling_weekly", "auto_composer", "api"];

function quotaMetric(source, kind, unit) {
  const total = toNonNegativeNumber(kind === "total" && source?.total_quota != null ? source?.total_quota : source?.total);
  const used = toNonNegativeNumber(kind === "total" && source?.used_quota != null && source?.total == null
    ? source?.used_quota
    : source?.used);
  const reportedPercentage = Number(source?.percentage);
  const percentage = Number.isFinite(reportedPercentage)
    ? Math.max(0, Math.min(100, reportedPercentage))
    : (total > 0 ? Math.max(0, Math.min(100, (used / total) * 100)) : 0);
  return {
    kind,
    modelLabel: String(source?.model_label || source?.model_name || source?.model || "").trim(),
    total,
    used,
    percentage,
    unit,
    resetsAt: source?.resets_at || source?.reset_at || null,
  };
}

function windowPriority(kind, priority) {
  const index = priority.indexOf(kind);
  return index === -1 ? priority.length : index;
}

function readQuotaMetrics(plan) {
  const windows = Array.isArray(plan?.quota_windows) ? plan.quota_windows : [];
  const unit = String(plan?.quota_unit || "tokens");
  const providerId = String(plan?.provider_id || "").trim().toLowerCase();
  const priority = providerId === "cursor" ? CURSOR_WINDOW_PRIORITY : WINDOW_PRIORITY;
  const liveMetrics = windows
    .filter((window) => String(window?.kind || "").trim())
    .map((window) => quotaMetric(window, String(window.kind), window?.unit || unit))
    .filter((metric) => metric.total > 0 || Number.isFinite(metric.percentage))
    .sort((left, right) => windowPriority(left.kind, priority) - windowPriority(right.kind, priority));
  // Cursor emits both `total` and `rolling_weekly` as the same Total Usage lane —
  // keep a single headline window plus Auto/API breakdowns.
  if (providerId === "cursor" && liveMetrics.length > 0) {
    const seen = new Set();
    const deduped = [];
    for (const metric of liveMetrics) {
      const key = metric.kind === "rolling_weekly" ? "total" : metric.kind;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(metric.kind === "rolling_weekly" ? { ...metric, kind: "total" } : metric);
    }
    return deduped;
  }
  if (liveMetrics.length > 0) return liveMetrics;

  const fixedMetric = quotaMetric(plan || {}, "total", unit);
  return fixedMetric.total > 0 ? [fixedMetric] : [];
}

function isConfiguredService(plan, total) {
  const detectionMethod = String(plan?.detection_method || "").trim().toLowerCase();
  const refreshMethod = String(plan?.refresh_method || "").trim().toLowerCase();
  const hasAutomaticDetection = (
    (detectionMethod && detectionMethod !== "not_configured")
    || refreshMethod === "official_api"
    || refreshMethod === "custom_api"
  );
  if (hasAutomaticDetection) {
    const status = String(plan?.sync_status || plan?.last_refresh_status || "").trim().toLowerCase();
    return status === "success";
  }

  const providerId = String(plan?.provider_id || "").trim().toLowerCase();
  const source = String(plan?.source || "").trim();
  const isManual = (
    String(plan?.quota_source || "").trim().toLowerCase() === "manual"
    || providerId === "custom"
    || (!providerId && !detectionMethod && !refreshMethod)
  );
  return isManual && source.length > 0 && total > 0;
}

function serviceLabels(plan) {
  const providerId = String(plan?.provider_id || "").trim().toLowerCase();
  const source = String(plan?.source || "").trim();
  const provider = PROVIDER_LABELS[providerId]
    || (providerId === "custom" ? source : "")
    || source
    || copy("spend.usage.token_services.unknown");
  const planLabel = String(plan?.plan_label || "")
    .replace(/\s*[（(]月付[）)]\s*$/u, "")
    .trim();
  return { provider, planLabel, providerId: providerId || "custom" };
}

function authorizedAccountLabel(plan) {
  if (String(plan?.detection_method || "").trim() !== "official_account") return "";
  const official = plan?.detection_config?.official_account || {};
  return String(
    official.display_name
    || official.account_label
    || official.account_id
    || plan?.notes
    || "",
  ).trim();
}

export function normalizeTokenServices(plans, now = new Date()) {
  if (!Array.isArray(plans)) return [];

  return plans
    .map((plan, index) => {
      const metrics = readQuotaMetrics(plan);
      const primaryMetric = metrics.find((metric) => metric.kind === "total")
        || metrics.find((metric) => metric.kind === "rolling_weekly")
        || metrics[0]
        || { total: 0, used: 0, percentage: 0 };
      const labels = serviceLabels(plan);
      const effectiveExpiry = plan?.subscription_end_date || plan?.expires_at || null;
      const verifiedExpiry = expiryTimestamp(effectiveExpiry);
      return {
        id: String(plan?.id || `${labels.provider}-${index}`),
        ...labels,
        unit: String(plan?.quota_unit || "tokens"),
        expiresAt: effectiveExpiry,
        notes: String(plan?.notes || "").trim(),
        accountLabel: authorizedAccountLabel(plan),
        syncStatus: String(plan?.sync_status || plan?.last_refresh_status || "").trim().toLowerCase(),
        errorMessage: String(plan?.last_error_message || "").trim(),
        originalIndex: index,
        metrics,
        ...primaryMetric,
        configured: isConfiguredService(plan, primaryMetric.total),
        expired: isExpired(effectiveExpiry, now),
        hasVerifiedFutureExpiry: verifiedExpiry !== null && verifiedExpiry > now.getTime(),
      };
    })
    .filter((service) => {
      if (service.expired) return false;
      // A saved plan is part of the user's Token service list. A temporary
      // refresh/auth failure must not make the whole service disappear.
      if (service.metrics.length === 0) return true;
      // Cursor percent lanes use total=100; 0% is a valid live reading (do not hide).
      if (service.providerId === "cursor") {
        return Number.isFinite(service.percentage) && (
          service.used < service.total
          || service.hasVerifiedFutureExpiry
          || service.percentage === 0
        );
      }
      return service.total > 0
        && (service.used < service.total || service.hasVerifiedFutureExpiry);
    })
    .sort(compareTokenServices);
}

export function compareTokenServices(left, right) {
  const leftExhausted = left.total > 0 && left.used >= left.total;
  const rightExhausted = right.total > 0 && right.used >= right.total;
  if (leftExhausted !== rightExhausted) return leftExhausted ? 1 : -1;
  return right.used - left.used || left.originalIndex - right.originalIndex;
}

function formatQuota(value, unit) {
  const number = toNonNegativeNumber(value);
  const locale = getCopyLocale();
  if (!unit || unit === "tokens") return formatTokenCount(number, { locale });
  if (unit === "percent") return `${number.toLocaleString(locale)}${copy("shared.unit.percent")}`;
  const suffix = unit && unit !== "tokens" ? ` ${unit}` : "";
  return `${number.toLocaleString(locale)}${suffix}`;
}

function formatDateTime(value, includeTime = false) {
  if (!value) return null;
  const normalized = String(value).trim();
  const timestamp = /^\d{10,13}$/.test(normalized)
    ? Number(normalized) * (normalized.length <= 10 ? 1000 : 1)
    : Date.parse(normalized);
  if (!Number.isFinite(timestamp)) return String(value);
  return new Intl.DateTimeFormat(getCopyLocale(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: includeTime ? "2-digit" : undefined,
    minute: includeTime ? "2-digit" : undefined,
    hour12: false,
  }).format(new Date(timestamp));
}

function formatRemainingDuration(value, now) {
  const timestamp = expiryTimestamp(value);
  if (timestamp === null) return null;
  const totalMinutes = Math.floor((timestamp - now.getTime()) / 60_000);
  if (totalMinutes <= 0) return copy("spend.usage.token_services.duration.elapsed");
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return copy("spend.usage.token_services.duration.days_hours", { days, hours });
  }
  if (hours > 0) {
    return copy("spend.usage.token_services.duration.hours_minutes", { hours, minutes });
  }
  return copy("spend.usage.token_services.duration.minutes", { minutes });
}

function windowLabel(metric) {
  const kind = metric?.kind;
  if (metric?.modelLabel) return metric.modelLabel;
  if (kind === "rolling_5_hour") return copy("spend.usage.token_services.window.rolling_5_hour");
  if (kind === "rolling_weekly") return copy("spend.usage.token_services.window.rolling_weekly");
  if (kind === "auto_composer") return copy("spend.usage.token_services.window.auto_composer");
  if (kind === "api") return copy("spend.usage.token_services.window.api");
  if (kind === "total") return copy("spend.usage.token_services.window.total_usage");
  if (kind === "gpt_5_3_codex_spark_5_hour") return "GPT 5.3 Codex Spark · 5 小时";
  if (kind === "gpt_5_3_codex_spark_weekly") return "GPT 5.3 Codex Spark Weekly";
  return copy("spend.usage.token_services.window.total");
}

function progressColor(percentage) {
  if (percentage >= 80) return "bg-red-500";
  if (percentage >= 60) return "bg-amber-500";
  return "bg-emerald-500";
}

function syncStatusClass(status) {
  if (status === "success" || status === "synced") return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300";
  if (status === "failed" || status === "error") return "bg-red-50 text-red-700 dark:bg-red-950/35 dark:text-red-300";
  if (status === "reauth_required" || status === "auth_required") return "bg-amber-50 text-amber-700 dark:bg-amber-950/35 dark:text-amber-300";
  if (status === "syncing") return "bg-blue-50 text-blue-700 dark:bg-blue-950/35 dark:text-blue-300";
  return "bg-oai-gray-100 text-oai-gray-500 dark:bg-oai-gray-800 dark:text-oai-gray-400";
}

function syncStatusLabel(status) {
  const normalized = status === "synced" ? "success" : status;
  return copy(`settings.token_plan.sync_status.${normalized || "not_configured"}`);
}

export function TokenServiceList({
  plans = [],
  loading = false,
  error = null,
  now = new Date(),
  className,
  embedded = false,
  hideHeader = false,
  paginate = true,
  pageSize = TOKEN_SERVICE_PAGE_SIZE,
}) {
  const [page, setPage] = useState(1);
  const services = useMemo(() => normalizeTokenServices(plans, now), [plans, now]);
  const effectivePageSize = Math.max(1, Number(pageSize) || TOKEN_SERVICE_PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(services.length / effectivePageSize));

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const pageStart = (page - 1) * effectivePageSize;
  const pageRows = paginate ? services.slice(pageStart, pageStart + effectivePageSize) : services;
  const showPagination = paginate
    && !loading
    && !error
    && services.length !== Math.min(services.length, effectivePageSize);

  return (
    <aside
      data-testid="token-service-list"
      className={cn(
        "flex h-full min-w-0 flex-col",
        embedded
          ? "tt-token-service-list--embedded"
          : "tt-surface min-h-[220px] rounded-[var(--tt-card-radius)] p-4",
        className,
      )}
    >
      {!hideHeader ? <div className="flex items-center justify-between gap-2 border-b border-oai-gray-100 pb-2 dark:border-oai-gray-800">
        <h3 data-testid="token-service-list-title" className="text-sm font-semibold text-oai-gray-900 dark:text-oai-gray-100">
          {copy("spend.usage.token_services.title")}
        </h3>
        {!loading && !error && services.length > 0 && (
          <span className="text-[11px] tabular-nums text-oai-gray-400 dark:text-oai-gray-500">
            {page} / {pageCount}
          </span>
        )}
      </div> : null}

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-xs text-oai-gray-400 dark:text-oai-gray-500">
          {copy("spend.usage.token_services.loading")}
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center px-2 text-center text-xs text-red-500 dark:text-red-400">
          {copy("spend.usage.token_services.error")}
        </div>
      ) : pageRows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-2 text-center text-xs leading-5 text-oai-gray-400 dark:text-oai-gray-500">
          {copy("spend.usage.token_services.empty")}
        </div>
      ) : (
        <ol data-testid="token-service-cards" className="mt-1.5 flex min-h-0 flex-1 flex-col gap-1.5">
          {pageRows.map((service, index) => {
            const rank = pageStart + index + 1;
            const connectedWithoutQuota = ["success", "synced"].includes(service.syncStatus)
              && service.metrics.length === 0;
            const showSyncStatus = connectedWithoutQuota
              || (service.syncStatus && !["success", "synced"].includes(service.syncStatus));
            return (
              <li
                key={service.id}
                data-testid="token-service-row"
                className="tt-surface-nested tt-token-service-card min-w-0 rounded-lg border p-2"
              >
                <div className="flex min-w-0 items-start gap-1.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-oai-gray-100 text-[11px] font-semibold tabular-nums text-oai-gray-500 dark:bg-oai-gray-800 dark:text-oai-gray-400">
                    {rank}
                  </span>
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white text-oai-gray-700 ring-1 ring-inset ring-oai-gray-200 dark:bg-oai-gray-900 dark:text-oai-gray-200 dark:ring-oai-gray-700"
                    data-testid={`token-service-provider-icon-${service.providerId}`}
                  >
                    <ProviderIcon provider={service.providerId} size={14} />
                  </span>
                  <span className="min-w-0 flex-1" title={[service.provider, service.planLabel].filter(Boolean).join(" · ")}>
                    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                      <span className="break-words text-xs font-semibold text-oai-gray-800 dark:text-oai-gray-200">
                        {service.provider}
                      </span>
                      {service.planLabel && (
                        <span className="break-words text-[10px] text-oai-gray-400 dark:text-oai-gray-500">
                          {service.planLabel}
                        </span>
                      )}
                      {showSyncStatus ? <span className={cn(
                        "rounded px-1.5 py-0.5 text-[9px] font-medium",
                        connectedWithoutQuota
                          ? "bg-amber-50 text-amber-700 dark:bg-amber-950/35 dark:text-amber-300"
                          : syncStatusClass(service.syncStatus),
                      )}>
                        {connectedWithoutQuota
                          ? copy("spend.cost.token_package.connected_no_quota")
                          : syncStatusLabel(service.syncStatus)}
                      </span> : null}
                    </span>
                    {(service.accountLabel || service.notes) && (
                      <span className="mt-0.5 block break-words text-[9px] leading-3 text-oai-gray-400 dark:text-oai-gray-500" title={service.accountLabel || service.notes}>
                        {service.accountLabel || service.notes}
                      </span>
                    )}
                  </span>
                </div>
                <div className="mt-1.5 space-y-1.5">
                  {service.metrics.map((metric) => {
                    const roundedPercentage = Math.round(metric.percentage);
                    return (
                      <div key={metric.kind} data-testid={`token-service-window-${metric.kind}`}>
                        <div className="mb-0.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[10px] leading-3.5 text-oai-gray-500 dark:text-oai-gray-400">
                          <span className="inline-flex items-center gap-1 whitespace-nowrap font-medium">
                            {metric.kind === "total" ? null : <Clock3 className="h-3 w-3" aria-hidden="true" />}
                            {windowLabel(metric)}
                          </span>
                          <span className="tabular-nums text-oai-gray-500 dark:text-oai-gray-400">
                            {copy("spend.usage.token_services.used")} {formatQuota(metric.used, metric.unit)} / {copy("spend.usage.token_services.total")} {formatQuota(metric.total, metric.unit)} · {copy("settings.token_plan.remaining")} {formatQuota(Math.max(0, metric.total - metric.used), metric.unit)} · <strong className="font-semibold text-oai-gray-700 dark:text-oai-gray-300">{roundedPercentage}%</strong>
                          </span>
                        </div>
                        <div className="h-0.5 overflow-hidden rounded-full bg-oai-gray-200 dark:bg-oai-gray-700">
                          <div
                            className={cn("h-full rounded-full", progressColor(roundedPercentage))}
                            style={{ width: `${roundedPercentage}%` }}
                            role="progressbar"
                            aria-label={copy("spend.usage.token_services.progress", { name: service.provider })}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={roundedPercentage}
                          />
                        </div>
                        <div
                          data-testid={`token-service-reset-${metric.kind}`}
                          className="mt-0.5 text-right text-[9px] leading-3 tabular-nums text-oai-gray-400 dark:text-oai-gray-600"
                        >
                          {metric.resetsAt
                            ? copy("spend.usage.token_services.reset_countdown", {
                              remaining: formatRemainingDuration(metric.resetsAt, now),
                              value: formatDateTime(metric.resetsAt, true),
                            })
                            : `${copy("settings.token_plan.quota_window_reset")}: ${copy("settings.token_plan.reset_unavailable")}`}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div
                  data-testid="token-service-validity"
                  className="mt-1 flex items-center gap-1 rounded-md bg-emerald-50/70 px-1.5 py-1 text-[9px] font-medium leading-3 tabular-nums text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                >
                  <CalendarDays className="h-3 w-3" aria-hidden="true" />
                  {service.expiresAt
                    ? copy("spend.usage.token_services.validity", {
                      remaining: formatRemainingDuration(service.expiresAt, now),
                      value: formatDateTime(service.expiresAt, true),
                    })
                    : copy("spend.usage.token_services.validity_unknown")}
                </div>
                {service.errorMessage ? (
                  <div className="mt-1 break-words text-[9px] leading-3 text-red-600 dark:text-red-400">
                    {service.errorMessage}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {showPagination && (
        <div className="mt-auto flex items-center justify-end gap-1 border-t border-oai-gray-100 pt-2 dark:border-oai-gray-800">
          <button
            type="button"
            aria-label={copy("spend.usage.token_services.previous")}
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-oai-gray-500 transition-colors hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-30 dark:text-oai-gray-400 dark:hover:bg-oai-gray-800"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={copy("spend.usage.token_services.next")}
            disabled={page >= pageCount}
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-oai-gray-500 transition-colors hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-30 dark:text-oai-gray-400 dark:hover:bg-oai-gray-800"
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
    </aside>
  );
}
