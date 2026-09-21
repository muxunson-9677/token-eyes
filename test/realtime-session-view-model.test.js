"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildRealtimeSessionViewModel } = require("../src/lib/realtime-session-view-model");

test("range summaries include anonymous buckets and merge equal times without inventing requests", () => {
  const usageRows = [
    { source: "codex", session_id: "parent", hour_start: "2026-09-21T08:00:00Z", total_tokens: 10, input_tokens: 8, output_tokens: 2, record_kind: "aggregate_bucket" },
    { source: "codex", hour_start: "2026-09-21T08:00:00Z", total_tokens: 20, input_tokens: 15, output_tokens: 5, record_kind: "aggregate_bucket" },
    { source: "codex", session_id: "child", hour_start: "2026-09-21T09:00:00Z", total_tokens: 5, input_tokens: 4, output_tokens: 1, record_kind: "request_event", request_count: 1 },
  ];
  const view = buildRealtimeSessionViewModel({ usageRows, lifecycleSessions: [
    { sessionId: "parent", agent: "codex", status: "running" },
    { sessionId: "child", parentSessionId: "parent", agent: "codex", status: "running" },
    { sessionId: "grandchild", parentSessionId: "child", agent: "codex", status: "running" },
  ] });
  assert.equal(view.summary.realtime_tokens.value, 35);
  const range = view.agent_range_summary.find((item) => item.source === "codex");
  assert.equal(range.total_tokens.value, 35);
  assert.equal(range.input_tokens.value, 27);
  assert.equal(range.request_count.value, null);
  assert.deepEqual(range.activity_points.map((point) => point.total_tokens), [30, 5]);
  assert.equal(view.requests.length, 1);
  assert.equal(view.requests[0].record_kind, "request_event");
  assert.equal(view.usage_records.length, 3);
  assert.deepEqual(view.usage_records.map((row) => row.record_kind).sort(), ["aggregate_bucket", "aggregate_bucket", "request_event"]);
  assert.equal(view.session_tree[0].children[0].children[0].session_id, "grandchild");
});

test("range trend groups request times into half-hour buckets and keeps absent costs unknown", () => {
  const view = buildRealtimeSessionViewModel({ usageRows: [
    { source: "hermes", timestamp: "2026-09-21T08:01:00Z", total_tokens: 10, record_kind: "request_event", request_count: 1 },
    { source: "hermes", timestamp: "2026-09-21T08:29:59Z", total_tokens: 20, record_kind: "request_event", request_count: 1 },
    { source: "hermes", timestamp: "2026-09-21T08:30:00Z", total_tokens: 5, record_kind: "request_event", request_count: 1 },
  ] });
  assert.deepEqual(view.agent_range_summary[0].activity_points, [
    { observed_at: "2026-09-21T08:00:00.000Z", total_tokens: 30 },
    { observed_at: "2026-09-21T08:30:00.000Z", total_tokens: 5 },
  ]);
  assert.equal(view.agent_range_summary[0].api_equivalent_usd.value, null);
  assert.equal(view.agent_range_summary[0].request_count.value, 3);
  assert.equal(view.sessions.length, 0);
});

test("an unpriced contributing bucket keeps the Agent range cost unknown", () => {
  const view = buildRealtimeSessionViewModel({ usageRows: [
    { source: "codex", total_tokens: 10, cost_usd: 0.02 },
    { source: "codex", total_tokens: 20, cost_usd: null },
  ] });
  assert.equal(view.agent_range_summary[0].total_tokens.value, 30);
  assert.equal(view.agent_range_summary[0].api_equivalent_usd.value, null);
  assert.equal(view.agent_range_summary[0].api_equivalent_usd.evidence_state, "connected_no_exact_data");
});

