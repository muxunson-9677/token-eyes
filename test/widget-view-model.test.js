"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildWidgetViewModel,
  flattenUsageLimitsPayload,
} = require("../src/lib/widget-view-model");

const NOW_MS = Date.parse("2026-07-29T08:30:00.000Z");

test("builds filtered status, limits, model totals, and one pending reset", () => {
  const result = buildWidgetViewModel({
    nowMs: NOW_MS,
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
    nowMs: NOW_MS,
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

test("keeps ordinary interruptions neutral and preserves exact alert states and task titles", () => {
  const result = buildWidgetViewModel({
    nowMs: NOW_MS,
    sessions: [
      {
        agent: "codex",
        projectId: "project-a",
        projectLabel: "Token Eyes",
        sessionId: "019-interrupted",
        sessionLabel: "执行代码修复",
        status: "interrupted",
        updatedAt: "2026-07-29T08:20:00.000Z",
      },
      {
        agent: "codex",
        projectId: "project-a",
        projectLabel: "Token Eyes",
        sessionId: "019-approval",
        sessionLabel: "检查发布方案",
        status: "waiting_approval",
        updatedAt: "2026-07-29T08:19:00.000Z",
      },
      {
        agent: "codex",
        projectId: "project-a",
        projectLabel: "Token Eyes",
        sessionId: "019-error",
        sessionLabel: "生成安装包",
        status: "error",
        updatedAt: "2026-07-29T08:18:00.000Z",
      },
    ],
  });

  assert.deepEqual(
    {
      red: result.projectStatus.red,
      yellow: result.projectStatus.yellow,
      green: result.projectStatus.green,
      unknown: result.projectStatus.unknown,
    },
    { red: 2, yellow: 0, green: 0, unknown: 1 },
  );
  const sessions = new Map(
    result.projectStatus.projects[0].sessions.map((session) => [session.id, session]),
  );
  assert.deepEqual(sessions.get("019-interrupted"), {
    id: "019-interrupted",
    label: "执行代码修复",
    status: "stopped",
    state: "stopped",
    updatedAt: "2026-07-29T08:20:00.000Z",
  });
  assert.equal(sessions.get("019-approval").status, "red");
  assert.equal(sessions.get("019-approval").state, "waiting_approval");
  assert.equal(sessions.get("019-error").status, "red");
  assert.equal(sessions.get("019-error").state, "error");
});

test("returns compact empty states and does not expose raw paths or unknown fields", () => {
  const secretPath = "C:\\Users\\alice\\secret-project";
  const result = buildWidgetViewModel({
    nowMs: NOW_MS,
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
    recentProjects: [{
      id: result.projectStatus.projects[0].id,
      label: "secret-project",
      updatedAt: "2026-07-29T08:00:00.000Z",
    }],
    projects: [{
      id: result.projectStatus.projects[0].id,
      label: "secret-project",
      red: 0,
      yellow: 0,
      green: 0,
      unknown: 1,
      sessions: [{
        id: "session-safe",
        label: null,
        status: "unknown",
        state: "unknown",
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

test("offers stale sessions as recent project choices without marking them active", () => {
  const sessions = [
    {
      agent: "codex",
      projectId: "project-old",
      projectLabel: "Old Project",
      sessionId: "old-newer",
      status: "completed",
      updatedAt: new Date(NOW_MS - 61 * 60_000).toISOString(),
    },
    {
      agent: "codex",
      projectId: "project-old",
      projectLabel: "Old Project",
      sessionId: "old-older",
      status: "completed",
      updatedAt: new Date(NOW_MS - 2 * 60 * 60_000).toISOString(),
    },
    ...Array.from({ length: 11 }, (_, index) => ({
      agent: "codex",
      projectId: `recent-${index + 1}`,
      projectLabel: `Recent ${index + 1}`,
      sessionId: `recent-session-${index + 1}`,
      status: "completed",
      updatedAt: new Date(NOW_MS - (index + 2) * 60 * 60_000).toISOString(),
    })),
  ];

  const result = buildWidgetViewModel({ nowMs: NOW_MS, sessions });

  assert.deepEqual(result.projectStatus.projects, []);
  assert.equal(result.projectStatus.recentProjects.length, 10);
  assert.deepEqual(result.projectStatus.recentProjects[0], {
    id: "project-old",
    label: "Old Project",
    updatedAt: new Date(NOW_MS - 61 * 60_000).toISOString(),
  });
  assert.equal(
    result.projectStatus.recentProjects.filter((project) => project.id === "project-old").length,
    1,
  );
  assert.equal(
    result.projectStatus.recentProjects.some((project) => project.id === "recent-10"),
    false,
  );
});

test("defaults active status to one hour and supports the five approved windows", () => {
  const sessions = [
    {
      agent: "codex",
      projectId: "project-45m",
      projectLabel: "45 minutes",
      sessionId: "session-45m",
      status: "running",
      updatedAt: new Date(NOW_MS - 45 * 60_000).toISOString(),
    },
    {
      agent: "codex",
      projectId: "project-2h",
      projectLabel: "2 hours",
      sessionId: "session-2h",
      status: "running",
      updatedAt: new Date(NOW_MS - 2 * 60 * 60_000).toISOString(),
    },
    {
      agent: "codex",
      projectId: "project-2d",
      projectLabel: "2 days",
      sessionId: "session-2d",
      status: "running",
      updatedAt: new Date(NOW_MS - 2 * 24 * 60 * 60_000).toISOString(),
    },
  ];

  const visibleIds = (activeSessionWindow) => buildWidgetViewModel({
    nowMs: NOW_MS,
    sessions,
    activeSessionWindow,
  }).projectStatus.projects.map((project) => project.id).sort();

  assert.deepEqual(visibleIds(undefined), ["project-45m"]);
  assert.deepEqual(visibleIds("30m"), ["project-45m"]);
  assert.deepEqual(visibleIds("1h"), ["project-45m"]);
  assert.deepEqual(visibleIds("3h"), ["project-2h", "project-45m"]);
  assert.deepEqual(visibleIds("5h"), ["project-2h", "project-45m"]);
  assert.deepEqual(visibleIds("1d"), ["project-2h", "project-45m"]);
  assert.deepEqual(visibleIds("3d"), ["project-2d", "project-2h", "project-45m"]);
});

test("keeps only the newest ten sessions active within the selected window", () => {
  const sessions = Array.from({ length: 12 }, (_, index) => ({
    agent: "codex",
    projectId: index % 2 === 0 ? "project-a" : "project-b",
    projectLabel: index % 2 === 0 ? "Project A" : "Project B",
    sessionId: `fresh-${index}`,
    status: index % 3 === 0 ? "error" : index % 3 === 1 ? "running" : "completed",
    updatedAt: new Date(NOW_MS - index * 60_000).toISOString(),
  }));
  sessions.push(
    {
      agent: "codex",
      projectId: "project-stale",
      projectLabel: "Stale",
      sessionId: "stale-red",
      status: "error",
      updatedAt: new Date(NOW_MS - 60 * 60_000 - 1).toISOString(),
    },
    {
      agent: "codex",
      projectId: "project-stale",
      projectLabel: "Stale",
      sessionId: "stale-yellow",
      status: "running",
      updatedAt: new Date(NOW_MS - 24 * 60 * 60_000).toISOString(),
    },
    {
      agent: "codex",
      projectId: "project-stale",
      projectLabel: "Stale",
      sessionId: "stale-green",
      status: "completed",
      updatedAt: new Date(NOW_MS - 7 * 24 * 60 * 60_000).toISOString(),
    },
  );

  const result = buildWidgetViewModel({ nowMs: NOW_MS, sessions });
  const visibleSessions = result.projectStatus.projects
    .flatMap((project) => project.sessions);

  assert.equal(visibleSessions.length, 10);
  assert.equal(result.projectStatus.projects.some((project) => project.id === "project-stale"), false);
  assert.deepEqual(
    visibleSessions.map((session) => session.id).sort(),
    Array.from({ length: 10 }, (_, index) => `fresh-${index}`),
  );
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
