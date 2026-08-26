import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { copy, setCopyLocale } from "../../../lib/copy";
import { EN_LOCALE, ZH_CN_LOCALE } from "../../../lib/locale";
import { UsageLimitsPanel } from "./UsageLimitsPanel.jsx";

describe("UsageLimitsPanel", () => {
  it("Task 8 renders independent Cursor team pool Auto and API lanes without an overall headline", () => {
    render(
      <UsageLimitsPanel
        cursor={{
          configured: true,
          primary_window: null,
          team_pool_window: { used_percent: 25, reset_at: "2026-08-21T00:00:00.000Z" },
          secondary_window: { used_percent: 10.25, reset_at: "2026-08-21T00:00:00.000Z" },
          tertiary_window: { used_percent: 70.75, reset_at: "2026-08-21T00:00:00.000Z" },
        }}
        order={["cursor"]}
      />,
    );

    expect(screen.queryByText(copy("limits.label.cursor_plan"))).not.toBeInTheDocument();
    expect(screen.getByText(copy("limits.label.cursor_team_pool"))).toBeInTheDocument();
    expect(screen.getByText(copy("limits.label.cursor_auto"))).toBeInTheDocument();
    expect(screen.getByText(copy("limits.label.cursor_api"))).toBeInTheDocument();
  });
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

  it("shows a burn-rate ETA line with local-estimate provenance, and an em-dash when insufficient", () => {
    const resetAt = new Date(Date.now() + (2 * 60 + 13) * 60_000 + 30_000).toISOString();
    const { rerender } = render(
      <UsageLimitsPanel
        claude={{
          configured: true,
          error: null,
          five_hour: { utilization: 60, resets_at: resetAt },
          burn_rate: {
            basis: "local_estimate",
            percent_per_min: 0.4,
            eta_exhaust_at: new Date(Date.now() + 100 * 60_000).toISOString(),
            tokens_last_60m: 2000,
            tokens_last_120m: 4000,
          },
        }}
        order={["claude"]}
      />,
    );

    const line = screen.getByTestId("limits-burn-line");
    expect(line.textContent).toContain(copy("limits.burn.local_estimate"));
    expect(line.textContent).toMatch(/\d{1,2}:\d{2}/);
    expect(line.textContent).toMatch(/2h 1[23]m/);

    rerender(
      <UsageLimitsPanel
        claude={{
          configured: true,
          error: null,
          five_hour: { utilization: 60, resets_at: resetAt },
          burn_rate: {
            basis: "local_estimate",
            percent_per_min: null,
            eta_exhaust_at: null,
            tokens_last_60m: 0,
            tokens_last_120m: 0,
          },
        }}
        order={["claude"]}
      />,
    );

    expect(screen.getByTestId("limits-burn-line").textContent).toContain("—");
  });

  it("keeps distinct privacy-safe accounts and per-account failures in the existing list", () => {
    render(
      <UsageLimitsPanel
        accounts={[
          {
            provider_id: "codex",
            account_key: "hashed-work",
            account_label: "Work",
            plan_label: "Plus",
            status: "ok",
            windows: [{ kind: "five_hour", label: "5h", used_percent: 42, reset_at: null }],
          },
          {
            provider_id: "codex",
            account_key: "hashed-personal",
            account_label: "Personal",
            plan_label: null,
            status: "auth_error",
            error_code: "reauth_required",
            windows: [],
          },
        ]}
        order={["codex"]}
      />,
    );

    expect(screen.getByText("Codex · Work · Plus")).toBeInTheDocument();
    expect(screen.getByText("Codex · Personal")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByText(/reauth_required/)).toBeInTheDocument();
    expect(screen.getAllByTestId("limit-account-service-row")).toHaveLength(2);
  });

  it("shows aggregate and per-account refresh state without hiding cached rows", () => {
    render(
      <UsageLimitsPanel
        accounts={[
          {
            provider_id: "claude",
            account_key: "hashed-a",
            account_label: "Team A",
            status: "ok",
            windows: [{ kind: "five_hour", label: "5h", used_percent: 30, reset_at: null }],
          },
          {
            provider_id: "claude",
            account_key: "hashed-b",
            account_label: "Team B",
            status: "stale",
            windows: [{ kind: "five_hour", label: "5h", used_percent: 55, reset_at: null }],
          },
        ]}
        accountsRefreshing
        order={["claude"]}
      />,
    );

    expect(screen.getByText(copy("limits.accounts.refreshing", { count: 2 }))).toBeInTheDocument();
    const rows = screen.getAllByTestId("limit-account-service-row");
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.dataset.refreshing === "true")).toBe(true);
    expect(screen.getByText("30%")).toBeInTheDocument();
    expect(screen.getByText("55%")).toBeInTheDocument();
  });

  it("keeps unknown WorkBuddy Credits distinct from exact zero without exposing account fields", () => {
    render(
      <UsageLimitsPanel
        workbuddy={{
          signed_in: true,
          plan: "PRO",
          account: {
            nickname: "SYNTHETIC_PRIVATE_NICKNAME",
            phone_masked: "SYNTHETIC_PRIVATE_PHONE",
            type: "synthetic",
          },
          groups: [
            {
              id: "base",
              items: null,
              total: null,
              remain: null,
              used: null,
              used_percent: null,
            },
            {
              id: "extra",
              items: 1,
              total: 100,
              remain: 100,
              used: 0,
              used_percent: 0,
            },
          ],
        }}
        order={["workbuddy"]}
      />,
    );

    const rows = screen.getAllByTestId("workbuddy-credit-row");
    const unknownRow = rows.find((row) => row.dataset.group === "base");
    const zeroRow = rows.find((row) => row.dataset.group === "extra");

    expect(unknownRow).toHaveTextContent(copy("data_sources.unknown"));
    expect(unknownRow).not.toHaveTextContent("(null)");
    expect(unknownRow).not.toHaveTextContent(
      copy("limits.workbuddy.credits_used", { used: "0", total: "0" }),
    );
    expect(within(unknownRow).getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
    expect(within(unknownRow).getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext",
      copy("data_sources.unknown"),
    );
    expect(zeroRow).toHaveTextContent(
      copy("limits.workbuddy.credits_used", { used: "0", total: "100" }),
    );
    expect(screen.getByTestId("workbuddy-credits-group")).toHaveTextContent(
      "SYNTHETIC_PRIVATE_NICKNAME",
    );
    expect(screen.getByTestId("workbuddy-credits-group")).toHaveTextContent(
      "SYNTHETIC_PRIVATE_PHONE",
    );
  });
});
