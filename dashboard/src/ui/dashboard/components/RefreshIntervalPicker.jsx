import React, { useMemo, useState } from "react";
import { RefreshCw, ChevronDown, Check } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { copy } from "../../../lib/copy";
import { cn } from "../../../lib/cn";
import { useUsageFilters, useUsageFilterActions } from "../../../hooks/use-usage-filters";

/**
 * Ticket-02 D: 刷新间隔选择器。
 *
 * 胶囊触发按钮（RefreshCw 图标 + 当前间隔 + ChevronDown）+ 下拉菜单
 * （30s / 1m / 5m / 手动）。点击刷新图标区域触发 onManualRefresh；
 * 间隔标签复用现有 dashboard.refresh.interval.* 文案。最后更新时间用
 * ticket02.refresh.* 文案显示"刚刚 / N 秒前 / N 分钟前"。
 */
const REFRESH_OPTIONS = [
  { value: "30s", labelKey: "dashboard.refresh.interval.30s" },
  { value: "1m", labelKey: "dashboard.refresh.interval.1m" },
  { value: "5m", labelKey: "dashboard.refresh.interval.5m" },
  { value: "manual", labelKey: "dashboard.refresh.interval.manual" },
];

function formatLastUpdatedLabel(lastUpdatedAt) {
  if (!lastUpdatedAt) return null;
  const ts = typeof lastUpdatedAt === "string" ? Date.parse(lastUpdatedAt) : Number(lastUpdatedAt);
  if (!Number.isFinite(ts)) return null;
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return copy("ticket02.refresh.just_now");
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return copy("ticket02.refresh.just_now");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return copy("ticket02.refresh.minutes_ago", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return copy("ticket02.refresh.hours_ago", { count: hours });
  // Beyond 24h the seconds-ago fallback is poor UX, but the refresh interval
  // picker is unmounted when stale and the auto-refresh loop replaces the
  // timestamp on the next tick, so this branch is rarely reached in practice.
  return copy("ticket02.refresh.hours_ago", { count: hours });
}

export function RefreshIntervalPicker({
  onManualRefresh,
  isRefreshing = false,
  lastUpdatedAt = null,
}) {
  const { state } = useUsageFilters();
  const { setRefreshInterval } = useUsageFilterActions();
  const [open, setOpen] = useState(false);

  const currentLabel = useMemo(() => {
    const opt = REFRESH_OPTIONS.find((o) => o.value === state.refreshInterval);
    return opt ? copy(opt.labelKey) : copy(REFRESH_OPTIONS[1].labelKey);
  }, [state.refreshInterval]);

  const lastUpdatedLabel = formatLastUpdatedLabel(lastUpdatedAt);

  const handleSelect = (value) => {
    setRefreshInterval(value);
    setOpen(false);
  };

  const handleIconClick = (e) => {
    e.stopPropagation();
    if (onManualRefresh) onManualRefresh();
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div className="inline-flex h-10 items-center gap-0.5 rounded-full border border-oai-gray-300 bg-white pl-1 pr-2 text-xs font-medium text-oai-gray-700 transition-colors hover:border-oai-gray-400 hover:bg-oai-gray-50 dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800">
        <button
          type="button"
          onClick={handleIconClick}
          aria-label={copy("ticket02.refresh.manual_aria")}
          disabled={isRefreshing}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-oai-gray-500 transition-colors hover:text-oai-brand-500 disabled:opacity-50 dark:text-oai-gray-400 dark:hover:text-oai-brand-300"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} aria-hidden="true" />
        </button>
        <Popover.Trigger
          render={
            <button
              type="button"
              aria-label={copy("ticket02.refresh.aria")}
              className="inline-flex min-h-10 items-center gap-1 rounded-full px-2 text-xs font-medium text-oai-gray-700 transition-colors hover:text-oai-black dark:text-oai-gray-300 dark:hover:text-white"
            />
          }
        >
          <span>{currentLabel}</span>
          <ChevronDown className="h-3 w-3 text-oai-gray-400" aria-hidden="true" />
        </Popover.Trigger>
      </div>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} side="bottom" align="end" className="!z-[9999]">
          <Popover.Popup className="w-40 rounded-xl border border-oai-gray-200 bg-white p-1 shadow-lg dark:border-oai-gray-700 dark:bg-oai-gray-900">
            {REFRESH_OPTIONS.map((opt) => {
              const selected = state.refreshInterval === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleSelect(opt.value)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                    selected
                      ? "bg-oai-gray-100 font-medium text-oai-black dark:bg-oai-gray-800 dark:text-white"
                      : "text-oai-gray-700 hover:bg-oai-gray-100 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
                  )}
                >
                  <span>{copy(opt.labelKey)}</span>
                  {selected && <Check className="h-3 w-3 text-oai-brand-500" aria-hidden="true" />}
                </button>
              );
            })}
            {lastUpdatedLabel && (
              <div className="mt-1 border-t border-oai-gray-100 px-2 pt-1.5 text-[10px] text-oai-gray-400 dark:border-oai-gray-800 dark:text-oai-gray-500">
                {copy("ticket02.refresh.last_updated", { time: lastUpdatedLabel })}
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
