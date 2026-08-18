import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach } from "vitest";
import { setCopyLocale } from "../../../../lib/copy";
import {
  UsageFiltersProvider,
} from "../../../../hooks/use-usage-filters";
import { AgentSwitcher } from "../AgentSwitcher.jsx";

// WO-7: AgentSwitcher — 网格=全部；无折叠；单选高亮 + 品牌色边框。

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

      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBe(4);

      expect(screen.getByRole("button", { name: "显示全部 Agent 的数据" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "仅显示 Claude Code 的数据" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "仅显示 Codex 的数据" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "仅显示 Hermes Agent 的数据" })).toBeInTheDocument();
    });

    it("renders every visible Agent as a labelled selectable card", () => {
      renderSwitcher({ visibleProviderIds: ["claude", "codex"] });

      expect(screen.getByRole("button", { name: "仅显示 Claude Code 的数据" }))
        .toHaveClass("tt-agent-switcher-card");
      expect(screen.getByRole("button", { name: "仅显示 Claude Code 的数据" })).toHaveStyle({
        height: "34px",
        fontSize: "10px",
      });
      expect(screen.getByRole("button", { name: "仅显示 Codex 的数据" }))
        .toHaveTextContent("Codex");
    });

    it("renders providers in visibleProviderIds order (not alphabetical)", () => {
      renderSwitcher({ visibleProviderIds: ["hermes", "claude"] });

      const buttons = screen.getAllByRole("button");
      expect(buttons[1]).toHaveAttribute("aria-label", "仅显示 Hermes Agent 的数据");
      expect(buttons[2]).toHaveAttribute("aria-label", "仅显示 Claude Code 的数据");
    });

    it("renders only the 全部 button when visibleProviderIds is empty", () => {
      renderSwitcher({ visibleProviderIds: [] });

      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBe(1);
      expect(screen.getByRole("button", { name: "显示全部 Agent 的数据" })).toBeInTheDocument();
    });
  });

  describe("selection (no collapse)", () => {
    it("全部按钮始终可见；Agent 图标不折叠", async () => {
      const user = userEvent.setup();
      renderSwitcher({ visibleProviderIds: ["claude", "codex"] });

      const allButton = screen.getByRole("button", { name: "显示全部 Agent 的数据" });
      expect(screen.getByRole("button", { name: "仅显示 Claude Code 的数据" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "仅显示 Codex 的数据" })).toBeInTheDocument();

      await act(async () => {
        await user.click(screen.getByRole("button", { name: "仅显示 Codex 的数据" }));
      });

      expect(allButton).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByRole("button", { name: "仅显示 Codex 的数据" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "仅显示 Claude Code 的数据" })).toBeInTheDocument();
    });

    it("点击全部恢复汇总范围", async () => {
      const user = userEvent.setup();
      renderSwitcher({ visibleProviderIds: ["claude", "codex"] });

      await act(async () => {
        await user.click(screen.getByRole("button", { name: "仅显示 Codex 的数据" }));
      });

      const allButton = screen.getByRole("button", { name: "显示全部 Agent 的数据" });
      expect(allButton).toHaveAttribute("aria-pressed", "false");

      await act(async () => {
        await user.click(allButton);
      });

      expect(allButton).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "仅显示 Codex 的数据" })).toHaveAttribute("aria-pressed", "false");
    });

    it("选中 Agent 使用品牌色边框（boxShadow）", async () => {
      const user = userEvent.setup();
      renderSwitcher({ visibleProviderIds: ["hermes"] });

      const hermesButton = screen.getByRole("button", { name: "仅显示 Hermes Agent 的数据" });
      await act(async () => {
        await user.click(hermesButton);
      });

      expect(hermesButton).toHaveAttribute("aria-pressed", "true");
      expect(hermesButton.style.boxShadow).toMatch(/inset 0 0 0 2px/);
    });
  });

  describe("aria attributes", () => {
    it("全部按钮 aria-pressed 表示数据范围是否为全部", async () => {
      const user = userEvent.setup();
      renderSwitcher({ visibleProviderIds: ["claude", "codex"] });

      const allButton = screen.getByRole("button", { name: "显示全部 Agent 的数据" });
      expect(allButton).toHaveAttribute("aria-pressed", "true");

      await act(async () => {
        await user.click(screen.getByRole("button", { name: "仅显示 Claude Code 的数据" }));
      });
      expect(allButton).toHaveAttribute("aria-pressed", "false");
    });
  });
});
