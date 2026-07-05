import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { setCopyLocale } from "../../../../lib/copy";
import {
  UsageFiltersProvider,
  useUsageFilters,
} from "../../../../hooks/use-usage-filters";
import { AgentSwitcher } from "../AgentSwitcher.jsx";

// Ticket-07 Task 2: AgentSwitcher 受 visibleProviderIds 约束并实现折叠状态机。
// 测试覆盖全部按钮状态机、可见顺序、空 allowlist 行为。

function renderSwitcher(props = {}) {
  return render(
    <UsageFiltersProvider>
      <AgentSwitcher {...props} />
    </UsageFiltersProvider>,
  );
}

describe("AgentSwitcher", () => {
  beforeEach(() => {
    setCopyLocale("zh-CN");
  });

  describe("visible provider list", () => {
    it("renders only the providers in visibleProviderIds in order", () => {
      renderSwitcher({ visibleProviderIds: ["claude", "codex", "hermes"] });

      // "全部" button + 3 agent buttons
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBe(4);

      // Agent buttons have aria-pressed="false" initially (全部 is selected)
      // Note: aria-label for 全部 button is dynamic: "收起 Agent 列表" when expanded
      expect(screen.getByRole("button", { name: "收起 Agent 列表" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "仅显示 Claude Code 的数据" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "仅显示 Codex 的数据" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "仅显示 Hermes Agent 的数据" })).toBeInTheDocument();
    });

    it("renders providers in visibleProviderIds order (not alphabetical)", () => {
      renderSwitcher({ visibleProviderIds: ["hermes", "claude"] });

      const buttons = screen.getAllByRole("button");
      // Order: 全部, Hermes, Claude
      expect(buttons[1]).toHaveAttribute("aria-label", "仅显示 Hermes Agent 的数据");
      expect(buttons[2]).toHaveAttribute("aria-label", "仅显示 Claude Code 的数据");
    });

    it("renders only the 全部 button when visibleProviderIds is empty", () => {
      renderSwitcher({ visibleProviderIds: [] });

      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBe(1);
      // When no agents visible, still shows "展开 Agent 列表" for the toggle
      expect(screen.getByRole("button", { name: "展开 Agent 列表" })).toBeInTheDocument();
    });

    it("does not render all 25 registry agents when visibleProviderIds is empty", () => {
      renderSwitcher({ visibleProviderIds: [] });

      // Should only have 1 button (全部), not 26 (全部 + 25 agents)
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBe(1);
    });
  });

  describe("collapse state machine", () => {
    it("首次进入：全部范围，Agent 图标展开，aria-expanded=true", () => {
      renderSwitcher({ visibleProviderIds: ["claude", "codex"] });

      const allButton = screen.getByRole("button", { name: "收起 Agent 列表" });
      expect(allButton).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("button", { name: "仅显示 Claude Code 的数据" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "仅显示 Codex 的数据" })).toBeInTheDocument();
    });

    it("全部范围点击一次后：Agent 隐藏，aria-expanded=false，全部按钮仍在", async () => {
      const user = userEvent.setup();
      renderSwitcher({ visibleProviderIds: ["claude", "codex"] });

      const allButton = screen.getByRole("button", { name: "收起 Agent 列表" });
      await act(async () => {
        await user.click(allButton);
      });

      expect(allButton).toHaveAttribute("aria-expanded", "false");
      expect(allButton).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "仅显示 Claude Code 的数据" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "仅显示 Codex 的数据" })).not.toBeInTheDocument();
    });

    it("全部范围且折叠时再次点击：恢复展开，aria-expanded=true", async () => {
      const user = userEvent.setup();
      renderSwitcher({ visibleProviderIds: ["claude", "codex"] });

      const allButton = screen.getByRole("button", { name: "收起 Agent 列表" });

      // First click: collapse
      await act(async () => {
        await user.click(allButton);
      });
      expect(allButton).toHaveAttribute("aria-expanded", "false");

      // Second click: expand
      await act(async () => {
        await user.click(allButton);
      });
      expect(allButton).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("button", { name: "仅显示 Claude Code 的数据" })).toBeInTheDocument();
    });

    it("选中单个 Agent 后点击全部：切回全部范围并折叠图标", async () => {
      const user = userEvent.setup();
      renderSwitcher({ visibleProviderIds: ["claude", "codex"] });

      // Click Codex to select it
      const codexButton = screen.getByRole("button", { name: "仅显示 Codex 的数据" });
      await act(async () => {
        await user.click(codexButton);
      });
      expect(codexButton).toHaveAttribute("aria-pressed", "true");

      const allButton = screen.getByRole("button", { name: "显示全部 Agent 并收起列表" });
      await act(async () => {
        await user.click(allButton);
      });

      // All selected, agents collapsed
      expect(allButton).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("button", { name: "仅显示 Codex 的数据" })).not.toBeInTheDocument();
    });

    it("选中单个 Agent 后点击全部再点击：展开图标", async () => {
      const user = userEvent.setup();
      renderSwitcher({ visibleProviderIds: ["claude", "codex"] });

      // Select Codex
      const codexButton = screen.getByRole("button", { name: "仅显示 Codex 的数据" });
      await act(async () => {
        await user.click(codexButton);
      });

      const allButton = screen.getByRole("button", { name: "显示全部 Agent 并收起列表" });
      // Click to collapse
      await act(async () => {
        await user.click(allButton);
      });
      expect(allButton).toHaveAttribute("aria-expanded", "false");

      // Click again to expand
      await act(async () => {
        await user.click(allButton);
      });
      expect(allButton).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("button", { name: "仅显示 Codex 的数据" })).toBeInTheDocument();
    });
  });

  describe("aria attributes", () => {
    it("全部按钮 aria-pressed 表示数据范围是否为全部，不随 expanded 变化", async () => {
      const user = userEvent.setup();
      renderSwitcher({ visibleProviderIds: ["claude", "codex"] });

      const allButton = screen.getByRole("button", { name: "收起 Agent 列表" });
      expect(allButton).toHaveAttribute("aria-pressed", "true");

      // Collapse: aria-pressed still true (data range unchanged)
      await act(async () => {
        await user.click(allButton);
      });
      expect(allButton).toHaveAttribute("aria-pressed", "true");
      expect(allButton).toHaveAttribute("aria-expanded", "false");
    });

    it("选中单个 Agent 时全部按钮 aria-pressed=false", async () => {
      const user = userEvent.setup();
      renderSwitcher({ visibleProviderIds: ["claude", "codex"] });

      const claudeButton = screen.getByRole("button", { name: "仅显示 Claude Code 的数据" });
      await act(async () => {
        await user.click(claudeButton);
      });

      const allButton = screen.getByRole("button", { name: "显示全部 Agent 并收起列表" });
      expect(allButton).toHaveAttribute("aria-pressed", "false");
    });

    it("动态 aria/title 根据状态变化", async () => {
      const user = userEvent.setup();
      renderSwitcher({ visibleProviderIds: ["claude", "codex"] });

      // Initial: 全部 + 展开 → "收起 Agent 列表"
      let allButton = screen.getByRole("button", { name: "收起 Agent 列表" });
      expect(allButton).toBeInTheDocument();

      // Click to collapse → aria-label changes to "展开 Agent 列表"
      await act(async () => {
        await user.click(allButton);
      });
      allButton = screen.getByRole("button", { name: "展开 Agent 列表" });
      expect(allButton).toBeInTheDocument();

      // Click to expand → aria-label changes back
      await act(async () => {
        await user.click(allButton);
      });
      allButton = screen.getByRole("button", { name: "收起 Agent 列表" });
      expect(allButton).toBeInTheDocument();
    });
  });
});
