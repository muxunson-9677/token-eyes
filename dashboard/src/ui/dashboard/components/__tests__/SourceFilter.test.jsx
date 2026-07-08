import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach } from "vitest";
import { setCopyLocale } from "../../../../lib/copy";
import {
  UsageFiltersProvider,
  useUsageFilterActions,
} from "../../../../hooks/use-usage-filters";
import { SourceFilter } from "../SourceFilter.jsx";

// Ticket-02 B: SourceFilter must distinguish the "全选/取消全选" button label
// based on the current draft selection state (regression test for the prior
// bug where both ternary branches returned the same copy key).

function Probe() {
  // Initialize state.sources = null (the default "all sources") so the
  // popover opens with draft = null → allChecked = true.
  useUsageFilterActions();
  return null;
}

function renderFilter(options = [{ source: "codex", source_display_name: "Codex" }]) {
  return render(
    <UsageFiltersProvider>
      <Probe />
      <SourceFilter options={options} />
    </UsageFiltersProvider>,
  );
}

describe("SourceFilter", () => {
  beforeEach(() => {
    setCopyLocale("zh-CN");
  });

  it("shows '取消全选' when all sources are selected (draft === null)", async () => {
    const user = userEvent.setup();
    renderFilter();

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "筛选数据来源" }));
    });

    // draft starts as null → allChecked true → "取消全选"
    expect(await screen.findByText("取消全选")).toBeInTheDocument();
  });

  it("shows '全选' when only a subset is selected (multi-option scenario)", async () => {
    const user = userEvent.setup();
    renderFilter([
      { source: "codex", source_display_name: "Codex" },
      { source: "claude", source_display_name: "Claude" },
    ]);

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "筛选数据来源" }));
    });

    // Initially draft=null → "取消全选"
    expect(await screen.findByText("取消全选")).toBeInTheDocument();

    // Click "取消全选" to switch to explicit array (all options selected)
    await act(async () => {
      await user.click(screen.getByText("取消全选"));
    });

    // Deselect one option → partial selection → label flips to "全选"
    await act(async () => {
      await user.click(screen.getByText("Codex"));
    });

    expect(screen.getByText("全选")).toBeInTheDocument();
  });
});
