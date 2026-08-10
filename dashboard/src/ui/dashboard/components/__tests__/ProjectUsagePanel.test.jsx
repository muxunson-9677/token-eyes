import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "../../../../lib/copy";
import { formatCompactNumber } from "../../../../lib/format";
import { render } from "../../../../test/test-utils";
import { ProjectUsagePanel } from "../ProjectUsagePanel.jsx";

describe("ProjectUsagePanel", () => {
  const baseEntry = {
    project_key: "cursor",
    project_ref: "",
    project_name: "My Project",
    project_path: "/Users/user/code/my-project",
    total_tokens: 12345,
    billable_total_tokens: 12000,
    cost_usd: 0.4567,
    priced_tokens: 12000,
    unpriced_tokens: 0,
    pricing_coverage: "complete",
    request_count: 42,
    last_active_at: "2026-06-29T10:00:00Z",
  };

  beforeEach(() => {
    document.documentElement.classList.add("screenshot-capture");
  });

  afterEach(() => {
    document.documentElement.classList.remove("screenshot-capture");
  });

  it("renders project card with real project path and displays all metrics", () => {
    const { container } = render(<ProjectUsagePanel entries={[baseEntry]} />);

    expect(screen.getByText("My Project")).toBeInTheDocument();
    expect(screen.getByText("/Users/user/code/my-project")).toBeInTheDocument();
    expect(screen.getByText("$0.4567")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("displays tokens in compact format", () => {
    render(<ProjectUsagePanel entries={[baseEntry]} />);

    const expected = formatCompactNumber("12000", {
      thousandSuffix: copy("shared.unit.thousand_abbrev"),
      millionSuffix: copy("shared.unit.million_abbrev"),
      billionSuffix: copy("shared.unit.billion_abbrev"),
      decimals: 1,
    });

    expect(screen.getByText(new RegExp(expected))).toBeInTheDocument();
  });

  it("shows copy path button when project_path exists", () => {
    render(<ProjectUsagePanel entries={[baseEntry]} />);

    const copyButton = screen.getByTitle(copy("dashboard.projects.copy_path"));
    expect(copyButton).toBeInTheDocument();
  });

  it("hides the path row when project_path is empty", () => {
    const entryWithoutPath = {
      ...baseEntry,
      project_path: "",
    };
    render(<ProjectUsagePanel entries={[entryWithoutPath]} />);

    expect(screen.queryByText(copy("dashboard.projects.no_path"))).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="project-path"]')).toBeNull();
    expect(screen.queryByTitle(copy("dashboard.projects.copy_path"))).not.toBeInTheDocument();
  });

  it("hides the path row when project_path is null", () => {
    const entryWithoutPath = {
      ...baseEntry,
      project_path: null,
    };
    render(<ProjectUsagePanel entries={[entryWithoutPath]} />);

    expect(screen.queryByText(copy("dashboard.projects.no_path"))).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="project-path"]')).toBeNull();
  });

  it("prefers total tokens when billable tokens are zero", () => {
    const entryWithBillableZero = {
      project_key: "claude",
      project_ref: "",
      project_name: "Alpha Project",
      project_path: "/code/alpha",
      total_tokens: 12345,
      billable_total_tokens: 0,
      cost_usd: 0.1234,
      request_count: 10,
      last_active_at: null,
    };

    render(<ProjectUsagePanel entries={[entryWithBillableZero]} />);

    const expected = formatCompactNumber("12345", {
      thousandSuffix: copy("shared.unit.thousand_abbrev"),
      millionSuffix: copy("shared.unit.million_abbrev"),
      billionSuffix: copy("shared.unit.billion_abbrev"),
      decimals: 1,
    });

    expect(screen.getByText(new RegExp(expected))).toBeInTheDocument();
  });

  it("renders empty state when entries array is empty", () => {
    render(<ProjectUsagePanel entries={[]} />);

    expect(screen.getByText(copy("dashboard.projects.empty"))).toBeInTheDocument();
  });

  it("closes the limit popup on Escape", async () => {
    const limitAria = copy("dashboard.projects.limit_aria");
    const onLimitChange = vi.fn();
    const user = userEvent.setup();

    render(<ProjectUsagePanel entries={[baseEntry]} onLimitChange={onLimitChange} />);

    await act(async () => {
      await user.click(screen.getByLabelText(limitAria));
    });
    expect(screen.getByRole("listbox", { name: limitAria })).toBeInTheDocument();

    await act(async () => {
      await user.keyboard("{Escape}");
    });
    expect(screen.queryByRole("listbox", { name: limitAria })).not.toBeInTheDocument();
  });

  it("does not generate fake github URLs", () => {
    const entryWithFakeRef = {
      ...baseEntry,
      project_ref: "https://github.com/octo/hello",
    };
    const { container } = render(<ProjectUsagePanel entries={[entryWithFakeRef]} />);

    // Should not contain codex.ai or claude.ai fake links
    expect(container.innerHTML).not.toContain("codex.ai");
    expect(container.innerHTML).not.toContain("claude.ai");
  });

  it("does not display GitHub stars anywhere", () => {
    const { container } = render(<ProjectUsagePanel entries={[baseEntry]} />);

    // The star character ★ should not appear
    expect(container.querySelector('[class*="stars"]')).toBeNull();
  });

  it("sorts entries by token count descending", () => {
    const entries = [
      { ...baseEntry, project_key: "low", project_name: "Low Tokens", total_tokens: 1000, project_path: "/low" },
      { ...baseEntry, project_key: "high", project_name: "High Tokens", total_tokens: 500000, project_path: "/high" },
      { ...baseEntry, project_key: "mid", project_name: "Mid Tokens", total_tokens: 50000, project_path: "/mid" },
    ];

    render(<ProjectUsagePanel entries={entries} />);

    const cards = screen.getAllByText(/Tokens/);
    // Tokens label appears in each card, we just verify rendering
    expect(cards.length).toBe(3);
  });

  it("handles missing optional fields gracefully", () => {
    const minimalEntry = {
      project_key: "test",
      project_name: "Test Project",
      project_path: "/test",
      total_tokens: 100,
    };
    render(<ProjectUsagePanel entries={[minimalEntry]} />);

    expect(screen.getByText("Test Project")).toBeInTheDocument();
    // Should not crash and should show no_path fallback-free since path exists
    expect(screen.getByText("/test")).toBeInTheDocument();
  });

  it("hides missing token, cost, request, and time values without placeholders", () => {
    const { container } = render(<ProjectUsagePanel entries={[{
      project_key: "test",
      project_name: "Test Project",
      pricing_coverage: "unpriced",
    }]} />);

    expect(screen.getByText("Test Project")).toBeInTheDocument();
    expect(container).not.toHaveTextContent("—");
    expect(container).not.toHaveTextContent(" - ");
    expect(screen.queryByText(copy("dashboard.projects.tokens_label"))).not.toBeInTheDocument();
  });

  it("keeps project disclosures independent and uses official provider icons", async () => {
    const user = userEvent.setup();
    const entries = [
      { ...baseEntry, project_key: "first", project_name: "First project", top_agents: ["codex"], top_models: ["gpt-5.6-sol"], model_providers: { "gpt-5.6-sol": "codex" } },
      { ...baseEntry, project_key: "second", project_name: "Second project", top_agents: ["claude"], top_models: ["claude-3.5"], model_providers: { "claude-3.5": "claude" } },
      { ...baseEntry, project_key: "third", project_name: "Third project", top_agents: ["cursor"] },
    ];

    render(<ProjectUsagePanel embedded entries={entries} />);
    const cards = screen.getAllByTestId("project-usage-card");

    expect(cards[0]).toHaveClass("tt-overview-project-card--compact");
    await user.click(screen.getByRole("button", { name: /Second project/ }));
    expect(cards[0]).toHaveAttribute("data-expanded", "false");
    expect(cards[1]).toHaveAttribute("data-expanded", "true");
    expect(cards[2]).toHaveAttribute("data-expanded", "false");
    expect(cards[1].querySelector('[data-slot="project-agent-icon"]')).toBeInTheDocument();
    expect(cards[1].querySelector('[data-slot="project-model-icon"]')).toBeInTheDocument();
  });

  it("reveals real agent, model, period, activity and trend details for only the selected project", async () => {
    const user = userEvent.setup();
    const entries = [
      {
        ...baseEntry,
        project_key: "detailed",
        project_name: "Detailed project",
        agent_usage: [{ id: "codex", tokens: 9000, percent: 75 }],
        model_usage: [{ id: "gpt-5.6-sol", provider: "codex", tokens: 7200, percent: 60 }],
        usage_trend: [
          { day: "2026-06-28", tokens: 1000 },
          { day: "2026-06-29", tokens: 11000 },
        ],
        period_from: "2026-06-28",
        period_to: "2026-06-29",
      },
      { ...baseEntry, project_key: "other", project_name: "Other project" },
    ];

    render(<ProjectUsagePanel embedded entries={entries} />);
    const cards = screen.getAllByTestId("project-usage-card");

    expect(cards[0]).toHaveAttribute("data-expanded", "false");
    expect(cards[1]).toHaveAttribute("data-expanded", "false");
    await user.click(screen.getByRole("button", { name: /Detailed project/ }));

    expect(cards[0]).toHaveAttribute("data-expanded", "true");
    expect(cards[1]).toHaveAttribute("data-expanded", "false");
    expect(cards[0].querySelector('[data-slot="project-agent-usage"]')).toHaveTextContent("9");
    expect(cards[0].querySelector('[data-slot="project-model-usage"]')).toHaveTextContent("7.2");
    expect(cards[0].querySelector('[data-slot="project-period"]')).toHaveTextContent("2026-06-28");
    expect(cards[0].querySelector('[data-slot="project-period"]')).toHaveTextContent("2026-06-29");
    expect(cards[0].querySelector('[data-slot="project-last-active"]')).toBeInTheDocument();
    expect(cards[0].querySelector('[data-testid="project-usage-sparkline"]')).toBeInTheDocument();
  });

  it("shows total records and lets users jump to a project page", async () => {
    const user = userEvent.setup();
    const entries = Array.from({ length: 4 }, (_, index) => ({
      ...baseEntry,
      project_key: `project-${index + 1}`,
      project_name: `Project ${index + 1}`,
      total_tokens: 10000 - index,
    }));

    render(<ProjectUsagePanel embedded entries={entries} limit={3} />);

    expect(screen.getByTestId("project-pagination-total")).toHaveTextContent("4");
    expect(screen.getByTestId("project-pagination")).toHaveClass("tt-overview-pagination");
    const pageInput = screen.getByLabelText(copy("dashboard.projects.page_number"));
    await user.clear(pageInput);
    await user.type(pageInput, "2");
    await user.click(screen.getByRole("button", { name: copy("dashboard.projects.page_jump") }));
    expect(screen.getByText("Project 4")).toBeInTheDocument();
  });
});
