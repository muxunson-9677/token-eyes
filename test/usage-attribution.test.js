const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { AGENT_ADAPTERS } = require("../src/lib/agent-adapters");
const providerApiConfigs = require("../src/lib/provider-api-configs");
const {
  createConfiguredTokenPlanResolver,
  normalizeUsageAttribution,
} = require("../src/lib/usage-attribution");
const {
  parseHermesIncremental,
  parseRolloutIncremental,
} = require("../src/lib/rollout");
const { execSqlScript } = require("./helpers/sqlite-builder.cjs");

test("preserves explicit api_key while reducing endpoint input to its origin", () => {
  const result = normalizeUsageAttribution({
    billing_mode: "api_key",
    endpoint: "https://api.deepseek.com/v1/chat?api_key=secret",
    api_key: "secret",
    authorization: "Bearer secret",
  });

  assert.deepEqual(result, {
    billing_mode: "api_key",
    billing_mode_confidence: "explicit_runtime",
    endpoint_origin: "https://api.deepseek.com",
  });
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("missing evidence stays unknown even when the model resembles a plan", () => {
  assert.deepEqual(
    normalizeUsageAttribution({ model: "mimo-coding-plan" }),
    {
      billing_mode: "unknown",
      billing_mode_confidence: "unavailable",
    },
  );
});

test("configured Token Plan resolver preserves explicit runtime and user override modes", () => {
  const resolve = createConfiguredTokenPlanResolver([
    {
      source: "hermes",
      provider_id: "xiaomi_mimo",
      plan_ref: "token-plan/xiaomi_mimo/plan-1",
    },
  ]);

  assert.deepEqual(
    resolve({
      source: "hermes",
      provider_id: "xiaomi_mimo",
      billing_mode: "api_key",
      billing_mode_confidence: "explicit_runtime",
    }),
    {
      billing_mode: "api_key",
      billing_mode_confidence: "explicit_runtime",
      provider_id: "xiaomi_mimo",
    },
  );
  assert.deepEqual(
    resolve({
      source: "hermes",
      provider_id: "xiaomi_mimo",
      billing_mode: "api_key",
      billing_mode_confidence: "user_override",
    }),
    {
      billing_mode: "api_key",
      billing_mode_confidence: "user_override",
      provider_id: "xiaomi_mimo",
    },
  );
});

test("configured Token Plan resolver matches only the normalized source and provider pair", () => {
  const resolve = createConfiguredTokenPlanResolver([
    {
      source: " HERMES ",
      provider_id: " XIAOMI_MIMO ",
      plan_ref: "token-plan/xiaomi_mimo/plan-1",
    },
  ]);

  assert.deepEqual(
    resolve({
      source: "Hermes",
      provider_id: "xiaomi_mimo",
      billing_mode: "api_key",
      billing_mode_confidence: "provider_receipt",
    }),
    {
      billing_mode: "token_plan",
      billing_mode_confidence: "configured_plan_provider_match",
      provider_id: "xiaomi_mimo",
      plan_ref: "token-plan/xiaomi_mimo/plan-1",
    },
  );
});

test("configured Token Plan resolver classifies an ambiguous pair without inventing a plan_ref", () => {
  const resolve = createConfiguredTokenPlanResolver([
    {
      source: "hermes",
      provider_id: "xiaomi_mimo",
      plan_ref: "token-plan/xiaomi_mimo/plan-1",
    },
    {
      source: "hermes",
      provider_id: "xiaomi_mimo",
      plan_ref: "token-plan/xiaomi_mimo/plan-2",
    },
  ]);

  const result = resolve({ source: "hermes", provider_id: "xiaomi_mimo" });
  assert.equal(result.billing_mode, "token_plan");
  assert.equal(result.billing_mode_confidence, "configured_plan_provider_match");
  assert.equal(Object.prototype.hasOwnProperty.call(result, "plan_ref"), false);
});

test("configured Token Plan resolver ignores source-only and deceptive label or model matches", () => {
  const resolve = createConfiguredTokenPlanResolver([
    {
      source: "hermes",
      provider_id: "xiaomi_mimo",
      plan_label: "MiMo coding plan",
      quota_unit: "tokens",
      plan_ref: "token-plan/xiaomi_mimo/plan-1",
    },
    {
      source: "codex",
      plan_label: "DeepSeek API plan",
      plan_ref: "token-plan/deepseek/plan-2",
    },
  ]);

  assert.deepEqual(
    resolve({
      source: "hermes",
      provider_id: "deepseek",
      model: "mimo-coding-plan",
      plan_label: "MiMo coding plan",
      quota_unit: "tokens",
      billing_mode: "api_key",
      billing_mode_confidence: "provider_receipt",
    }),
    {
      billing_mode: "api_key",
      billing_mode_confidence: "provider_receipt",
      provider_id: "deepseek",
    },
  );
  assert.deepEqual(
    resolve({
      source: "hermes",
      provider_id: "deepseek",
      billing_mode: "token_plan",
      billing_mode_confidence: "provider_receipt",
    }),
    {
      billing_mode: "token_plan",
      billing_mode_confidence: "provider_receipt",
      provider_id: "deepseek",
    },
  );
  assert.deepEqual(resolve({ source: "hermes", model: "mimo-coding-plan" }), {
    billing_mode: "unknown",
    billing_mode_confidence: "unavailable",
  });
  assert.deepEqual(resolve({ source: "codex", model: "deepseek-api-plan" }), {
    billing_mode: "unknown",
    billing_mode_confidence: "unavailable",
  });
});

test("mixed is invalid for a single record and normalizes to unknown", () => {
  assert.deepEqual(normalizeUsageAttribution({ billing_mode: "mixed" }), {
    billing_mode: "unknown",
    billing_mode_confidence: "unavailable",
  });
});

test("trusted attribution accepts only canonical billing modes", () => {
  for (const billingMode of ["api_key", "token_plan", "unknown"]) {
    assert.equal(normalizeUsageAttribution({ billing_mode: billingMode }).billing_mode, billingMode);
  }
  for (const billingMode of ["subscription", "plan", "payg", "api-key", "token-plan"]) {
    assert.equal(normalizeUsageAttribution({ billing_mode: billingMode }).billing_mode, "unknown");
  }
});

test("only allowlisted non-secret evidence fields are returned", () => {
  const result = normalizeUsageAttribution({
    billing_mode: "token_plan",
    billing_mode_confidence: "provider_receipt",
    provider_id: "deepseek",
    endpoint_origin: "https://user:password@api.deepseek.com/v1?cookie=secret",
    account_ref: "account/account-1",
    plan_ref: "plan/plan-1",
    credential_ref: "provider-api/deepseek/credential-1",
    cookie: "secret",
    api_key: "secret",
    extra: "discard-me",
  });

  assert.deepEqual(result, {
    billing_mode: "token_plan",
    billing_mode_confidence: "provider_receipt",
    provider_id: "deepseek",
    endpoint_origin: "https://api.deepseek.com",
    account_ref: "account/account-1",
    plan_ref: "plan/plan-1",
    credential_ref: "provider-api/deepseek/credential-1",
  });
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(JSON.stringify(result).includes("password"), false);
});

test("invalid endpoint input becomes null", () => {
  assert.equal(
    normalizeUsageAttribution({
      billing_mode: "api_key",
      endpoint_origin: "not a URL",
    }).endpoint_origin,
    null,
  );
});

test("secret-like reference values are omitted", () => {
  for (const unsafe of [
    "plain-secret-value",
    "ghp_abcdefghijklmnopqrstuvwxyz",
    "xoxb-123456789-secret",
    "AIzaSyExampleSecret",
  ]) {
    const result = normalizeUsageAttribution({
      billing_mode: "api_key",
      provider_id: unsafe,
      credential_ref: unsafe,
      account_ref: unsafe,
      plan_ref: unsafe,
    });
    assert.deepEqual(result, {
      billing_mode: "api_key",
      billing_mode_confidence: "explicit_runtime",
    });
  }
});

test("known attribution provider ids remain available", () => {
  const adapterProviderIds = new Set(
    AGENT_ADAPTERS.flatMap(({ id, queueSource, family }) => [id, queueSource, family])
      .filter((value) => value && value !== "unknown"),
  );
  for (const providerId of [
    ...adapterProviderIds,
    ...providerApiConfigs.KNOWN_PROVIDER_API_IDS,
  ]) {
    assert.equal(
      normalizeUsageAttribution({ provider_id: providerId }).provider_id,
      providerId,
    );
  }
  for (const providerId of ["openai", "anthropic", "deepseek", "hermes"]) {
    assert.equal(
      normalizeUsageAttribution({ provider_id: providerId }).provider_id,
      providerId,
    );
  }
});

test("provider API configs export their authoritative non-secret provider ids", () => {
  assert.ok(Array.isArray(providerApiConfigs.KNOWN_PROVIDER_API_IDS));
  assert.ok(providerApiConfigs.KNOWN_PROVIDER_API_IDS.length > 0);
});

test("recognized credential-store references remain available", () => {
  assert.equal(
    normalizeUsageAttribution({ credential_ref: "codex_auth_json" }).credential_ref,
    "codex_auth_json",
  );
  assert.equal(
    normalizeUsageAttribution({ credential_ref: "claude_credentials_json" }).credential_ref,
    "claude_credentials_json",
  );
  assert.equal(
    normalizeUsageAttribution({
      credential_ref: "token-plan/hermes/api/a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    }).credential_ref,
    "token-plan/hermes/api/a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  );
});

test("rollout queue records retain explicit attribution and redact endpoint details", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-usage-attribution-"));
  try {
    const rolloutPath = path.join(tmp, "rollout.jsonl");
    const queuePath = path.join(tmp, "queue.jsonl");
    const usage = {
      input_tokens: 10,
      cached_input_tokens: 0,
      output_tokens: 5,
      reasoning_output_tokens: 0,
      total_tokens: 15,
    };
    await fs.writeFile(
      rolloutPath,
      `${JSON.stringify({
        type: "event_msg",
        timestamp: "2026-08-18T00:00:00.000Z",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: usage,
            total_token_usage: usage,
            billing_mode: "api_key",
            endpoint: "https://api.deepseek.com/v1/chat?api_key=secret",
            api_key: "secret",
          },
        },
      })}\n`,
    );

    await parseRolloutIncremental({
      rolloutFiles: [rolloutPath],
      cursors: { version: 1, files: {} },
      queuePath,
      source: "codex",
    });

    const queued = JSON.parse((await fs.readFile(queuePath, "utf8")).trim());
    assert.equal(queued.billing_mode, "api_key");
    assert.equal(queued.billing_mode_confidence, "explicit_runtime");
    assert.equal(queued.endpoint_origin, "https://api.deepseek.com");
    assert.equal(JSON.stringify(queued).includes("secret"), false);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("Codex cumulative buckets omit conflicting trusted providers in either order", async () => {
  for (const providers of [["deepseek", "openai"], ["openai", "deepseek"]]) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-codex-provider-conflict-"));
    try {
      const rolloutPath = path.join(tmp, "rollout.jsonl");
      const queuePath = path.join(tmp, "queue.jsonl");
      const usage = (total) => ({
        input_tokens: total,
        cached_input_tokens: 0,
        output_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: total,
      });
      const lines = providers.map((providerId, index) => JSON.stringify({
        type: "event_msg",
        timestamp: `2026-08-18T00:0${index}:00.000Z`,
        payload: {
          type: "token_count",
          info: {
            last_token_usage: usage(10),
            total_token_usage: usage((index + 1) * 10),
            billing_mode: "api_key",
            provider_id: providerId,
          },
        },
      }));
      await fs.writeFile(rolloutPath, `${lines.join("\n")}\n`);

      await parseRolloutIncremental({
        rolloutFiles: [rolloutPath],
        cursors: { version: 1, files: {} },
        queuePath,
        source: "codex",
      });

      const queued = JSON.parse((await fs.readFile(queuePath, "utf8")).trim());
      assert.equal(queued.billing_mode, "api_key");
      assert.equal(queued.total_tokens, 20);
      assert.equal(queued.provider_id, undefined);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }
});

test("rollout queue keeps unknown and explicit deltas in separate records", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-attribution-split-"));
  try {
    const rolloutPath = path.join(tmp, "rollout.jsonl");
    const queuePath = path.join(tmp, "queue.jsonl");
    const first = {
      input_tokens: 10,
      cached_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      total_tokens: 10,
    };
    const second = { ...first, input_tokens: 30, total_tokens: 30 };
    const line = (timestamp, total, billingMode) => JSON.stringify({
      type: "event_msg",
      timestamp,
      payload: {
        type: "token_count",
        info: {
          last_token_usage: total,
          total_token_usage: total,
          ...(billingMode ? { billing_mode: billingMode } : {}),
        },
      },
    });
    await fs.writeFile(
      rolloutPath,
      `${line("2026-08-18T00:00:00.000Z", first)}\n${line("2026-08-18T00:01:00.000Z", second, "api_key")}\n`,
    );

    await parseRolloutIncremental({
      rolloutFiles: [rolloutPath],
      cursors: { version: 1, files: {} },
      queuePath,
      source: "codex",
    });

    const queued = (await fs.readFile(queuePath, "utf8"))
      .trim()
      .split("\n")
      .map((lineValue) => JSON.parse(lineValue));
    assert.deepEqual(
      queued.map((row) => [row.billing_mode, row.total_tokens]).sort(),
      [["api_key", 20], ["unknown", 10]],
    );
    assert.equal(queued.some((row) => row.billing_mode === "mixed"), false);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("Hermes parser retains explicit billing evidence and sanitizes its endpoint", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-hermes-attribution-"));
  try {
    const dbPath = path.join(tmp, "state.db");
    const queuePath = path.join(tmp, "queue.jsonl");
    execSqlScript(dbPath, `
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        model TEXT,
        started_at INTEGER,
        ended_at INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cache_read_tokens INTEGER,
        cache_write_tokens INTEGER,
        reasoning_tokens INTEGER,
        message_count INTEGER,
        billing_provider TEXT,
        billing_base_url TEXT,
        billing_mode TEXT
      );
      INSERT INTO sessions VALUES (
        'session-1', 'deepseek-chat', 1787011200, 1787011260,
        10, 5, 0, 0, 0, 1,
        'deepseek', 'https://user:password@api.deepseek.com/v1/chat?api_key=secret', 'api_key'
      );
    `);

    await parseHermesIncremental({
      dbPath,
      cursors: {},
      queuePath,
    });

    const queued = JSON.parse((await fs.readFile(queuePath, "utf8")).trim());
    assert.equal(queued.billing_mode, "api_key");
    assert.equal(queued.billing_mode_confidence, "explicit_runtime");
    assert.equal(queued.provider_id, "deepseek");
    assert.equal(queued.endpoint_origin, "https://api.deepseek.com");
    assert.equal(JSON.stringify(queued).includes("secret"), false);
    assert.equal(JSON.stringify(queued).includes("password"), false);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("Hermes parser treats an invalid billing alias as provider-endpoint fallback evidence", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-hermes-invalid-billing-mode-"));
  try {
    const dbPath = path.join(tmp, "state.db");
    const queuePath = path.join(tmp, "queue.jsonl");
    execSqlScript(dbPath, `
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        model TEXT,
        started_at INTEGER,
        ended_at INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cache_read_tokens INTEGER,
        cache_write_tokens INTEGER,
        reasoning_tokens INTEGER,
        message_count INTEGER,
        billing_provider TEXT,
        billing_base_url TEXT,
        billing_mode TEXT
      );
      INSERT INTO sessions VALUES (
        'session-invalid-mode', 'deepseek-chat', 1787011200, 1787011260,
        10, 5, 0, 0, 0, 1,
        'deepseek', 'https://api.deepseek.com/v1', 'subscription'
      );
    `);

    await parseHermesIncremental({ dbPath, cursors: {}, queuePath });

    const queued = JSON.parse((await fs.readFile(queuePath, "utf8")).trim());
    assert.equal(queued.billing_mode, "api_key");
    assert.equal(queued.billing_mode_confidence, "provider_receipt");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("Hermes parser derives API usage from its recorded provider endpoint when legacy billing_mode is empty", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-hermes-provider-endpoint-"));
  try {
    const dbPath = path.join(tmp, "state.db");
    const queuePath = path.join(tmp, "queue.jsonl");
    execSqlScript(dbPath, `
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        model TEXT,
        started_at INTEGER,
        ended_at INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cache_read_tokens INTEGER,
        cache_write_tokens INTEGER,
        reasoning_tokens INTEGER,
        message_count INTEGER,
        billing_provider TEXT,
        billing_base_url TEXT,
        billing_mode TEXT
      );
      INSERT INTO sessions VALUES (
        'session-legacy', 'deepseek-chat', 1787011200, 1787011260,
        10, 5, 0, 0, 0, 1,
        'deepseek', 'https://api.deepseek.com/v1', NULL
      );
    `);

    await parseHermesIncremental({ dbPath, cursors: {}, queuePath });

    const queued = JSON.parse((await fs.readFile(queuePath, "utf8")).trim());
    assert.equal(queued.billing_mode, "api_key");
    assert.equal(queued.billing_mode_confidence, "provider_receipt");
    assert.equal(queued.provider_id, "deepseek");
    assert.equal(queued.endpoint_origin, "https://api.deepseek.com");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("Hermes parser reattributes matching legacy unknown history without changing token totals", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-hermes-history-attribution-"));
  try {
    const dbPath = path.join(tmp, "state.db");
    const queuePath = path.join(tmp, "queue.jsonl");
    const epoch = 1787011200;
    execSqlScript(dbPath, `
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, model TEXT, started_at INTEGER, ended_at INTEGER,
        input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER,
        cache_write_tokens INTEGER, reasoning_tokens INTEGER, message_count INTEGER,
        billing_provider TEXT, billing_base_url TEXT, billing_mode TEXT
      );
      INSERT INTO sessions VALUES (
        'session-history', 'deepseek-chat', ${epoch}, ${epoch + 60},
        10, 5, 0, 0, 0, 1, 'deepseek', 'https://api.deepseek.com/v1', NULL
      );
    `);
    const hourStart = new Date(epoch * 1000).toISOString().replace(/:\d{2}\.000Z$/, ":00.000Z");
    const legacy = {
      source: "hermes", model: "deepseek-chat", hour_start: hourStart,
      input_tokens: 10, cached_input_tokens: 0, cache_creation_input_tokens: 0,
      output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15,
      billable_total_tokens: 15, conversation_count: 1,
      billing_mode: "unknown", billing_mode_confidence: "unavailable",
    };
    await fs.writeFile(queuePath, `${JSON.stringify(legacy)}\n`);
    const cursors = {
      hermes: {
        lastCompletedStartedAt: epoch,
        snapshots: { "session-history": { in: 10, out: 5, cacheRead: 0, cacheWrite: 0, reasoning: 0, message_count: 1 } },
      },
      hourly: {
        version: 3,
        buckets: {
          [`hermes|deepseek-chat|${hourStart}`]: {
            totals: { ...legacy },
            attributionBuckets: {
              unknown: {
                totals: { ...legacy },
                attribution: { billing_mode: "unknown", billing_mode_confidence: "unavailable" },
              },
            },
          },
        },
        groupQueued: {},
      },
    };

    await parseHermesIncremental({ dbPath, cursors, queuePath });

    const rows = (await fs.readFile(queuePath, "utf8")).trim().split(/\r?\n/).map(JSON.parse);
    const latest = new Map(rows.map((row) => [row.billing_mode, row]));
    assert.equal(latest.get("unknown").total_tokens, 0);
    assert.equal(latest.get("api_key").total_tokens, 15);
    assert.equal([...latest.values()].reduce((sum, row) => sum + row.total_tokens, 0), 15);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("Hermes provider attribution degrades conservatively within one cumulative bucket", async () => {
  const cases = [
    { name: "deepseek then openai", providers: ["deepseek", "openai"], expectedProvider: undefined },
    { name: "openai then deepseek", providers: ["openai", "deepseek"], expectedProvider: undefined },
    { name: "single openai", providers: ["openai"], expectedProvider: "openai" },
    { name: "same openai repeated", providers: ["openai", "openai"], expectedProvider: "openai" },
    { name: "missing then openai", providers: [null, "openai"], expectedProvider: undefined },
    { name: "openai then missing", providers: ["openai", null], expectedProvider: undefined },
  ];

  for (const testCase of cases) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-hermes-provider-merge-"));
    try {
      const dbPath = path.join(tmp, "state.db");
      const queuePath = path.join(tmp, "queue.jsonl");
      const inserts = testCase.providers.map((provider, index) => `
        INSERT INTO sessions VALUES (
          'session-${index}', 'shared-model', ${1787011200 + index * 60}, ${1787011230 + index * 60},
          10, 1, 0, 0, 0, 1,
          ${provider == null ? "NULL" : `'${provider}'`}, NULL, 'api_key'
        );
      `).join("\n");
      execSqlScript(dbPath, `
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          model TEXT,
          started_at INTEGER,
          ended_at INTEGER,
          input_tokens INTEGER,
          output_tokens INTEGER,
          cache_read_tokens INTEGER,
          cache_write_tokens INTEGER,
          reasoning_tokens INTEGER,
          message_count INTEGER,
          billing_provider TEXT,
          billing_base_url TEXT,
          billing_mode TEXT
        );
        ${inserts}
      `);

      const cursors = {};
      await parseHermesIncremental({ dbPath, cursors, queuePath });
      const queuedText = (await fs.readFile(queuePath, "utf8")).trim();
      const queued = JSON.parse(queuedText);
      assert.equal(queued.billing_mode, "api_key", testCase.name);
      assert.equal(queued.total_tokens, testCase.providers.length * 11, testCase.name);
      assert.equal(queued.provider_id, testCase.expectedProvider, testCase.name);
      assert.equal(Object.hasOwn(queued, "providerAttributionAmbiguous"), false, testCase.name);

      const repeated = await parseHermesIncremental({ dbPath, cursors, queuePath });
      assert.equal(repeated.bucketsQueued, 0, `${testCase.name} must remain idempotent`);
      assert.equal((await fs.readFile(queuePath, "utf8")).trim(), queuedText, testCase.name);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }
});

test("model backfill retracts the original billing-mode queue identity", async () => {
  for (const billingMode of ["api_key", "token_plan"]) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `tt-retract-${billingMode}-`));
    try {
      const rolloutPath = path.join(tmp, "rollout.jsonl");
      const queuePath = path.join(tmp, "queue.jsonl");
      const cursors = { version: 1, files: {} };
      const usage1 = {
        input_tokens: 1,
        cached_input_tokens: 0,
        output_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 1,
      };
      const usage3 = { ...usage1, input_tokens: 3, total_tokens: 3 };
      const usage4 = { ...usage1, input_tokens: 4, total_tokens: 4 };
      const tokenLine = (timestamp, last, total) => JSON.stringify({
        type: "event_msg",
        timestamp,
        payload: {
          type: "token_count",
          info: {
            last_token_usage: last,
            total_token_usage: total,
            billing_mode: billingMode,
          },
        },
      });

      await fs.writeFile(
        rolloutPath,
        `${tokenLine("2026-08-18T00:00:00.000Z", usage1, usage1)}\n`,
      );
      await parseRolloutIncremental({
        rolloutFiles: [rolloutPath],
        cursors,
        queuePath,
        source: "codex",
      });
      await fs.appendFile(
        rolloutPath,
        `${JSON.stringify({ type: "session_meta", payload: { model: "gpt-5.4" } })}\n${tokenLine("2026-08-18T00:01:00.000Z", usage3, usage4)}\n`,
      );
      await parseRolloutIncremental({
        rolloutFiles: [rolloutPath],
        cursors,
        queuePath,
        source: "codex",
      });

      const queued = (await fs.readFile(queuePath, "utf8"))
        .trim()
        .split("\n")
        .map((lineValue) => JSON.parse(lineValue));
      const retraction = queued.find(
        (row) => row.model === "unknown" && row.billing_mode === billingMode && row.total_tokens === 0,
      );
      assert.ok(retraction, `${billingMode} unknown-model identity must be retracted`);

      const latest = new Map();
      for (const row of queued) {
        latest.set(`${row.source}|${row.model}|${row.hour_start}|${row.billing_mode}`, row);
      }
      assert.equal(
        [...latest.values()].reduce((sum, row) => sum + row.total_tokens, 0),
        4,
        `${billingMode} totals must remain conserved after model backfill`,
      );
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }
});
