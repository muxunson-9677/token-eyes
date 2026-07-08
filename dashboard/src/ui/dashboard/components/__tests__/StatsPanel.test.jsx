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
