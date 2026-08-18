const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
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

test("mixed is invalid for a single record and normalizes to unknown", () => {
  assert.deepEqual(normalizeUsageAttribution({ billing_mode: "mixed" }), {
    billing_mode: "unknown",
    billing_mode_confidence: "unavailable",
  });
});

test("explicit subscription aliases normalize to token_plan", () => {
  for (const billingMode of ["subscription", "token-plan", "token plan"]) {
    assert.equal(
      normalizeUsageAttribution({ billing_mode: billingMode }).billing_mode,
      "token_plan",
    );
  }
});

test("only allowlisted non-secret evidence fields are returned", () => {
  const result = normalizeUsageAttribution({
    billing_mode: "token_plan",
    billing_mode_confidence: "provider_receipt",
    provider_id: "deepseek",
    endpoint_origin: "https://user:password@api.deepseek.com/v1?cookie=secret",
    account_ref: "account-1",
    plan_ref: "plan-1",
    credential_ref: "credential-1",
    cookie: "secret",
    api_key: "secret",
    extra: "discard-me",
  });

  assert.deepEqual(result, {
    billing_mode: "token_plan",
    billing_mode_confidence: "provider_receipt",
    provider_id: "deepseek",
    endpoint_origin: "https://api.deepseek.com",
    account_ref: "account-1",
    plan_ref: "plan-1",
    credential_ref: "credential-1",
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
  const result = normalizeUsageAttribution({
    billing_mode: "api_key",
    provider_id: "Bearer secret-token",
    account_ref: "cookie=session-secret",
    plan_ref: "sk-plan-secret",
    credential_ref: "token=raw-secret",
  });

  assert.deepEqual(result, {
    billing_mode: "api_key",
    billing_mode_confidence: "explicit_runtime",
  });
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
    assert.equal(queued.provider_id, "deepseek");
    assert.equal(queued.endpoint_origin, "https://api.deepseek.com");
    assert.equal(JSON.stringify(queued).includes("secret"), false);
    assert.equal(JSON.stringify(queued).includes("password"), false);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