test("does not let a half-hour usage bucket hide a newer task lifecycle event", () => {
  const result = buildRealtimeSessionViewModel({
    usageRows: [{ session_id: "new", source: "codex", hour_start: "2026-09-12T15:30:00Z", total_tokens: 1 }],
    lifecycleSessions: [{ sessionId: "new", agent: "codex", status: "running", updatedAt: "2026-09-12T15:33:36Z" }],
  });
  assert.equal(result.sessions[0].last_activity_at, "2026-09-12T15:33:36Z");
});

test("uses lifecycle state when available and only marks usage-only sessions as recent activity", () => {
  const result = buildRealtimeSessionViewModel({
    observedAt: "2026-08-21T08:00:00.000Z",
    usageRows: [
      { session_id: "usage-only", source: "codex", total_tokens: 12, cost_usd: 0.01 },
      { session_id: "known", source: "codex", total_tokens: 24, cost_usd: 0.02 },
    ],
    lifecycleSessions: [{ sessionId: "known", agent: "Codex", status: "running" }],
  });

  assert.equal(result.sessions.find((session) => session.session_id === "known").state, "running");
  assert.equal(result.sessions.find((session) => session.session_id === "usage-only").state, "recent_activity");
  assert.equal(result.summary.active_agents.value, 1);
});

test("keeps usage-only Agent runtime unknown without lifecycle evidence", () => {
  const result = buildRealtimeSessionViewModel({
    usageRows: [{ session_id: "old", source: "claude", total_tokens: 12 }],
    lifecycleSessions: [{ sessionId: "live", agent: "codex", status: "running" }],
    agentHistory: [
      { source: "codex", agent_label: "Codex", history_state: "historical_usage", total_tokens: { value: 1 } },
      { source: "claude", agent_label: "Claude", history_state: "historical_usage", total_tokens: { value: 12 } },
    ],
  });

  assert.equal(result.agent_history.find((item) => item.source === "codex").runtime_state, "running");
  assert.equal(result.agent_history.find((item) => item.source === "claude").runtime_state, "unknown");
  assert.equal(result.summary.active_agents.value, 1);
});

test("uses the Codex lifecycle source when a completed session has no usage row", () => {
  const view = buildRealtimeSessionViewModel({
    observedAt: "2026-08-22T00:00:00.000Z",
    lifecycleSessions: [{ sessionId: "completed", agent: "codex", status: "completed", updatedAt: "2026-08-22T00:00:00.000Z" }],
  });
  assert.equal(view.sessions[0].source, "codex");
  assert.equal(view.sessions[0].agent_label, "codex");
});

test("keeps missing token and price values unknown instead of converting them to zero", () => {
  const result = buildRealtimeSessionViewModel({
    usageRows: [{ session_id: "unknown-usage", source: "codex" }],
  });

  assert.equal(result.sessions[0].total_tokens.value, null);
  assert.equal(result.sessions[0].api_equivalent_usd.value, null);
  assert.equal(result.summary.realtime_tokens.value, null);
  assert.equal(result.summary.api_equivalent_value.value, null);
});

test("keeps each missing token component unknown when only a total is available", () => {
  const result = buildRealtimeSessionViewModel({
    usageRows: [{ session_id: "total-only", source: "codex", total_tokens: 12 }],
  });

  assert.equal(result.sessions[0].total_tokens.value, 12);
  assert.equal(result.sessions[0].input_tokens.value, null);
  assert.equal(result.sessions[0].output_tokens.value, null);
  assert.equal(result.sessions[0].cached_input_tokens.value, null);
  assert.equal(result.sessions[0].input_tokens.evidence_state, "connected_no_exact_data");
});

test("does not turn lifecycle metadata into a local request record", () => {
  const result = buildRealtimeSessionViewModel({
    lifecycleSessions: [{ sessionId: "active", agent: "Codex", model: "gpt-5.6-terra", status: "running" }],
  });

  assert.equal(result.sessions[0].request_count.value, null);
  assert.equal(result.sessions[0].evidence.record_count, 0);
  assert.equal(result.sessions[0].evidence.source_kind, "lifecycle_metadata");
});

