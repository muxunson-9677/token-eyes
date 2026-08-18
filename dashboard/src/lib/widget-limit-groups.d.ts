import type { DesktopWidgetViewModel } from "./api";

type WidgetLimit = DesktopWidgetViewModel["limits"][number];

export interface WidgetLimitGroup extends Omit<WidgetLimit, "id" | "window"> {
  id: string;
  planId: string;
  windows: WidgetLimit[];
}

export function groupWidgetLimits(limits: WidgetLimit[]): WidgetLimitGroup[];

export function widgetLimitGroupSelected(
  group: WidgetLimitGroup,
  selectedIds: string[] | null | undefined,
): boolean;
