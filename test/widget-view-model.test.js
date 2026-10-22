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

  assert.ok(result.agents.includes("deepseek-harness"));
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
  assert.equal(result.limits[0].accountLabel, "Codex Plus · A1B2");
  assert.equal(Object.hasOwn(result.limits[0], "accountState"), false);
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
        taskLabel: "执行代码修复",
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
      sessionIds: ["session-safe"],
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
    sessionIds: ["old-newer", "old-older"],
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

test("does not expose provider windows when no Token plan is configured", () => {
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

  assert.deepEqual(limits, []);
  assert.doesNotMatch(JSON.stringify(limits), /access_token|must-not-leak/u);
});

test("uses configured token plans as the widget limit source and carries their notes", () => {
  const limits = flattenUsageLimitsPayload({
    codex: {
      configured: true,
      plan_label: "Fallback Plus",
      primary_window: {
        used_percent: 99,
        limit_window_seconds: 18_000,
      },
    },
  }, [
    {
      id: "codex-main",
      source: "codex",
      provider_id: "codex",
      plan_label: "Plus",
      notes: "主力开发账号",
      quota_windows: [
        { kind: "rolling_5_hour", percentage: 42, resets_at: "2026-08-03T01:00:00.000Z" },
        { kind: "rolling_weekly", percentage: 68, resets_at: "2026-08-08T01:00:00.000Z" },
      ],
    },
    {
      id: "cursor-backup",
      source: "cursor",
      provider_id: "cursor",
      plan_label: "Pro",
      notes: "备用套餐",
      total_quota: 100,
      used_quota: 30,
    },
  ]);

  assert.deepEqual(limits.map((item) => ({
    id: item.id,
    planId: item.planId,
    agent: item.agent,
    provider: item.provider,
    planLabel: item.planLabel,
    accountLabel: item.accountLabel,
    window: item.window,
    usedPercent: item.usedPercent,
    notes: item.notes,
  })), [
    {
      id: "codex:codex-main:5h",
      planId: "codex:codex-main",
      agent: "codex",
      provider: "Codex",
      planLabel: "Plus",
      accountLabel: "",
      window: "5 小时",
      usedPercent: 42,
      notes: "主力开发账号",
    },
    {
      id: "codex:codex-main:7d",
      planId: "codex:codex-main",
      agent: "codex",
      provider: "Codex",
      planLabel: "Plus",
      accountLabel: "",
      window: "7 天",
      usedPercent: 68,
      notes: "主力开发账号",
    },
    {
      id: "cursor:cursor-backup",
      planId: "cursor:cursor-backup",
      agent: "cursor",
      provider: "Cursor",
      planLabel: "Pro",
      accountLabel: "",
      window: "Total Usage",
      usedPercent: 30,
      notes: "备用套餐",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(limits), /Fallback Plus|99/u);
});

test("keeps the canonical Cursor quota lanes and plan identity for the widget", () => {
  const limits = flattenUsageLimitsPayload({}, [{
    id: "cursor-main",
    source: "cursor",
    provider_id: "cursor",
    plan_id: "cursor_pro",
    plan_label: "Pro",
    detection_method: "official_account",
    detection_config: {
      official_account: { display_name: "ezequielhuelsxw@outlook.com", plan_name: "free" },
    },
    subscription_amount: 20,
    subscription_currency: "USD",
    subscription_end_date: "2026-08-22",
    quota_windows: [
      { kind: "total", percentage: 100, resets_at: "2026-08-22T04:17:12.000Z" },
      { kind: "rolling_weekly", percentage: 67, resets_at: "2026-08-22T04:17:12.000Z" },
      { kind: "auto_composer", percentage: 62, resets_at: "2026-08-22T04:17:12.000Z" },
      { kind: "api", percentage: 100, resets_at: "2026-08-22T04:17:12.000Z" },
      { kind: "fast_request", percentage: 9 },
    ],
  }]);

  assert.deepEqual(limits.map((item) => ({
    id: item.id,
    kind: item.kind,
    window: item.window,
    planLabel: item.planLabel,
    accountLabel: item.accountLabel,
    subscriptionAmount: item.subscriptionAmount,
    subscriptionCurrency: item.subscriptionCurrency,
  })), [
    {
      id: "cursor:cursor-main:total",
      kind: "total",
      window: "Total Usage",
      planLabel: "Pro",
      accountLabel: "ezequielhuelsxw@outlook.com",
      subscriptionAmount: 20,
      subscriptionCurrency: "USD",
    },
    {
      id: "cursor:cursor-main:auto_composer",
      kind: "auto_composer",
      window: "Auto + Composer Usage",
      planLabel: "Pro",
      accountLabel: "ezequielhuelsxw@outlook.com",
      subscriptionAmount: 20,
      subscriptionCurrency: "USD",
    },
    {
      id: "cursor:cursor-main:api",
      kind: "api",
      window: "API Usage",
      planLabel: "Pro",
      accountLabel: "ezequielhuelsxw@outlook.com",
      subscriptionAmount: 20,
      subscriptionCurrency: "USD",
    },
  ]);
  assert.equal(new Set(limits.map((item) => item.id)).size, limits.length);
  assert.equal(limits.every((item) => item.catalogPlanId === "cursor_pro"), true);
  assert.equal(limits.every((item) => item.reportedPlanName === "free"), true);
  const sanitized = buildWidgetViewModel({ limits }).limits;
  assert.equal(sanitized.every((item) => item.catalogPlanId === "cursor_pro"), true);
  assert.equal(sanitized.every((item) => item.reportedPlanName === "free"), true);
});

test("keeps reset time and plan expiry separate for every widget quota window", () => {
  const limits = flattenUsageLimitsPayload({}, [{
    id: "codex-main",
    source: "codex",
    provider_id: "codex",
    plan_label: "Plus",
    expires_at: "2026-09-01T00:00:00.000Z",
    quota_windows: [
      { kind: "rolling_5_hour", percentage: 20, resets_at: "2026-08-17T05:00:00.000Z" },
      { kind: "rolling_weekly", percentage: 60, resets_at: "2026-08-22T00:00:00.000Z" },
    ],
  }]);

  assert.deepEqual(limits.map((item) => ({
    window: item.window,
    resetAt: item.resetAt,
    expiresAt: item.expiresAt,
  })), [
    {
      window: "5 小时",
      resetAt: "2026-08-17T05:00:00.000Z",
      expiresAt: "2026-09-01T00:00:00.000Z",
    },
    {
      window: "7 天",
      resetAt: "2026-08-22T00:00:00.000Z",
      expiresAt: "2026-09-01T00:00:00.000Z",
    },
  ]);
});

test("keeps an empty plan label for account fallback and carries the subscription start", () => {
  const flattened = flattenUsageLimitsPayload({}, [{
    id: "scheduled-plan",
    source: "codex",
    provider_id: "codex",
    plan_label: "",
    detection_method: "official_account",
    detection_config: {
      official_account: { display_name: "owner@example.com" },
    },
    subscription_start_date: "2026-09-01T00:00:00.000Z",
    total_quota: 100,
    used_quota: 0,
  }]);

  assert.equal(flattened[0].planLabel, "");
  assert.equal(flattened[0].accountLabel, "owner@example.com");
  assert.equal(flattened[0].startsAt, "2026-09-01T00:00:00.000Z");

  const [sanitized] = buildWidgetViewModel({ limits: flattened }).limits;
  assert.equal(sanitized.planLabel, "");
  assert.equal(sanitized.accountLabel, "owner@example.com");
  assert.equal(sanitized.startsAt, "2026-09-01T00:00:00.000Z");
});

test("preserves strict date-only plan boundaries while keeping timestamp semantics exact", () => {
  const flattened = flattenUsageLimitsPayload({}, [{
    id: "calendar-plan",
    source: "codex",
    provider_id: "codex",
    subscription_start_date: "2026-09-01",
    subscription_end_date: "2026-09-30",
    total_quota: 100,
    used_quota: 10,
  }, {
    id: "timestamp-plan",
    source: "codex",
    provider_id: "codex",
    subscription_start_date: "2026-09-01T00:30:00+08:00",
    subscription_end_date: "2026-09-30T23:30:00+08:00",
    total_quota: 100,
    used_quota: 10,
  }]);

  assert.deepEqual(flattened.map(({ startsAt, expiresAt }) => ({ startsAt, expiresAt })), [
    { startsAt: "2026-09-01", expiresAt: "2026-09-30" },
    {
      startsAt: "2026-08-31T16:30:00.000Z",
      expiresAt: "2026-09-30T15:30:00.000Z",
    },
  ]);
  assert.deepEqual(
    buildWidgetViewModel({ limits: flattened }).limits
      .map(({ startsAt, expiresAt }) => ({ startsAt, expiresAt })),
    [
      { startsAt: "2026-09-01", expiresAt: "2026-09-30" },
      {
        startsAt: "2026-08-31T16:30:00.000Z",
        expiresAt: "2026-09-30T15:30:00.000Z",
      },
    ],
  );
});

test("normalizes official Unix reset timestamps without replacing them with the plan expiry", () => {
  const limits = flattenUsageLimitsPayload({}, [{
    id: "codex-main",
    source: "codex",
    provider_id: "codex",
    plan_label: "Pro 20x",
    expires_at: "2026-08-30T14:24:24.000Z",
    quota_windows: [
      { kind: "rolling_weekly", percentage: 48, resets_at: "1787196799" },
      { kind: "gpt_5_3_codex_spark_weekly", percentage: 56, resets_at: 1787198612 },
      { kind: "rolling_5_hour", percentage: 20, resets_at: 1787196799000 },
    ],
  }]);

  assert.deepEqual(limits.map((item) => ({
    window: item.window,
    resetAt: item.resetAt,
    expiresAt: item.expiresAt,
  })), [
    {
      window: "7 天",
      resetAt: "2026-08-20T03:33:19.000Z",
      expiresAt: "2026-08-30T14:24:24.000Z",
    },
    {
      window: "GPT 5.3 Codex Spark",
      resetAt: "2026-08-20T04:03:32.000Z",
      expiresAt: "2026-08-30T14:24:24.000Z",
    },
    {
      window: "5 小时",
      resetAt: "2026-08-20T03:33:19.000Z",
      expiresAt: "2026-08-30T14:24:24.000Z",
    },
  ]);
});

test("keeps official Codex Spark quota-window names instead of collapsing them to other", () => {
  const limits = flattenUsageLimitsPayload({}, [{
    id: "codex-main",
    source: "codex",
    provider_id: "codex",
    plan_label: "Pro 20x",
    quota_windows: [
      {
        kind: "gpt_5_3_codex_spark_5_hour",
        percentage: 42,
      },
      {
        kind: "gpt_5_3_codex_spark_weekly",
        percentage: 56,
      },
    ],
  }]);

  assert.deepEqual(
    limits.map((limit) => ({ id: limit.id, window: limit.window })),
    [
      {
        id: "codex:codex-main:gpt_5_3_codex_spark_5h",
        window: "GPT 5.3 Codex Spark · 5 小时",
      },
      {
        id: "codex:codex-main:gpt_5_3_codex_spark_weekly",
        window: "GPT 5.3 Codex Spark",
      },
    ],
  );
});

test("filters widget usage by DeepSeek Harness when selected", () => {
  const result = buildWidgetViewModel({
    agent: "deepseek-harness",
    usage: [
      { agent: "deepseek-harness", model: "deepseek-v4-flash", tokens: 120, costUsd: 0 },
      { agent: "codex", model: "gpt-5", tokens: 999, costUsd: 1 },
    ],
  });
  assert.equal(result.selectedAgent, "deepseek-harness");
  assert.equal(result.totals.tokens, 120);
});

test('widget preserves unknown cost for unpriced and partially priced usage',()=>{
 for(const costs of [[null],[null,2]]){
  const result=buildWidgetViewModel({usage:costs.map((costUsd,i)=>({agent:'codex',model:'model-'+i,tokens:100,costUsd}))});
  assert.equal(result.totals.costUsd,null);assert.equal(result.totals.models[0].costUsd,null);
 }
 assert.equal(buildWidgetViewModel({usage:[{agent:'codex',model:'free',tokens:100,costUsd:0}]}).totals.costUsd,0);
});