test("keeps a running task session-specific while exposing its Agent's readable daily aggregate separately", () => {
  const result = buildRealtimeSessionViewModel({
    usageRows: [{ session_id: "earlier-codex-session", source: "codex", total_tokens: 120, input_tokens: 100, output_tokens: 20, cost_usd: 0.03, hour_start: "2026-08-25T01:00:00.000Z" }],
    lifecycleSessions: [{ sessionId: "active-codex-session", agent: "codex", status: "running", taskLabel: "当前活跃任务" }],
  });

  const active = result.sessions.find((session) => session.session_id === "active-codex-session");
  assert.equal(active.total_tokens.value, null, "a different session's usage must not be misattributed to this task");
  assert.equal(active.agent_day_usage.total_tokens.value, 120);
  assert.equal(active.agent_day_usage.api_equivalent_usd.value, 0.03);
  assert.equal(active.agent_day_activity_points.length, 1);
});

test("projects agent history through a privacy-safe whitelist", () => {
  const result = buildRealtimeSessionViewModel({
    lifecycleSessions: [{ sessionId: "live", agent: "codex", status: "running" }],
    agentHistory: [{
      source: "codex", agent_label: "Codex", history_state: "historical_usage", record_count: 1,
      observed_from: "2026-08-01T00:00:00.000Z", observed_to: "2026-08-02T00:00:00.000Z",
      total_tokens: { value: 12, unit: "tokens", evidence_state: "exact" },
      api_equivalent_usd: { value: 0.02, unit: "USD", evidence_state: "estimated" },
      prompt: "must not escape", local_path: "must not escape", arbitrary: "must not escape",
    }],
  });

  assert.equal(JSON.stringify(result).includes("must not escape"), false);
  assert.deepEqual(Object.keys(result.agent_history[0]).sort(), [
    "agent_label", "api_equivalent_usd", "history_state", "observed_from", "observed_to", "record_count", "runtime_state", "source", "total_tokens",
  ]);
  assert.equal(result.agent_history[0].runtime_state, "running");
});

test("uses a privacy-safe task label without exposing the internal task reference", () => {
  const result = buildRealtimeSessionViewModel({
    usageRows: [{ session_id: "safe-session", source: "codex", total_tokens: 12 }],
    lifecycleSessions: [{ sessionId: "safe-session", agent: "Codex", status: "running", taskRef: "task-secret", taskLabel: "Codex 当前会话" }],
  });

  assert.equal(result.sessions[0].task_label, "Codex 当前会话");
  assert.equal(result.sessions[0].task_label.includes("task-secret"), false);
});

test("keeps the official safe task title as the focused-session label", () => {
  const result = buildRealtimeSessionViewModel({
    lifecycleSessions: [{
      sessionId: "safe-session",
      agent: "Codex",
      status: "running",
      taskRef: "internal-task-reference",
      taskLabel: "完善价值对比与实时会话",
      updatedAt: "2026-08-24T08:30:00.000Z",
    }],
  });

  assert.equal(result.sessions[0].task_label, "完善价值对比与实时会话");
  assert.equal(JSON.stringify(result.sessions).includes("internal-task-reference"), true);
  assert.equal(result.sessions[0].task_label.includes("internal-task-reference"), false);
});

test("forms an agent tree only from explicit parent links", () => {
  const result = buildRealtimeSessionViewModel({
    observedAt: "2026-08-21T08:00:00.000Z",
    usageRows: [
      { session_id: "parent", source: "codex", total_tokens: 12 },
      { session_id: "child", parent_session_id: "parent", source: "codex", total_tokens: 5 },
      { session_id: "same-project", source: "codex", project_label: "same", total_tokens: 7 },
    ],
  });

  const parent = result.session_tree.find((node) => node.session_id === "parent");
  assert.deepEqual(parent.children.map((child) => child.session_id), ["child"]);
  assert.ok(result.session_tree.some((node) => node.session_id === "same-project"));
});

