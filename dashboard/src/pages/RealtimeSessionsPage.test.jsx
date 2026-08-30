import React from "react";
import fs from "node:fs";
import path from "node:path";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "../lib/copy";
import { LIMIT_PROVIDER_IDS } from "../lib/limits-providers.js";
import { LIMITS_DISPLAY_CHANGE_EVENT } from "../hooks/use-limits-display-prefs.js";
import { RealtimeSessionsPage } from "./RealtimeSessionsPage.jsx";

const realtimeStyles = fs.readFileSync(
  path.resolve(process.cwd(), "src/ui/foundation/apple-glass.css"),
  "utf8",
);

const { getRealtimeSessions, peekRealtimeSessions } = vi.hoisted(() => ({ getRealtimeSessions: vi.fn(), peekRealtimeSessions: vi.fn(() => null) }));
vi.mock("../lib/api", () => ({ getRealtimeSessions, peekRealtimeSessions }));

const metric = (value) => ({ value, unit: "tokens", evidence_state: "exact" });
const session = {
  session_id: "safe-session", source: "codex", agent_label: "Codex", state: "running", model: "gpt-5", project_label: "Project A", last_activity_at: "2026-08-21T08:00:00.000Z",
  task_ref: "task-abc123def456", task_label: "完善价值对比与实时会话", duration_minutes: { value: 960, unit: "minutes", evidence_state: "exact" },
  activity_points: [
    { observed_at: "2026-08-21T07:00:00.000Z", total_tokens: 20 },
    { observed_at: "2026-08-21T07:30:00.000Z", total_tokens: 65 },
    { observed_at: "2026-08-21T08:00:00.000Z", total_tokens: 100 },
  ],
  total_tokens: metric(100), input_tokens: metric(60), output_tokens: metric(30), cached_input_tokens: metric(10), cache_creation_input_tokens: metric(0), reasoning_output_tokens: metric(0), request_count: metric(2), api_equivalent_usd: { value: 0.2, unit: "USD", evidence_state: "estimated" },
};
const payload = {
  observed_at: "2026-08-21T08:00:00.000Z",
  sessions: [session],
  session_tree: [{ ...session, children: [] }],
  activity_points: [{ observed_at: "2026-08-21T08:00:00.000Z", total_tokens: 100, source: "codex" }],
  requests: [{ record_ref: "request:safe-session:0", session_ref: "session:safe-session", observed_at: "2026-08-21T08:00:00.000Z", source: "codex", model: "gpt-5", total_tokens: metric(100), api_equivalent_usd: { value: 0.2, unit: "USD", evidence_state: "estimated" } }],
  summary: { active_agents: metric(1), realtime_tokens: metric(100), api_equivalent_value: { value: 0.2, unit: "USD", evidence_state: "estimated" } },
  agent_history: [
    { source: "codex", agent_label: "Codex", runtime_state: "running", history_state: "historical_usage", record_count: 1, total_tokens: metric(100), api_equivalent_usd: { value: 0.2, unit: "USD", evidence_state: "estimated" } },
    { source: "cursor", agent_label: "Cursor", runtime_state: "idle", history_state: "historical_usage", record_count: 1, total_tokens: metric(90), api_equivalent_usd: { value: 0.1, unit: "USD", evidence_state: "estimated" } },
    { source: "claude", agent_label: "Claude Code", history_state: "historical_usage", record_count: 1, total_tokens: metric(80), api_equivalent_usd: { value: 0.1, unit: "USD", evidence_state: "estimated" } },
    { source: "hermes", agent_label: "Hermes Agent", history_state: "historical_usage", record_count: 1, total_tokens: metric(70), api_equivalent_usd: { value: 0.1, unit: "USD", evidence_state: "estimated" } },
    { source: "workbuddy", agent_label: "WorkBuddy", history_state: "historical_usage", record_count: 1, total_tokens: metric(60), api_equivalent_usd: { value: 0.1, unit: "USD", evidence_state: "estimated" }, native_resources: [{ provider: "workbuddy", label: "remaining", value: 180, unit: "Credits", evidence_state: "exact" }, { provider: "workbuddy", label: "today_consumed", value: 12, unit: "Credits", evidence_state: "observed" }] },
    { source: "trae", agent_label: "Trae", history_state: "installed_no_history", record_count: 0, total_tokens: metric(null), api_equivalent_usd: { value: null, unit: "USD", evidence_state: "connected_no_exact_data" } },
    { source: "codebuddy", agent_label: "CodeBuddy", history_state: "installed_no_history", record_count: 0, total_tokens: metric(null), api_equivalent_usd: { value: null, unit: "USD", evidence_state: "connected_no_exact_data" } },
    { source: "deepseek-harness", agent_label: "DeepSeek Harness", history_state: "historical_usage", record_count: 1, total_tokens: metric(50), api_equivalent_usd: { value: 0.1, unit: "USD", evidence_state: "estimated" } },
  ],
};

