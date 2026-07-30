import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { copy, setCopyLocale } from "../../../../lib/copy";
import {
  UsageFiltersProvider,
} from "../../../../hooks/use-usage-filters";
import { UsageFilterBar } from "../UsageFilterBar.jsx";

// Ticket-02 H: UsageFilterBar lays out the 5 filter children. Each child reads
// from useUsageFilters, so the bar must be rendered inside a
// UsageFiltersProvider. We render the real children (no mocks) — ProviderIcon
// is jsdom-safe (renders <img>/inline SVG) and DASHBOARD_AGENTS provides the
// agent buttons. locale pinned to zh-CN so shared.action.apply renders "应用".

function renderBar(props = {}) {
  return render(
    <UsageFiltersProvider>
      <UsageFilterBar
        sourceOptions={[{ source: "codex", source_display_name: "Codex" }]}
        modelsBySource={{ codex: ["gpt-4o"] }}
        onManualRefresh={vi.fn()}
        timeZone="UTC"
        offsetMinutes={0}
        visibleProviderIds={["claude", "codex", "cursor"]}
        {...props}
      />
    </UsageFiltersProvider>,
  );
}

describe("UsageFilterBar", () => {
  beforeEach(() => {
    setCopyLocale("zh-CN");
  });

  it("renders a toolbar with the 5 child trigger controls", () => {
    renderBar();

    // Toolbar container
    expect(screen.getByRole("toolbar", { name: "切换 Agent 数据范围" })).toBeInTheDocument();

    // AgentSwitcher 网格 = 全部
    expect(screen.getByRole("button", { name: "显示全部 Agent 的数据" })).toBeInTheDocument();
    // SourceFilter / ModelFilter / RefreshIntervalPicker / TimeRangePicker triggers
    expect(screen.getByRole("button", { name: "筛选数据来源" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "筛选模型" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新间隔" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "时间范围" })).toBeInTheDocument();
  });

  it("right-aligns the complete filter group while preserving wrapping", () => {
    renderBar();

    const toolbar = screen.getByRole("toolbar");
    expect(toolbar).toHaveClass("justify-end", "flex-wrap");
  });

  it("uses one glass toolbar and gives every filter control restrained press and focus feedback", () => {
    renderBar();

    const toolbar = screen.getByRole("toolbar");
    expect(toolbar).toHaveClass(
      "tt-surface",
      "[&_button]:rounded-[var(--tt-control-radius)]",
      "[&_button:active:not(:disabled)]:translate-y-px",
      "[&_button[aria-pressed=true]]:shadow-inner",
      "[&_button:focus-visible]:ring-2",
      "motion-reduce:[&_button]:transition-none",
      "motion-reduce:[&_button]:transform-none",
    );
  });

  it("shows the same observable open feedback on every popover trigger while preserving Agent selection", async () => {
    const user = userEvent.setup();
    renderBar();

    const toolbar = screen.getByRole("toolbar");
    const allAgents = screen.getByRole("button", {
      name: copy("ticket02.agent.aria_all"),
    });
    expect(allAgents).toHaveAttribute("aria-pressed", "true");

    for (const labelKey of [
      "ticket02.source.aria",
      "ticket02.model.aria",
      "ticket02.refresh.aria",
      "ticket02.time.aria",
    ]) {
      const trigger = screen.getByRole("button", { name: copy(labelKey) });
      expect(trigger.closest('[role="toolbar"]')).toBe(toolbar);
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(trigger).not.toHaveAttribute("data-popup-open");

      await act(async () => {
        await user.click(trigger);
      });

      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(trigger).toHaveAttribute("data-popup-open");
      expect(trigger.matches("button[data-popup-open]")).toBe(true);

      await act(async () => {
        await user.keyboard("{Escape}");
      });
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(trigger).not.toHaveAttribute("data-popup-open");
    }

    expect(toolbar).toHaveClass(
      "[&_button[data-popup-open]]:translate-y-px",
      "[&_button[data-popup-open]]:shadow-inner",
      "[&_button[aria-pressed=true]]:translate-y-px",
      "[&_button[aria-pressed=true]]:shadow-inner",
    );
  });

  it("opens the SourceFilter popover and lists the source option", async () => {
    const user = userEvent.setup();
    renderBar();

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "筛选数据来源" }));
    });

    // source_display_name from the option + the Apply button (zh-CN "应用")
    expect(await screen.findByText("Codex")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "应用" })).toBeInTheDocument();
  });

  it("opens the ModelFilter popover and lists the model option", async () => {
    const user = userEvent.setup();
    renderBar();

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "筛选模型" }));
    });

    expect(await screen.findByText("gpt-4o")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "应用" })).toBeInTheDocument();
  });

  it("fires onManualRefresh when the refresh icon is clicked", async () => {
    const user = userEvent.setup();
    const onManualRefresh = vi.fn();
    renderBar({ onManualRefresh });

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "立即刷新" }));
    });

    expect(onManualRefresh).toHaveBeenCalledTimes(1);
  });

  it("throws when rendered without a UsageFiltersProvider", () => {
    // Suppress React's console.error noise from the unhandled render throw.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<UsageFilterBar />)).toThrow(
        /must be used within a UsageFiltersProvider/,
      );
    } finally {
      spy.mockRestore();
    }
  });
});
