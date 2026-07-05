import React, { useMemo, useState, useCallback, useRef } from "react";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import { useCurrency } from "../../hooks/useCurrency.js";
import { getCurrencySymbol } from "../../lib/currency";

const SOURCE_COLORS = [
  "#f472b6", // pink
  "#38bdf8", // sky blue
  "#34d399", // emerald
  "#fbbf24", // amber
  "#a78bfa", // violet
  "#fb7185", // rose
  "#2dd4bf", // teal
  "#f97316", // orange
  "#6366f1", // indigo
  "#ec4899", // fuchsia
  "#14b8a6", // mint
  "#f59e0b", // yellow
];

const PROVIDER_COLOR_MAP = {
  codex: "#3b82f6",
  openai: "#10b981",
  gpt: "#10b981",
  claude: "#d97757",
  anthropic: "#d97757",
  gemini: "#2196f3",
  google: "#2196f3",
  kimi: "#a78bfa",
  moonshot: "#a78bfa",
  opencode: "#f59e0b",
  deepseek: "#f59e0b",
  kilo: "#facc15",
};

export function getSourceColor(source) {
  const normalized = String(source || "").toLowerCase().trim();
  for (const [key, color] of Object.entries(PROVIDER_COLOR_MAP)) {
    if (normalized.includes(key)) return color;
  }
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = normalized.charCodeAt(i) + ((hash << 5) - hash);
  }
  return SOURCE_COLORS[Math.abs(hash) % SOURCE_COLORS.length];
}

export function formatSpendValue(value, currency) {
  if (value == null) return "-";
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return String(value);
  const symbol = getCurrencySymbol(currency);
  const formatted = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numberValue);
  return `${symbol}${formatted}`;
}

const PADDING = { top: 16, right: 16, bottom: 40, left: 56 };

function buildChartLayout(width, height) {
  const chartWidth = Math.max(0, width - PADDING.left - PADDING.right);
  const chartHeight = Math.max(0, height - PADDING.top - PADDING.bottom);
  return { chartWidth, chartHeight };
}

function scaleX(bucketIndex, numBuckets, chartWidth) {
  if (numBuckets <= 1) return PADDING.left + chartWidth / 2;
  return PADDING.left + (bucketIndex / (numBuckets - 1)) * chartWidth;
}

function scaleY(value, maxValue, chartHeight) {
  if (maxValue <= 0) return PADDING.top + chartHeight;
  return PADDING.top + chartHeight - (value / maxValue) * chartHeight;
}

