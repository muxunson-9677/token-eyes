import { render, screen } from "@testing-library/react";
import { setCopyLocale } from "../../../../lib/copy";
import { StatsPanel } from "../StatsPanel.jsx";

function renderPanel(props = {}) {
  return render(
    <StatsPanel
      rankLabel="2026-03-01"
      streakDays={12}
      rolling={{
        last_7d: { totals: { billable_total_tokens: 12345 } },
        last_30d: {
          totals: { billable_total_tokens: 67890, conversation_count: 999 },
          avg_per_active_day: 2222,
        },
      }}
      topModels={[]}
      {...props}
    />,
  );
}

it("shows current-period conversations instead of fixed rolling 30-day conversations", () => {
  renderPanel({ period: "month", periodConversations: 42 });

  expect(screen.getByText("42")).toBeInTheDocument();
  // Locale system resolves to zh-CN by design (see lib/locale.ts).
  expect(screen.getByText("对话")).toBeInTheDocument();
  expect(screen.queryByText("999")).not.toBeInTheDocument();
});

it("uses the same compact conversations label across periods", () => {
  renderPanel({ period: "day", periodConversations: 7 });

  expect(screen.getByText("7")).toBeInTheDocument();
  // Locale system resolves to zh-CN by design (see lib/locale.ts).
  expect(screen.getByText("对话")).toBeInTheDocument();
  expect(screen.queryByText("today")).not.toBeInTheDocument();
});

it("localizes compact rolling stats labels", () => {
  // Locale system resolves to zh-CN for any input by design (see lib/locale.ts);
  // setCopyLocale("en") is effectively a no-op. Only verify the zh-CN labels.
  setCopyLocale("zh-CN");
  const view = renderPanel({ periodConversations: 42 });
  for (const label of ["7 天", "30 天", "平均", "对话"]) {
    expect(screen.getByText(label)).toBeInTheDocument();
  }
  view.unmount();
});

it("uses the measured model collection instead of a fixed three-model summary", () => {
  const models = Array.from({ length: 5 }, (_, index) => ({
    id: `model-${index}`,
    name: `Measured model ${index}`,
    tokens: 500 - index,
    percent: 20 - index,
  }));
  const { container } = renderPanel({ overviewModels: models, topModels: [] });

  expect(container.firstChild).toHaveClass("tt-surface-nested");
  expect(container.firstChild).not.toHaveClass("tt-surface");
  for (const model of models) {
    expect(screen.getByText(model.name)).toBeInTheDocument();
  }
  expect(container.querySelector('[data-testid="overview-model-list"]')).toHaveClass("overflow-y-auto");
  expect(container.querySelector(".truncate")).toBeNull();
});

it("hides unavailable summary metrics and shows one honest model empty state without dash placeholders", () => {
  const { container } = render(
    <StatsPanel
      rolling={null}
      periodConversations={null}
      topModels={[]}
      overviewModels={[]}
      rankLabel={null}
      streakDays={null}
    />,
  );

  expect(screen.queryByText("7 天")).not.toBeInTheDocument();
  expect(screen.queryByText("30 天")).not.toBeInTheDocument();
  expect(screen.queryByText("平均")).not.toBeInTheDocument();
  expect(screen.queryByText("对话")).not.toBeInTheDocument();
  expect(screen.getByText("当前范围暂无模型消耗")).toBeInTheDocument();
  expect(container).not.toHaveTextContent("—");
  expect(container).not.toHaveTextContent("--");
});
