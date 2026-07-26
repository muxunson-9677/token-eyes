const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const { appendQuotaSamplesFromAccounts, readQuotaSamples, selectCycleSamples } = require("../src/lib/quota-history");
const { ADVICE, computeQuotaForecast } = require("../src/lib/quota-forecast");

const tempHomes = [];
afterEach(() => {
  while (tempHomes.length) fs.rmSync(tempHomes.pop(), { recursive: true, force: true });
});

function sampleEvidence(observedAt) {
  return { source_kind: "official_api", accuracy: "exact", coverage: "complete", observed_at: observedAt, source_updated_at: observedAt, stale_after_seconds: 3600, pricing_source: null, pricing_version: null, note_code: null };
}

test("quota history persists only anonymous quota samples and splits a reset cycle", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-quota-"));
  tempHomes.push(home);
  const first = "2026-07-27T00:00:00.000Z";
  const second = "2026-07-27T00:15:00.000Z";
  const reset = "2026-07-28T00:00:00.000Z";
  const account = (usedPercent, observedAt) => ({ account_key: "hashed-account", provider_id: "codex", status: "ok", rawAccountId: "must-not-persist", windows: [{ kind: "five_hour", label: "5h", used_percent: usedPercent, reset_at: reset, window_seconds: 18_000, evidence: sampleEvidence(observedAt) }] });

  assert.equal(appendQuotaSamplesFromAccounts([account(40, first)], { home, nowMs: Date.parse(first) }), 1);
  assert.equal(appendQuotaSamplesFromAccounts([account(10, second)], { home, nowMs: Date.parse(second) }), 1);
  const persisted = readQuotaSamples({ home });
  assert.equal(persisted.length, 2);
  assert.equal(JSON.stringify(persisted).includes("must-not-persist"), false);
  assert.deepEqual(selectCycleSamples(persisted, { accountKey: "hashed-account", windowKind: "five_hour", windowLabel: "5h" }).map((sample) => sample.used_percent), [10]);
});

test("quota forecast replays a clock and warns before the quota reset", () => {
  const nowMs = Date.parse("2026-07-27T01:00:00.000Z");
  const samples = [20, 40, 60].map((used_percent, index) => {
    const observed_at = new Date(nowMs - (30 - index * 15) * 60_000).toISOString();
    return { used_percent, observed_at, evidence: sampleEvidence(observed_at) };
  });
  const forecast = computeQuotaForecast({
    accountKey: "hashed-account",
    nowMs,
    samples,
    window: { kind: "five_hour", label: "5h", used_percent: 60, reset_at: "2026-07-27T04:00:00.000Z", window_seconds: 18_000 },
  });

  assert.equal(forecast.sample_count, 3);
  assert.equal(forecast.advice, ADVICE.DANGER);
  assert.equal(forecast.exhausts_before_reset, true);
  assert.ok(forecast.exhaust_at);
  assert.equal(forecast.evidence.source_kind, "estimated");
});
