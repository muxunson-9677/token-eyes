"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");
const { buildValueComparisonViewModel } = require("../src/lib/value-comparison-view-model");

async function callResponse(handler, endpoint) {
  const url = new URL(`http://127.0.0.1${endpoint}`);
  const chunks = [];
  let statusCode = 200;
  const handled = await handler(
    { method: "GET", headers: { host: "127.0.0.1" } },
    { writeHead(status) { statusCode = status; }, end(body) { if (body) chunks.push(body); } },
    url,
  );
  assert.equal(handled, true);
  return { statusCode, body: JSON.parse(chunks.join("")) };
}

async function call(handler, endpoint) {
  return (await callResponse(handler, endpoint)).body;
}

test("value and realtime endpoints return privacy-safe, explicit evidence payloads", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-value-realtime-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    const traeHome = path.join(root, "trae");
    const codexHome = path.join(root, "codex");
    fs.mkdirSync(path.join(traeHome, "ModularData", "ai-agent"), { recursive: true });
    fs.mkdirSync(path.join(codexHome, "sessions", "2026", "08", "21"), { recursive: true });
    fs.writeFileSync(path.join(traeHome, "ModularData", "ai-agent", "token_usage.jsonl"), "{}\n");
    fs.writeFileSync(path.join(codexHome, "sessions", "2026", "08", "21", "rollout-2026-08-21T08-00-00-history-only.jsonl"), `${JSON.stringify({
      timestamp: "2026-08-21T08:00:00.000Z",
      type: "session_meta",
      payload: { id: "local-session", cwd: "C:/safe-project" },
    })}\n${JSON.stringify({
      timestamp: "2026-08-21T08:15:00.000Z",
      type: "event_msg",
      payload: { type: "token_count", info: { total_token_usage: { input_tokens: 40, output_tokens: 10, total_tokens: 50 } } },
    })}\n`);
    fs.writeFileSync(queuePath, `${JSON.stringify({
      source: "claude", model: "claude-sonnet", hour_start: "2026-08-21T08:00:00.000Z",
      input_tokens: 80, output_tokens: 20, total_tokens: 100, conversation_count: 1,
    })}\n`);
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({
      dataDirectories: { trae: traeHome, codex: codexHome },
      tokenPlans: [{
        id: "codex-plan", provider_id: "codex", source: "codex", plan_id: "codex_pro_20x", plan_label: "Pro 20x",
        detection_method: "official_account", sync_status: "success",
        detection_config: { official_account: { account_binding_id: "account/codex/local" } },
      }],
      spendRecords: [{ source: "subscription", amount_usd: 8, start_date: "2026-08-01", end_date: "2026-08-31" }],
    }));
    let rolloutFallbackCalls = 0;
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: root,
      now: () => new Date("2026-08-21T08:30:00.000Z"),
      codexLifecycleProvider: async () => [{
        agent: "codex", sessionId: "local-session", model: "unpriced-lifecycle-model", status: "running", updatedAt: "2026-08-21T08:25:00.000Z",
        taskLabel: "完善价值对比与实时会话",
        sessionLabel: "must not be copied into a prompt or body",
      }],
      codexRolloutRowsProvider: async () => {
        rolloutFallbackCalls += 1;
        return [{
          source: "codex", hour_start: "2026-08-21T08:00:00.000Z", model: "fallback-only",
          total_tokens: 50, input_tokens: 40, output_tokens: 10,
        }];
      },
      detectAllAgentEnvironments: () => [{ agent: "codebuddy", status: "detected" }],
      workbuddyQuotaProvider: async () => ({
        signed_in: true,
        error: null,
        groups: [{ id: "activity", used: 120, total: 300, remain: 180 }],
      }),
    });

    const value = await call(handler, "/functions/tokentracker-value-comparison?range=month");
    assert.equal(value.range, "month");
    assert.equal(value.actual_spend.total_usd.evidence_state, "unsupported");
    assert.equal(value.actual_spend.total_usd.evidence.source_kind, "unavailable");
    assert.equal(value.actual_spend.total_usd.evidence.record_count, 0);
    assert.equal(value.api_equivalent_value.unit, "USD");
    assert.equal(value.api_equivalent_value.value, null, "all-unpriced usage must not become a fake $0.00 value");
    assert.equal(value.value_composition.find((item) => item.key === "unknown")?.value, null);
    assert.equal(value.monthly_trend.length, 6);
    assert.equal(value.monthly_trend[0].actual_spend_usd, null);
    assert.equal(value.monthly_trend[0].api_equivalent_usd, null);
    assert.equal(value.monthly_trend.at(-1).actual_spend_usd, null, "usage without a bill is not exact zero spend");
    assert.equal(value.monthly_trend.at(-1).api_equivalent_usd, null, "an unpriced month is not exact zero value");
    assert.ok(value.actual_composition.some((item) => item.key === "subscription"));
    assert.equal(value.actual_composition.find((item) => item.key === "token_plan")?.display_state, "native_only");
    assert.equal(value.actual_composition.find((item) => item.key === "token_plan")?.native_resources[0].value, 180);
    assert.equal(value.attribution.linked[0].plan_label, "Pro 20x");
    assert.equal(value.attribution.linked[0].association_state, "configured_current_account");
    assert.equal(value.attribution.linked[0].api_equivalent_usd, null);
    assert.equal(value.attribution.unattributed.find((item) => item.source === "claude")?.api_equivalent_usd, null);

    rolloutFallbackCalls = 0;
    const realtime = await call(handler, "/functions/tokentracker-realtime-sessions?range=today");
    assert.equal(typeof realtime.revision, "string");
    assert.equal(realtime.sessions.some((item) => item.state === "running"), true);
    assert.equal(realtime.sessions.find((item) => item.state === "running")?.task_label, "完善价值对比与实时会话");
    assert.equal(realtime.activity_points.length, 2);
    assert.deepEqual(realtime.pricing_coverage, {
      covered_models: 0,
      total_models: 3,
      percent: 0,
      uncovered_models: ["claude-sonnet", "fallback-only", "unpriced-lifecycle-model"],
    });
    assert.equal(realtime.activity_points.find((point) => point.source === "codex").api_equivalent_usd, null);
    assert.equal(Array.isArray(realtime.requests), true);
    assert.equal(realtime.requests.length, 0);
    assert.equal(realtime.sessions.some((item) => item.source === "claude"), false);
    assert.deepEqual(realtime.agent_history.map((item) => [item.source, item.agent_label, item.history_state]), [
      ["claude", "Claude Code", "historical_usage"],
      ["trae", "Trae", "installed_no_history"],
      ["codebuddy", "CodeBuddy", "installed_no_history"],
    ]);
    assert.equal(realtime.agent_history.some((item) => item.source === "codex"), false);
    assert.equal(rolloutFallbackCalls, 1);
    assert.equal(realtime.agent_history[1].total_tokens.value, null);
    assert.deepEqual(realtime.native_resources, [
      { provider: "workbuddy", label: "remaining", value: 180, unit: "Credits", evidence_state: "exact" },
      { provider: "workbuddy", label: "today_consumed", value: 0, unit: "Credits", evidence_state: "observed" },
    ]);
    const publicPayload = JSON.stringify({ value, realtime });
    for (const forbiddenField of ["\"prompt\":", "\"authorization\":", "\"cwd\":", "\"accessToken\":", "\"cookie\":", "\"api_key\":"]) {
      assert.equal(publicPayload.includes(forbiddenField), false);
    }
    assert.equal(publicPayload.includes("safe-project"), false);
    assert.equal(publicPayload.includes("must not be copied into a prompt or body"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("WorkBuddy quota read failure keeps both dashboards available with an explicit unreadable Credits state", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-workbuddy-unreadable-"));
  try {
    const handler = createLocalApiHandler({
      queuePath: path.join(root, "queue.jsonl"),
      trackerDataDir: root,
      now: () => new Date("2026-08-21T08:30:00.000Z"),
      codexLifecycleProvider: async () => [],
      workbuddyQuotaProvider: async () => { throw new Error("injected quota reader failure"); },
    });

    const value = await callResponse(handler, "/functions/tokentracker-value-comparison?range=month");
    const realtime = await callResponse(handler, "/functions/tokentracker-realtime-sessions?range=today");
    const unreadableCredits = [
      { provider: "workbuddy", label: "remaining", value: null, unit: "Credits", evidence_state: "unavailable" },
      { provider: "workbuddy", label: "today_consumed", value: null, unit: "Credits", evidence_state: "unavailable" },
    ];

    assert.equal(value.statusCode, 200);
    assert.deepEqual(value.body.native_resources, unreadableCredits);
    assert.equal(value.body.api_equivalent_value.value, null);
    assert.equal(realtime.statusCode, 200);
    assert.deepEqual(realtime.body.native_resources, unreadableCredits);
    assert.equal(JSON.stringify({ value: value.body, realtime: realtime.body }).includes("injected quota reader failure"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("realtime view reuses an in-range tracked Codex aggregate instead of rescanning rollout history", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-realtime-queue-fast-path-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    fs.writeFileSync(queuePath, `${JSON.stringify({
      source: "codex", model: "gpt-5.6-sol", hour_start: "2026-08-21T08:00:00.000Z",
      input_tokens: 80, output_tokens: 20, total_tokens: 100, conversation_count: 1,
    })}\n`);
    let rolloutFallbackCalls = 0;
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: root,
      now: () => new Date("2026-08-21T08:30:00.000Z"),
      codexLifecycleProvider: async () => [],
      codexRolloutRowsProvider: async () => {
        rolloutFallbackCalls += 1;
        return [];
      },
      workbuddyQuotaProvider: async () => ({ signed_in: false, groups: [] }),
    });

    const realtime = await call(handler, "/functions/tokentracker-realtime-sessions?range=today&tz=UTC&tz_offset_minutes=0");
    assert.equal(realtime.agent_history.find((item) => item.source === "codex")?.total_tokens.value, 100);
    assert.equal(rolloutFallbackCalls, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("realtime view reads the active default lifecycle rollout directly for current-session tokens", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-realtime-active-rollout-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    const codexHome = path.join(root, "codex");
    const sessionDir = path.join(codexHome, "sessions", "2026", "08", "21");
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(queuePath, "");
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ dataDirectories: { codex: codexHome } }));
    fs.writeFileSync(path.join(sessionDir, "rollout-2026-08-18T08-00-00-active.jsonl"), [
      JSON.stringify({ timestamp: "2026-08-21T08:00:00.000Z", type: "session_meta", payload: { id: "active-session", thread_source: "user" } }),
      JSON.stringify({ timestamp: "2026-08-21T08:01:00.000Z", type: "event_msg", payload: { type: "task_started", turn_id: "private-turn" } }),
      JSON.stringify({ timestamp: "2026-08-21T08:02:00.000Z", type: "turn_context", payload: { model: "gpt-5.6-sol" } }),
      JSON.stringify({ timestamp: "2026-08-21T08:03:00.000Z", type: "event_msg", payload: { type: "user_message", message: "private body" } }),
      JSON.stringify({ timestamp: "2026-08-21T08:04:00.000Z", type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 40, output_tokens: 10, total_tokens: 50 } } } }),
    ].join("\n"));
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: root,
      now: () => new Date("2026-08-21T08:30:00.000Z"),
      dataDirectoryPathsResolver: () => ({ codexHome, codexHomes: [codexHome] }),
      workbuddyQuotaProvider: async () => ({ signed_in: false, groups: [] }),
    });

    const realtime = await call(handler, "/functions/tokentracker-realtime-sessions?range=today&tz=UTC&tz_offset_minutes=0");
    const running = realtime.sessions.find((session) => session.state === "running");
    assert.equal(running.total_tokens.value, 50);
    assert.equal(realtime.summary.realtime_tokens.value, 50);
    assert.equal(JSON.stringify(realtime).includes("private body"), false);
    assert.equal(JSON.stringify(realtime).includes(root), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("WorkBuddy connected quota with a missing used value stays unknown instead of becoming exact zero Credits", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-workbuddy-missing-used-"));
  try {
    const handler = createLocalApiHandler({
      queuePath: path.join(root, "queue.jsonl"),
      trackerDataDir: root,
      now: () => new Date("2026-08-21T08:30:00.000Z"),
      codexLifecycleProvider: async () => [],
      workbuddyQuotaProvider: async () => ({
        signed_in: true,
        error: null,
        groups: [{ id: "activity", used: null, total: 300, remain: null }],
      }),
    });

    const value = await callResponse(handler, "/functions/tokentracker-value-comparison?range=month");
    const realtime = await callResponse(handler, "/functions/tokentracker-realtime-sessions?range=today");
    const connectedUnknownCredits = [
      { provider: "workbuddy", label: "remaining", value: null, unit: "Credits", evidence_state: "connected_no_exact_data" },
      { provider: "workbuddy", label: "today_consumed", value: null, unit: "Credits", evidence_state: "connected_no_exact_data" },
    ];

    assert.equal(value.statusCode, 200);
    assert.deepEqual(value.body.native_resources, connectedUnknownCredits);
    assert.equal(realtime.statusCode, 200);
    assert.deepEqual(realtime.body.native_resources, connectedUnknownCredits);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("only an in-range bill can establish exact spend, including an explicit real zero", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-value-bill-range-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    const configPath = path.join(root, "config.json");
    fs.writeFileSync(queuePath, "");
    fs.writeFileSync(configPath, JSON.stringify({
      spendRecords: [{ source: "subscription", amount: 12, currency: "USD", billing_cycle: "monthly", start_date: "2026-07-01", end_date: "2026-07-31" }],
    }));
    const options = {
      queuePath,
      trackerDataDir: root,
      now: () => new Date("2026-08-21T08:30:00.000Z"),
      codexLifecycleProvider: async () => [],
      workbuddyQuotaProvider: async () => ({ signed_in: false, groups: [] }),
    };

    const outsideRange = await call(createLocalApiHandler(options), "/functions/tokentracker-value-comparison?range=today");
    assert.equal(outsideRange.actual_spend.subscription_usd.value, null);
    assert.equal(outsideRange.actual_spend.subscription_usd.evidence_state, "unsupported");

    fs.writeFileSync(configPath, JSON.stringify({
      spendRecords: [{ source: "subscription", amount: 0, currency: "USD", billing_cycle: "monthly", start_date: "2026-08-01", end_date: "2026-08-31" }],
    }));
    const exactZero = await call(createLocalApiHandler(options), "/functions/tokentracker-value-comparison?range=month");
    assert.equal(exactZero.actual_spend.subscription_usd.value, 0);
    assert.equal(exactZero.actual_spend.subscription_usd.evidence_state, "exact");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a requested empty month falls back to the latest month with real local evidence", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-value-month-fallback-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    fs.writeFileSync(queuePath, `${JSON.stringify({
      source: "codex", model: "gpt-5.4", hour_start: "2026-07-18T08:00:00.000Z",
      input_tokens: 1_000, output_tokens: 100, total_tokens: 1_100,
    })}\n`);
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({
      agentDefaultPricing: { codex: { inputUsdPer1M: 2, outputUsdPer1M: 8 } },
      pricing_updated_at: "2026-08-24T00:00:00.000Z",
      agent_default_pricing_updated_at: { codex: "2026-08-24T00:00:00.000Z" },
      spendRecords: [{ source: "subscription", amount: 12, currency: "USD", billing_cycle: "monthly", start_date: "2026-07-01", end_date: "2026-07-31" }],
    }));
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: root,
      now: () => new Date("2026-08-21T08:30:00.000Z"),
      codexLifecycleProvider: async () => [],
      detectAllAgentEnvironments: () => [],
      workbuddyQuotaProvider: async () => ({ signed_in: false, groups: [] }),
    });

    const value = await call(handler, "/functions/tokentracker-value-comparison?range=month&month=2026-08&tz=UTC&tz_offset_minutes=0");
    assert.equal(value.requested_month, "2026-08");
    assert.equal(value.data_month, "2026-07");
    assert.equal(value.fallback_applied, true);
    assert.deepEqual(value.month_options, ["2026-08", "2026-07", "2026-06", "2026-05", "2026-04", "2026-03"]);
    assert.ok(value.available_months.includes("2026-07"));
    assert.equal(value.actual_spend.subscription_usd.value, 12);
    assert.ok(value.recognized_tokens.value > 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a requested month with usage but no bill falls back to the latest comparable billed month", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-value-comparable-month-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    fs.writeFileSync(queuePath, [
      { source: "codex", model: "gpt-5.4", hour_start: "2026-08-18T08:00:00.000Z", input_tokens: 1_000, output_tokens: 100, total_tokens: 1_100 },
      { source: "codex", model: "gpt-5.4", hour_start: "2026-07-18T08:00:00.000Z", input_tokens: 2_000, output_tokens: 200, total_tokens: 2_200 },
    ].map((row) => JSON.stringify(row)).join("\n") + "\n");
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({
      agentDefaultPricing: { codex: { inputUsdPer1M: 2, outputUsdPer1M: 8 } },
      pricing_updated_at: "2026-08-24T00:00:00.000Z",
      agent_default_pricing_updated_at: { codex: "2026-08-24T00:00:00.000Z" },
      spendRecords: [{ source: "codex", amount: 12, currency: "USD", billing_cycle: "monthly", start_date: "2026-07-01", end_date: "2026-07-31" }],
    }));
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: root,
      now: () => new Date("2026-08-21T08:30:00.000Z"),
      codexLifecycleProvider: async () => [],
      detectAllAgentEnvironments: () => [],
      workbuddyQuotaProvider: async () => ({ signed_in: false, groups: [] }),
    });

    const value = await call(handler, "/functions/tokentracker-value-comparison?range=month&month=2026-08&tz=UTC&tz_offset_minutes=0");
    assert.equal(value.requested_month, "2026-08");
    assert.equal(value.data_month, "2026-07");
    assert.equal(value.fallback_applied, true);
    assert.equal(value.actual_spend.subscription_usd.value, 12);
    assert.ok(value.recognized_tokens.value > 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("value comparison falls back per category and exposes WorkBuddy points without converting them to dollars", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-value-category-fallback-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    fs.writeFileSync(queuePath, [
      { source: "codex", model: "priced", hour_start: "2026-08-18T08:00:00.000Z", billing_mode: "token_plan", input_tokens: 1_000, output_tokens: 100, total_tokens: 1_100 },
      { source: "claude", model: "priced", hour_start: "2026-07-18T08:00:00.000Z", billing_mode: "api_key", input_tokens: 2_000, output_tokens: 200, total_tokens: 2_200 },
    ].map((row) => JSON.stringify(row)).join("\n") + "\n");
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({
      agentDefaultPricing: {
        codex: { inputUsdPer1M: 2, outputUsdPer1M: 8 },
        claude: { inputUsdPer1M: 1, outputUsdPer1M: 4 },
      },
      pricing_updated_at: "2026-08-24T00:00:00.000Z",
      agent_default_pricing_updated_at: { codex: "2026-08-24T00:00:00.000Z", claude: "2026-08-24T00:00:00.000Z" },
      spendRecords: [
        { source: "codex", amount: 12, currency: "USD", billing_cycle: "monthly", start_date: "2026-08-01", end_date: "2026-08-31" },
        { source: "other_ai", amount: 7, currency: "USD", billing_cycle: "one_time", start_date: "2026-07-15", end_date: "2026-07-15" },
      ],
    }));
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: root,
      now: () => new Date("2026-08-21T08:30:00.000Z"),
      codexLifecycleProvider: async () => [],
      detectAllAgentEnvironments: () => [],
      workbuddyQuotaProvider: async () => ({
        signed_in: true,
        groups: [{ id: "activity", used: 12, total: 2312, remain: 2300 }],
      }),
    });

    const value = await call(handler, "/functions/tokentracker-value-comparison?range=month&month=2026-08&tz=UTC&tz_offset_minutes=0");
    const otherAi = value.actual_composition.find((row) => row.key === "other_ai");
    assert.equal(otherAi.value, 7);
    assert.equal(otherAi.source_month, "2026-07");
    assert.equal(otherAi.fallback_applied, true);
    const apiKey = value.value_composition.find((row) => row.key === "api_key");
    assert.ok(apiKey.value > 0);
    assert.equal(apiKey.source_month, "2026-07");
    assert.equal(apiKey.fallback_applied, true);
    const points = value.value_composition.find((row) => row.key === "token_plan");
    assert.equal(points.display_state, "native_only");
    assert.deepEqual(points.native_resources.map((item) => [item.label, item.value, item.unit]), [
      ["remaining", 2300, "Credits"],
      ["today_consumed", 0, "Credits"],
    ]);
    assert.equal(points.value, null, "native points must not be converted to dollars");
    assert.equal(value.actual_composition.find((row) => row.key === "token_plan")?.display_state, "native_only");
    const observedApi = value.actual_composition.find((row) => row.key === "official_api");
    assert.equal(observedApi.display_state, "usage_detected");
    assert.equal(observedApi.value, null, "API Token usage must not become an actual cash bill");
    assert.equal(observedApi.observed_usage.value, 2_200);
    assert.equal(observedApi.observed_usage.unit, "tokens");
    assert.equal(observedApi.observed_usage.evidence_state, "observed");
    assert.equal(observedApi.source_month, "2026-07");
    assert.equal(observedApi.fallback_applied, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("value comparison includes every configured custom Agent plan before unmatched usage sources", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-value-custom-plans-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    fs.writeFileSync(queuePath, `${JSON.stringify({
      source: "codex", model: "gpt-5.4", hour_start: "2026-08-18T08:00:00.000Z",
      input_tokens: 1_000, output_tokens: 100, total_tokens: 1_100,
    })}\n`);
    const sources = ["codex", "claude", "hermes", "cursor", "workbuddy", "deepseek_harness", "trae", "codebuddy"];
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({
      tokenPlans: sources.map((source, index) => ({
        id: `custom-${index}`,
        provider_id: "custom",
        source,
        plan_id: "custom",
        plan_label: `自定义 ${source}`,
        detection_method: "custom_api",
        sync_status: "success",
        display_order: index,
      })),
    }));
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: root,
      now: () => new Date("2026-08-21T08:30:00.000Z"),
      codexLifecycleProvider: async () => [],
      detectAllAgentEnvironments: () => [],
      workbuddyQuotaProvider: async () => ({ signed_in: false, groups: [] }),
    });

    const value = await call(handler, "/functions/tokentracker-value-comparison?range=month&month=2026-08&tz=UTC&tz_offset_minutes=0");
    assert.equal(value.attribution.linked.length, sources.length);
    assert.deepEqual(value.attribution.linked.map((row) => row.source), sources);
    assert.equal(value.attribution.linked[0].plan_label, "自定义 codex");
    assert.equal(value.attribution.linked[0].association_state, "configured_plan");
    assert.equal(value.attribution.linked[0].observed_tokens, 1_100);
    assert.equal(value.attribution.unattributed.some((row) => row.source === "codex"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("realtime view retains the Codex session identifier from the live rollout instead of downgrading its focus card to unknown", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-realtime-session-id-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    const codexHome = path.join(root, "codex");
    const sessionDir = path.join(codexHome, "sessions", "2026", "08", "21");
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, "rollout-2026-08-21T08-00-00-session.jsonl"), [
      JSON.stringify({ timestamp: "2026-08-21T08:00:00.000Z", type: "session_meta", payload: { id: "live-session", cwd: "C:/safe-project" } }),
      JSON.stringify({ timestamp: "2026-08-21T05:59:00.000Z", type: "event_msg", payload: { type: "task_started", turn_id: "raw-turn-id" } }),
      JSON.stringify({ timestamp: "2026-08-21T06:00:00.000Z", type: "event_msg", payload: { type: "user_message", message: "private first body" } }),
      JSON.stringify({ timestamp: "2026-08-21T08:05:00.000Z", type: "turn_context", payload: { model: "gpt-5.6-terra" } }),
      JSON.stringify({ timestamp: "2026-08-21T22:00:00.000Z", type: "event_msg", payload: { type: "user_message", message: "private last body with fake timestamp 2028-01-01T00:00:00.000Z" } }),
      JSON.stringify({ timestamp: "2026-08-21T22:01:00.000Z", type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 40, output_tokens: 10, total_tokens: 50 } } } }),
    ].join("\n"));
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ dataDirectories: { codex: codexHome } }));
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: root,
      now: () => new Date("2026-08-21T22:30:00.000Z"),
      codexLifecycleProvider: async () => [{ agent: "codex", sessionId: "live-session", taskId: "raw-turn-id", model: "gpt-5.6-terra", status: "running", updatedAt: "2026-08-21T22:20:00.000Z" }],
    });

    const realtime = await call(handler, "/functions/tokentracker-realtime-sessions?range=today&tz=UTC&tz_offset_minutes=0");
    const running = realtime.sessions.find((session) => session.state === "running");
    assert.equal(running.source, "codex");
    assert.equal(running.total_tokens.value, 50);
    assert.equal(running.request_count.value, 1);
    assert.equal(running.duration_minutes.value, 16 * 60);
    assert.equal(running.duration_minutes.evidence_state, "exact");
    assert.match(running.task_ref, /^task-[a-f0-9]{12}$/u);
    const serialized = JSON.stringify(realtime);
    assert.equal(serialized.includes("raw-turn-id"), false);
    assert.equal(serialized.includes("private first body"), false);
    assert.equal(serialized.includes("private last body"), false);
    assert.equal(serialized.includes("2028-01-01"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("realtime view includes a late-UTC Codex rollout in the user's local day", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-realtime-local-day-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    const codexHome = path.join(root, "codex");
    const sessionDir = path.join(codexHome, "sessions", "2026", "08", "24");
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, "rollout-2026-08-24T17-00-00-local-day.jsonl"), [
      JSON.stringify({ timestamp: "2026-08-24T17:00:00.000Z", type: "session_meta", payload: { id: "local-day-session" } }),
      JSON.stringify({ timestamp: "2026-08-24T17:05:00.000Z", type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 40, output_tokens: 10, total_tokens: 50 } } } }),
    ].join("\n"));
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ dataDirectories: { codex: codexHome } }));
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: root,
      now: () => new Date("2026-08-25T01:30:00.000Z"),
      codexLifecycleProvider: async () => [{ agent: "codex", sessionId: "local-day-session", status: "running", updatedAt: "2026-08-25T01:20:00.000Z" }],
    });

    const realtime = await call(handler, "/functions/tokentracker-realtime-sessions?range=today&tz=Asia%2FShanghai&tz_offset_minutes=480");
    const running = realtime.sessions.find((session) => session.state === "running");
    assert.equal(running.total_tokens.value, 50);
    assert.equal(running.request_count.value, 1);
    assert.equal(realtime.summary.realtime_tokens.value, 50);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a recorded Token Plan subscription remains attributable to its current official account", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-token-plan-bill-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    fs.writeFileSync(queuePath, `${JSON.stringify({
      source: "codex",
      model: "gpt-5.4",
      hour_start: "2026-08-21T08:00:00.000Z",
      input_tokens: 1_000,
      output_tokens: 100,
      total_tokens: 1_100,
    })}\n`);
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({
      agentDefaultPricing: {
        codex: { inputUsdPer1M: 2, outputUsdPer1M: 8 },
      },
      pricing_updated_at: "2026-08-24T00:00:00.000Z",
      agent_default_pricing_updated_at: {
        codex: "2026-08-24T00:00:00.000Z",
      },
      tokenPlans: [{
        id: "codex-plan",
        provider_id: "codex",
        source: "codex",
        plan_id: "codex_pro_20x",
        plan_label: "Pro 20x",
        detection_method: "official_account",
        sync_status: "success",
        detection_config: { official_account: { account_binding_id: "synthetic-binding" } },
        subscription_amount: 20,
        subscription_currency: "USD",
        subscription_cycle: "monthly",
        subscription_start_date: "2026-08-01",
        subscription_end_date: "2026-08-31",
      }],
    }));
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: root,
      now: () => new Date("2026-08-21T08:30:00.000Z"),
      codexLifecycleProvider: async () => [],
      detectAllAgentEnvironments: () => [],
      workbuddyQuotaProvider: async () => ({ signed_in: false, groups: [] }),
    });

    const value = await call(handler, "/functions/tokentracker-value-comparison?range=month");
    assert.equal(value.actual_spend.subscription_usd.value, 20);
    assert.equal(value.actual_composition.find((item) => item.key === "subscription")?.value, 20);
    assert.equal(value.actual_composition.find((item) => item.key === "token_plan")?.value, null);
    assert.ok(value.value_composition.find((item) => item.key === "subscription")?.value > 0);
    assert.deepEqual(value.value_composition.find((item) => item.key === "token_plan"), {
      key: "token_plan", value: null, evidence_state: "unsupported", display_state: "not_detected",
    });
    assert.equal(value.attribution.linked[0].plan_label, "Pro 20x");
    assert.equal(value.attribution.linked[0].actual_spend_usd, 20);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a configured monthly Token Plan without dates still contributes its user-entered amount and preserves an explicit zero", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-token-plan-undated-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    fs.writeFileSync(queuePath, `${JSON.stringify({ source: "codex", model: "priced", hour_start: "2026-08-21T08:00:00.000Z", total_tokens: 100 })}\n`);
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({
      agentDefaultPricing: { codex: { inputUsdPer1M: 2, outputUsdPer1M: 8 } },
      tokenPlans: [
        { id: "codex-plan", provider_id: "codex", source: "codex", plan_label: "Configured Codex", subscription_amount: 20, subscription_currency: "USD", subscription_cycle: "monthly" },
        { id: "cursor-plan", provider_id: "cursor", source: "cursor", plan_label: "Configured Cursor", subscription_amount: 0, subscription_currency: "USD", subscription_cycle: "monthly" },
      ],
    }));
    const handler = createLocalApiHandler({ queuePath, trackerDataDir: root, now: () => new Date("2026-08-21T08:30:00.000Z"), codexLifecycleProvider: async () => [], detectAllAgentEnvironments: () => [], workbuddyQuotaProvider: async () => ({ signed_in: false, groups: [] }) });

    const value = await call(handler, "/functions/tokentracker-value-comparison?range=month&month=2026-08&tz=UTC&tz_offset_minutes=0");
    assert.equal(value.actual_spend.subscription_usd.value, 20);
    assert.equal(value.attribution.linked.find((row) => row.source === "codex").actual_spend_usd, 20);
    assert.equal(value.attribution.linked.find((row) => row.source === "cursor").actual_spend_usd, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("keeps a real spend-only source visible in value attribution", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-spend-only-attribution-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    fs.writeFileSync(queuePath, "");
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ spendRecords: [{ id: "real-spend", source: "other_ai", plan_label: "Local AI purchase", amount: 12, currency: "USD", billing_cycle: "one_time", start_date: "2026-08-10" }] }));
    const handler = createLocalApiHandler({ queuePath, trackerDataDir: root, now: () => new Date("2026-08-21T08:30:00.000Z"), codexLifecycleProvider: async () => [], detectAllAgentEnvironments: () => [], workbuddyQuotaProvider: async () => ({ signed_in: false, groups: [] }) });

    const value = await call(handler, "/functions/tokentracker-value-comparison?range=month&month=2026-08&tz=UTC&tz_offset_minutes=0");
    const row = value.attribution.unattributed.find((item) => item.source === "other_ai");
    assert.equal(row.actual_spend_usd, 12);
    assert.equal(row.api_equivalent_usd, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("value total, composition, and current trend use the same local-calendar usage range", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-value-local-day-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    fs.writeFileSync(queuePath, `${JSON.stringify({
      source: "claude",
      model: "synthetic-priced-model",
      hour_start: "2026-07-31T20:00:00.000Z",
      input_tokens: 1_000_000,
      output_tokens: 0,
      total_tokens: 1_000_000,
    })}\n`);
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({
      agentDefaultPricing: {
        claude: { inputUsdPer1M: 2, outputUsdPer1M: 8 },
      },
      agent_default_pricing_updated_at: {
        claude: "2026-08-01T00:00:00.000Z",
      },
    }));
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: root,
      now: () => new Date("2026-08-21T08:30:00.000Z"),
      codexLifecycleProvider: async () => [],
      detectAllAgentEnvironments: () => [],
      workbuddyQuotaProvider: async () => ({ signed_in: false, groups: [] }),
    });

    const value = await call(
      handler,
      "/functions/tokentracker-value-comparison?range=month&tz=Asia%2FShanghai&tz_offset_minutes=480",
    );
    const composedValue = value.value_composition.reduce(
      (sum, item) => sum + (typeof item.value === "number" ? item.value : 0),
      0,
    );

    assert.equal(value.api_equivalent_value.value, 2);
    assert.equal(composedValue, value.api_equivalent_value.value);
    assert.equal(value.monthly_trend.at(-1).label, "8月");
    assert.equal(value.monthly_trend.at(-1).api_equivalent_usd, value.api_equivalent_value.value);
    assert.equal(value.monthly_trend.at(-2).api_equivalent_usd, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("value total, composition, attribution, and current trend share one usage snapshot", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-value-snapshot-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    const codexHome = path.join(root, "codex");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(queuePath, `${JSON.stringify({
      source: "codex",
      model: "synthetic-priced-model",
      hour_start: "2026-03-10T08:00:00.000Z",
      input_tokens: 500_000,
      output_tokens: 0,
      total_tokens: 500_000,
    })}\n`);
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({
      dataDirectories: { codex: codexHome },
      agentDefaultPricing: {
        codex: { inputUsdPer1M: 2, outputUsdPer1M: 8 },
      },
      agent_default_pricing_updated_at: {
        codex: "2026-08-01T00:00:00.000Z",
      },
      tokenPlans: [{
        id: "codex-plan",
        provider_id: "codex",
        source: "codex",
        plan_id: "codex_pro_20x",
        plan_label: "Pro 20x",
        detection_method: "official_account",
        sync_status: "success",
        detection_config: { official_account: { account_binding_id: "synthetic-binding" } },
      }],
    }));
    let rolloutReadCount = 0;
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: root,
      now: () => new Date("2026-08-21T08:30:00.000Z"),
      codexLifecycleProvider: async () => [],
      codexRolloutRowsProvider: async () => {
        rolloutReadCount += 1;
        const inputTokens = rolloutReadCount === 1 ? 1_000_000 : 2_000_000;
        return [{
          source: "codex",
          model: "synthetic-priced-model",
          hour_start: "2026-08-21T08:00:00.000Z",
          input_tokens: inputTokens,
          output_tokens: 0,
          total_tokens: inputTokens,
        }];
      },
      detectAllAgentEnvironments: () => [],
      workbuddyQuotaProvider: async () => ({ signed_in: false, groups: [] }),
    });

    const value = await call(handler, "/functions/tokentracker-value-comparison?range=month&tz=UTC&tz_offset_minutes=0");
    const composedValue = value.value_composition.reduce(
      (sum, item) => sum + (typeof item.value === "number" ? item.value : 0),
      0,
    );
    const attributedValue = [
      ...value.attribution.linked,
      ...value.attribution.unattributed,
    ].reduce((sum, item) => sum + (typeof item.api_equivalent_usd === "number" ? item.api_equivalent_usd : 0), 0);

    assert.equal(rolloutReadCount, 2);
    assert.equal(value.api_equivalent_value.value, 4);
    assert.equal(composedValue, value.api_equivalent_value.value);
    assert.equal(attributedValue, value.api_equivalent_value.value);
    assert.equal(value.monthly_trend.find((item) => item.label === "3月")?.api_equivalent_usd, 1);
    assert.equal(value.monthly_trend.at(-1).api_equivalent_usd, value.api_equivalent_value.value);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("keeps unavailable trend values distinct from a real zero", () => {
  const value = buildValueComparisonViewModel({
    actualSpend: { subscriptionUsd: 0, officialApiUsd: null, otherAiUsd: null },
    monthlyTrend: [{
      bucket_start: "2026-03-01",
      label: "3月",
      actual_spend_usd: null,
      api_equivalent_usd: null,
    }],
  });

  assert.equal(value.actual_spend.subscription_usd.value, 0);
  assert.equal(value.actual_spend.subscription_usd.evidence_state, "exact");
  assert.equal(value.monthly_trend[0].actual_spend_usd, null);
  assert.equal(value.monthly_trend[0].api_equivalent_usd, null);
});
