const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

require("./helpers/home-shim.cjs");

const {
  computeSlidingBurnRates,
  attachBurnRates,
} = require("../src/lib/burn-rate");
const { createLocalApiHandler } = require("../src/lib/local-api");

const NOW = Date.parse("2026-05-09T12:00:00.000Z");

function claudeRow(hourStart, totalTokens) {
  return {
    source: "claude",
    model: "claude-sonnet-4-6",
    hour_start: hourStart,
    input_tokens: totalTokens,
    output_tokens: 0,
    total_tokens: totalTokens,
  };
}

test("computeSlidingBurnRates sums queue increments per source for 60/120 minute windows", () => {
  const rows = [
    // Inside 60m window (>= 11:00).
    claudeRow("2026-05-09T11:00:00.000Z", 1000),
    claudeRow("2026-05-09T11:30:00.000Z", 1000),
    // Inside 120m window only (>= 10:00, < 11:00).
    claudeRow("2026-05-09T10:00:00.000Z", 500),
    claudeRow("2026-05-09T10:30:00.000Z", 500),
    // Outside both windows.
    claudeRow("2026-05-09T09:30:00.000Z", 9999),
    // Other sources are tracked independently.
    { source: "codex", model: "gpt-5.5", hour_start: "2026-05-09T11:30:00.000Z", total_tokens: 300 },
  ];
  const rates = computeSlidingBurnRates(rows, { nowMs: NOW });
  assert.equal(rates.claude.tokens_last_60m, 2000);
  assert.equal(rates.claude.tokens_last_120m, 3000);
  assert.equal(rates.codex.tokens_last_60m, 300);
  assert.equal(rates.codex.tokens_last_120m, 300);
});

test("attachBurnRates computes percent/min and exhaustion ETA for anchored session windows", () => {
  // Claude 5h session window resetting at 14:30 => window started 09:30.
  // 5000 tokens consumed since window start, 60% quota used
  // => 0.012 %/token. Last 60 minutes burned 2000 tokens => 33.33 tokens/min
  // => 0.4 %/min => (100-60)/0.4 = 100 minutes => ETA 13:40.
  const rows = [
    claudeRow("2026-05-09T09:30:00.000Z", 1000),
    claudeRow("2026-05-09T10:00:00.000Z", 1000),
    claudeRow("2026-05-09T10:30:00.000Z", 1000),
    claudeRow("2026-05-09T11:00:00.000Z", 1000),
    claudeRow("2026-05-09T11:30:00.000Z", 1000),
  ];
  const data = {
    fetched_at: "2026-05-09T12:00:00.000Z",
    claude: {
      configured: true,
      five_hour: { utilization: 60, resets_at: "2026-05-09T14:30:00.000Z" },
    },
  };
  const out = attachBurnRates(data, rows, { nowMs: NOW });
  const burn = out.claude.burn_rate;
  assert.ok(burn, "claude must carry burn_rate");
  assert.equal(burn.basis, "local_estimate");
  assert.equal(burn.tokens_last_60m, 2000);
  // 120m window opens at 10:00 — excludes the 09:30 bucket.
  assert.equal(burn.tokens_last_120m, 4000);
  assert.ok(Math.abs(burn.percent_per_min - 0.4) < 1e-9, `percent_per_min ${burn.percent_per_min}`);
  assert.equal(burn.eta_exhaust_at, "2026-05-09T13:40:00.000Z");
  // Original response object must not be mutated.
  assert.equal(data.claude.burn_rate, undefined);
  // Non-provider metadata is untouched.
  assert.equal(out.fetched_at, "2026-05-09T12:00:00.000Z");
});

test("attachBurnRates returns null estimates when the window cannot be anchored or there is no recent burn", () => {
  const rows = [claudeRow("2026-05-09T11:30:00.000Z", 1000)];
  const data = {
    // Cursor has no anchored session window: tokens still reported, percent/ETA null.
    cursor: {
      configured: true,
      primary_window: { used_percent: 40, reset_at: "2026-06-01T00:00:00.000Z" },
    },
    // Claude window missing resets_at: cannot anchor.
    claude: { configured: true, five_hour: { utilization: 40, resets_at: null } },
    // Codex configured (unix-seconds reset) but zero recent queue activity.
    codex: {
      configured: true,
      primary_window: { used_percent: 40, reset_at: 1778680200, limit_window_seconds: 18000 },
    },
  };
  const out = attachBurnRates(data, rows, { nowMs: NOW });
  assert.equal(out.cursor.burn_rate.percent_per_min, null);
  assert.equal(out.cursor.burn_rate.eta_exhaust_at, null);
  assert.equal(out.claude.burn_rate.percent_per_min, null);
  assert.equal(out.claude.burn_rate.eta_exhaust_at, null);
  assert.equal(out.codex.burn_rate.tokens_last_60m, 0);
  assert.equal(out.codex.burn_rate.percent_per_min, null);
  assert.equal(out.codex.burn_rate.eta_exhaust_at, null);
});

test("usage-limits endpoint attaches burn_rate to providers but not token-only sources", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-burn-rate-endpoint-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const rows = [
      claudeRow("2026-05-09T09:30:00.000Z", 1000),
      claudeRow("2026-05-09T10:00:00.000Z", 1000),
      claudeRow("2026-05-09T10:30:00.000Z", 1000),
      claudeRow("2026-05-09T11:00:00.000Z", 1000),
      claudeRow("2026-05-09T11:30:00.000Z", 1000),
      { source: "trae", model: "claude-sonnet-4-6", hour_start: "2026-05-09T11:30:00.000Z", total_tokens: 120 },
    ];
    await fs.promises.writeFile(queuePath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: tmp,
      now: () => new Date(NOW),
      usageLimitsProvider: async () => ({
        fetched_at: "2026-05-09T12:00:00.000Z",
        claude: {
          configured: true,
          five_hour: { utilization: 60, resets_at: "2026-05-09T14:30:00.000Z" },
        },
      }),
    });
    const url = new URL("http://localhost/functions/tokentracker-usage-limits");
    const chunks = [];
    const res = {
      statusCode: 200,
      setHeader() {},
      writeHead() {},
      write(chunk) { chunks.push(chunk); },
      end(body) { if (body) chunks.push(body); },
    };
    const handled = await handler({ method: "GET", url: url.pathname, headers: { host: "localhost" } }, res, url);
    assert.ok(handled);
    const result = JSON.parse(chunks.join(""));
    assert.ok(result.claude.burn_rate, "claude burn_rate expected");
    assert.equal(result.claude.burn_rate.eta_exhaust_at, "2026-05-09T13:40:00.000Z");
    // Token-only providers keep their exact legacy shape (no burn_rate key).
    assert.equal(result.trae.burn_rate, undefined);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});
