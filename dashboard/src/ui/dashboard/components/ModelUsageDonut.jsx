import React from "react";
import { Boxes, Gauge, Sparkles } from "lucide-react";
import { Card } from "../../components";
import { copy, getCopyLocale } from "../../../lib/copy";
import { formatTokenCount } from "../../../lib/format";

const SERIES_STYLES = [
  { stroke: "stroke-oai-brand-500", fill: "fill-oai-brand-500", dot: "bg-oai-brand-500" },
  { stroke: "stroke-blue-500", fill: "fill-blue-500", dot: "bg-blue-500" },
  { stroke: "stroke-amber-500", fill: "fill-amber-500", dot: "bg-amber-500" },
  { stroke: "stroke-violet-500", fill: "fill-violet-500", dot: "bg-violet-500" },
  { stroke: "stroke-rose-500", fill: "fill-rose-500", dot: "bg-rose-500" },
  { stroke: "stroke-oai-gray-400", fill: "fill-oai-gray-400", dot: "bg-oai-gray-400" },
];

const RANK_STYLES = [
  "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/30",
  "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200 dark:bg-slate-500/15 dark:text-slate-200 dark:ring-slate-500/30",
  "bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200 dark:bg-orange-500/15 dark:text-orange-200 dark:ring-orange-500/30",
];

const RADAR_CENTER_X = 60;
const RADAR_CENTER_Y = 62;
const RADAR_RADIUS = 47;
const RADAR_LABEL_RADIUS = 56;

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function hasPositiveUsage(row) {
  return Math.sign(Number(row?.tokens)) === 1 && Math.sign(Number(row?.percent)) === 1;
}

