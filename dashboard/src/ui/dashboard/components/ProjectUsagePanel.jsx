import React, { useMemo, useState } from "react";

import { Select } from "../../components";
import { copy } from "../../../lib/copy";
import { formatCompactNumber, toDisplayNumber, toFiniteNumber } from "../../../lib/format";
import { ProviderIcon } from "./ProviderIcon";

const LIMIT_OPTIONS = [3, 6, 10];

function resolveTokens(entry) {
  if (!entry) return null;
  const total = entry.total_tokens ?? null;
  const billable = entry.billable_total_tokens ?? null;
  const billableValue = toFiniteNumber(billable);
  const totalValue = toFiniteNumber(total);
  if (billableValue === 0 && totalValue != null && totalValue > 0) {
    return total;
  }
  return billable ?? total ?? null;
}

function formatCost(costUsd) {
  if (costUsd == null || isNaN(costUsd)) return null;
  return Number(costUsd).toFixed(4);
}

function formatRelativeTime(isoString) {
  if (!isoString) return null;
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 30) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return isoString;
  }
}

export function ProjectUsagePanel({
  entries = [],
  limit = 3,
  onLimitChange,
  loading = false,
  error = null,
  className = "",
  embedded = false,
}) {
  const tokensLabel = copy("dashboard.projects.tokens_label");
  const emptyLabel = copy("dashboard.projects.empty");
  const limitLabel = copy("dashboard.projects.limit_label");
  const limitAria = copy("dashboard.projects.limit_aria");
  const optionLabels = {
    3: copy("dashboard.projects.limit_top_3"),
    6: copy("dashboard.projects.limit_top_6"),
    10: copy("dashboard.projects.limit_top_10"),
  };
  const resolvedLimit = LIMIT_OPTIONS.includes(limit) ? limit : LIMIT_OPTIONS[0];

  const sortedEntries = useMemo(() => {
    const list = Array.isArray(entries) ? entries.slice() : [];
    return list.sort((a, b) => {
      const aValue = toFiniteNumber(resolveTokens(a)) ?? 0;
      const bValue = toFiniteNumber(resolveTokens(b)) ?? 0;
      return bValue - aValue;
    });
  }, [entries]);

  const displayEntries = sortedEntries.slice(0, Math.max(1, limit));

  const tokenFormatOptions = {
    thousandSuffix: copy("shared.unit.thousand_abbrev"),
    millionSuffix: copy("shared.unit.million_abbrev"),
    billionSuffix: copy("shared.unit.billion_abbrev"),
    decimals: 1,
  };

  const containerClass = embedded
    ? `${className}`
    : `rounded-xl border border-oai-gray-200 dark:border-oai-gray-800 bg-white dark:bg-oai-gray-900 p-5 ${className}`;

  return (
    <div className={containerClass}>
      {!embedded && (
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className="text-sm font-medium text-oai-gray-500 dark:text-oai-gray-300 uppercase tracking-wide">
            {copy("dashboard.projects.title")}
          </h3>
        </div>
      )}
      <div className={`flex items-center ${embedded ? "justify-end mb-3" : "justify-between gap-3 mb-4"}`}>
        <Select
          value={resolvedLimit}
          onValueChange={(value) => {
            if (typeof onLimitChange === "function" && value != null) {
              onLimitChange(value);
            }
          }}
          options={LIMIT_OPTIONS.map((value) => ({ value, label: optionLabels[value] }))}
          ariaLabel={limitAria}
          align="end"
          className="px-2 py-1 text-xs text-oai-gray-600 dark:text-oai-gray-300"
        />
      </div>

      {displayEntries.length === 0 ? (
        <div className="text-sm text-oai-gray-400 dark:text-oai-gray-400">{emptyLabel}</div>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          {displayEntries.map((entry) => (
            <ProjectUsageCard
              key={`${entry?.project_key || "project"}-${entry?.project_ref || ""}`}
              entry={entry}
              tokensLabel={tokensLabel}
              tokenFormatOptions={tokenFormatOptions}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectUsageCard({
  entry,
  tokensLabel,
  tokenFormatOptions,
}) {
  const [copyStatus, setCopyStatus] = useState(null);

  const projectKey = entry?.project_key || "";
  const projectName = entry?.project_name || projectKey || copy("data.confidence.unattributed");
  const projectPath = entry?.project_path || "";
  const hasRealPath = Boolean(projectPath && projectPath.length > 0);
  const costUsd = entry?.cost_usd ?? null;
  const requestCount = entry?.request_count ?? null;
  const lastActive = entry?.last_active_at;
  const pricingCoverage = entry?.pricing_coverage || "unpriced";
  const pricedTokens = entry?.priced_tokens ?? 0;
  const unpricedTokens = entry?.unpriced_tokens ?? 0;
  const projectRef = entry?.project_ref || "";

  const tokensRaw = resolveTokens(entry);
  const tokensCompact =
    tokensRaw == null
      ? null
      : formatCompactNumber(tokensRaw, tokenFormatOptions);

  const isUnpriced = pricingCoverage === "unpriced";
  const costDisplay = (!isUnpriced && costUsd != null) ? formatCost(costUsd) : null;
  const requestsDisplay = requestCount != null ? String(requestCount) : null;
  const lastActiveDisplay = formatRelativeTime(lastActive);

  const pricingLabel = {
    complete: copy("dashboard.projects.pricing_complete"),
    partial: copy("dashboard.projects.pricing_partial"),
    unpriced: copy("dashboard.projects.pricing_unpriced"),
  }[pricingCoverage] || copy("dashboard.projects.pricing_unpriced");

  const pricingClass = {
    complete: "text-oai-green-600 dark:text-oai-green-400",
    partial: "text-oai-yellow-600 dark:text-oai-yellow-400",
    unpriced: "text-oai-gray-400",
  }[pricingCoverage] || "text-oai-gray-400";

  const handleCopyPath = async (e) => {
    e.stopPropagation();
    if (!projectPath) return;
    try {
      await navigator.clipboard.writeText(projectPath);
      setCopyStatus("copied");
      setTimeout(() => setCopyStatus(null), 2000);
    } catch {
      setCopyStatus("failed");
      setTimeout(() => setCopyStatus(null), 2000);
    }
  };

  return (
    <div className="flex flex-col gap-2 p-3 rounded-lg border border-oai-gray-200 dark:border-oai-gray-700">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded bg-oai-gray-100 dark:bg-oai-gray-800 flex items-center justify-center flex-shrink-0">
          <ProviderIcon provider={projectKey} size={24} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-oai-black dark:text-oai-white truncate" title={projectName}>
            {projectName}
          </div>
          {hasRealPath ? (
            <div data-slot="project-path" className="flex items-center gap-1.5 mt-0.5">
              <span className="text-xs text-oai-gray-400 dark:text-oai-gray-400 truncate max-w-[120px]" title={projectPath}>
                {projectPath}
              </span>
              <button
                onClick={handleCopyPath}
                className="flex-shrink-0 px-1.5 py-0.5 text-xs text-oai-blue-600 dark:text-oai-blue-400 hover:bg-oai-gray-100 dark:hover:bg-oai-gray-800 rounded transition-colors"
                title={copy("dashboard.projects.copy_path")}
              >
                {copyStatus === "copied" ? "✓" : "⎘"}
              </button>
            </div>
          ) : null}
          {projectRef && /^https?:\/\//.test(projectRef) && (
            <div data-slot="project-remote" className="text-xs text-oai-gray-400 dark:text-oai-gray-400 mt-0.5 truncate max-w-[180px]">
              <span className="text-oai-gray-400">{copy("dashboard.projects.remote_repo")} </span>
              <span title={projectRef}>{projectRef.replace(/^https?:\/\//, "")}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
        {tokensCompact != null ? <span title={tokensLabel}>
          {tokensCompact} <span className="text-oai-gray-400">{tokensLabel}</span>
        </span> : null}
        {costDisplay != null && (
          <span>
            ${costDisplay} <span className="text-oai-gray-400">{copy("dashboard.projects.cost_label")}</span>
          </span>
        )}
        {requestsDisplay != null && (
          <span>
            {requestsDisplay} <span className="text-oai-gray-400">{copy("dashboard.projects.requests_label")}</span>
          </span>
        )}
        <span className={`${pricingClass}`}>
          {pricingLabel}
        </span>
        {lastActiveDisplay && (
          <span className="text-oai-gray-400">
            {lastActiveDisplay}
          </span>
        )}
      </div>
    </div>
  );
}