test("only exposes whitelisted public metadata and makes revisions stable", () => {
  const input = {
    observedAt: "2026-08-21T08:00:00.000Z",
    usageRows: [{
      session_id: "safe-session",
      source: "codex",
      agent_label: "Codex",
      total_tokens: 12,
      prompt: "must not escape",
      request_body: "must not escape",
      authorization: "must not escape",
    }],
  };

  const first = buildRealtimeSessionViewModel(input);
  const second = buildRealtimeSessionViewModel(input);
  const serialized = JSON.stringify(first);

  assert.equal(first.revision, second.revision);
  assert.equal(serialized.includes("must not escape"), false);
  assert.equal(first.sessions[0].total_tokens.value, 12);
});

test("retains native resource units independently of token totals", () => {
  const result = buildRealtimeSessionViewModel({
    observedAt: "2026-08-21T08:00:00.000Z",
    usageRows: [{ session_id: "one", source: "codex", total_tokens: 12 }],
    nativeResources: [{ provider: "WorkBuddy", value: 2300, unit: "credits" }],
  });

  assert.equal(result.summary.realtime_tokens.value, 12);
  assert.deepEqual(result.native_resources, [{ provider: "WorkBuddy", value: 2300, unit: "credits" }]);
});

test("aggregates safe token components and activity without exposing request content", () => {
  const result = buildRealtimeSessionViewModel({
    observedAt: "2026-08-21T08:00:00.000Z",
    usageRows: [
      { session_id: "one", source: "codex", hour_start: "2026-08-21T07:00:00.000Z", input_tokens: 40, output_tokens: 10, cached_input_tokens: 5, total_tokens: 55, cost_usd: 0.04, prompt: "secret" },
      { session_id: "one", source: "codex", hour_start: "2026-08-21T08:00:00.000Z", input_tokens: 30, output_tokens: 20, cached_input_tokens: 10, total_tokens: 60, cost_usd: 0.06, request_body: "secret" },
    ],
  });

  const session = result.sessions[0];
  assert.equal(session.total_tokens.value, 115);
  assert.equal(session.input_tokens.value, 70);
  assert.equal(session.output_tokens.value, 30);
  assert.equal(session.cached_input_tokens.value, 15);
  assert.equal(session.request_count.value, null, "aggregate buckets are not request events");
  assert.deepEqual(result.activity_points.map((point) => point.total_tokens), [55, 60]);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("request counts require request-level evidence for every contributing row", () => {
  for (const [counts, expected] of [[[1, 1], 2], [[1, null], null], [[0], 0]]) {
    const result = buildRealtimeSessionViewModel({ usageRows: counts.map((request_count) => ({
      source: "codex", session_id: "one", total_tokens: 10, request_count,
    })) });
    assert.equal(result.sessions[0].request_count.value, expected);
  }
});

test("reports coverage as distinct known-price models instead of session count", () => {
  const result = buildRealtimeSessionViewModel({
    usageRows: [
      { session_id: "one", source: "codex", model: "priced-model", total_tokens: 12, cost_usd: 0 },
      { session_id: "two", source: "codex", model: "priced-model", total_tokens: 8, cost_usd: 0.02 },
      { session_id: "three", source: "claude", model: "unknown-model", total_tokens: 6, cost_usd: null },
    ],
  });

  assert.deepEqual(result.pricing_coverage, {
    covered_models: 1,
    total_models: 2,
    percent: 50,
    uncovered_models: ["unknown-model"],
  });
});

test("counts a lifecycle-only model as uncovered instead of omitting it", () => {
  const result = buildRealtimeSessionViewModel({
    lifecycleSessions: [{ sessionId: "active", agent: "Codex", model: "gpt-5.6-terra", status: "running" }],
  });

  assert.deepEqual(result.pricing_coverage, {
    covered_models: 0,
    total_models: 1,
    percent: 0,
    uncovered_models: ["gpt-5.6-terra"],
  });
});

test("adds privacy-safe collection and public-pricing evidence to a real session", () => {
  const result = buildRealtimeSessionViewModel({
    observedAt: "2026-08-21T08:30:00.000Z",
    usageRows: [
      {
        session_id: "safe-session",
        source: "codex",
        model: "priced-model",
        hour_start: "2026-08-21T07:00:00.000Z",
        total_tokens: 40,
        cost_usd: 0.02,
        pricing_version: "2026-08-21",
        source_url: "https://example.test/pricing",
        prompt: "secret prompt",
      },
      {
        session_id: "safe-session",
        source: "codex",
        model: "priced-model",
        hour_start: "2026-08-21T08:00:00.000Z",
        total_tokens: 60,
        cost_usd: 0.03,
        pricing_version: "2026-08-21",
        source_url: "https://example.test/pricing",
        request_body: "secret request",
      },
    ],
  });

  const session = result.sessions[0];
  assert.deepEqual(session.evidence, {
    source_kind: "local_usage_log",
    record_count: 2,
    observed_from: "2026-08-21T07:00:00.000Z",
    observed_to: "2026-08-21T08:00:00.000Z",
    safe_record_refs: ["session:safe-session"],
    pricing: {
      state: "estimated",
      model: "priced-model",
      source_url: "https://example.test/pricing",
      version: "2026-08-21",
    },
  });
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("computes the current-day duration from the first and last message metadata", () => {
  const result = buildRealtimeSessionViewModel({
    observedAt: "2026-08-21T22:30:00.000Z",
    todayKey: "2026-08-21",
    usageRows: [
      {
        session_id: "safe-session",
        source: "codex",
        activity_day: "2026-08-21",
        first_message_at: "2026-08-21T06:00:00.000Z",
        last_message_at: "2026-08-21T22:00:00.000Z",
        message_span_state: "exact",
        total_tokens: 12,
      },
    ],
  });

  assert.equal(result.sessions[0].duration_minutes.value, 16 * 60);
  assert.equal(result.sessions[0].duration_minutes.evidence_state, "exact");
  assert.equal(result.sessions[0].task_ref, "safe-session");
});

test("keeps a one-message duration as a real zero and no-message duration unknown", () => {
  const oneMessage = buildRealtimeSessionViewModel({
    todayKey: "2026-08-21",
    usageRows: [{
      session_id: "one-message",
      source: "codex",
      activity_day: "2026-08-21",
      first_message_at: "2026-08-21T06:00:00.000Z",
      last_message_at: "2026-08-21T06:00:00.000Z",
      message_span_state: "exact",
    }],
  });
  const noMessage = buildRealtimeSessionViewModel({
    todayKey: "2026-08-21",
    lifecycleSessions: [{ sessionId: "no-message", agent: "codex", status: "running" }],
  });

  assert.equal(oneMessage.sessions[0].duration_minutes.value, 0);
  assert.equal(oneMessage.sessions[0].duration_minutes.evidence_state, "exact");
  assert.equal(noMessage.sessions[0].duration_minutes.value, null);
  assert.equal(noMessage.sessions[0].duration_minutes.evidence_state, "connected_no_exact_data");
});

test("builds a session-scoped activity series for the current-task sparkline", () => {
  const result = buildRealtimeSessionViewModel({
    usageRows: [
      { session_id: "focus", source: "codex", hour_start: "2026-08-21T08:30:00.000Z", total_tokens: 30 },
      { session_id: "other", source: "claude", hour_start: "2026-08-21T08:45:00.000Z", total_tokens: 999 },
      { session_id: "focus", source: "codex", hour_start: "2026-08-21T08:00:00.000Z", total_tokens: 10 },
    ],
  });

  assert.deepEqual(result.sessions.find((session) => session.session_id === "focus").activity_points, [
    { observed_at: "2026-08-21T08:00:00.000Z", total_tokens: 10 },
    { observed_at: "2026-08-21T08:30:00.000Z", total_tokens: 30 },
  ]);
});
