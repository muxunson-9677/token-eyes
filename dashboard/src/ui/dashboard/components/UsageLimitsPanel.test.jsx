import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { copy, setCopyLocale } from "../../../lib/copy";
import { EN_LOCALE, ZH_CN_LOCALE } from "../../../lib/locale";
import { UsageLimitsPanel } from "./UsageLimitsPanel.jsx";

describe("UsageLimitsPanel", () => {
  afterEach(() => {
    setCopyLocale(EN_LOCALE);
  });

  it("shows provider status rows instead of hiding configured providers with errors", () => {
    render(
      <UsageLimitsPanel
        claude={{ configured: true, error: "Claude API returned 403" }}
        codex={{ configured: false }}
        cursor={{
          configured: true,
          error: null,
          primary_window: { used_percent: 50, reset_at: "2026-05-10T10:39:54.000Z" },
        }}
        order={["claude", "codex", "cursor"]}
      />,
    );

    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("Cursor")).toBeInTheDocument();
    expect(screen.getByText(/Claude API returned 403/)).toBeInTheDocument();
    expect(screen.getByText(copy("limits.status.not_connected"))).toBeInTheDocument();
    expect(screen.getByText(copy("limits.label.cursor_plan"))).toBeInTheDocument();
  });

  it("renders Kimi quota windows and not-connected state", () => {
    const { rerender } = render(
      <UsageLimitsPanel
        kimi={{
          configured: true,
          error: null,
          parallel_limit: 20,
          primary_window: { used_percent: 64, reset_at: "2026-05-04T06:02:56.054Z" },
          secondary_window: { used_percent: 4, reset_at: "2026-05-02T05:02:56.054Z" },
          tertiary_window: { used_percent: 1, reset_at: null },
        }}
        order={["kimi"]}
      />,
    );

    expect(screen.getByText("Kimi")).toBeInTheDocument();
    expect(screen.getByText(copy("limits.label.kimi_weekly"))).toBeInTheDocument();
    expect(screen.getByText("5h")).toBeInTheDocument();
    expect(screen.getByText(copy("limits.label.kimi_total"))).toBeInTheDocument();
    expect(screen.getByText(copy("limits.label.kimi_parallel", { count: 20 }))).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /使用限制\s*·\s*已用/ })).toBeInTheDocument();
    expect(screen.getByText("64%")).toBeInTheDocument();
    expect(screen.getByText("4%")).toBeInTheDocument();
    expect(screen.getByText("1%")).toBeInTheDocument();

    rerender(<UsageLimitsPanel kimi={{ configured: false }} order={["kimi"]} />);

    expect(screen.getByText("Kimi")).toBeInTheDocument();
    expect(screen.getByText(copy("limits.status.not_connected"))).toBeInTheDocument();
  });

  it("keeps Hermes, OpenClaw and OpenCode visible as display sources without live limit data", () => {
    render(
      <UsageLimitsPanel
        order={["hermes", "openclaw", "opencode"]}
      />,
    );

    expect(screen.getByText("Hermes")).toBeInTheDocument();
    expect(screen.getByText("OpenClaw")).toBeInTheDocument();
    expect(screen.getByText("OpenCode")).toBeInTheDocument();
    expect(screen.getAllByText(copy("limits.status.not_connected"))).toHaveLength(3);
  });

  it("renders Trae, CodeBuddy and OpenCode as token-only totals without quota bars", () => {
    render(
      <UsageLimitsPanel
        trae={{ configured: true, error: null, token_only: true, total_tokens: 1_250 }}
        codebuddy={{ configured: true, error: null, token_only: true, total_tokens: 3_200 }}
        opencode={{ configured: true, error: null, token_only: true, total_tokens: 8_400 }}
        order={["trae", "codebuddy", "opencode"]}
      />,
    );

    expect(screen.getByText("Trae")).toBeInTheDocument();
    expect(screen.getByText("CodeBuddy")).toBeInTheDocument();
    expect(screen.getByText("OpenCode")).toBeInTheDocument();
    expect(screen.getByText(copy("limits.status.token_only", { tokens: "1.3K" }))).toBeInTheDocument();
    expect(screen.getByText(copy("limits.status.token_only", { tokens: "3.2K" }))).toBeInTheDocument();
    expect(screen.getByText(copy("limits.status.token_only", { tokens: "8.4K" }))).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("appends plan_label to the provider title when present", () => {
    render(
      <UsageLimitsPanel
        cursor={{
          configured: true,
          error: null,
          plan_label: "Pro",
          primary_window: { used_percent: 50, reset_at: "2026-05-10T10:39:54.000Z" },
        }}
        order={["cursor"]}
      />,
    );

    expect(screen.getByText("Cursor Pro")).toBeInTheDocument();
    expect(screen.queryByText("Cursor")).not.toBeInTheDocument();
  });

  it("keeps a stale cached limit visible and labels its evidence", () => {
    render(
      <UsageLimitsPanel
        cursor={{
          configured: true,
          error: null,
          primary_window: { used_percent: 50, reset_at: "2026-08-10T10:39:54.000Z" },
          evidence: {
            source_kind: "cache",
            accuracy: "exact",
            coverage: "complete",
            observed_at: "2026-07-26T00:00:00.000Z",
            source_updated_at: "2026-07-26T00:00:00.000Z",
            stale_after_seconds: 300,
            is_stale: true,
            pricing_source: null,
            pricing_version: null,
            note_code: "last_successful_value",
          },
        }}
        order={["cursor"]}
      />,
    );

    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText(copy("observability.evidence.cached"))).toBeInTheDocument();
  });

  it("renders just the provider name when plan_label is null or absent", () => {
    const { rerender } = render(
      <UsageLimitsPanel
        cursor={{
          configured: true,
          error: null,
          plan_label: null,
          primary_window: { used_percent: 50, reset_at: "2026-05-10T10:39:54.000Z" },
        }}
        order={["cursor"]}
      />,
    );

    expect(screen.getByText("Cursor")).toBeInTheDocument();

    rerender(
      <UsageLimitsPanel
        cursor={{
          configured: true,
          error: null,
          primary_window: { used_percent: 50, reset_at: "2026-05-10T10:39:54.000Z" },
        }}
        order={["cursor"]}
      />,
    );

    expect(screen.getByText("Cursor")).toBeInTheDocument();
  });

  it("renders Codex Spark quota windows through compact copy labels", () => {
    function expectLimitRow(label, value) {
      const row = screen.getByText(label).closest("div");
      expect(row).not.toBeNull();
      expect(within(row).getByText(value)).toBeInTheDocument();
    }

    setCopyLocale(ZH_CN_LOCALE);
    render(
      <UsageLimitsPanel
        codex={{
          configured: true,
          error: null,
          primary_window: { used_percent: 12, reset_at: 1_800_000_000, limit_window_seconds: 18000 },
          secondary_window: { used_percent: 30, reset_at: 1_800_604_800, limit_window_seconds: 604800 },
          spark_primary_window: { used_percent: 4, reset_at: 1_800_000_001, limit_window_seconds: 18000 },
          spark_secondary_window: { used_percent: 18, reset_at: 1_800_604_801, limit_window_seconds: 604800 },
        }}
        order={["codex"]}
      />,
    );

    expect(screen.getByText("Codex")).toBeInTheDocument();
    expectLimitRow("5h", "12%");
    expectLimitRow("7d", "30%");
    expectLimitRow("Spark 5h", "4%");
    expectLimitRow("Spark 7d", "18%");
  });
});
