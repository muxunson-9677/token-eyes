# Token Eyes Usage Statistics Second-Level Response Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/spend/usage` show a meaningful local overview within 500ms on repeated opens and within 2s on a representative cold start, without hiding stale data behind a loading state or replacing real figures with placeholders.

**Architecture:** Treat the synced `queue.jsonl` as the durable local snapshot for aggregate views. Aggregate endpoints use that snapshot immediately and read raw Codex rollout logs only when the requested range has no synced Codex rows. Add an mtime-and-size keyed in-process queue cache so the page's summary, provider, model, cost, and trend requests reuse one parsed snapshot. Preserve the existing browser stale-while-revalidate cache and request-detail rollout path.

**Tech Stack:** Node.js CommonJS local API, React 18/Vite dashboard, Node test runner, Vitest, PowerShell/Node performance harness.

---

## Root-cause evidence

- `/spend/usage` mounts `useUsageSummary`, cost totals, provider/model filter options, then trend and request details.
- `usage-summary`, `provider-stats`, `model-stats`, and `spend-timeseries` each call `withCodexRolloutRows`.
- The current implementation scans raw Codex rollouts even when the already-synced queue contains Codex rows for the requested range.
- A read-only benchmark on 2026-07-13 found a 749,354-byte queue and four in-range rollout files totalling 50,074,624 bytes.
- Sequential cold aggregate calls took 10.124s. A cold page-style fan-out took 11.845s wall time; summary/provider/model each remained pending for roughly 11 seconds.
- Therefore the primary cause is redundant raw-log scanning and concurrent scan amplification, not React rendering.

## File map

- Modify `src/lib/local-api.js`: choose synced queue rows before raw Codex fallback; cache parsed queue rows by file fingerprint.
- Modify `test/usage-caliber-consistency.test.js`: lock queue-snapshot precedence while preserving the existing empty-queue rollout fallback.
- Create `test/local-api-queue-cache.test.js`: lock cache reuse and invalidation behavior.
- Create `scripts/benchmark-usage-page.js`: reproduce cold/repeated `/spend/usage` endpoint fan-out and report P50/P95.
- Modify `package.json`: expose the benchmark as `npm run benchmark:usage-page`.
- Modify `docs/superpowers/specs/2026-07-13-token-eyes-fixes-1-6-design.md`: record measured evidence and only mark item 12 complete if thresholds pass.

### Task 1: Prefer the durable synced queue snapshot

**Files:**
- Modify: `test/usage-caliber-consistency.test.js`
- Modify: `src/lib/local-api.js`

- [ ] **Step 1: Write the failing regression test**

Add a test that writes one Codex queue row with `total_tokens: 100`, writes a conflicting rollout event with `total_tokens: 999`, then requests all four aggregate endpoints concurrently:

```js
test("aggregate views prefer synced Codex queue rows over redundant rollout rescans", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-caliber-codex-snapshot-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const trackerDataDir = path.join(tmp, "tracker");
    const codexHome = path.join(tmp, ".codex");
    const sessionsDir = path.join(codexHome, "sessions", "2026", "05", "09");
    await fs.promises.mkdir(trackerDataDir, { recursive: true });
    await fs.promises.mkdir(sessionsDir, { recursive: true });
    await writeQueue(queuePath, [{
      hour_start: "2026-05-09T10:00:00.000Z",
      source: "codex",
      model: "gpt-5",
      input_tokens: 80,
      output_tokens: 20,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      reasoning_output_tokens: 0,
      total_tokens: 100,
      billable_total_tokens: 100,
      conversation_count: 1,
    }]);
    await fs.promises.writeFile(
      path.join(trackerDataDir, "config.json"),
      JSON.stringify({ dataDirectories: { codex: codexHome } }),
      "utf8",
    );
    await fs.promises.writeFile(
      path.join(sessionsDir, "rollout-2026-05-09T10-00-00-000Z.jsonl"),
      [
        buildCodexTurnContextLine({ model: "gpt-5" }),
        buildCodexTokenCountLine({
          ts: "2026-05-09T10:05:00.000Z",
          last: {
            input_tokens: 900,
            cached_input_tokens: 0,
            cache_creation_input_tokens: 0,
            output_tokens: 99,
            reasoning_output_tokens: 0,
            total_tokens: 999,
          },
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const handler = createLocalApiHandler({ queuePath, trackerDataDir });
    const qs = "?from=2026-05-09&to=2026-05-09&tz=UTC&sources=codex";
    const [summary, timeseries, providers, models] = await Promise.all([
      callHandler(handler, `/functions/tokentracker-usage-summary${qs}`),
      callHandler(handler, `/functions/tokentracker-spend-timeseries${qs}&bucket=day`),
      callHandler(handler, `/functions/tokentracker-provider-stats${qs}`),
      callHandler(handler, `/functions/tokentracker-model-stats${qs}`),
    ]);

    assert.equal(summary.totals.total_tokens, 100);
    assert.equal(timeseries.totals.total_tokens, 100);
    assert.equal(providers.totals.total_tokens, 100);
    assert.equal(models.totals.total_tokens, 100);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test --test-name-pattern "aggregate views prefer synced Codex queue rows" test/usage-caliber-consistency.test.js
```

