import React, { useMemo, useState } from "react";
import { Calendar, ChevronDown } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { copy } from "../../../lib/copy";
import { cn } from "../../../lib/cn";
import { computeRangeFromKey, formatDateLocal } from "../../../lib/date-range";
import { useUsageFilters, useUsageFilterActions } from "../../../hooks/use-usage-filters";
import { DateRangePopover, formatDateShort, getDateFnsLocale } from "./DateRangePopover";
import { getCopyLocale } from "../../../lib/copy";

/**
 * Ticket-02 E: 时间范围选择器。
 *
 * 胶囊触发按钮（Calendar 图标 + 当前选择 + ChevronDown）+ 下拉面板。
 * 面板分两部分：快捷键按钮组（today/1d/7d/14d/30d）+ 自定义区域
 * （嵌入 DateRangePopover 日历）。快捷键点击用 computeRangeFromKey
 * 计算 {from,to} 并派发 setTimeRange；自定义 onApply 派发
 * setTimeRange("custom", from, to)。
 */
const QUICK_KEYS = [
  { key: "total", labelKey: "ticket02.time.total" },
  { key: "today", labelKey: "ticket02.time.today" },
  { key: "1d", labelKey: "ticket02.time.1d" },
  { key: "7d", labelKey: "ticket02.time.7d" },
  { key: "14d", labelKey: "ticket02.time.14d" },
  { key: "30d", labelKey: "ticket02.time.30d" },
];

export function TimeRangePicker({ timeZone, offsetMinutes }) {
  const { state } = useUsageFilters();
  const { setTimeRange } = useUsageFilterActions();
  const [open, setOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(false);

  const triggerLabel = useMemo(() => {
    if (state.timeRange === "custom") {
      if (state.from && state.to) {
        const locale = getDateFnsLocale(getCopyLocale());
        const fromLabel = formatDateShort(state.from, locale);
        const toLabel = formatDateShort(state.to, locale);
        return fromLabel === toLabel ? fromLabel : `${fromLabel} ~ ${toLabel}`;
      }
      return copy("ticket02.time.custom");
    }
    const opt = QUICK_KEYS.find((o) => o.key === state.timeRange);
    return opt ? copy(opt.labelKey) : copy("ticket02.time.total");
  }, [state.timeRange, state.from, state.to]);

  const handleOpenChange = (next) => {
    if (next) {
      setShowCustom(state.timeRange === "custom");
    }
    setOpen(next);
  };

  const handleQuickKey = (key) => {
    const { from, to } = computeRangeFromKey(key, { timeZone, offsetMinutes });
    setTimeRange(key, from, to);
    setOpen(false);
  };

  const handleCustomApply = (fromStr, toStr) => {
    setTimeRange("custom", fromStr, toStr);
    setOpen(false);
  };

  const handleCustomCancel = () => {
    setShowCustom(false);
  };

  const customFrom = state.from || formatDateLocal(new Date());
  const customTo = state.to || formatDateLocal(new Date());

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger
        render={
          <button
            type="button"
            aria-label={copy("ticket02.time.aria")}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-oai-brand-500 bg-white px-3 text-xs font-medium text-oai-gray-700 transition-colors hover:bg-oai-gray-50 dark:border-oai-brand-400 dark:bg-oai-gray-900 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
          />
        }
      >
        <Calendar className="h-3.5 w-3.5 text-oai-brand-500" aria-hidden="true" />
        <span className="max-w-[160px] truncate">{triggerLabel}</span>
        <ChevronDown className="h-3 w-3 text-oai-gray-400" aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} side="bottom" align="end" className="!z-[9999]">
          <Popover.Popup className="rounded-xl border border-oai-gray-200 bg-white p-3 shadow-lg dark:border-oai-gray-700 dark:bg-oai-gray-900">
            <div className="flex flex-wrap items-center gap-1.5">
              {QUICK_KEYS.map((opt) => {
                const selected = state.timeRange === opt.key && !showCustom;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => handleQuickKey(opt.key)}
                    className={cn(
                      "h-7 rounded-md px-2.5 text-xs font-medium transition-colors",
                      selected
                        ? "bg-oai-brand-500 text-white"
                        : "bg-oai-gray-100 text-oai-gray-600 hover:bg-oai-gray-200 dark:bg-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-700",
                    )}
                  >
                    {copy(opt.labelKey)}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setShowCustom(true)}
                className={cn(
                  "h-7 rounded-md px-2.5 text-xs font-medium transition-colors",
                  showCustom || state.timeRange === "custom"
                    ? "bg-oai-brand-500 text-white"
                    : "bg-oai-gray-100 text-oai-gray-600 hover:bg-oai-gray-200 dark:bg-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-700",
                )}
              >
                {copy("ticket02.time.custom")}
              </button>
            </div>

            {showCustom && (
              <div className="mt-3 border-t border-oai-gray-100 pt-3 dark:border-oai-gray-800">
                <DateRangePopover
                  from={customFrom}
                  to={customTo}
                  onApply={handleCustomApply}
                  onCancel={handleCustomCancel}
                />
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
