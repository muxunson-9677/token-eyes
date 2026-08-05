import React from "react";
import { copy, getCopyLocale } from "../../../lib/copy";

const TONES = {
  exact: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
  estimated: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200",
  partial: "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
  stale: "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
  unavailable: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200",
  unattributed: "bg-orange-100 text-orange-900 dark:bg-orange-950/50 dark:text-orange-200",
};

function formatTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(getCopyLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function DataConfidenceBadge({ confidence, onOpenDiagnostics, className = "", ...rest }) {
  if (!confidence?.state) return null;
  const states = Array.isArray(confidence.states) && confidence.states.length
    ? confidence.states
    : [confidence.state];
  const updatedAt = confidence.observedAt || confidence.lastSuccessAt;
  const details = [];

  if (confidence.sourceLabel || updatedAt) {
    details.push(copy("data.confidence.source_updated", {
      source: confidence.sourceLabel || copy("data.confidence.source_unknown"),
      time: formatTimestamp(updatedAt) || copy("data.confidence.time_unknown"),
    }));
  }
  if (confidence.estimationMethod) {
    details.push(copy("data.confidence.estimated_detail", { method: confidence.estimationMethod }));
  }
  if (states.includes("partial")) {
    details.push(confidence.reason || copy("data.confidence.partial_detail", {
      coverage: confidence.coveragePercent ?? 0,
    }));
  }
  if (confidence.unpricedTokens > 0) {
    details.push(copy("data.confidence.unpriced_detail", {
      tokens: confidence.unpricedTokens,
      percent: confidence.unpricedPercent ?? 0,
    }));
  }
  if (states.includes("stale")) {
    details.push(copy("data.confidence.stale_detail", {
      time: formatTimestamp(confidence.lastSuccessAt) || copy("data.confidence.time_unknown"),
    }));
  }
  if (states.includes("unavailable")) {
    details.push(copy("data.confidence.unavailable_detail", {
      reason: confidence.reason || copy("data.confidence.reason_unknown"),
    }));
  }
  if (states.includes("unattributed")) {
    details.push(copy("data.confidence.unattributed_detail", {
      tokens: confidence.unattributedTokens ?? 0,
      percent: confidence.unattributedPercent ?? 0,
    }));
  }

  return (
    <div
      className={`flex flex-wrap items-center justify-start gap-1.5 text-left text-xs text-oai-gray-600 dark:text-oai-gray-300 ${className}`}
      data-confidence-state={confidence.state}
      {...rest}
    >
      {states.map((state) => (
        <span key={state} className={`inline-flex rounded-full px-2 py-1 font-semibold ${TONES[state] || TONES.exact}`}>
          {copy(`data.confidence.${state}`)}
        </span>
      ))}
      {details.length ? (
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          {details.map((detail) => <span key={detail}>{detail}</span>)}
        </span>
      ) : null}
      {onOpenDiagnostics ? (
        <button
          type="button"
          onClick={onOpenDiagnostics}
          className="inline-flex min-h-10 items-center rounded-md px-2 font-semibold text-oai-brand hover:underline"
        >
          {copy("data.confidence.open_diagnostics")}
        </button>
      ) : null}
    </div>
  );
}