export function ModelUsageDonut({ rows = [], totalTokens = 0, className = "" }) {
  const [activeIndex, setActiveIndex] = React.useState(null);
  const locale = getCopyLocale();
  const safeRows = Array.isArray(rows)
    ? rows.filter(hasPositiveUsage)
    : [];
  const activeRow = Number.isInteger(activeIndex) ? safeRows[activeIndex] : null;
  const activePercent = activeRow
    ? clampPercent(activeRow.percent).toLocaleString(locale, { maximumFractionDigits: 1 })
    : "";
  const activeTokens = activeRow
    ? Number(activeRow.tokens).toLocaleString(locale, { maximumFractionDigits: 20 })
    : "";
  const activeLabel = activeRow
    ? `${activeRow.name}, ${copy("dashboard.model_distribution.table_tokens")} ${activeTokens}, ${copy("dashboard.model_distribution.table_share")} ${activePercent}%`
    : "";
  const clearActiveIndex = (index) => {
    setActiveIndex((current) => (current === index ? null : current));
  };
  const topOnePercent = clampPercent(safeRows[0]?.percent);
  const topThreePercent = clampPercent(
    safeRows.slice(0, 3).reduce(function sumPercent(sum, row) {
      return sum + clampPercent(row.percent);
    }, 0),
  );

  if (safeRows.length === 0 || Math.sign(Number(totalTokens)) !== 1) {
    return (
      <Card
        variant="nested"
        className={`tt-pressable-parent h-full ${className}`}
        bodyClassName="flex min-h-48 h-full flex-col"
      >
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
  const radarRows = safeRows.slice(0, 5);
  const radarPoint = (index, radius) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / radarRows.length;
    return {
      x: RADAR_CENTER_X + Math.cos(angle) * radius,
      y: RADAR_CENTER_Y + Math.sin(angle) * radius,
    };
  };
  const radarGridPolygons = [0.25, 0.5, 0.75, 1].map((scale) =>
    radarRows
      .map((_, index) => {
        const point = radarPoint(index, RADAR_RADIUS * scale);
        return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
      })
      .join(" "),
  );
  const radarValuePoints = radarRows.map(function buildRadarValuePoint(row, index) {
    const point = radarPoint(index, RADAR_RADIUS * (clampPercent(row.percent) / 100));
    return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  }).join(" ");
  return (
    <Card
      variant="nested"
      className={`tt-pressable-parent h-full ${className}`}
      bodyClassName="flex h-full flex-col"
    >
      <div className="tt-overview-model-usage-header mb-3 grid items-end gap-3 sm:grid-cols-[minmax(0,.8fr)_minmax(0,1.8fr)]">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-oai-black dark:text-oai-white">
            {copy("dashboard.model_distribution.title")}
          </h3>
          <p className="mt-1 text-[10px] text-oai-gray-500 dark:text-oai-gray-400">
            {copy("dashboard.model_distribution.subtitle")}
          </p>
        </div>
        <div className="tt-overview-model-summary grid grid-cols-3 overflow-hidden rounded-xl border border-oai-gray-100 bg-white/80 shadow-sm dark:border-oai-gray-800 dark:bg-oai-gray-900/70">
          <div data-testid="model-usage-summary-count" data-tone="green"><span data-testid="model-usage-summary-icon" aria-hidden="true"><Boxes /></span><span><strong>{safeRows.length}</strong><small>{copy("dashboard.model_distribution.model_count")}</small></span></div>
          <div data-testid="model-usage-summary-top1" data-tone="blue"><span data-testid="model-usage-summary-icon" aria-hidden="true"><Gauge /></span><span><strong>{topOnePercent.toLocaleString(locale, { maximumFractionDigits: 1 })}%</strong><small>{copy("dashboard.model_distribution.top_one_share")}</small></span></div>
          <div data-testid="model-usage-summary-top3" data-tone="amber"><span data-testid="model-usage-summary-icon" aria-hidden="true"><Sparkles /></span><span><strong>{topThreePercent.toLocaleString(locale, { maximumFractionDigits: 1 })}%</strong><small>{copy("dashboard.model_distribution.top_three_share")}</small></span></div>
        </div>
      </div>

      <div
        className="grid min-h-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2"
        data-testid="model-usage-layout"
      >
        <div
          className="flex min-h-0 flex-col"
          data-testid="model-usage-visuals"
        >
          <div className="relative h-32 w-32 shrink-0 self-center">
            <svg
              viewBox="0 0 120 120"
              className="h-full w-full -rotate-90"
              role="img"
              aria-label={copy("dashboard.model_distribution.chart_aria")}
            >
              <circle cx="60" cy="60" r="46" pathLength="100" fill="none" strokeWidth="12" className="stroke-oai-gray-100 dark:stroke-oai-gray-800" />
              {safeRows.map(function renderSegment(row, index) {
                const percent = clampPercent(row.percent);
                const dashOffset = -offset;
                const isActive = activeIndex === index;
                offset += percent;
                return (
                  <circle
                    key={row.id || row.name}
                    data-testid="model-donut-segment"
                    data-active={isActive ? "true" : undefined}
                    cx="60"
                    cy="60"
                    r="46"
                    pathLength="100"
                    fill="none"
                    strokeWidth={isActive ? "15" : "12"}
                    strokeLinecap="butt"
                    strokeDasharray={`${percent} ${100 - percent}`}
                    strokeDashoffset={dashOffset}
                    tabIndex="0"
                    role="img"
                    aria-label={`${row.name}, ${copy("dashboard.model_distribution.table_tokens")} ${Number(row.tokens).toLocaleString(locale, { maximumFractionDigits: 20 })}, ${copy("dashboard.model_distribution.table_share")} ${percent.toLocaleString(locale, { maximumFractionDigits: 1 })}%`}
                    aria-describedby={isActive ? "model-usage-tooltip" : undefined}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseLeave={() => clearActiveIndex(index)}
                    onFocus={() => setActiveIndex(index)}
                    onBlur={() => clearActiveIndex(index)}
                    className={`${SERIES_STYLES[index % SERIES_STYLES.length].stroke} cursor-pointer outline-none transition-[stroke-width,stroke-dasharray] duration-200`}
                  />
                );
              })}
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              {activeRow ? (
                <div
                  id="model-usage-tooltip"
                  role="tooltip"
                  aria-label={activeLabel}
                  className="pointer-events-none w-24 rounded-lg border border-oai-gray-200 bg-white/95 px-1.5 py-1 shadow-sm dark:border-oai-gray-700 dark:bg-oai-gray-900/95"
                >
                  <strong className="block break-words text-[9px] font-semibold leading-3 text-oai-black dark:text-oai-white">
                    {activeRow.name}
                  </strong>
                  <span className="mt-0.5 block text-[8px] leading-3 tabular-nums text-oai-gray-500 dark:text-oai-gray-400">
                    {activeTokens} · {activePercent}%
                  </span>
                </div>
              ) : (
                <>
                  <span className="text-[10px] text-oai-gray-400 dark:text-oai-gray-500">
                    {copy("dashboard.model_distribution.total")}
                  </span>
                  <strong className="mt-0.5 text-lg font-semibold tabular-nums text-oai-black dark:text-oai-white">
                    {formatTokenCount(totalTokens, { locale })}
                  </strong>
                </>
              )}
            </div>
          </div>

          <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-oai-gray-100 pt-3 dark:border-oai-gray-800">
            <div>
              <h4 className="text-xs font-semibold text-oai-gray-700 dark:text-oai-gray-200">
                {copy("dashboard.model_distribution.radar_title")}
              </h4>
              <p className="mt-0.5 text-[10px] leading-4 text-oai-gray-400 dark:text-oai-gray-500">
                {copy("dashboard.model_distribution.radar_summary", {
                  count: safeRows.length,
                  percent: clampPercent(safeRows[0]?.percent).toLocaleString(locale, {
                    maximumFractionDigits: 1,
                  }),
                })}
              </p>
            </div>
            <div
              className="mt-2 flex min-h-36 max-h-44 flex-1 items-center justify-center overflow-hidden rounded-xl bg-oai-gray-50/70 dark:bg-oai-gray-900/45"
              data-testid="model-radar-panel"
            >
              <svg
                className="h-full min-h-36 w-full"
                role="img"
                aria-label={copy("dashboard.model_distribution.radar_aria")}
                viewBox="0 0 120 155"
              >
                <defs>
                  <linearGradient id="model-radar-fill" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.42" />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.16" />
                  </linearGradient>
                </defs>
                <circle
                  data-testid="model-radar-frame"
                  cx={RADAR_CENTER_X}
                  cy={RADAR_CENTER_Y}
                  r="55"
                  fill="rgba(16, 185, 129, 0.025)"
                  stroke="currentColor"
                  strokeWidth="0.8"
                  strokeDasharray="2 4"
                  className="text-oai-gray-200 dark:text-oai-gray-800"
                />
                {radarGridPolygons.map((points, index) => (
                  <polygon
                    key={points}
                    data-testid="model-radar-grid-ring"
                    points={points}
                    fill={index === 0 ? "rgba(16, 185, 129, 0.025)" : "none"}
                    stroke="currentColor"
                    strokeWidth={index === radarGridPolygons.length - 1 ? "1.35" : "0.85"}
                    className={index === radarGridPolygons.length - 1
                      ? "text-oai-gray-300 dark:text-oai-gray-600"
                      : "text-oai-gray-200 dark:text-oai-gray-800"}
                  />
                ))}
                {radarRows.map((row, index) => {
                  const point = radarPoint(index, RADAR_RADIUS);
                  return (
                    <line
                      key={row.id || row.name}
                      x1={RADAR_CENTER_X}
                      y1={RADAR_CENTER_Y}
                      x2={point.x}
                      y2={point.y}
                      stroke="currentColor"
                      strokeWidth="0.9"
                      strokeDasharray="3 3"
                      className="text-oai-gray-300 dark:text-oai-gray-700"
                    />
                  );
                })}
                {[25, 50, 75, 100].map((value) => {
                  const angle = -Math.PI / 6;
                  const scale = value / 100;
                  return (
                    <text
                      key={value}
                      x={RADAR_CENTER_X + Math.cos(angle) * RADAR_RADIUS * scale + 2}
                      y={RADAR_CENTER_Y + Math.sin(angle) * RADAR_RADIUS * scale + 3}
                      className="fill-oai-gray-400 text-[8px] font-medium tabular-nums dark:fill-oai-gray-600"
                    >
                      {value}
                    </text>
                  );
                })}
                <polygon
                  data-testid="model-radar-value"
                  points={radarValuePoints}
                  fill="url(#model-radar-fill)"
                  className="stroke-oai-brand-500 [filter:drop-shadow(0_2px_3px_rgba(16,185,129,0.22))]"
                  strokeLinejoin="round"
                  strokeWidth="2.5"
                />
                <circle
                  cx={RADAR_CENTER_X}
                  cy={RADAR_CENTER_Y}
                  r="2.5"
                  className="fill-oai-gray-300 dark:fill-oai-gray-600"
                />
                {radarRows.map((row, index) => {
                  const point = radarPoint(
                    index,
                    RADAR_RADIUS * (clampPercent(row.percent) / 100),
                  );
                  const percent = clampPercent(row.percent);
                  const isActive = activeIndex === index;
                  return (
                    <circle
                      key={row.id || row.name}
                      data-testid="model-radar-vertex"
                      data-active={isActive ? "true" : undefined}
                      cx={point.x}
                      cy={point.y}
                      r={isActive ? "5.5" : "4"}
                      tabIndex="0"
                      role="img"
                      aria-label={`${row.name}, ${copy("dashboard.model_distribution.table_tokens")} ${Number(row.tokens).toLocaleString(locale, { maximumFractionDigits: 20 })}, ${copy("dashboard.model_distribution.table_share")} ${percent.toLocaleString(locale, { maximumFractionDigits: 1 })}%`}
                      aria-describedby={isActive ? "model-usage-tooltip" : undefined}
                      onMouseEnter={() => setActiveIndex(index)}
                      onMouseLeave={() => clearActiveIndex(index)}
                      onFocus={() => setActiveIndex(index)}
                      onBlur={() => clearActiveIndex(index)}
                      className={`${SERIES_STYLES[index % SERIES_STYLES.length].fill} cursor-pointer stroke-white outline-none transition-[r] duration-200 dark:stroke-oai-gray-950`}
                      strokeWidth="2"
                    />
                  );
                })}
                {radarRows.map((row, index) => {
                  let point = radarPoint(index, RADAR_LABEL_RADIUS);
                  if (radarRows.length === 3) {
                    const positions = [
                      { x: 60, y: 8 },
                      { x: 113, y: 119 },
                      { x: 7, y: 119 },
                    ];
                    point = positions[index];
                  }
                  const percent = clampPercent(row.percent).toLocaleString(locale, {
                    maximumFractionDigits: 1,
                  });
                  return (
                    <g
                      key={row.id || row.name}
                      data-testid={`model-radar-label-${index}`}
                      aria-label={`${row.name} ${percent}%`}
                    >
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r="8"
                        className={`${SERIES_STYLES[index % SERIES_STYLES.length].fill} stroke-white dark:stroke-oai-gray-950`}
                        strokeWidth="2"
                      />
                      <text
                        x={point.x}
                        y={point.y + 3}
                        textAnchor="middle"
                        className="fill-white text-[8px] font-bold tabular-nums"
                      >
                        {index + 1}
                      </text>
                      <text
                        x={point.x}
                        y={point.y + 19}
                        textAnchor="middle"
                        className="fill-oai-gray-500 text-[10px] font-semibold tabular-nums dark:fill-oai-gray-400"
                      >
                        {percent}%
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        </div>

        <div className="tt-overview-model-table-card flex min-h-0 min-w-0 flex-col" data-testid="model-usage-table">
          <div data-testid="model-usage-table-head" className="grid grid-cols-[30px_minmax(0,1fr)_minmax(72px,.8fr)_42px] gap-2 border-b border-oai-gray-100 px-1 pb-2 text-[9px] text-oai-gray-400 dark:border-oai-gray-800">
            <span>{copy("dashboard.model_distribution.table_rank")}</span><span>{copy("dashboard.model_distribution.table_model")}</span><span className="text-right">{copy("dashboard.model_distribution.table_tokens")}</span><span className="text-right">{copy("dashboard.model_distribution.table_share")}</span>
          </div>
          <ol
            data-testid="model-usage-legend"
            className="m-0 grid h-full min-h-0 min-w-0 flex-1 auto-rows-min list-none divide-y divide-oai-gray-100 overflow-y-auto p-0 pr-1 oai-scrollbar dark:divide-oai-gray-800"
          >
            {safeRows.map(function renderLegendItem(row, index) {
              const percent = clampPercent(row.percent);
              return (
                <li
                  key={row.id || row.name}
                  data-model-rank-row="true"
                  className="grid min-h-11 min-w-0 grid-cols-[30px_minmax(0,1fr)_minmax(72px,.8fr)_42px] content-center items-center gap-x-2 py-1.5 text-[10px]"
                >
                  <span className={`flex h-6 min-w-6 items-center justify-center rounded-md px-1 text-[10px] font-bold tabular-nums ${RANK_STYLES[index] || "bg-oai-gray-100 text-oai-gray-500 dark:bg-oai-gray-800 dark:text-oai-gray-400"}`}>
                    {index + 1}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${SERIES_STYLES[index % SERIES_STYLES.length].dot}`} aria-hidden />
                    <span className="min-w-0 break-words font-medium leading-4 text-oai-gray-700 dark:text-oai-gray-200">{row.name}</span>
                  </span>
                  <span className="min-w-0 whitespace-nowrap text-right tabular-nums text-oai-gray-400 dark:text-oai-gray-500">
                    {formatTokenCount(row.tokens, { locale })}
                  </span>
                  <span className="shrink-0 text-right font-semibold tabular-nums text-oai-gray-700 dark:text-oai-gray-200">{percent.toLocaleString(locale, { maximumFractionDigits: 1 })}%</span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </Card>
  );
}