Expected: FAIL because the current code replaces the queue's 100 tokens with the rollout's 999 tokens.

- [ ] **Step 3: Add the smallest queue-snapshot predicate**

In `src/lib/local-api.js`, add:

```js
function hasCodexQueueRowsForRange(rows, { from = "", to = "", timeZoneContext = null } = {}) {
  return rows.some((row) => {
    if (normalizeSource(row.source) !== "codex") return false;
    const day = rowDayKey(row, timeZoneContext);
    if (!day) return false;
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });
}
```

Then make `withCodexRolloutRows` return `rows` immediately after the existing source-exclusion guard when the predicate is true. Keep the existing raw-rollout fallback unchanged for an empty/missing queue so the current fallback test remains valid.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
node --test --test-name-pattern "Codex real rollout logs|aggregate views prefer synced Codex queue rows|three-caliber consistency" test/usage-caliber-consistency.test.js
```

Expected: the new snapshot-precedence test and existing empty-queue fallback/caliber tests pass.

- [ ] **Step 5: Commit**

```powershell
git add -- src/lib/local-api.js test/usage-caliber-consistency.test.js
git commit -m "perf: serve aggregate usage from synced snapshot"
```

### Task 2: Reuse one parsed queue across aggregate endpoints

**Files:**
- Create: `test/local-api-queue-cache.test.js`
- Modify: `src/lib/local-api.js`

- [ ] **Step 1: Write the failing cache reuse and invalidation tests**

Create `test/local-api-queue-cache.test.js` with this complete test file. It patches `fs.readFileSync` only while calling `readQueueData(queuePath)`, asserts two reads with an unchanged fingerprint hit disk once, then rewrites the queue with a different size and verifies invalidation:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  clearQueueDataCacheForTests,
  readQueueData,
} = require("../src/lib/local-api");

function queueRow(totalTokens, hourStart = "2026-05-09T10:00:00Z") {
  return {
    hour_start: hourStart,
    source: "claude",
    model: "claude-sonnet-4",
    input_tokens: totalTokens,
    output_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: totalTokens,
    billable_total_tokens: totalTokens,
    conversation_count: 1,
  };
}

async function writeRows(queuePath, rows) {
  await fs.promises.writeFile(
    queuePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8",
  );
}

test("readQueueData reuses an unchanged parsed queue and invalidates on file change", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-queue-cache-"));
  const queuePath = path.join(tmp, "queue.jsonl");
  const originalReadFileSync = fs.readFileSync;
  let queueReads = 0;
  try {
    clearQueueDataCacheForTests();
    await writeRows(queuePath, [queueRow(100)]);
    fs.readFileSync = function patchedRead(filePath, ...args) {
      if (path.resolve(String(filePath)) === path.resolve(queuePath)) queueReads += 1;
      return originalReadFileSync.call(this, filePath, ...args);
    };

    assert.equal(readQueueData(queuePath)[0].total_tokens, 100);
    assert.equal(readQueueData(queuePath)[0].total_tokens, 100);
    assert.equal(queueReads, 1);

    await writeRows(queuePath, [queueRow(1000), queueRow(2000, "2026-05-09T10:30:00Z")]);
    assert.equal(readQueueData(queuePath).reduce((n, row) => n + row.total_tokens, 0), 3000);
    assert.equal(queueReads, 2);
  } finally {
    fs.readFileSync = originalReadFileSync;
    clearQueueDataCacheForTests();
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test test/local-api-queue-cache.test.js
```

