import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCurrency } from "../../../hooks/useCurrency.js";
import { useUsageTrend } from "../../../hooks/use-usage-trend";
import { copy } from "../../../lib/copy";
import { cn } from "../../../lib/cn";
import { formatChineseTokenCount, formatUsdCurrency } from "../../../lib/format";
import { getCurrencySymbol, CURRENCY_USD } from "../../../lib/currency";

// ---------------------------------------------------------------------------
// 维度配置：5 条数据线
// ---------------------------------------------------------------------------
// LEGEND_ORDER：图例自左向右的展示顺序（与工单表格一致）。
// RENDER_ORDER：自底向上的绘制顺序（工单 B3：缓存命中在最上层，成本在最下层）。
//
// axis: "tokens" 映射到左 Y 轴；"cost" 映射到右 Y 轴。
// kind: "solid" 实线 + 面积渐变填充；"dashed" 虚线 + 无填充。
const SERIES_DIMENSIONS = [
  {
    key: "input_tokens",
    labelKey: "usage.trend.chart.legend.input",
    color: "#3b82f6",
    kind: "solid",
    axis: "tokens",
  },
  {
    key: "output_tokens",
    labelKey: "usage.trend.chart.legend.output",
    color: "#10b981",
    kind: "solid",
    axis: "tokens",
  },
  {
    key: "cache_creation_input_tokens",
    labelKey: "usage.trend.chart.legend.cache_creation",
    color: "#f97316",
    kind: "dashed",
    axis: "tokens",
  },
  {
    key: "cached_input_tokens",
    labelKey: "usage.trend.chart.legend.cache_hit",
    color: "#8b5cf6",
    kind: "solid",
    axis: "tokens",
  },
  {
    key: "cost_usd",
    labelKey: "usage.trend.chart.legend.cost",
    color: "#ef4444",
    kind: "dashed",
    axis: "cost",
  },
];

// 自底向上的绘制顺序：成本最底，缓存命中最顶。
const RENDER_ORDER_KEYS = [
  "cost_usd",
  "cache_creation_input_tokens",
  "input_tokens",
  "output_tokens",
  "cached_input_tokens",
];

const DIMENSION_BY_KEY = Object.fromEntries(
  SERIES_DIMENSIONS.map((d) => [d.key, d]),
);

// ---------------------------------------------------------------------------
// 图表布局常量
// ---------------------------------------------------------------------------
const MIN_CHART_HEIGHT = 440;
const PADDING = { top: 16, right: 56, bottom: 36, left: 56 };
const MAX_RENDER_POINTS = 400;
const Y_TICK_COUNT = 4; // 4 段 → 5 条刻度线
const X_TICK_MAX = 7;

// ---------------------------------------------------------------------------
// 纯函数 helpers（导出便于单测）
// ---------------------------------------------------------------------------

/** Tokens 类轴标签：统一使用中文数量单位。 */
export function formatTokenAxis(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "0";
  return formatChineseTokenCount(n);
}

/** 成本类轴标签：跟随用户货币偏好。 */
export function formatCostAxis(value, { currency = CURRENCY_USD, rate = 1 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return `${getCurrencySymbol(currency)}0`;
  }
  return formatUsdCurrency(n, { decimals: n < 1 ? 2 : 0, currency, rate });
}

/** Tooltip 内 Tokens 数值：统一使用中文数量单位。 */
export function formatTooltipToken(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "0";
  return formatChineseTokenCount(n);
}

/** Tooltip 内成本数值：保留 6 位小数（与 CC Switch 口径一致）。 */
export function formatTooltipCost(value, { currency = CURRENCY_USD, rate = 1 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return `${getCurrencySymbol(currency)}0`;
  }
  return formatUsdCurrency(n, { decimals: 6, currency, rate });
}

/**
 * 将 `SpendSeriesEntry[]`（按 bucket × source 拆分）聚合为按时间桶排序的
 * 单一序列：每个桶 5 个维度的合计值。空桶补 0。
 */
