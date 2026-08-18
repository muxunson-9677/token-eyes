const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  normalizeUsageAttribution,
} = require("../src/lib/usage-attribution");
const { parseRolloutIncremental } = require("../src/lib/rollout");

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