export function SpendTrendChart({
  series = [],
  sources = [],
  currency: currencyProp,
  rate: rateProp,
  bucket = "day",
  from,
  to,
  loading = false,
  error = null,
  className = "",
}) {
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [hoveredBucket, setHoveredBucket] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const hideTimeoutRef = useRef(null);
  const { currency: contextCurrency, rate: contextRate } = useCurrency();
  const currency = String(currencyProp || contextCurrency || "USD").toUpperCase();
  const numericRate = Number(rateProp || contextRate || 1);
  const rate = Number.isFinite(numericRate) && numericRate > 0 ? numericRate : 1;

  const pickDisplayCost = useCallback((item, usdKey, cnyKey) => {
    const rawValue = currency === "CNY" ? item?.[cnyKey] : item?.[usdKey];
    const numberValue = Number(rawValue || 0);
    if (!Number.isFinite(numberValue)) return 0;
    if (currency === "USD" || currency === "CNY") return numberValue;
    return numberValue * rate;
  }, [currency, rate]);

  // Observe container width
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Get unique buckets in order
  const buckets = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const item of series) {
      if (!seen.has(item.bucket_start)) {
        seen.add(item.bucket_start);
        result.push({ bucket_start: item.bucket_start, label: item.label });
      }
    }
    return result;
  }, [series]);

  const numBuckets = buckets.length;
  const width = containerWidth || 600;
  const height = 280;
  const { chartWidth, chartHeight } = buildChartLayout(width, height);

  // Compute max value across all sources for y-axis scaling
  const maxValue = useMemo(() => {
    if (!series.length) return 0;
    let max = 0;
    for (const item of series) {
      const val = pickDisplayCost(item, "combined_usd", "combined_cny");
      if (val > max) max = val;
    }
    return max || 1;
  }, [series, pickDisplayCost]);

  // Group series by source
  const seriesBySource = useMemo(() => {
    const map = new Map();
    for (const source of sources) {
      map.set(source, []);
    }
    for (const item of series) {
      if (map.has(item.source)) {
        map.get(item.source).push(item);
      }
    }
    return map;
  }, [series, sources]);

  // Build line path for a source
  const getLinePath = useCallback((sourceSeries) => {
    if (!sourceSeries.length || numBuckets <= 1) return "";
    const points = [];
    for (let i = 0; i < sourceSeries.length; i++) {
      const item = sourceSeries[i];
      const bucketIdx = buckets.findIndex((b) => b.bucket_start === item.bucket_start);
      if (bucketIdx < 0) continue;
      const val = pickDisplayCost(item, "combined_usd", "combined_cny");
      const x = scaleX(bucketIdx, numBuckets, chartWidth);
      const y = scaleY(val, maxValue, chartHeight);
      points.push(`${x},${y}`);
    }
    return `M ${points.join(" L ")}`;
  }, [buckets, numBuckets, chartWidth, chartHeight, maxValue, pickDisplayCost]);

  // Y-axis ticks
  const yTicks = useMemo(() => {
    const count = 5;
    const ticks = [];
    for (let i = 0; i <= count; i++) {
      const value = (maxValue / count) * i;
      ticks.push({
        value,
        y: scaleY(value, maxValue, chartHeight),
        label: formatSpendValue(value, currency),
      });
    }
    return ticks;
  }, [maxValue, chartHeight, currency]);

  // X-axis ticks (show every N buckets to avoid crowding)
  const xTicks = useMemo(() => {
    if (!buckets.length) return [];
    const maxTicks = Math.min(8, buckets.length);
    const step = Math.max(1, Math.floor(buckets.length / maxTicks));
    const ticks = [];
    for (let i = 0; i < buckets.length; i += step) {
      ticks.push({
        index: i,
        x: scaleX(i, numBuckets, chartWidth),
        label: buckets[i].label,
      });
    }
    // Always show last
    if (buckets.length > 1 && ticks[ticks.length - 1]?.index !== buckets.length - 1) {
      ticks.push({
        index: buckets.length - 1,
        x: scaleX(buckets.length - 1, numBuckets, chartWidth),
        label: buckets[buckets.length - 1].label,
      });
    }
    return ticks;
  }, [buckets, numBuckets, chartWidth]);

  const handleMouseEnter = useCallback((e, bucketStart) => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHoveredBucket(bucketStart);
    setTooltipPos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  }, []);

  const handleMouseLeave = useCallback(() => {
    hideTimeoutRef.current = setTimeout(() => {
      setHoveredBucket(null);
    }, 150);
  }, []);

  const handleKeyDown = useCallback((e, bucketStart) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setHoveredBucket((prev) => (prev === bucketStart ? null : bucketStart));
    }
  }, []);

  // Tooltip data
  const tooltipData = useMemo(() => {
    if (!hoveredBucket) return null;
    const items = series.filter((s) => s.bucket_start === hoveredBucket);
    const bucketLabel = buckets.find((b) => b.bucket_start === hoveredBucket)?.label || hoveredBucket;
    return { bucketStart: hoveredBucket, bucketLabel, items };
  }, [hoveredBucket, buckets, series]);

  const svgContent = (
    <svg
      width={width}
      height={height}
      className="select-none"
      role="img"
      aria-label={copy("spend.trend.title")}
    >
      {/* Background */}
      <rect x={PADDING.left} y={PADDING.top} width={chartWidth} height={chartHeight}
        className="fill-transparent" />

      {/* Grid lines */}
      {yTicks.map((tick, i) => (
        <line
          key={i}
          x1={PADDING.left}
          y1={tick.y}
          x2={PADDING.left + chartWidth}
          y2={tick.y}
          className="stroke-oai-gray-100 dark:stroke-oai-gray-800"
          strokeWidth="1"
        />
      ))}

      {/* Y-axis */}
      <line
        x1={PADDING.left}
        y1={PADDING.top}
        x2={PADDING.left}
        y2={PADDING.top + chartHeight}
        className="stroke-oai-gray-200 dark:stroke-oai-gray-700"
        strokeWidth="1"
      />

      {/* X-axis */}
      <line
        x1={PADDING.left}
        y1={PADDING.top + chartHeight}
        x2={PADDING.left + chartWidth}
        y2={PADDING.top + chartHeight}
        className="stroke-oai-gray-200 dark:stroke-oai-gray-700"
        strokeWidth="1"
      />

      {/* Y-axis labels */}
      {yTicks.map((tick, i) => (
        <text
          key={i}
          x={PADDING.left - 8}
          y={tick.y}
          textAnchor="end"
          dominantBaseline="middle"
          className="fill-oai-gray-400 dark:fill-oai-gray-500 text-[10px] font-medium"
        >
          {tick.label}
        </text>
      ))}

      {/* X-axis labels */}
      {xTicks.map((tick, i) => (
        <text
          key={i}
          x={tick.x}
          y={PADDING.top + chartHeight + 16}
          textAnchor="middle"
          className="fill-oai-gray-400 dark:fill-oai-gray-500 text-[10px] font-medium"
        >
          {tick.label}
        </text>
      ))}

      {/* Lines */}
      {sources.map((source) => {
        const sourceSeries = seriesBySource.get(source) || [];
        if (!sourceSeries.length) return null;
        const color = getSourceColor(source);
        const path = getLinePath(sourceSeries);
        if (!path) return null;
        return (
          <path
            key={source}
            d={path}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        );
      })}

      {/* Hover hit areas */}
      {buckets.map((bucket, idx) => {
        const x = scaleX(idx, numBuckets, chartWidth);
        return (
          <rect
            key={bucket.bucket_start}
            x={x - chartWidth / Math.max(numBuckets - 1, 1) / 2}
            y={PADDING.top}
            width={chartWidth / Math.max(numBuckets - 1, 1)}
            height={chartHeight}
            fill="transparent"
            onMouseEnter={(e) => handleMouseEnter(e, bucket.bucket_start)}
            onMouseLeave={handleMouseLeave}
            onFocus={() => setHoveredBucket(bucket.bucket_start)}
            onBlur={() => setHoveredBucket(null)}
            onKeyDown={(e) => handleKeyDown(e, bucket.bucket_start)}
            tabIndex={0}
            role="button"
            aria-label={bucket.label}
          />
        );
      })}

      {/* Data points */}
      {sources.map((source) => {
        const sourceSeries = seriesBySource.get(source) || [];
        const color = getSourceColor(source);
        return sourceSeries.map((item) => {
          const bucketIdx = buckets.findIndex((b) => b.bucket_start === item.bucket_start);
          if (bucketIdx < 0) return null;
          const val = pickDisplayCost(item, "combined_usd", "combined_cny");
          const x = scaleX(bucketIdx, numBuckets, chartWidth);
          const y = scaleY(val, maxValue, chartHeight);
          return (
            <circle
              key={`${source}-${item.bucket_start}`}
              cx={x}
              cy={y}
              r="3"
              fill={color}
              stroke="white"
              strokeWidth="1.5"
            />
          );
        });
      })}
    </svg>
  );

  if (loading) {
    return (
      <div className={cn("rounded-lg border border-oai-gray-200 dark:border-oai-gray-800 bg-white dark:bg-oai-gray-900 p-4", className)}>
        <div className="h-64 flex items-center justify-center">
          <span className="text-sm text-oai-gray-400 dark:text-oai-gray-400">{copy("spend.trend.loading")}</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("rounded-lg border border-oai-gray-200 dark:border-oai-gray-800 bg-white dark:bg-oai-gray-900 p-4", className)}>
        <div className="h-64 flex items-center justify-center">
          <span className="text-sm text-red-500 dark:text-red-400">{copy("spend.trend.error")}</span>
        </div>
      </div>
    );
  }

  if (!series.length || !sources.length) {
    return (
      <div className={cn("rounded-lg border border-oai-gray-200 dark:border-oai-gray-800 bg-white dark:bg-oai-gray-900 p-4", className)}>
        <div className="h-64 flex items-center justify-center">
          <span className="text-sm text-oai-gray-400 dark:text-oai-gray-400">{copy("spend.trend.empty")}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative rounded-lg border border-oai-gray-200 dark:border-oai-gray-800 bg-white dark:bg-oai-gray-900 p-4",
        className,
      )}
    >
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-oai-gray-700 dark:text-oai-gray-300 uppercase tracking-wide">
            {copy("spend.trend.title")}
          </h3>
          {from && to && (
            <p className="text-xs text-oai-gray-400 dark:text-oai-gray-400 mt-0.5">
              {from === to ? from : `${from} – ${to}`}
            </p>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3">
        {sources.map((source) => (
          <div key={source} className="flex items-center gap-1.5">
            <div
              className="w-3 h-3 rounded-sm shrink-0"
              style={{ backgroundColor: getSourceColor(source) }}
            />
            <span className="text-xs text-oai-gray-600 dark:text-oai-gray-400 capitalize">
              {source}
            </span>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="relative" style={{ minHeight: height }}>
        {svgContent}

        {/* Tooltip */}
        {tooltipData && (
          <div
            className="absolute z-50 pointer-events-none"
            style={{
              left: `${tooltipPos.x}px`,
              top: `${tooltipPos.y}px`,
            }}
          >
            <div
              className={cn(
                "absolute left-0 backdrop-blur-md bg-white/95 dark:bg-oai-gray-900/95 border border-oai-gray-200/50 dark:border-oai-gray-800/50 shadow-xl rounded-xl p-3.5 max-w-[280px] min-w-[180px] flex flex-col gap-2",
                "animate-in fade-in zoom-in-95 duration-100",
              )}
              style={{
                transform: `translateX(-50%) translateY(${tooltipPos.y > height / 2 ? 'calc(-100% - 12px)' : '12px'})`,
              }}
            >
              <div className="border-b border-oai-gray-100 dark:border-oai-gray-800/80 pb-1.5">
                <span className="text-[11px] font-semibold text-oai-gray-500 dark:text-oai-gray-400">
                  {tooltipData.bucketLabel}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {tooltipData.items.map((item) => {
                  const apiCost = pickDisplayCost(item, "api_cost_usd", "api_cost_cny");
                  const subCost = pickDisplayCost(item, "subscription_cost_usd", "subscription_cost_cny");
                  const combined = pickDisplayCost(item, "combined_usd", "combined_cny");
                  const color = getSourceColor(item.source);
                  return (
                    <div key={item.source} className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: color }} />
                        <span className="text-[11px] font-medium text-oai-gray-750 dark:text-oai-gray-200 capitalize">
                          {item.source}
                        </span>
                      </div>
                      <div className="pl-3.5 flex flex-col gap-0.5 text-[10px] text-oai-gray-500 dark:text-oai-gray-400">
                        <div className="flex justify-between gap-3">
                          <span>{copy("spend.trend.tooltip.api")}</span>
                          <span className="font-medium text-oai-gray-700 dark:text-oai-gray-200 tabular-nums">
                            {formatSpendValue(apiCost || 0, currency)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>{copy("spend.trend.tooltip.subscription")}</span>
                          <span className="font-medium text-oai-gray-700 dark:text-oai-gray-200 tabular-nums">
                            {formatSpendValue(subCost || 0, currency)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3 border-t border-oai-gray-100 dark:border-oai-gray-800/60 pt-0.5 mt-0.5">
                          <span className="font-medium">{copy("spend.trend.tooltip.combined")}</span>
                          <span className="font-semibold text-oai-gray-900 dark:text-oai-gray-100 tabular-nums">
                            {formatSpendValue(combined || 0, currency)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