Expected: FAIL because `readQueueData` and `clearQueueDataCacheForTests` are not exported and no parsed-queue cache exists.

- [ ] **Step 3: Implement the bounded fingerprint cache**

In `src/lib/local-api.js`:

```js
const QUEUE_DATA_CACHE_MAX_ENTRIES = 8;
const QUEUE_DATA_CACHE = new Map();

function readQueueData(queuePath) {
  const fingerprint = queueFileMtimeKey(queuePath);
  const cached = QUEUE_DATA_CACHE.get(queuePath);
  if (cached?.fingerprint === fingerprint) return cached.rows;

  let raw;
  try {
    raw = fs.readFileSync(queuePath, "utf8");
  } catch (e) {
    if (e?.code !== "ENOENT") {
      console.error("[LocalAPI] readQueueData: failed to read queue:", e?.message || e);
    }
    return [];
  }
  const lines = raw.split("\n").filter((line) => line.trim());
  const parsed = [];
  let malformed = 0;
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      malformed += 1;
    }
  }
  if (malformed > 0) {
    console.error(
      `[LocalAPI] readQueueData: skipped ${malformed}/${lines.length} malformed line(s) in ${queuePath}`,
    );
  }
  const seen = new Map();
  for (const row of parsed) {
    const key = `${row.source || ""}|${row.model || ""}|${row.hour_start || ""}`;
    seen.set(key, normalizeQueueRow(row));
  }
  const rows = Array.from(seen.values());
  QUEUE_DATA_CACHE.delete(queuePath);
  QUEUE_DATA_CACHE.set(queuePath, { fingerprint, rows });
  while (QUEUE_DATA_CACHE.size > QUEUE_DATA_CACHE_MAX_ENTRIES) {
    QUEUE_DATA_CACHE.delete(QUEUE_DATA_CACHE.keys().next().value);
  }
  return rows;
}

function clearQueueDataCacheForTests() {
  QUEUE_DATA_CACHE.clear();
}
```

Export `readQueueData` and `clearQueueDataCacheForTests`. Do not change normalization, malformed-line tolerance, or dedup keys.

- [ ] **Step 4: Run the focused test and local API regression set**

Run:

```powershell
node --test test/local-api-queue-cache.test.js test/usage-caliber-consistency.test.js test/local-api-source-scope.test.js
```

Expected: all pass with zero failures.

- [ ] **Step 5: Commit**

```powershell
git add -- src/lib/local-api.js test/local-api-queue-cache.test.js
git commit -m "perf: cache parsed local usage queue"
```

### Task 3: Add a repeatable page-load benchmark

**Files:**
- Create: `scripts/benchmark-usage-page.js`
- Modify: `package.json`

- [ ] **Step 1: Add the benchmark harness**

Create `scripts/benchmark-usage-page.js` with the following complete implementation:

- resolve the existing local queue read-only;
- instantiate one local API handler with `trackerDataDir: process.cwd()`;
- request usage-summary, provider-stats, model-stats, spend-records and spend-timeseries in the same fan-out shape as `/spend/usage`;
- run one cold iteration and ten repeated iterations;
- print queue bytes, cold wall time, repeated P50/P95, endpoint timings and thresholds;
- exit non-zero when cold exceeds 2000ms or repeated P95 exceeds 500ms.

```js
const fs = require("node:fs");
const { performance } = require("node:perf_hooks");
const {
  createLocalApiHandler,
  resolveQueuePath,
} = require("../src/lib/local-api");

const COLD_LIMIT_MS = 2000;
const REPEATED_P95_LIMIT_MS = 500;
const REPEATED_RUNS = 10;

function percentile(values, percentileValue) {
  const sorted = values.slice().sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[index];
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function defaultRange() {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);
  return { from: dateKey(from), to: dateKey(to) };
}

function createResponseCapture() {
  let body = "";
  return {
    response: {
      statusCode: 200,
      setHeader() {},
      writeHead(code) { this.statusCode = code; },
      write(chunk) { body += chunk; },
      end(chunk) { if (chunk) body += chunk; },
    },
    body: () => body,
  };
}

async function callEndpoint(handler, endpoint) {
  const url = new URL(`http://localhost${endpoint}`);
  const req = {
    method: "GET",
    url: url.pathname + url.search,
    headers: { host: "localhost" },
  };
  const capture = createResponseCapture();
  const startedAt = performance.now();
  const handled = await handler(req, capture.response, url);
  return {
    endpoint: url.pathname,
    handled,
    status: capture.response.statusCode,
    bytes: Buffer.byteLength(capture.body()),
    duration_ms: Number((performance.now() - startedAt).toFixed(1)),
  };
}

