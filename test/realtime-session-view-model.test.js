"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildRealtimeSessionViewModel } = require("../src/lib/realtime-session-view-model");

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
  assert.equal(session.request_count.value, 2);
  assert.deepEqual(result.activity_points.map((point) => point.total_tokens), [55, 60]);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});
