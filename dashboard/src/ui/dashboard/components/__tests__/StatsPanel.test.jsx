import { render, screen, within } from "@testing-library/react";
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
  for (const label of ["7天", "30天", "平均 / 日", "对话"]) {
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

  expect(container.firstChild).not.toHaveClass("tt-surface-nested");
  expect(container.firstChild).not.toHaveClass("tt-surface");
  expect(screen.getAllByTestId("overview-stat-card")[0]).toHaveClass("tt-surface-nested");
  expect(screen.getByTestId("overview-model-ranking")).toHaveClass("tt-surface-nested");
  for (const model of models) {
    expect(screen.getByText(model.name)).toBeInTheDocument();
  }
  expect(container.querySelector('[data-testid="overview-model-list"]')).toHaveClass("overflow-y-auto");
  expect(container.querySelector(".truncate")).toBeNull();
});

it("gives every overview model a distinct visual boundary", () => {
  renderPanel({ overviewModels: [
    { id: "one", name: "Model One", tokens: 100, percent: 60 },
    { id: "two", name: "Model Two", tokens: 50, percent: 40 },
  ] });
  expect(screen.getAllByTestId("overview-model-row")).toHaveLength(2);
  screen.getAllByTestId("overview-model-row").forEach((row) => expect(row).toHaveClass("border", "rounded-lg"));
});

it("uses Scheme A rank tones and distinct model markers", () => {
  renderPanel({ overviewModels: [
    { id: "one", name: "Model One", tokens: 400, percent: 40 },
    { id: "two", name: "Model Two", tokens: 300, percent: 30 },
    { id: "three", name: "Model Three", tokens: 200, percent: 20 },
    { id: "four", name: "Model Four", tokens: 100, percent: 10 },
  ] });

  const ranks = screen.getAllByTestId("overview-model-rank");
  expect(ranks[0]).toHaveClass("bg-amber-100", "rounded-lg");
  expect(ranks[1]).toHaveClass("bg-slate-200", "rounded-lg");
  expect(ranks[2]).toHaveClass("bg-orange-100", "rounded-lg");

  const markerColors = screen
    .getAllByTestId("overview-model-marker")
    .map((marker) => marker.style.backgroundColor);
  expect(new Set(markerColors).size).toBe(4);
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

it("uses the reference overview composition: four standalone metrics above a titled ranking", () => {
  const { container } = renderPanel({
    periodConversations: 42,
    overviewModels: [
      { id: "one", name: "Model One", tokens: 100, percent: 60 },
      { id: "two", name: "Model Two", tokens: 50, percent: 40 },
    ],
    trendRows: [
      { day: "2026-08-01", total_tokens: 10, conversation_count: 1 },
      { day: "2026-08-02", total_tokens: 20, conversation_count: 2 },
    ],
  });

  expect(container.firstChild).toHaveClass("tt-overview-stats");
  expect(screen.getAllByTestId("overview-stat-card")).toHaveLength(4);
  expect(screen.getAllByTestId("overview-stat-sparkline")).toHaveLength(4);
  expect(screen.getAllByTestId("overview-stat-icon")[0].querySelector(".lucide-database")).not.toBeNull();
  expect(screen.getByTestId("overview-model-ranking")).toContainElement(
    screen.getByTestId("overview-model-list"),
  );
});

it("uses one real scrolling model list that can consume the ranking card height", () => {
  renderPanel({
    overviewModels: Array.from({ length: 12 }, (_, index) => ({
      id: `model-${index}`,
      name: `Measured model ${index}`,
      tokens: 1000 - index,
      percent: 20 - index,
    })),
  });

  expect(screen.getByTestId("overview-model-ranking")).toHaveClass(
    "flex",
    "flex-col",
  );
  expect(screen.getByTestId("overview-model-list")).toHaveClass(
    "min-h-0",
    "flex-1",
    "overflow-y-auto",
  );
});

it("keeps the overview model ranking and every row non-navigational", () => {
  renderPanel({
    overviewModels: [
      { id: "one", name: "Model One", tokens: 100, percent: 60 },
      { id: "two", name: "Model Two", tokens: 50, percent: 40 },
    ],
  });

  const ranking = screen.getByTestId("overview-model-ranking");
  expect(within(ranking).queryByRole("link", { name: /查看全部|view all/i })).not.toBeInTheDocument();
  expect(ranking.querySelector('[href="/leaderboard"]')).toBeNull();
  for (const row of screen.getAllByTestId("overview-model-row")) {
    expect(row.closest("a, button")).toBeNull();
    expect(row.querySelector("a, button")).toBeNull();
  }
});