async function runFanout(handler, range) {
  const query = `?from=${range.from}&to=${range.to}&tz=Asia%2FShanghai&tz_offset_minutes=-480`;
  const endpoints = [
    `/functions/tokentracker-usage-summary${query}&rolling=1`,
    `/functions/tokentracker-provider-stats${query}`,
    `/functions/tokentracker-model-stats${query}`,
    `/functions/tokentracker-spend-records${query}`,
    `/functions/tokentracker-spend-timeseries${query}&bucket=day`,
  ];
  const startedAt = performance.now();
  const results = await Promise.all(endpoints.map((endpoint) => callEndpoint(handler, endpoint)));
  return {
    wall_ms: Number((performance.now() - startedAt).toFixed(1)),
    endpoints: results,
  };
}

async function main() {
  const queuePath = resolveQueuePath();
  const queueStat = fs.statSync(queuePath);
  const handler = createLocalApiHandler({
    queuePath,
    trackerDataDir: process.cwd(),
  });
  const range = defaultRange();
  const cold = await runFanout(handler, range);
  const repeated = [];
  for (let index = 0; index < REPEATED_RUNS; index += 1) {
    repeated.push(await runFanout(handler, range));
  }
  const repeatedWalls = repeated.map((run) => run.wall_ms);
  const report = {
    queue_path: queuePath,
    queue_bytes: queueStat.size,
    range,
    thresholds_ms: {
      cold: COLD_LIMIT_MS,
      repeated_p95: REPEATED_P95_LIMIT_MS,
    },
    cold,
    repeated: {
      runs: REPEATED_RUNS,
      p50_ms: percentile(repeatedWalls, 50),
      p95_ms: percentile(repeatedWalls, 95),
      samples_ms: repeatedWalls,
    },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (cold.wall_ms > COLD_LIMIT_MS || report.repeated.p95_ms > REPEATED_P95_LIMIT_MS) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

Add to `package.json`:

```json
"benchmark:usage-page": "node scripts/benchmark-usage-page.js"
```

- [ ] **Step 2: Validate syntax and run the real-data benchmark**

Run:

```powershell
node --check scripts/benchmark-usage-page.js
npm run benchmark:usage-page
```

Expected: exit 0; cold wall time ≤2000ms and repeated P95 ≤500ms. If the threshold fails, do not change the number: return to root-cause investigation and optimize the measured bottleneck.

- [ ] **Step 3: Commit**

```powershell
git add -- scripts/benchmark-usage-page.js package.json
git commit -m "test: add usage page performance benchmark"
```

### Task 4: Full verification and progress tracking

**Files:**
- Modify: `docs/superpowers/specs/2026-07-13-token-eyes-fixes-1-6-design.md`

- [ ] **Step 1: Run focused and project verification**

```powershell
node --test test/local-api-queue-cache.test.js test/usage-caliber-consistency.test.js test/local-api-source-scope.test.js
npm run dashboard:build
npm run validate:copy
npm run validate:ui-hardcode
git diff --check
```

Expected: zero test/build/validation failures and a clean diff check.

- [ ] **Step 2: Run the final fresh benchmark**

```powershell
npm run benchmark:usage-page
```

Record the actual queue size, cold wall time and repeated P50/P95. Do not mark item 12 complete unless the command exits 0.

- [ ] **Step 3: Update the 12-item tracking document**

Change item 12 from partial to complete only when the thresholds pass. Append a progress row with the original 11.845s reproduction, final timings, tests, build and remaining manual installed-client verification.

- [ ] **Step 4: Commit documentation**

```powershell
git add -- docs/superpowers/specs/2026-07-13-token-eyes-fixes-1-6-design.md
git commit -m "docs: record usage performance verification"
```
