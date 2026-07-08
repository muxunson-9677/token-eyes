import React from "react";
import { copy } from "../../../lib/copy";
import { cn } from "../../../lib/cn";
import { AgentSwitcher } from "./AgentSwitcher";
import { SourceFilter } from "./SourceFilter";
import { ModelFilter } from "./ModelFilter";
import { RefreshIntervalPicker } from "./RefreshIntervalPicker";
import { TimeRangePicker } from "./TimeRangePicker";

/**
 * Ticket-02 H: 顶部筛选栏整体布局。
 *
 * 横向容器，从左到右依次排列：Agent 切换图标组 → 来源筛选 → 模型筛选
 * → 刷新间隔选择器 → 时间范围选择器。窄屏自动换行（flex-wrap）。
 *
 * 各子组件自行从 useUsageFilters 读取/派发状态，本容器仅负责布局与
 * 将 SpendPage 提供的 options / 回调透传给对应子组件。
 *
 * Ticket-07 Task 2: 接收 visibleProviderIds 并传递给 AgentSwitcher。
 */
export function UsageFilterBar({
  sourceOptions = [],
  modelsBySource = {},
  onManualRefresh,
  isRefreshing = false,
  lastUpdatedAt = null,
  timeZone,
  offsetMinutes,
  visibleProviderIds = [],
  className,
}) {
  return (
    <div
      role="toolbar"
      aria-label={copy("ticket02.agent.aria")}
      className={cn(
        "flex flex-wrap items-center justify-end gap-2 rounded-xl border border-oai-gray-200 bg-white p-2 dark:border-oai-gray-800 dark:bg-oai-gray-900",
        className,
      )}
    >
      <AgentSwitcher visibleProviderIds={visibleProviderIds} />
      <SourceFilter options={sourceOptions} />
      <ModelFilter options={modelsBySource} />
      <RefreshIntervalPicker
        onManualRefresh={onManualRefresh}
        isRefreshing={isRefreshing}
        lastUpdatedAt={lastUpdatedAt}
      />
      <TimeRangePicker timeZone={timeZone} offsetMinutes={offsetMinutes} />
    </div>
  );
}
