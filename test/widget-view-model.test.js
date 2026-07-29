"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildWidgetViewModel,
  flattenUsageLimitsPayload,
} = require("../src/lib/widget-view-model");

test("builds filtered status, limits, model totals, and one pending reset", () => {
  const result = buildWidgetViewModel({
    agent: "codex",
    usage: [
      { agent: "codex", model: "gpt-5", tokens: 80, costUsd: 1.2 },
      { agent: "codex", model: "gpt-5-mini", tokens: 20, costUsd: 0.1 },
      { agent: "claude", model: "claude-opus", tokens: 999, costUsd: 9 },
    ],
    sessions: [
      {
        agent: "codex",
        projectId: "project-green",
        projectLabel: "Green",
        sessionId: "green-1",
        status: "completed",
        updatedAt: "2026-07-29T08:03:00.000Z",
      },
      {
        agent: "codex",
        projectId: "project-red",
        projectLabel: "Red",
        sessionId: "red-1",
        status: "error",
        updatedAt: "2026-07-29T08:02:00.000Z",
      },
      {
        agent: "codex",
        projectId: "project-yellow",
        projectLabel: "Yellow",
        sessionId: "yellow-1",
        status: "running",
        updatedAt: "2026-07-29T08:01:00.000Z",
      },
    ],
    limits: [
      {
        id: "codex:default:5h",
        agent: "codex",
        provider: "Codex",
        accountLabel: "Codex Plus · A1B2",
        window: "5h",
        usedPercent: 21,
        resetAt: "2026-07-29T12:00:00.000Z",
      },
      {
        id: "claude:default:5h",
        agent: "claude",
        provider: "Claude",
        accountLabel: "Claude Max",
        window: "5h",
        usedPercent: 55,
        resetAt: "2026-07-29T12:00:00.000Z",
      },
    ],
    pendingResets: [{
      id: "reset-safe",
      type: "official_reset_announcement",
      agent: "codex",
      occurred_at: "2026-07-29T08:00:00.000Z",
      title: "Codex limits reset",
      source_url: "https://x.com/thsottiaux/status/2082317452755751098",
      alertEligible: true,
    }],
  });

  assert.deepEqual(result.agents, ["all", "claude", "codex", "cursor", "hermes"]);
  assert.equal(result.selectedAgent, "codex");
  assert.deepEqual(
    result.projectStatus.projects.map((project) => project.id),
    ["project-red", "project-yellow", "project-green"],
  );
  assert.deepEqual(
    {
      red: result.projectStatus.red,
      yellow: result.projectStatus.yellow,
      green: result.projectStatus.green,
    },
    { red: 1, yellow: 1, green: 1 },
  );
  assert.equal(result.limits.length, 1);
  assert.equal(result.limits[0].usedPercent, 21);
  assert.equal(result.totals.tokens, 100);
  assert.equal(result.totals.costUsd, 1.3);
  assert.deepEqual(
    result.totals.models.map((model) => [model.name, model.share]),
    [["gpt-5", 80], ["gpt-5-mini", 20]],
  );
  assert.deepEqual(result.pendingReset, {
    id: "reset-safe",
    agent: "codex",
    window: null,
    occurredAt: "2026-07-29T08:00:00.000Z",
    previousUsedPercent: null,
    currentUsedPercent: null,
  });
});

test("deduplicates archived and active copies of one session and keeps the newest status", () => {
  const result = buildWidgetViewModel({
    sessions: [
      {
        agent: "codex",
        projectId: "project-a",
        projectLabel: "Token Eyes",
        sessionId: "same-session",
        status: "completed",
        updatedAt: "2026-07-29T07:00:00.000Z",
      },
      {
        agent: "codex",
        projectId: "project-a",
        projectLabel: "Token Eyes",
        sessionId: "same-session",
        status: "running",
        updatedAt: "2026-07-29T08:00:00.000Z",
      },
    ],
  });

  assert.equal(result.projectStatus.projects[0].sessions.length, 1);
  assert.equal(result.projectStatus.projects[0].sessions[0].status, "yellow");
  assert.deepEqual(
    {
      red: result.projectStatus.red,
      yellow: result.projectStatus.yellow,
      green: result.projectStatus.green,
    },
    { red: 0, yellow: 1, green: 0 },
  );
});

