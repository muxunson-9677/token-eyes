import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { copy } from "../lib/copy";
import { RealtimeSessionsPage } from "./RealtimeSessionsPage.jsx";

const getRealtimeSessions = vi.fn();
vi.mock("../lib/api", () => ({ getRealtimeSessions }));

const metric = (value) => ({ value, unit: "tokens", evidence_state: "exact" });
const session = {
  session_id: "safe-session", source: "codex", agent_label: "Codex", state: "running", model: "gpt-5", project_label: "Project A", last_activity_at: "2026-08-21T08:00:00.000Z",
  total_tokens: metric(100), input_tokens: metric(60), output_tokens: metric(30), cached_input_tokens: metric(10), cache_creation_input_tokens: metric(0), reasoning_output_tokens: metric(0), request_count: metric(2), api_equivalent_usd: { value: 0.2, unit: "USD", evidence_state: "estimated" },
};
const payload = { observed_at: "2026-08-21T08:00:00.000Z", sessions: [session], session_tree: [{ ...session, children: [] }], activity_points: [{ observed_at: "2026-08-21T08:00:00.000Z", total_tokens: 100, source: "codex" }], summary: { active_agents: metric(1), realtime_tokens: metric(100), api_equivalent_value: { value: 0.2, unit: "USD", evidence_state: "estimated" } } };

afterEach(() => vi.restoreAllMocks());

describe("RealtimeSessionsPage", () => {
  it("changes live range and refreshes instead of presenting static chrome", async () => {
    const user = userEvent.setup();
    getRealtimeSessions.mockResolvedValue(payload);
    render(<RealtimeSessionsPage />);
    await screen.findByText("Codex");
    await user.selectOptions(screen.getByRole("combobox", { name: copy("realtime.range.select") }), "7d");
    await waitFor(() => expect(getRealtimeSessions).toHaveBeenLastCalledWith("7d", expect.any(AbortSignal)));
    await user.click(screen.getByRole("button", { name: new RegExp(copy("realtime.updated")) }));
    await waitFor(() => expect(getRealtimeSessions).toHaveBeenCalledTimes(3));
  });

  it("switches between real safe aggregation views", async () => {
    const user = userEvent.setup();
    getRealtimeSessions.mockResolvedValue(payload);
    render(<RealtimeSessionsPage />);
    await screen.findByText("Project A");
    await user.click(screen.getByRole("tab", { name: copy("realtime.tabs.requests") }));
    expect(await screen.findByText("100 Token")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: copy("realtime.tabs.children") }));
    expect(await screen.findByText(copy("realtime.tree.empty"))).toBeInTheDocument();
  });
});