export function aggregateSeriesByBucket(series) {
  if (!Array.isArray(series) || series.length === 0) return [];
  const map = new Map();
  const order = [];
  for (const entry of series) {
    if (!entry || !entry.bucket_start) continue;
    let bucket = map.get(entry.bucket_start);
    if (!bucket) {
      bucket = {
        bucket_start: entry.bucket_start,
        label: entry.label || entry.bucket_start,
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cached_input_tokens: 0,
        cost_usd: 0,
      };
      map.set(entry.bucket_start, bucket);
      order.push(entry.bucket_start);
    }
    bucket.input_tokens += toNum(entry.input_tokens);
    bucket.output_tokens += toNum(entry.output_tokens);
    bucket.cache_creation_input_tokens += toNum(entry.cache_creation_input_tokens);
    bucket.cached_input_tokens += toNum(entry.cached_input_tokens);
    bucket.cost_usd += toNum(entry.cost_usd);
  }
  return order.map((key) => map.get(key));
}

/**
 * 数据点过多时按等间距采样降频，保证渲染流畅。返回新数组。
 * 当 buckets.length <= maxPoints 时原样返回（浅拷贝保持引用一致）。
 */
export function downsampleBuckets(buckets, maxPoints = MAX_RENDER_POINTS) {
  if (!Array.isArray(buckets) || buckets.length <= maxPoints) {
    return Array.isArray(buckets) ? buckets.slice() : [];
  }
  const step = Math.ceil(buckets.length / maxPoints);
  const out = [];
  for (let i = 0; i < buckets.length; i += step) {
    out.push(buckets[i]);
  }
  // 始终保留最后一个桶，避免末端被截断。
  if (out[out.length - 1] !== buckets[buckets.length - 1]) {
    out.push(buckets[buckets.length - 1]);
  }
  return out;
}

/**
 * Catmull-Rom 样条转三次贝塞尔，生成平滑的 SVG path。
 * points: [{x, y}]。单点返回空串，两点用直线。
 */