test("returns compact empty states and does not expose raw paths or unknown fields", () => {
  const secretPath = "C:\\Users\\alice\\secret-project";
  const result = buildWidgetViewModel({
    agent: "cursor",
    usage: [],
    sessions: [{
      agent: "cursor",
      projectId: secretPath,
      projectLabel: secretPath,
      sessionId: "session-safe",
      status: "stale",
      prompt: "do not expose",
      updatedAt: "2026-07-29T08:00:00.000Z",
    }],
    limits: [],
    pendingResets: [],
  });

  assert.deepEqual(result.projectStatus, {
    red: 0,
    yellow: 0,
    green: 0,
    unknown: 1,
    projects: [{
      id: result.projectStatus.projects[0].id,
      label: "secret-project",
      red: 0,
      yellow: 0,
      green: 0,
      unknown: 1,
      sessions: [{
        id: "session-safe",
        label: "session-safe",
        status: "unknown",
        updatedAt: "2026-07-29T08:00:00.000Z",
      }],
    }],
  });
  assert.equal(JSON.stringify(result).includes("Users"), false);
  assert.equal(JSON.stringify(result).includes("prompt"), false);
  assert.deepEqual(result.limits, []);
  assert.deepEqual(result.totals, { tokens: 0, costUsd: 0, models: [] });
  assert.equal(result.pendingReset, null);
});

test("an official extra reset alert overrides the capsule regardless of the selected agent", () => {
  const result = buildWidgetViewModel({
    agent: "claude",
    pendingResets: [{
      id: "codex-reset",
      type: "official_reset_announcement",
      agent: "codex",
      occurred_at: "2026-07-29T08:00:00.000Z",
      alertEligible: true,
    }],
  });
  assert.equal(result.selectedAgent, "claude");
  assert.equal(result.pendingReset.id, "codex-reset");
  assert.equal(result.pendingReset.agent, "codex");
});

test("local rolling-window events never replace the widget capsule", () => {
  const result = buildWidgetViewModel({
    pendingResets: [
      {
        id: "upcoming",
        type: "reset_upcoming",
        agent: "codex",
        window: "rolling_5_hour",
        occurredAt: "2026-07-29T07:00:00.000Z",
        alertEligible: true,
      },
      {
        id: "recovered",
        type: "manual_reset",
        agent: "codex",
        window: "rolling_5_hour",
        occurredAt: "2026-07-29T07:30:00.000Z",
        alertEligible: false,
      },
    ],
  });
  assert.equal(result.pendingReset, null);
});

test("flattens the existing usage-limit payload without credentials", () => {
  const limits = flattenUsageLimitsPayload({
    fetched_at: "2026-07-29T08:00:00.000Z",
    codex: {
      configured: true,
      plan_label: "Codex Plus",
      primary_window: {
        used_percent: 21,
        limit_window_seconds: 18_000,
        reset_at: 1785312000,
      },
      secondary_window: {
        used_percent: 44,
        limit_window_seconds: 604_800,
        reset_at: 1785916800,
      },
      access_token: "must-not-leak",
    },
  });

  assert.deepEqual(limits.map((item) => ({
    agent: item.agent,
    provider: item.provider,
    accountLabel: item.accountLabel,
    window: item.window,
    usedPercent: item.usedPercent,
  })), [
    {
      agent: "codex",
      provider: "Codex",
      accountLabel: "Codex Plus",
      window: "5h",
      usedPercent: 21,
    },
    {
      agent: "codex",
      provider: "Codex",
      accountLabel: "Codex Plus",
      window: "7d",
      usedPercent: 44,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(limits), /access_token|must-not-leak/u);
});
