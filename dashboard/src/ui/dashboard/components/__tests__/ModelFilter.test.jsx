import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach } from "vitest";
import { setCopyLocale } from "../../../../lib/copy";
import {
  UsageFiltersProvider,
  useUsageFilterActions,
} from "../../../../hooks/use-usage-filters";
import { ModelFilter } from "../ModelFilter.jsx";

function Probe() {
  useUsageFilterActions();
  return null;
}

function renderFilter(options = { codex: ["gpt-4o"] }) {
  return render(
    <UsageFiltersProvider>
      <Probe />
      <ModelFilter options={options} />
    </UsageFiltersProvider>,
  );
}

describe("ModelFilter", () => {
  beforeEach(() => {
    setCopyLocale("zh-CN");
  });

  it("shows '全选' when all models are selected (draft === null)", async () => {
    const user = userEvent.setup();
    renderFilter();

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "筛选模型" }));
    });

    expect(await screen.findByText("全选")).toBeInTheDocument();
  });

  it("applies a concrete model selection from the default all state", async () => {
    const user = userEvent.setup();
    renderFilter({ codex: ["gpt-4o", "gpt-5.5"] });

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "筛选模型" }));
    });

    await act(async () => {
      await user.click(screen.getByText("gpt-5.5"));
    });

    await act(async () => {
      await user.click(screen.getByText("应用"));
    });

    expect(screen.getByText("已选 1 项")).toBeInTheDocument();
  });
});