export function buildSmoothPath(points) {
  if (!Array.isArray(points) || points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x},${points[0].y}`;
  if (points.length === 2) {
    return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`;
  }
  const segs = [`M ${points[0].x},${points[0].y}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    segs.push(`C ${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`);
  }
  return segs.join(" ");
}

/** 在 linePath 基础上闭合到 baselineY 形成面积路径。 */
export function buildAreaPath(linePath, firstX, lastX, baselineY) {
  if (!linePath) return "";
  return `${linePath} L ${lastX},${baselineY} L ${firstX},${baselineY} Z`;
}

/** 计算“好看”的坐标轴最大值：1/2/5/10 × 10^n。 */
export function niceAxisMax(maxValue) {
  const n = Number(maxValue);
  if (!Number.isFinite(n) || n <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(n)));
  const normalized = n / magnitude;
  let nice;
  if (normalized <= 1) nice = 1;
  else if (normalized <= 2) nice = 2;
  else if (normalized <= 5) nice = 5;
  else nice = 10;
  return nice * magnitude;
}

/** 返回 [0..max] 之间 count+1 条刻度（含 0 与 max）。 */
export function computeYTicks(maxValue, count = Y_TICK_COUNT) {
  const max = niceAxisMax(maxValue);
  const ticks = [];
  for (let i = 0; i <= count; i++) {
    const value = (max / count) * i;
    ticks.push({ value, ratio: i / count });
  }
  return ticks;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// ---------------------------------------------------------------------------
// 主组件（受控）：接受预取的 series / loading / error
// ---------------------------------------------------------------------------

export function UsageTrendChart({
  series,
  loading = false,
  error = null,
  from,
  to,
  bucket,
  className = "",
  currency: currencyProp,
  rate: rateProp,
  onRetry,
}) {
  const containerRef = useRef(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [hiddenKeys, setHiddenKeys] = useState(() => new Set());
  const [highlightedKey, setHighlightedKey] = useState(null);
  const [hoveredBucket, setHoveredBucket] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const hideTimerRef = useRef(null);
  const { currency: ctxCurrency, rate: ctxRate } = useCurrency();
  const currency = String(currencyProp || ctxCurrency || CURRENCY_USD).toUpperCase();
  const numericRate = Number(rateProp || ctxRate || 1);
  const rate = Number.isFinite(numericRate) && numericRate > 0 ? numericRate : 1;

  // 监听容器宽度（响应式） - 使用回调ref确保即使在StateCard切换后也能observe
  const setContainerRef = useCallback((el) => {
    // Disconnect previous observer if any
    if (containerRef._observer) {
      containerRef._observer.disconnect();
      containerRef._observer = null;
    }
    containerRef.current = el;
    if (el) {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setContainerSize({
            width: entry.contentRect.width,
            height: entry.contentRect.height,
          });
        }
      });
      observer.observe(el);
      containerRef._observer = observer;
      const initialRect = el.getBoundingClientRect();
      setContainerSize({ width: initialRect.width, height: initialRect.height });
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (containerRef._observer) {
        containerRef._observer.disconnect();
      }
    };
  }, []);

  // 聚合 + 降采样
  const buckets = useMemo(
    () => downsampleBuckets(aggregateSeriesByBucket(series)),
    [series],
  );

  const width = containerSize.width || 640;
  const height = Math.max(MIN_CHART_HEIGHT, containerSize.height || MIN_CHART_HEIGHT);
  const chartWidth = Math.max(0, width - PADDING.left - PADDING.right);
  const chartHeight = Math.max(0, height - PADDING.top - PADDING.bottom);
  const baselineY = PADDING.top + chartHeight;

  const numBuckets = buckets.length;
  const scaleX = useCallback(
    (i) => {
      if (numBuckets <= 1) return PADDING.left + chartWidth / 2;
      return PADDING.left + (i / (numBuckets - 1)) * chartWidth;
    },
    [numBuckets, chartWidth],
  );
  const scaleYTokens = useCallback(
    (value, max) => {
      if (max <= 0) return baselineY;
      return baselineY - (value / max) * chartHeight;
    },
    [baselineY, chartHeight],
  );
  const scaleYCost = scaleYTokens; // 同一套线性映射，只是 max 不同

  // 各维度点序列（含 hidden 过滤标记；点本身仍计算，便于 tooltip 显示）
  const pointsByKey = useMemo(() => {
    const out = {};
    for (const dim of SERIES_DIMENSIONS) {
      out[dim.key] = buckets.map((b, i) => ({
        x: scaleX(i),
        y: dim.axis === "tokens" ? b[dim.key] : b[dim.key],
        value: b[dim.key],
        bucket_start: b.bucket_start,
      }));
    }
    return out;
  }, [buckets, scaleX]);

  // 左 Y 轴 max（仅可见的 tokens 维度）
  const maxToken = useMemo(() => {
    let max = 0;
    for (const dim of SERIES_DIMENSIONS) {
      if (dim.axis !== "tokens") continue;
      if (hiddenKeys.has(dim.key)) continue;
      for (const b of buckets) {
        const v = toNum(b[dim.key]);
        if (v > max) max = v;
      }
    }
    return max;
  }, [buckets, hiddenKeys]);

  // 右 Y 轴 max（成本维度）
  const maxCost = useMemo(() => {
    if (hiddenKeys.has("cost_usd")) return 0;
    let max = 0;
    for (const b of buckets) {
      const v = toNum(b.cost_usd);
      if (v > max) max = v;
    }
    return max;
  }, [buckets, hiddenKeys]);

  const niceMaxToken = useMemo(() => niceAxisMax(maxToken), [maxToken]);
  const niceMaxCost = useMemo(() => niceAxisMax(maxCost), [maxCost]);

  const yTicksTokens = useMemo(() => computeYTicks(maxToken), [maxToken]);
  const yTicksCost = useMemo(() => computeYTicks(maxCost), [maxCost]);

  // X 轴疏密：最多 X_TICK_MAX 条刻度，始终包含末桶
  const xTicks = useMemo(() => {
    if (numBuckets === 0) return [];
    const step = Math.max(1, Math.ceil(numBuckets / X_TICK_MAX));
    const ticks = [];
    for (let i = 0; i < numBuckets; i += step) {
      ticks.push({ index: i, x: scaleX(i), label: buckets[i].label });
    }
    const lastIdx = numBuckets - 1;
    if (ticks[ticks.length - 1]?.index !== lastIdx) {
      ticks.push({ index: lastIdx, x: scaleX(lastIdx), label: buckets[lastIdx].label });
    }
    return ticks;
  }, [buckets, numBuckets, scaleX]);

  // 鼠标交互
  const handleBucketEnter = useCallback((e, bucketStart) => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHoveredBucket(bucketStart);
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  const handleBucketLeave = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setHoveredBucket(null), 120);
  }, []);

  const toggleHidden = useCallback((key) => {
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const hoveredBucketData = useMemo(() => {
    if (!hoveredBucket) return null;
    const idx = buckets.findIndex((b) => b.bucket_start === hoveredBucket);
    if (idx < 0) return null;
    return { bucket: buckets[idx], x: scaleX(idx) };
  }, [hoveredBucket, buckets, scaleX]);

  // 渲染顺序（自底向上）
  const renderDims = useMemo(
    () =>
      RENDER_ORDER_KEYS
        .map((k) => DIMENSION_BY_KEY[k])
        .filter((d) => d && !hiddenKeys.has(d.key)),
    [hiddenKeys],
  );

  // ---- 状态分支 ----
  if (loading && numBuckets === 0) {
    return <StateCard className={className} state="loading" />;
  }
  if (error) {
    return <StateCard className={className} state="error" onRetry={onRetry} />;
  }
  if (numBuckets === 0) {
    return <StateCard className={className} state="empty" />;
  }

  const rangeLabel = from && to ? (from === to ? from : `${from} – ${to}`) : null;

  return (
    <div
      className={cn(
        "relative flex h-full min-w-0 flex-col rounded-xl border border-oai-gray-200 dark:border-oai-gray-800 bg-white dark:bg-oai-gray-900 p-4",
        className,
      )}
    >
      {/* 标题栏 */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-oai-gray-700 dark:text-oai-gray-300 uppercase tracking-wide">
          {copy("usage.trend.chart.title")}
        </h3>
        {rangeLabel && (
          <span className="text-xs text-oai-gray-400 dark:text-oai-gray-500 tabular-nums">
            {rangeLabel}
          </span>
        )}
      </div>

      {/* 图表 */}
      <div ref={setContainerRef} data-testid="usage-trend-plot" className="relative min-h-[440px] min-w-0 flex-1">
        <svg
          width={width}
          height={height}
          className="select-none"
          role="img"
          aria-label={copy("usage.trend.chart.aria.label")}
        >
          <defs>
            {/* 实线维度的面积渐变 */}
            {SERIES_DIMENSIONS.filter((d) => d.kind === "solid").map((d) => (
              <linearGradient
                key={d.key}
                id={`area-grad-${d.key}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={d.color} stopOpacity="0.3" />
                <stop offset="100%" stopColor={d.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>

          {/* 横向网格线（仅左轴刻度位置） */}
          {yTicksTokens.map((tick, i) => {
            const y = PADDING.top + chartHeight - tick.ratio * chartHeight;
            return (
              <line
                key={`grid-${i}`}
                x1={PADDING.left}
                y1={y}
                x2={PADDING.left + chartWidth}
                y2={y}
                className="stroke-oai-gray-100 dark:stroke-oai-gray-800"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
            );
          })}

          {/* 左 Y 轴线 */}
          <line
            x1={PADDING.left}
            y1={PADDING.top}
            x2={PADDING.left}
            y2={baselineY}
            className="stroke-oai-gray-200 dark:stroke-oai-gray-700"
            strokeWidth="1"
          />
          {/* 右 Y 轴线 */}
          <line
            x1={PADDING.left + chartWidth}
            y1={PADDING.top}
            x2={PADDING.left + chartWidth}
            y2={baselineY}
            className="stroke-oai-gray-200 dark:stroke-oai-gray-700"
            strokeWidth="1"
          />
          {/* X 轴线 */}
          <line
            x1={PADDING.left}
            y1={baselineY}
            x2={PADDING.left + chartWidth}
            y2={baselineY}
            className="stroke-oai-gray-200 dark:stroke-oai-gray-700"
            strokeWidth="1"
          />

          {/* 左 Y 轴刻度（Tokens） */}
          {yTicksTokens.map((tick, i) => {
            const y = PADDING.top + chartHeight - tick.ratio * chartHeight;
            return (
              <text
                key={`yt-${i}`}
                x={PADDING.left - 8}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-oai-gray-400 dark:fill-oai-gray-500 text-[10px] font-medium tabular-nums"
              >
                {formatTokenAxis(tick.value)}
              </text>
            );
          })}
          {/* 右 Y 轴刻度（成本） */}
          {yTicksCost.map((tick, i) => {
            const y = PADDING.top + chartHeight - tick.ratio * chartHeight;
            return (
              <text
                key={`yc-${i}`}
                x={PADDING.left + chartWidth + 8}
                y={y}
                textAnchor="start"
                dominantBaseline="middle"
                className="fill-oai-gray-400 dark:fill-oai-gray-500 text-[10px] font-medium tabular-nums"
              >
                {formatCostAxis(tick.value, { currency, rate })}
              </text>
            );
          })}

          {/* X 轴刻度 */}
          {xTicks.map((tick, i) => (
            <text
              key={`xt-${i}`}
              x={tick.x}
              y={baselineY + 16}
              textAnchor="middle"
              className="fill-oai-gray-400 dark:fill-oai-gray-500 text-[10px] font-medium tabular-nums"
            >
              {tick.label}
            </text>
          ))}

          {/* 面积填充（仅实线维度，自底向上） */}
          {renderDims
            .filter((d) => d.kind === "solid")
            .map((d) => {
              const pts = pointsByKey[d.key];
              if (!pts || pts.length < 2) return null;
              const mapped = pts.map((p) => ({
                x: p.x,
                y: d.axis === "tokens"
                  ? scaleYTokens(p.value, niceMaxToken)
                  : scaleYCost(p.value, niceMaxCost),
              }));
              const linePath = buildSmoothPath(mapped);
              const areaPath = buildAreaPath(
                linePath,
                mapped[0].x,
                mapped[mapped.length - 1].x,
                baselineY,
              );
              return (
                <path
                  key={`area-${d.key}`}
                  d={areaPath}
                  fill={`url(#area-grad-${d.key})`}
                  stroke="none"
                  opacity={highlightedKey && highlightedKey !== d.key ? 0.5 : 1}
                />
              );
            })}

          {/* 线条 */}
          {renderDims.map((d) => {
            const pts = pointsByKey[d.key];
            if (!pts || pts.length < 1) return null;
            const dimMax = d.axis === "tokens" ? niceMaxToken : niceMaxCost;
            const mapped = pts.map((p) => ({
              x: p.x,
              y: d.axis === "tokens"
                ? scaleYTokens(p.value, dimMax)
                : scaleYCost(p.value, dimMax),
            }));
            const path = buildSmoothPath(mapped);
            const isHighlighted = highlightedKey === d.key;
            const dimmed = highlightedKey && !isHighlighted;
            return (
              <path
                key={`line-${d.key}`}
                d={path}
                fill="none"
                stroke={d.color}
                strokeWidth={isHighlighted ? 3 : 2}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={d.kind === "dashed" ? "5 4" : undefined}
                opacity={dimmed ? 0.4 : 1}
                style={{ transition: "opacity 150ms ease, stroke-width 150ms ease" }}
              />
            );
          })}

          {/* 单桶场景：buildSmoothPath 对单点仅返回 "M x,y"（SVG 不可见），
              因此显式绘制每个维度的数据点，确保 F3.2「单条数据正常显示点」。
              hover 时由下方的 hover dots 接管，避免重复绘制。 */}
          {numBuckets === 1 && !hoveredBucketData &&
            renderDims.map((d) => {
              const val = toNum(buckets[0][d.key]);
              const dimMax = d.axis === "tokens" ? niceMaxToken : niceMaxCost;
              const y = d.axis === "tokens"
                ? scaleYTokens(val, dimMax)
                : scaleYCost(val, dimMax);
              return (
                <circle
                  key={`point-${d.key}`}
                  cx={scaleX(0)}
                  cy={y}
                  r="3.5"
                  fill={d.color}
                  stroke="white"
                  strokeWidth="1.5"
                />
              );
            })}

          {/* 垂直辅助线 + 数据点（hover 时） */}
          {hoveredBucketData && (
            <>
              <line
                x1={hoveredBucketData.x}
                y1={PADDING.top}
                x2={hoveredBucketData.x}
                y2={baselineY}
                className="stroke-oai-gray-300 dark:stroke-oai-gray-600"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              {renderDims.map((d) => {
                const val = hoveredBucketData.bucket[d.key];
                const dimMax = d.axis === "tokens" ? niceMaxToken : niceMaxCost;
                const y = d.axis === "tokens"
                  ? scaleYTokens(val, dimMax)
                  : scaleYCost(val, dimMax);
                return (
                  <circle
                    key={`dot-${d.key}`}
                    cx={hoveredBucketData.x}
                    cy={y}
                    r="3.5"
                    fill={d.color}
                    stroke="white"
                    strokeWidth="1.5"
                  />
                );
              })}
            </>
          )}

          {/* hover 命中区 */}
          {buckets.map((b, i) => {
            const x = scaleX(i);
            const halfStep = numBuckets > 1 ? chartWidth / (numBuckets - 1) / 2 : chartWidth / 2;
            return (
              <rect
                key={`hit-${b.bucket_start}`}
                x={x - halfStep}
                y={PADDING.top}
                width={halfStep * 2}
                height={chartHeight}
                fill="transparent"
                onMouseEnter={(e) => handleBucketEnter(e, b.bucket_start)}
                onMouseMove={(e) => handleBucketEnter(e, b.bucket_start)}
                onMouseLeave={handleBucketLeave}
                onFocus={() => setHoveredBucket(b.bucket_start)}
                onBlur={handleBucketLeave}
                tabIndex={0}
                role="button"
                aria-label={b.label}
              />
            );
          })}
        </svg>

        {/* Tooltip（HTML 覆盖层，文字渲染更清晰） */}
        {hoveredBucketData && (
          <Tooltip
            bucket={hoveredBucketData.bucket}
            x={tooltipPos.x}
            chartWidth={width}
            currency={currency}
            rate={rate}
            hiddenKeys={hiddenKeys}
          />
        )}
      </div>

      {/* 底部图例 */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
        {SERIES_DIMENSIONS.map((d) => {
          const isHidden = hiddenKeys.has(d.key);
          return (
            <button
              key={d.key}
              type="button"
              onClick={() => toggleHidden(d.key)}
              onMouseEnter={() => setHighlightedKey(d.key)}
              onMouseLeave={() => setHighlightedKey(null)}
              onFocus={() => setHighlightedKey(d.key)}
              onBlur={() => setHighlightedKey(null)}
              aria-pressed={!isHidden}
              aria-label={copy("usage.trend.chart.legend.toggle_aria", {
                name: copy(d.labelKey),
              })}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs transition-opacity",
                isHidden
                  ? "opacity-40"
                  : "opacity-100 hover:bg-oai-gray-100 dark:hover:bg-oai-gray-800",
              )}
            >
              {/* 线型指示：实线 / 虚线 */}
              <svg width="18" height="8" aria-hidden="true" className="shrink-0">
                <line
                  x1="0"
                  y1="4"
                  x2="18"
                  y2="4"
                  stroke={d.color}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeDasharray={d.kind === "dashed" ? "4 3" : undefined}
                />
              </svg>
              <span
                className={cn(
                  "font-medium tabular-nums",
                  isHidden
                    ? "text-oai-gray-400 dark:text-oai-gray-600 line-through"
                    : "text-oai-gray-700 dark:text-oai-gray-300",
                )}
              >
                {copy(d.labelKey)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------
function Tooltip({ bucket, x, chartWidth, currency, rate, hiddenKeys }) {
  // 横向防溢出：靠近边缘时反向偏移
  const TOOLTIP_W = 200;
  const half = TOOLTIP_W / 2;
  let left = x;
  if (x < half) left = half;
  else if (x > chartWidth - half) left = chartWidth - half;

  const rows = SERIES_DIMENSIONS.filter((d) => !hiddenKeys.has(d.key));
  const isCostRow = (d) => d.axis === "cost";

  return (
    <div
      className="pointer-events-none absolute z-50"
      data-testid="usage-trend-tooltip"
      style={{ left: `${left}px`, top: 0, transform: "translateX(-50%)" }}
    >
      <div className="backdrop-blur-md bg-white/95 dark:bg-oai-gray-900/95 border border-oai-gray-200/60 dark:border-oai-gray-800/60 shadow-xl rounded-lg p-3 min-w-[180px] max-w-[220px] flex flex-col gap-1.5">
        <div className="border-b border-oai-gray-100 dark:border-oai-gray-800 pb-1">
          <span className="text-[11px] font-semibold text-oai-gray-700 dark:text-oai-gray-200 tabular-nums">
            {bucket.label}
          </span>
        </div>
        {rows.map((d) => {
          const val = toNum(bucket[d.key]);
          return (
            <div key={d.key} className="flex items-center justify-between gap-3 text-[11px]">
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <span
                  aria-hidden="true"
                  className="inline-block w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: d.color }}
                />
                <span className="text-oai-gray-600 dark:text-oai-gray-300 truncate">
                  {copy(d.labelKey)}
                </span>
              </span>
              <span className="font-medium text-oai-gray-900 dark:text-oai-gray-100 tabular-nums shrink-0">
                {isCostRow(d)
                  ? formatTooltipCost(val, { currency, rate })
                  : formatTooltipToken(val)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 状态卡片（loading / error / empty）
// ---------------------------------------------------------------------------
function StateCard({ className, state, onRetry }) {
  const copyKey =
    state === "loading"
      ? "usage.trend.chart.loading"
      : state === "error"
        ? "usage.trend.chart.error"
        : "usage.trend.chart.empty";
  return (
    <div
      className={cn(
        "rounded-xl border border-oai-gray-200 dark:border-oai-gray-800 bg-white dark:bg-oai-gray-900 p-4",
        className,
      )}
    >
      <div className="mb-3">
        <h3 className="text-sm font-medium text-oai-gray-700 dark:text-oai-gray-300 uppercase tracking-wide">
          {copy("usage.trend.chart.title")}
        </h3>
      </div>
      <div className="h-[320px] flex flex-col items-center justify-center gap-3">
        {state === "loading" && <Spinner />}
        <span
          className={cn(
            "text-sm",
            state === "error"
              ? "text-red-500 dark:text-red-400"
              : "text-oai-gray-400 dark:text-oai-gray-500",
          )}
        >
          {copy(copyKey)}
        </span>
        {state === "error" && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-8 items-center rounded-md border border-oai-gray-300 dark:border-oai-gray-700 bg-white dark:bg-oai-gray-900 px-3 text-xs font-medium text-oai-gray-700 dark:text-oai-gray-300 hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800 transition-colors"
          >
            {copy("usage.trend.chart.retry")}
          </button>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-5 w-5 rounded-full border-2 border-oai-gray-200 dark:border-oai-gray-700 border-t-oai-brand animate-spin"
    />
  );
}

// ---------------------------------------------------------------------------
// 容器组件：直接对接工单1的 useUsageTrend Hook
// ---------------------------------------------------------------------------
// 适用于已挂载 UsageFiltersProvider 的应用内场景。父组件只需提供 from/to +
// 鉴权参数；sources / models / agentIds 过滤由 Hook 自身从 filter context 读取。
export function UsageTrendChartCard({
  from,
  to,
  accessToken = null,
  baseUrl,
  guestAllowed = true,
  cacheKey,
  timeZone,
  tzOffsetMinutes,
  className,
  onRetry,
  allowedSources,
}) {
  const { trend, loading, error, refresh } = useUsageTrend({
    baseUrl,
    accessToken,
    guestAllowed,
    from,
    to,
    cacheKey,
    timeZone,
    tzOffsetMinutes,
    allowedSources,
  });
  const series = trend?.series ?? [];
  const bucket = trend?.bucket ?? "day";
  const handleRetry = onRetry || refresh;
  return (
    <UsageTrendChart
      series={series}
      loading={loading}
      error={error}
      from={from}
      to={to}
      bucket={bucket}
      className={className}
      onRetry={handleRetry}
    />
  );
}
