import React from "react";
import { Card } from "../../components";
import { copy } from "../../../lib/copy";
import { formatChineseTokenCount } from "../../../lib/format";

const SERIES_STYLES = [
  { stroke: "stroke-oai-brand-500", dot: "bg-oai-brand-500" },
  { stroke: "stroke-blue-500", dot: "bg-blue-500" },
  { stroke: "stroke-amber-500", dot: "bg-amber-500" },
  { stroke: "stroke-violet-500", dot: "bg-violet-500" },
  { stroke: "stroke-rose-500", dot: "bg-rose-500" },
  { stroke: "stroke-oai-gray-400", dot: "bg-oai-gray-400" },
];

function hasPositiveUsage(row) {
  return Math.sign(Number(row?.tokens)) === 1 && Math.sign(Number(row?.percent)) === 1;
}

export function ModelUsageDonut({ rows = [], totalTokens = 0, className = "" }) {
  const safeRows = Array.isArray(rows)
    ? rows.filter(hasPositiveUsage)
    : [];

  if (safeRows.length === 0 || Number(totalTokens) <= 0) {
    return (
      <Card className={className} bodyClassName="min-h-48 flex flex-col">
        <div>
          <h3 className="text-sm font-semibold text-oai-black dark:text-oai-white">
            {copy("dashboard.model_distribution.title")}
          </h3>
          <p className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
            {copy("dashboard.model_distribution.subtitle")}
          </p>
        </div>
        <div className="flex flex-1 items-center justify-center text-sm text-oai-gray-400 dark:text-oai-gray-500">
          {copy("dashboard.model_distribution.empty")}
        </div>
      </Card>
    );
  }

  let offset = 0;
  return (
    <Card className={className}>
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-oai-black dark:text-oai-white">
          {copy("dashboard.model_distribution.title")}
        </h3>
        <p className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy("dashboard.model_distribution.subtitle")}
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
        <div className="relative h-32 w-32 justify-self-center">
          <svg
            viewBox="0 0 120 120"
            className="h-full w-full -rotate-90"
            role="img"
            aria-label={copy("dashboard.model_distribution.chart_aria")}
          >
            <circle cx="60" cy="60" r="46" pathLength="100" fill="none" strokeWidth="12" className="stroke-oai-gray-100 dark:stroke-oai-gray-800" />
            {safeRows.map(function renderSegment(row, index) {
              const percent = Math.max(0, Math.min(100, Number(row.percent) || 0));
              const dashOffset = -offset;
              offset += percent;
              return (
                <circle
                  key={row.id || row.name}
                  cx="60"
                  cy="60"
                  r="46"
                  pathLength="100"
                  fill="none"
                  strokeWidth="12"
                  strokeLinecap="butt"
                  strokeDasharray={`${percent} ${100 - percent}`}
                  strokeDashoffset={dashOffset}
                  className={`${SERIES_STYLES[index % SERIES_STYLES.length].stroke} transition-[stroke-dasharray] duration-500`}
                />
              );
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[10px] text-oai-gray-400 dark:text-oai-gray-500">
              {copy("dashboard.model_distribution.total")}
            </span>
            <strong className="mt-0.5 text-lg font-semibold tabular-nums text-oai-black dark:text-oai-white">
              {formatChineseTokenCount(totalTokens)}
            </strong>
          </div>
        </div>

        <ol
          data-testid="model-usage-legend"
          className="max-h-56 min-w-0 space-y-2.5 overflow-y-auto pr-1 oai-scrollbar"
        >
          {safeRows.map(function renderLegendItem(row, index) {
            return (
              <li key={row.id || row.name} className="grid min-w-0 grid-cols-[auto_auto_minmax(0,1fr)_auto] items-start gap-x-2 text-xs">
                <span className="mt-0.5 w-4 text-[10px] font-semibold tabular-nums text-oai-gray-400 dark:text-oai-gray-500">
                  {index + 1}
                </span>
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${SERIES_STYLES[index % SERIES_STYLES.length].dot}`} aria-hidden />
                <span className="min-w-0 break-words font-medium text-oai-gray-700 dark:text-oai-gray-200">
                  {row.name}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-oai-gray-700 dark:text-oai-gray-200">
                  {Number(row.percent).toLocaleString("zh-CN", { maximumFractionDigits: 1 })}%
                </span>
                <span aria-hidden />
                <span aria-hidden />
                <span className="col-span-2 text-[11px] tabular-nums text-oai-gray-400 dark:text-oai-gray-500">
                  {formatChineseTokenCount(row.tokens)}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </Card>
  );
}