function setVisibleAgents(agentIds) {
  const visible = new Set(agentIds);
  window.localStorage.setItem(
    "tt.limits.providerOrder",
    JSON.stringify(LIMIT_PROVIDER_IDS),
  );
  window.localStorage.setItem(
    "tt.limits.providerVisibility",
    JSON.stringify(Object.fromEntries(
      LIMIT_PROVIDER_IDS.map((id) => [id, visible.has(id)]),
    )),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  peekRealtimeSessions.mockReset();
  peekRealtimeSessions.mockReturnValue(null);
  globalThis.ResizeObserver = class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fill: vi.fn(), closePath: vi.fn(),
  });
});

afterEach(() => vi.restoreAllMocks());

describe("RealtimeSessionsPage", () => {
  it("gives an already-selected Agent card a deeper pointer-down state", () => {
    expect(realtimeStyles).toMatch(
      /\.rt-session-mini\.tt-pressable\[aria-pressed="true"\]:active\s*\{[^}]*transform:\s*translateY\(2px\)\s*scale\(\.985\)/u,
    );
  });

  it("renders cached Agent cards only from the limits allowlist and updates them without reload", () => {
    const cachedPayload = {
      ...payload,
      agent_history: [
        { ...payload.agent_history[0], source: " CODEX ", agent_label: "Cached Codex" },
        { ...payload.agent_history[2], agent_label: "Hidden Claude" },
        { ...payload.agent_history[1], agent_label: "Hidden Cursor" },
        { ...payload.agent_history[3], source: "unknown-cache", agent_label: "Unknown Cache" },
      ],
    };
    setVisibleAgents(["codex"]);
    peekRealtimeSessions.mockReturnValue(cachedPayload);
    getRealtimeSessions.mockImplementation(() => new Promise(() => {}));

    render(<RealtimeSessionsPage />);

    expect(document.querySelectorAll(".rt-session-mini")).toHaveLength(1);
    expect(screen.getByText("Cached Codex")).toBeInTheDocument();
    expect(screen.queryByText("Hidden Claude")).not.toBeInTheDocument();
    expect(screen.queryByText("Hidden Cursor")).not.toBeInTheDocument();
    expect(screen.queryByText("Unknown Cache")).not.toBeInTheDocument();

    act(() => {
      setVisibleAgents(["claude"]);
      window.dispatchEvent(new CustomEvent(LIMITS_DISPLAY_CHANGE_EVENT));
    });

    expect(screen.queryByText("Cached Codex")).not.toBeInTheDocument();
    expect(screen.getByText("Hidden Claude")).toBeInTheDocument();

    act(() => {
      setVisibleAgents([]);
      window.dispatchEvent(new CustomEvent(LIMITS_DISPLAY_CHANGE_EVENT));
    });

    expect(document.querySelector(".rt-session-strip")).toBeNull();
    expect(document.querySelector(".rt-session-mini")).toBeNull();
  });

  it("renders the cached realtime aggregate immediately while refreshing in the background", () => {
    peekRealtimeSessions.mockReturnValue(payload);
    getRealtimeSessions.mockImplementation(() => new Promise(() => {}));
    render(<RealtimeSessionsPage />);
    expect(screen.getByText("完善价值对比与实时会话")).toBeVisible();
    expect(screen.queryByText(copy("realtime.loading"))).not.toBeInTheDocument();
  });

  it("uses only live runtime states in every Agent card badge", async () => {
    getRealtimeSessions.mockResolvedValue(payload);
    render(<RealtimeSessionsPage />);
    await screen.findAllByText("Codex");
    const states = [...document.querySelectorAll(".rt-mini-state")].map((node) => node.textContent.trim());
    expect(states).toContain(copy("realtime.state.running"));
    expect(states.every((state) => [copy("realtime.state.running"), copy("realtime.state.idle")].includes(state))).toBe(true);
    expect(states).not.toContain(copy("realtime.state.recent_activity"));
  });
  it("does not abort and restart a slow in-flight refresh on the polling interval", async () => {
    vi.useFakeTimers();
    const focus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    let resolveRequest;
    getRealtimeSessions.mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve; }));
    const view = render(<RealtimeSessionsPage />);
    try {
      await act(async () => {});
      expect(getRealtimeSessions).toHaveBeenCalledTimes(1);
      await act(async () => { vi.advanceTimersByTime(15_000); });
      expect(getRealtimeSessions).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => { resolveRequest?.(payload); });
      view.unmount();
      focus.mockRestore();
      vi.useRealTimers();
    }
  });

  it("changes live range and refreshes instead of presenting static chrome", async () => {
    const user = userEvent.setup();
    getRealtimeSessions.mockResolvedValue(payload);
    render(<RealtimeSessionsPage />);
    await screen.findAllByText("Codex");
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByText(/^Agent \d+$/)).not.toBeInTheDocument();
    expect(document.querySelector('img[src="/brand-logos/codex.svg"]')).not.toBeNull();
    await act(async () => { await user.click(screen.getByRole("button", { name: copy("realtime.agent.next") })); });
    expect(await screen.findByText("Trae")).toBeInTheDocument();
    expect(screen.getByTitle(copy("realtime.history.trae_pending_detail"))).toBeInTheDocument();
    await act(async () => { await user.click(screen.getByRole("button", { name: copy("realtime.agent.next") })); });
    expect(await screen.findByText("CodeBuddy")).toBeInTheDocument();
    const traeCard = screen.getByText("Trae").closest(".rt-session-mini");
    const codeBuddyCard = screen.getByText("CodeBuddy").closest(".rt-session-mini");
    expect(traeCard).toHaveTextContent(copy("realtime.history.trae_pending_metric"));
    expect(traeCard.querySelector(".rt-mini-state")).toHaveTextContent(copy("realtime.state.idle"));
    expect(codeBuddyCard).toHaveTextContent(copy("realtime.history.no_usage_metric"));
    expect(codeBuddyCard.querySelector(".rt-mini-state")).toHaveTextContent(copy("realtime.state.idle"));
    expect(traeCard).not.toHaveTextContent(copy("value_realtime.data_unavailable"));
    expect(codeBuddyCard).not.toHaveTextContent(copy("value_realtime.data_unavailable"));
    await act(async () => { await user.click(screen.getByRole("button", { name: copy("realtime.agent.next") })); });
    expect(screen.queryByText("DeepSeek Harness")).not.toBeInTheDocument();
    expect(await screen.findByText("总积分 180")).toBeInTheDocument();
    expect(await screen.findByText("已消耗 12")).toBeInTheDocument();
    const previous = screen.getByRole("button", { name: copy("realtime.agent.previous") });
    const next = screen.getByRole("button", { name: copy("realtime.agent.next") });
    const controls = previous.parentElement;
    const strip = controls?.parentElement;
    expect(controls).toHaveClass("rt-session-controls");
    expect(controls?.firstElementChild).toBe(previous);
    expect(controls?.lastElementChild).toBe(next);
    expect(strip?.firstElementChild).toHaveClass("rt-session-viewport");
    expect(strip?.lastElementChild).toBe(controls);
    await act(async () => { await user.selectOptions(screen.getByRole("combobox", { name: copy("realtime.range.select") }), "7d"); });
    await waitFor(() => expect(getRealtimeSessions).toHaveBeenLastCalledWith("7d", expect.any(AbortSignal), undefined));
    await act(async () => { await user.click(screen.getByRole("button", { name: new RegExp(copy("realtime.updated")) })); });
    await waitFor(() => expect(getRealtimeSessions).toHaveBeenCalledTimes(3));
  });

  it("uses a truthful current-range caption before a second refresh instead of a waiting placeholder", async () => {
    getRealtimeSessions.mockResolvedValue(payload);
    render(<RealtimeSessionsPage />);
    expect(await screen.findAllByText(copy("realtime.current_range"))).toHaveLength(4);
    expect(screen.queryByText(copy("realtime.no_change"))).not.toBeInTheDocument();
  });

  it("switches between real safe aggregation views", async () => {
    const user = userEvent.setup();
    getRealtimeSessions.mockResolvedValue(payload);
    render(<RealtimeSessionsPage />);
    expect(await screen.findByText("完善价值对比与实时会话")).toBeInTheDocument();
    expect(document.querySelector(".rt-focus-task")).not.toHaveTextContent(/当前会话|当前绘画/u);
    expect(screen.queryByText(/任务标识|abc123def456/)).not.toBeInTheDocument();
    const durationCell = screen.getByText(copy("realtime.duration")).closest("div");
    expect(durationCell).toHaveTextContent("16 小时");
    expect(screen.queryByTestId("focus-art")).not.toBeInTheDocument();
    await act(async () => { await user.click(screen.getByRole("tab", { name: copy("realtime.tabs.requests") })); });
    expect(await screen.findByText("100 Token")).toBeInTheDocument();
    expect(screen.getByText("request:safe-session:0")).toBeInTheDocument();
    await act(async () => { await user.click(screen.getByRole("tab", { name: copy("realtime.tabs.children") })); });
    expect(await screen.findByText(copy("realtime.tree.empty"))).toBeInTheDocument();
  });

  it("focuses the newest running task when multiple conversations exist", async () => {
    getRealtimeSessions.mockResolvedValue({
      ...payload,
      sessions: [
        { ...session, session_id: "older", task_label: "较早运行任务", last_activity_at: "2026-08-24T08:00:00.000Z" },
        { ...session, session_id: "newer", task_label: "最新活跃绘画任务", last_activity_at: "2026-08-24T09:00:00.000Z" },
      ],
    });
    render(<RealtimeSessionsPage />);
    expect(await screen.findByText("最新活跃绘画任务")).toBeInTheDocument();
    expect(document.querySelector(".rt-focus-task")).not.toHaveTextContent("较早运行任务");
  });

  it("draws the current-task sparkline from the focused session series", async () => {
    getRealtimeSessions.mockResolvedValue(payload);
    render(<RealtimeSessionsPage />);
    const sparkline = await screen.findByTestId("focus-sparkline");
    expect(sparkline).toHaveAttribute("data-point-count", "3");
    expect(sparkline).toHaveAttribute("data-series-signature", "20,65,100");
    expect(document.querySelector(".rt-mini-wave .lucide-activity")).toBeNull();
  });

  it("labels a lifecycle-only task with its Agent's readable daily aggregate without mislabeling it as session usage", async () => {
    getRealtimeSessions.mockResolvedValue({
      ...payload,
      sessions: [{
        ...session,
        total_tokens: metric(null), input_tokens: metric(null), output_tokens: metric(null), request_count: metric(null),
        api_equivalent_usd: { value: null, unit: "USD", evidence_state: "connected_no_exact_data" },
        activity_points: [],
        agent_day_usage: {
          total_tokens: metric(100), input_tokens: metric(60), output_tokens: metric(30), request_count: metric(2),
          api_equivalent_usd: { value: 0.2, unit: "USD", evidence_state: "estimated" },
        },
        agent_day_activity_points: session.activity_points,
      }],
    });
    render(<RealtimeSessionsPage />);
    expect((await screen.findAllByText(copy("realtime.agent_today_total"))).length).toBeGreaterThan(0);
    const sparkline = await screen.findByTestId("focus-sparkline");
    expect(sparkline).toHaveAttribute("data-point-count", "3");
    expect(document.querySelector(".rt-focus")).toHaveTextContent("当前 Agent 今日累计100");
  });

  it("shows an explicit state when the focused session has no readable trend", async () => {
    getRealtimeSessions.mockResolvedValue({ ...payload, sessions: [{ ...session, activity_points: [] }] });
    render(<RealtimeSessionsPage />);
    expect(await screen.findByText(copy("realtime.task_trend.unavailable"))).toBeInTheDocument();
    expect(screen.queryByTestId("focus-sparkline")).not.toBeInTheDocument();
  });

  it("shows an explicit unreadable state instead of zero for WorkBuddy points", async () => {
    getRealtimeSessions.mockResolvedValue({
      ...payload,
      agent_history: [{
        ...payload.agent_history.find((agent) => agent.source === "workbuddy"),
        native_resources: [{ provider: "workbuddy", label: "remaining", value: null, unit: "Credits", evidence_state: "unavailable" }, { provider: "workbuddy", label: "today_consumed", value: null, unit: "Credits", evidence_state: "unavailable" }],
      }],
    });
    render(<RealtimeSessionsPage />);
    const card = (await screen.findByText("WorkBuddy")).closest(".rt-session-mini");
    expect(card).toHaveTextContent("积分");
    expect(card).toHaveTextContent(copy("value_realtime.data_unavailable"));
    expect(card).not.toHaveTextContent("Credits");
    expect(card).not.toHaveTextContent("0 积分");
  });

  it("shows WorkBuddy total and consumed points as two aligned metrics", async () => {
    getRealtimeSessions.mockResolvedValue({
      ...payload,
      agent_history: [{
        ...payload.agent_history.find((agent) => agent.source === "workbuddy"),
        native_resources: [
          { provider: "workbuddy", label: "remaining", value: 3880, unit: "Credits", evidence_state: "exact" },
          { provider: "workbuddy", label: "today_consumed", value: 55.5, unit: "Credits", evidence_state: "observed" },
        ],
      }],
    });
    render(<RealtimeSessionsPage />);
    const card = (await screen.findByText("WorkBuddy")).closest(".rt-session-mini");
    expect(card).toHaveTextContent("总积分 3880");
    expect(card).toHaveTextContent("已消耗 55.5");
    expect(card).not.toHaveTextContent("基础");
    expect(card).not.toHaveTextContent("活跃");
    expect(card.querySelectorAll(".rt-mini-data > span")).toHaveLength(2);
    expect(card).not.toHaveTextContent("Credits");
    expect(card).not.toHaveTextContent("$0.10");
  });

  it("uses an explicit unavailable state instead of a dash for every missing visible datum", async () => {
    const unknownMetric = { value: null, unit: "tokens", evidence_state: "connected_no_exact_data" };
    getRealtimeSessions.mockResolvedValue({
      ...payload,
      observed_at: null,
      activity_points: [],
      requests: [],
      sessions: [{
        ...session,
        model: null,
        last_activity_at: null,
        total_tokens: unknownMetric,
        input_tokens: unknownMetric,
        output_tokens: unknownMetric,
        cached_input_tokens: unknownMetric,
        cache_creation_input_tokens: unknownMetric,
        request_count: unknownMetric,
        api_equivalent_usd: { value: null, unit: "USD", evidence_state: "connected_no_exact_data" },
      }],
      summary: {
        active_agents: metric(1),
        realtime_tokens: unknownMetric,
        api_equivalent_value: { value: null, unit: "USD", evidence_state: "connected_no_exact_data" },
      },
    });
    render(<RealtimeSessionsPage />);
    await screen.findAllByText(copy("value_realtime.data_unavailable"));
    const exactDashes = Array.from(document.querySelectorAll("body *"))
      .filter((node) => node.children.length === 0 && node.textContent?.trim() === "—");
    expect(exactDashes).toHaveLength(0);
  });

  it("gives every audited Agent card a brand icon and explicit data state", async () => {
    const user = userEvent.setup();
    getRealtimeSessions.mockResolvedValue(payload);
    render(<RealtimeSessionsPage />);
    await screen.findAllByText("Codex");
    const seen = new Set();
    const expectedIcons = {
      "Claude Code": "/brand-logos/claude-code.svg",
      CodeBuddy: "/brand-logos/codebuddy.svg",
      Codex: "/brand-logos/codex.svg",
      Cursor: "/brand-logos/cursor.svg",
      "Hermes Agent": "/brand-logos/hermes.svg",
      Trae: "/brand-logos/trae.svg",
      WorkBuddy: "/brand-logos/codebuddy.svg",
    };
    const auditVisibleCards = () => {
      for (const card of document.querySelectorAll(".rt-session-mini")) {
        const name = card.querySelector(".rt-mini-name span")?.textContent;
        if (!name) continue;
        seen.add(name);
        expect(card.querySelector("img")).toHaveAttribute("src", expectedIcons[name]);
        expect(card.querySelector(".rt-mini-state")?.textContent.trim()).not.toBe("");
      }
    };
    auditVisibleCards();
    for (let index = 0; index < 3; index += 1) {
      await act(async () => { await user.click(screen.getByRole("button", { name: copy("realtime.agent.next") })); });
      auditVisibleCards();
    }
    expect([...seen].sort()).toEqual([
      "Claude Code", "CodeBuddy", "Codex", "Cursor", "Hermes Agent", "Trae", "WorkBuddy",
    ]);
  });

  it("uses the page month selector for Agent history while keeping the green badge as runtime state", async () => {
    const user = userEvent.setup();
    getRealtimeSessions.mockImplementation(async (_range, _signal, requestedMonth) => ({
      ...payload,
      data_month: requestedMonth || "2026-08",
      range_from: requestedMonth === "2026-07" ? "2026-07-01" : "2026-08-21",
      range_to: requestedMonth === "2026-07" ? "2026-07-31" : "2026-08-21",
      available_months: ["2026-08", "2026-07"],
    }));
    render(<RealtimeSessionsPage />);
    const codexCard = (await screen.findAllByText("Codex")).map((node) => node.closest(".rt-session-mini")).find(Boolean);
    expect(codexCard.querySelector(".rt-mini-state")).toHaveTextContent(copy("realtime.state.running"));
    expect(codexCard.querySelector(".rt-mini-state")).not.toHaveTextContent(copy("realtime.history.six_month"));
    await act(async () => {
      await user.selectOptions(screen.getByRole("combobox", { name: copy("realtime.month.select") }), "2026-07");
    });
    await waitFor(() => expect(getRealtimeSessions).toHaveBeenLastCalledWith("month", expect.any(AbortSignal), "2026-07"));
    expect(screen.getByRole("combobox", { name: copy("realtime.range.select") })).toHaveValue("month");
    expect(screen.getByTestId("realtime-range-window")).toHaveTextContent("2026-07-01 至 2026-07-31");
  });

  it("ignores an older response that resolves after a newer range response", async () => {
    const user = userEvent.setup();
    let resolveToday;
    let resolveSevenDays;
    getRealtimeSessions
      .mockImplementationOnce(() => new Promise((resolve) => { resolveToday = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSevenDays = resolve; }));
    render(<RealtimeSessionsPage />);
    await act(async () => {
      await user.selectOptions(screen.getByRole("combobox", { name: copy("realtime.range.select") }), "7d");
    });
    await act(async () => {
      resolveSevenDays({ ...payload, sessions: [{ ...session, task_label: "newer seven day response" }] });
    });
    expect(await screen.findByText("newer seven day response")).toBeInTheDocument();
    await act(async () => {
      resolveToday({ ...payload, sessions: [{ ...session, task_label: "stale today response" }] });
    });
    expect(screen.queryByText("stale today response")).not.toBeInTheDocument();
    expect(screen.getByText("newer seven day response")).toBeInTheDocument();
  });

  it("does not show the previous range while an uncached range is loading", async () => {
    const user = userEvent.setup();
    getRealtimeSessions
      .mockResolvedValueOnce({
        ...payload,
        range_from: "2026-08-21",
        range_to: "2026-08-21",
        sessions: [{ ...session, task_label: "today-only task" }],
      })
      .mockImplementationOnce(() => new Promise(() => {}));

    render(<RealtimeSessionsPage />);
    expect(await screen.findByText("today-only task")).toBeInTheDocument();

    await act(async () => {
      await user.selectOptions(
        screen.getByRole("combobox", { name: copy("realtime.range.select") }),
        "7d",
      );
    });

    expect(screen.getByRole("combobox", { name: copy("realtime.range.select") })).toHaveValue("7d");
    expect(screen.queryByText("today-only task")).not.toBeInTheDocument();
    expect(screen.getByText(copy("realtime.loading"))).toBeInTheDocument();
  });

  it("gives every expandable side-card summary the shared press and focus contract", async () => {
    getRealtimeSessions.mockResolvedValue(payload);
    render(<RealtimeSessionsPage />);
    await screen.findByText("完善价值对比与实时会话");

    const summaries = document.querySelectorAll(".rt-side-card > summary");
    expect(summaries).toHaveLength(3);
    for (const summary of summaries) {
      expect(summary).toHaveClass("tt-pressable", "tt-product-focusable");
    }
  });

  it("selects an Agent card with mouse and derives task, model, sparkline, and requests from that session", async () => {
    const user = userEvent.setup();
    const cursorSession = {
      ...session,
      session_id: "cursor-session",
      source: "cursor",
      agent_label: "Cursor",
      state: "idle",
      model: "cursor-model",
      task_label: "Cursor selected task",
      total_tokens: metric(222),
      input_tokens: metric(200),
      output_tokens: metric(22),
      request_count: metric(1),
      api_equivalent_usd: { value: 0.4, unit: "USD", evidence_state: "estimated" },
      activity_points: [
        { observed_at: "2026-08-21T07:00:00.000Z", total_tokens: 10 },
        { observed_at: "2026-08-21T08:00:00.000Z", total_tokens: 222 },
      ],
    };
    getRealtimeSessions.mockResolvedValue({
      ...payload,
      sessions: [session, cursorSession],
      session_tree: [{ ...session, children: [] }, { ...cursorSession, children: [] }],
      requests: [
        ...payload.requests,
        { ...payload.requests[0], record_ref: "request:cursor-session:0", session_ref: "session:cursor-session", source: "cursor", model: "cursor-model", total_tokens: metric(222) },
      ],
    });

    render(<RealtimeSessionsPage />);
    const cursorCard = await screen.findByRole("button", { name: /Cursor/u });
    expect(document.querySelectorAll('.rt-session-mini[aria-pressed="true"]')).toHaveLength(1);
    expect([...document.querySelectorAll(".rt-kpi-value")].map((node) => node.textContent)).toEqual(["1", "100", "$0.20"]);
    await act(async () => { await user.click(cursorCard); });

    expect(cursorCard).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelectorAll('.rt-session-mini[aria-pressed="true"]')).toHaveLength(1);
    expect(screen.getByText("Cursor selected task")).toBeInTheDocument();
    expect([...document.querySelectorAll(".rt-kpi-value")].map((node) => node.textContent)).toEqual(["0", "222", "$0.40"]);
    expect(document.querySelector(".rt-focus")).toHaveTextContent("cursor-model");
    expect(screen.getByTestId("focus-sparkline")).toHaveAttribute("data-series-signature", "10,222");
    await act(async () => { await user.click(screen.getByRole("tab", { name: copy("realtime.tabs.requests") })); });
    expect(screen.getByText("request:cursor-session:0")).toBeInTheDocument();
    expect(screen.queryByText("request:safe-session:0")).not.toBeInTheDocument();
  });

  it("shows a truthful empty detail when the selected Agent has no session", async () => {
    const user = userEvent.setup();
    getRealtimeSessions.mockResolvedValue(payload);
    render(<RealtimeSessionsPage />);
    expect(await screen.findByText("完善价值对比与实时会话")).toBeInTheDocument();

    await act(async () => { await user.click(screen.getByRole("button", { name: copy("realtime.agent.next") })); });
    await act(async () => { await user.click(screen.getByRole("button", { name: /Trae/u })); });

    expect(screen.queryByText("完善价值对比与实时会话")).not.toBeInTheDocument();
    expect(screen.queryByTestId("focus-sparkline")).not.toBeInTheDocument();
    expect(document.querySelector(".rt-focus")).toBeNull();
    expect(screen.getAllByText(copy("realtime.empty")).length).toBeGreaterThan(0);
  });

  it("supports native keyboard selection and keeps one selected indicator while paging", async () => {
    const user = userEvent.setup();
    getRealtimeSessions.mockResolvedValue(payload);
    render(<RealtimeSessionsPage />);
    const cursorCard = await screen.findByRole("button", { name: /Cursor/u });
    cursorCard.focus();
    await act(async () => { await user.keyboard("{Enter}"); });
    expect(cursorCard).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Codex/u })).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelectorAll('.rt-session-mini[aria-pressed="true"]')).toHaveLength(1);

    const next = screen.getByRole("button", { name: copy("realtime.agent.next") });
    await act(async () => { await user.click(next); });
    expect(document.querySelectorAll('.rt-session-mini[aria-pressed="true"]')).toHaveLength(1);
    expect(document.querySelector('.rt-session-mini[aria-pressed="true"]')).toBeVisible();

    const selected = document.querySelector('.rt-session-mini[aria-pressed="true"]');
    selected.focus();
    await act(async () => { await user.keyboard(" "); });
    expect(selected).toHaveAttribute("aria-pressed", "true");
    expect(selected).toHaveClass("tt-pressable", "tt-product-focusable");
  });
});
