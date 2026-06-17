import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UsageListPanel } from "@/components/usage/UsageListPanel";
import type { UsageRangeSelection } from "@/types/usage";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const requestLogTableSpy = vi.hoisted(() => vi.fn((_props: any) => null));

vi.mock("@/components/usage/RequestLogTable", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  RequestLogTable: (props: any) => requestLogTableSpy(props),
}));

describe("UsageListPanel", () => {
  const baseRange: UsageRangeSelection = { preset: "today" };

  it("forwards all props to RequestLogTable", () => {
    render(
      <UsageListPanel
        range={baseRange}
        rangeLabel="Today"
        appType="hermes"
        providerName="anthropic"
        model="claude-sonnet-4-20250514"
        refreshIntervalMs={30000}
      />,
    );

    expect(requestLogTableSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        range: baseRange,
        rangeLabel: "Today",
        appType: "hermes",
        providerName: "anthropic",
        model: "claude-sonnet-4-20250514",
        refreshIntervalMs: 30000,
      }),
    );
  });

  it("passes appType 'hermes' for Hermes filter", () => {
    render(
      <UsageListPanel
        range={baseRange}
        rangeLabel="Today"
        appType="hermes"
        refreshIntervalMs={0}
      />,
    );

    expect(requestLogTableSpy).toHaveBeenCalledWith(
      expect.objectContaining({ appType: "hermes" }),
    );
  });

  it("passes appType 'all' as-is (RequestLogTable normalizes to undefined)", () => {
    render(
      <UsageListPanel
        range={baseRange}
        rangeLabel="Today"
        appType="all"
        refreshIntervalMs={0}
      />,
    );

    expect(requestLogTableSpy).toHaveBeenCalledWith(
      expect.objectContaining({ appType: "all" }),
    );
  });
});
