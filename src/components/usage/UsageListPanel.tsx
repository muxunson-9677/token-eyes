import { RequestLogTable } from "./RequestLogTable";
import type { UsageRangeSelection } from "@/types/usage";

interface UsageListPanelProps {
  range: UsageRangeSelection;
  rangeLabel: string;
  appType?: string;
  providerName?: string;
  model?: string;
  refreshIntervalMs: number;
  onRangeChange?: (range: UsageRangeSelection) => void;
}

/**
 * 用量列表展示面板（薄封装）。
 * 复用现有 RequestLogTable，不复制表格实现；
 * props 与 UsageDashboard 传入参数保持一致。
 */
export function UsageListPanel(props: UsageListPanelProps) {
  return <RequestLogTable {...props} />;
}
