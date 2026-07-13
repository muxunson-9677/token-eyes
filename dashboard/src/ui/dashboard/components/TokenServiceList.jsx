import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../../../lib/cn";
import { copy } from "../../../lib/copy";

export const TOKEN_SERVICE_PAGE_SIZE = 5;

function toNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function isExpired(expiresAt, now) {
  const value = String(expiresAt || "").trim();
  if (!value) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value < now.toISOString().slice(0, 10);
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= now.getTime();
}

function readQuotaMetric(plan) {
  const windows = Array.isArray(plan?.quota_windows) ? plan.quota_windows : [];
  const liveWindow = windows.find((window) => window?.kind === "rolling_weekly")
    || windows.find((window) => window?.kind === "rolling_5_hour")
    || null;
  const source = liveWindow || plan || {};
  const total = toNonNegativeNumber(liveWindow ? source.total : source.total_quota);
  const used = toNonNegativeNumber(liveWindow ? source.used : source.used_quota);
  const reportedPercentage = Number(source.percentage);
  const percentage = Number.isFinite(reportedPercentage)
    ? Math.max(0, Math.min(100, reportedPercentage))
    : (total > 0 ? Math.max(0, Math.min(100, (used / total) * 100)) : 0);
  return { total, used, percentage };
}

export function normalizeTokenServices(plans, now = new Date()) {
  if (!Array.isArray(plans)) return [];

  return plans
    .map((plan, index) => {
      const metric = readQuotaMetric(plan);
      const name = String(
        plan?.plan_label || plan?.source || plan?.provider_id || copy("spend.usage.token_services.unknown"),
      ).trim();
      return {
        id: String(plan?.id || `${name}-${index}`),
        name,
        unit: String(plan?.quota_unit || "tokens"),
        originalIndex: index,
        ...metric,
        expired: isExpired(plan?.expires_at, now),
      };
    })
    .filter((service) => (
      !service.expired
      && service.total > 0
    ))
    .sort((left, right) => right.used - left.used || left.originalIndex - right.originalIndex);
}

function formatQuota(value, unit) {
  const number = toNonNegativeNumber(value);
  const suffix = unit && unit !== "tokens" ? ` ${unit}` : "";
  if (number >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(2)}B${suffix}`;
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(2)}M${suffix}`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1)}K${suffix}`;
  return `${number.toLocaleString()}${suffix}`;
}

function progressColor(percentage) {
  if (percentage >= 80) return "bg-red-500";
  if (percentage >= 60) return "bg-amber-500";
  return "bg-emerald-500";
}

export function TokenServiceList({ plans = [], loading = false, error = null, now = new Date(), className }) {
  const [page, setPage] = useState(1);
  const services = useMemo(() => normalizeTokenServices(plans, now), [plans, now]);
  const pageCount = Math.max(1, Math.ceil(services.length / TOKEN_SERVICE_PAGE_SIZE));

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const pageStart = (page - 1) * TOKEN_SERVICE_PAGE_SIZE;
  const pageRows = services.slice(pageStart, pageStart + TOKEN_SERVICE_PAGE_SIZE);

  return (
    <aside
      data-testid="token-service-list"
      className={cn(
        "flex min-h-[220px] min-w-0 flex-col rounded-xl border border-oai-gray-200 bg-white p-3 dark:border-oai-gray-800 dark:bg-oai-gray-900",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-oai-gray-100 pb-2 dark:border-oai-gray-800">
        <h3 className="text-sm font-semibold text-oai-gray-900 dark:text-oai-gray-100">
          {copy("spend.usage.token_services.title")}
        </h3>
        {!loading && !error && services.length > 0 && (
          <span className="text-[11px] tabular-nums text-oai-gray-400 dark:text-oai-gray-500">
            {page} / {pageCount}
          </span>
        )}
      </div>

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
        <ol className="min-h-0 flex-1 divide-y divide-oai-gray-100 dark:divide-oai-gray-800">
          {pageRows.map((service, index) => {
            const rank = pageStart + index + 1;
            const roundedPercentage = Math.round(service.percentage);
            return (
              <li key={service.id} data-testid="token-service-row" className="py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-oai-gray-100 text-[11px] font-semibold tabular-nums text-oai-gray-500 dark:bg-oai-gray-800 dark:text-oai-gray-400">
                    {rank}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-oai-gray-800 dark:text-oai-gray-200" title={service.name}>
                    {service.name}
                  </span>
                  <span className="shrink-0 text-[11px] font-medium tabular-nums text-oai-gray-500 dark:text-oai-gray-400">
                    {roundedPercentage}%
                  </span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-oai-gray-100 dark:bg-oai-gray-800">
                  <div
                    className={cn("h-full rounded-full", progressColor(roundedPercentage))}
                    style={{ width: `${roundedPercentage}%` }}
                    role="progressbar"
                    aria-label={copy("spend.usage.token_services.progress", { name: service.name })}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={roundedPercentage}
                  />
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[10px] tabular-nums text-oai-gray-400 dark:text-oai-gray-500">
                  <span>{copy("spend.usage.token_services.used")} {formatQuota(service.used, service.unit)}</span>
                  <span>{copy("spend.usage.token_services.total")} {formatQuota(service.total, service.unit)}</span>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {!loading && !error && services.length > TOKEN_SERVICE_PAGE_SIZE && (
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
