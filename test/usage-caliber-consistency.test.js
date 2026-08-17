const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");

async function writeQueue(queuePath, rows) {
  await fs.promises.writeFile(
    queuePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
}

async function callEndpoint(queuePath, endpoint) {
  const handler = createLocalApiHandler({ queuePath });
  return callHandler(handler, endpoint);
}

async function callHandler(handler, endpoint) {
  const url = new URL(`http://localhost${endpoint}`);
  const req = {
    method: "GET",
    url: url.pathname + url.search,
    headers: { host: "localhost" },
  };
  const chunks = [];
  const res = {
    statusCode: 200,
    setHeader() {},
    writeHead() {},
    write(chunk) {
      chunks.push(chunk);
    },
    end(body) {
      if (body) chunks.push(body);
    },
  };
  const handled = await handler(req, res, url);
  assert.ok(handled, `endpoint must be handled: ${endpoint}`);
  return JSON.parse(chunks.join(""));
}

const CONSISTENCY_ROWS = [
  {
    source: "claude",
    model: "claude-sonnet-4-6",
    hour_start: "2026-05-09T10:00:00.000Z",
    input_tokens: 100,
    cached_input_tokens: 200,
    cache_creation_input_tokens: 0,
    output_tokens: 50,
    reasoning_output_tokens: 0,
    total_tokens: 350,
    conversation_count: 2,
  },
  {
    source: "claude",
    model: "claude-sonnet-4-6",
    hour_start: "2026-05-09T10:30:00.000Z",
    input_tokens: 10,
    cached_input_tokens: 20,
    cache_creation_input_tokens: 0,
    output_tokens: 5,
    reasoning_output_tokens: 0,
    total_tokens: 35,
    conversation_count: 1,
  },
  {
    source: "gemini",
    model: "gemini-2.5-pro",
    hour_start: "2026-05-09T11:00:00.000Z",
    input_tokens: 1000,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 500,
    reasoning_output_tokens: 0,
    total_tokens: 1500,
    conversation_count: 3,
  },
];

const CALIBER_TOLERANCE = 1e-6;

function buildCodexTurnContextLine({ model }) {
  return JSON.stringify({
    type: "turn_context",
    payload: { model },
  });
}

function buildCodexTokenCountLine({ ts, last, total = last }) {
  return JSON.stringify({
    type: "event_msg",
    timestamp: ts,
    payload: {
      type: "token_count",
      info: {
        last_token_usage: last,
        total_token_usage: total,
      },
    },
  });
}

test("three-caliber consistency: usage-summary === spend-timeseries totals === provider-stats totals (non-codex)", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-caliber-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, CONSISTENCY_ROWS);
    const qs = "?from=2026-05-09&to=2026-05-09&tz=UTC";

    const summary = await callEndpoint(
      queuePath,
      `/functions/tokentracker-usage-summary${qs}`,
    );
    const timeseries = await callEndpoint(
      queuePath,
      `/functions/tokentracker-spend-timeseries${qs}`,
    );
    const providerStats = await callEndpoint(
      queuePath,
      `/functions/tokentracker-provider-stats${qs}`,
    );
    const modelStats = await callEndpoint(
      queuePath,
      `/functions/tokentracker-model-stats${qs}`,
    );

    // total_tokens must be identical across all four endpoints
    const summaryTokens = summary.totals.total_tokens;
    const tsTokens = timeseries.totals.total_tokens;
    const psTokens = providerStats.totals.total_tokens;
    const msTokens = modelStats.totals.total_tokens;

    assert.equal(
      summaryTokens,
      tsTokens,
      `usage-summary(${summaryTokens}) !== spend-timeseries(${tsTokens})`,
    );
    assert.equal(
      summaryTokens,
      psTokens,
      `usage-summary(${summaryTokens}) !== provider-stats(${psTokens})`,
    );
    assert.equal(
      summaryTokens,
      msTokens,
      `usage-summary(${summaryTokens}) !== model-stats(${msTokens})`,
    );

    // Expected: 350 + 35 + 1500 = 1885
    assert.equal(summaryTokens, 1885);

    // cost_usd must also match (within tolerance for float rounding)
    const summaryCost = Number(summary.totals.cost_usd);
    const tsCost = Number(timeseries.totals.cost_usd);
    const psCost = Number(providerStats.totals.cost_usd);
    const msCost = Number(modelStats.totals.cost_usd);

    assert.ok(
      Math.abs(summaryCost - tsCost) < CALIBER_TOLERANCE,
      `cost_usd: usage-summary(${summaryCost}) !== spend-timeseries(${tsCost})`,
    );
    assert.ok(
      Math.abs(summaryCost - psCost) < CALIBER_TOLERANCE,
      `cost_usd: usage-summary(${summaryCost}) !== provider-stats(${psCost})`,
    );
    assert.ok(
      Math.abs(summaryCost - msCost) < CALIBER_TOLERANCE,
      `cost_usd: usage-summary(${summaryCost}) !== model-stats(${msCost})`,
    );

    // conversation_count consistency
    assert.equal(summary.totals.conversation_count, 6);
    assert.equal(providerStats.totals.conversation_count, 6);
    assert.equal(modelStats.totals.conversation_count, 6);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("Codex real rollout logs feed usage-summary, spend-timeseries, provider-stats, and model-stats when queue is empty", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-caliber-codex-rollout-"));
  const originalCreateReadStream = fs.createReadStream;
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const trackerDataDir = path.join(tmp, "tracker");
    const codexHome = path.join(tmp, ".codex");
    const codexSessionsDir = path.join(codexHome, "sessions", "2026", "05", "09");
    await fs.promises.mkdir(trackerDataDir, { recursive: true });
    await fs.promises.mkdir(codexSessionsDir, { recursive: true });
    await writeQueue(queuePath, []);
    await fs.promises.writeFile(
      path.join(trackerDataDir, "config.json"),
      JSON.stringify({ dataDirectories: { codex: codexHome } }, null, 2) + "\n",
      "utf8",
    );

    const usage1 = {
      input_tokens: 120,
      cached_input_tokens: 20,
      cache_creation_input_tokens: 0,
      output_tokens: 30,
      reasoning_output_tokens: 0,
      total_tokens: 150,
    };
    const usage2 = {
      input_tokens: 70,
      cached_input_tokens: 10,
      cache_creation_input_tokens: 0,
      output_tokens: 40,
      reasoning_output_tokens: 0,
      total_tokens: 110,
    };
    const rolloutPath = path.join(codexSessionsDir, "rollout-2026-05-09T10-00-00-000Z.jsonl");
    await fs.promises.writeFile(
      rolloutPath,
      [
        buildCodexTurnContextLine({ model: "gpt-4o" }),
        buildCodexTokenCountLine({ ts: "2026-05-09T10:05:00.000Z", last: usage1 }),
        buildCodexTokenCountLine({ ts: "2026-05-09T10:35:00.000Z", last: usage2 }),
      ].join("\n") + "\n",
      "utf8",
    );
    let rolloutReads = 0;
    fs.createReadStream = function patchedCreateReadStream(filePath, ...args) {
      if (path.resolve(String(filePath)) === path.resolve(rolloutPath)) rolloutReads += 1;
      return originalCreateReadStream.call(this, filePath, ...args);
    };

    const handler = createLocalApiHandler({ queuePath, trackerDataDir });
    const qs = "?from=2026-05-09&to=2026-05-09&tz=UTC&sources=codex";
    const [summary, timeseries, providerStats, modelStats] = await Promise.all([
      callHandler(handler, `/functions/tokentracker-usage-summary${qs}`),
      callHandler(handler, `/functions/tokentracker-spend-timeseries${qs}&bucket=day`),
      callHandler(handler, `/functions/tokentracker-provider-stats${qs}`),
      callHandler(handler, `/functions/tokentracker-model-stats${qs}`),
    ]);

    assert.equal(summary.totals.total_tokens, 260);
    assert.equal(summary.totals.input_tokens, 160);
    assert.equal(summary.totals.cached_input_tokens, 30);
    assert.equal(summary.totals.output_tokens, 70);
    assert.equal(timeseries.totals.total_tokens, 260);
    assert.equal(providerStats.totals.total_tokens, 260);
    assert.equal(modelStats.totals.total_tokens, 260);
    assert.equal(providerStats.providers[0].source, "codex");
    assert.equal(modelStats.models[0].model, "gpt-4o");
    assert.equal(rolloutReads, 1);
  } finally {
    fs.createReadStream = originalCreateReadStream;
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("concurrent and subsequent Codex rollout scans refresh when the file set changes", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-caliber-codex-refresh-"));
  const originalCreateReadStream = fs.createReadStream;
  const originalStat = fs.promises.stat;
  const openedPaths = [];
  let rolloutStatCalls = 0;
  let resolverCalls = 0;
  let releaseFirstScan;
  let firstScanBlocked;
  let releaseSecondScan;
  let secondScanBlocked;
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const trackerDataDir = path.join(tmp, "tracker");
    const codexHome = path.join(tmp, ".codex");
    const sessionsDir = path.join(codexHome, "sessions", "2026", "05", "09");
    await fs.promises.mkdir(trackerDataDir, { recursive: true });
    await fs.promises.mkdir(sessionsDir, { recursive: true });
    await writeQueue(queuePath, []);
    await fs.promises.writeFile(
      path.join(trackerDataDir, "config.json"),
      JSON.stringify({ dataDirectories: { codex: codexHome } }, null, 2) + "\n",
      "utf8",
    );

    const firstRolloutPath = path.join(sessionsDir, "rollout-2026-05-09T10-00-00-000Z.jsonl");
    await fs.promises.writeFile(
      firstRolloutPath,
      [
        buildCodexTurnContextLine({ model: "gpt-4o" }),
        buildCodexTokenCountLine({
          ts: "2026-05-09T10:05:00.000Z",
          last: { input_tokens: 80, output_tokens: 20, total_tokens: 100 },
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    fs.createReadStream = function recordRolloutPath(filePath, ...args) {
      openedPaths.push(path.resolve(String(filePath)));
      return originalCreateReadStream.call(this, filePath, ...args);
    };
    let markFirstScanBlocked;
    let markSecondScanBlocked;
    firstScanBlocked = new Promise((resolve) => { markFirstScanBlocked = resolve; });
    secondScanBlocked = new Promise((resolve) => { markSecondScanBlocked = resolve; });
    fs.promises.stat = async function gateScanGenerations(filePath, ...args) {
      if (String(filePath).endsWith(".jsonl")) {
        rolloutStatCalls += 1;
        if (rolloutStatCalls === 2) {
          await new Promise((release) => {
            releaseFirstScan = release;
            markFirstScanBlocked();
          });
        } else if (rolloutStatCalls === 3) {
          await new Promise((release) => {
            releaseSecondScan = release;
            markSecondScanBlocked();
          });
        }
      }
      return originalStat.call(this, filePath, ...args);
    };

    const handlerOptions = {
      queuePath,
      trackerDataDir,
      dataDirectoryPathsResolver: () => {
        resolverCalls += 1;
        return { codexHome, codexHomes: [codexHome] };
      },
    };
    const handler = createLocalApiHandler(handlerOptions);
    const endpoint = "/functions/tokentracker-usage-summary?from=2026-05-09&to=2026-05-09&tz=UTC&sources=codex";
    const firstRequest = callHandler(handler, endpoint);
    await firstScanBlocked;

    const secondRolloutPath = path.join(sessionsDir, "rollout-2026-05-09T11-00-00-000Z.jsonl");
    await fs.promises.writeFile(
      secondRolloutPath,
      [
        buildCodexTurnContextLine({ model: "gpt-5" }),
        buildCodexTokenCountLine({
          ts: "2026-05-09T11:05:00.000Z",
          last: { input_tokens: 150, output_tokens: 50, total_tokens: 200 },
        }),
      ].join("\n") + "\n",
      "utf8",
    );
    const waiterRequests = [1, 2, 3, 4].map((probe) => callHandler(handler, `${endpoint}&probe=${probe}`));
    releaseFirstScan();
    await secondScanBlocked;

    const thirdRolloutPath = path.join(sessionsDir, "rollout-2026-05-09T12-00-00-000Z.jsonl");
    await fs.promises.writeFile(
      thirdRolloutPath,
      [
        buildCodexTurnContextLine({ model: "gpt-5.6-sol" }),
        buildCodexTokenCountLine({
          ts: "2026-05-09T12:05:00.000Z",
          last: { input_tokens: 40, output_tokens: 10, total_tokens: 50 },
        }),
      ].join("\n") + "\n",
      "utf8",
    );
    const lateWaiterRequests = [5, 6, 7, 8].map((probe) => callHandler(handler, `${endpoint}&probe=${probe}`));
    releaseSecondScan();

    const [first, ...waiters] = await Promise.all([
      firstRequest,
      ...waiterRequests,
      ...lateWaiterRequests,
    ]);
    assert.equal(first.totals.total_tokens, 100);
    assert.deepEqual(
      waiters.map((result) => result.totals.total_tokens),
      [300, 300, 300, 300, 350, 350, 350, 350],
    );
    assert.equal(rolloutStatCalls, 12, "each waiter cohort must share exactly one follow-up scan");
    assert.ok(resolverCalls > 0);
    assert.ok(openedPaths.length >= 2);
    assert.ok(openedPaths.every((filePath) => filePath.startsWith(path.resolve(codexHome) + path.sep)));
  } finally {
    releaseFirstScan?.();
    releaseSecondScan?.();
    fs.createReadStream = originalCreateReadStream;
    fs.promises.stat = originalStat;
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("Codex rollout scans recover after an owner generation rejects", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-caliber-codex-recovery-"));
  const originalCreateReadStream = fs.createReadStream;
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const trackerDataDir = path.join(tmp, "tracker");
    const codexHome = path.join(tmp, ".codex");
    const sessionsDir = path.join(codexHome, "sessions", "2026", "05", "09");
    await fs.promises.mkdir(trackerDataDir, { recursive: true });
    await fs.promises.mkdir(sessionsDir, { recursive: true });
    await writeQueue(queuePath, []);
    await fs.promises.writeFile(
      path.join(trackerDataDir, "config.json"),
      JSON.stringify({ dataDirectories: { codex: codexHome } }, null, 2) + "\n",
      "utf8",
    );
    await fs.promises.writeFile(
      path.join(sessionsDir, "rollout-2026-05-09T10-00-00-000Z.jsonl"),
      [
        buildCodexTurnContextLine({ model: "gpt-5" }),
        buildCodexTokenCountLine({
          ts: "2026-05-09T10:05:00.000Z",
          last: { input_tokens: 80, output_tokens: 20, total_tokens: 100 },
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    let rejectNextStream = true;
    fs.createReadStream = function rejectFirstRollout(filePath, ...args) {
      if (rejectNextStream && String(filePath).endsWith(".jsonl")) {
        rejectNextStream = false;
        throw new Error("injected rollout scan failure");
      }
      return originalCreateReadStream.call(this, filePath, ...args);
    };
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir,
      dataDirectoryPathsResolver: () => ({ codexHome, codexHomes: [codexHome] }),
    });
    const endpoint = "/functions/tokentracker-usage-summary?from=2026-05-09&to=2026-05-09&tz=UTC&sources=codex";
    await assert.rejects(() => callHandler(handler, endpoint), /injected rollout scan failure/u);

    const recovered = await callHandler(handler, endpoint);
    assert.equal(recovered.totals.total_tokens, 100);
  } finally {
    fs.createReadStream = originalCreateReadStream;
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("Codex rollout cache refreshes when a non-newest file changes", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-caliber-codex-signature-"));
  const originalCreateReadStream = fs.createReadStream;
  const openedPaths = [];
  let resolverCalls = 0;
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const trackerDataDir = path.join(tmp, "tracker");
    const codexHome = path.join(tmp, ".codex");
    const sessionsDir = path.join(codexHome, "sessions", "2026", "05", "09");
    await fs.promises.mkdir(trackerDataDir, { recursive: true });
    await fs.promises.mkdir(sessionsDir, { recursive: true });
    await writeQueue(queuePath, []);
    await fs.promises.writeFile(
      path.join(trackerDataDir, "config.json"),
      JSON.stringify({ dataDirectories: { codex: codexHome } }, null, 2) + "\n",
      "utf8",
    );

    const olderRolloutPath = path.join(sessionsDir, "rollout-2026-05-09T10-00-00-000Z.jsonl");
    const newestRolloutPath = path.join(sessionsDir, "rollout-2026-05-09T11-00-00-000Z.jsonl");
    const writeRollout = (filePath, model, ts, totalTokens) => fs.promises.writeFile(
      filePath,
      [
        buildCodexTurnContextLine({ model }),
        buildCodexTokenCountLine({
          ts,
          last: { input_tokens: totalTokens, output_tokens: 0, total_tokens: totalTokens },
        }),
      ].join("\n") + "\n",
      "utf8",
    );
    await writeRollout(olderRolloutPath, "gpt-4o", "2026-05-09T10:05:00.000Z", 100);
    await writeRollout(newestRolloutPath, "gpt-5", "2026-05-09T11:05:00.000Z", 200);
    const olderMtime = new Date("2026-05-09T10:30:00.000Z");
    const newestMtime = new Date("2026-05-09T11:30:00.000Z");
    await fs.promises.utimes(olderRolloutPath, olderMtime, olderMtime);
    await fs.promises.utimes(newestRolloutPath, newestMtime, newestMtime);

    fs.createReadStream = function recordRolloutPath(filePath, ...args) {
      openedPaths.push(path.resolve(String(filePath)));
      return originalCreateReadStream.call(this, filePath, ...args);
    };

    const handlerOptions = {
      queuePath,
      trackerDataDir,
      dataDirectoryPathsResolver: () => {
        resolverCalls += 1;
        return { codexHome, codexHomes: [codexHome] };
      },
    };
    const handler = createLocalApiHandler(handlerOptions);
    const endpoint = "/functions/tokentracker-usage-summary?from=2026-05-09&to=2026-05-09&tz=UTC&sources=codex";
    const first = await callHandler(handler, endpoint);
    assert.equal(first.totals.total_tokens, 300);

    await writeRollout(olderRolloutPath, "gpt-4o", "2026-05-09T10:05:00.000Z", 150);
    const modifiedOlderMtime = new Date("2026-05-09T11:00:00.000Z");
    await fs.promises.utimes(olderRolloutPath, modifiedOlderMtime, modifiedOlderMtime);

    const secondHandler = createLocalApiHandler(handlerOptions);
    const second = await callHandler(secondHandler, endpoint);
    assert.equal(second.totals.total_tokens, 350);
    assert.ok(resolverCalls >= 2);
    assert.ok(openedPaths.length >= 4);
    assert.ok(openedPaths.every((filePath) => filePath.startsWith(path.resolve(codexHome) + path.sep)));
  } finally {
    fs.createReadStream = originalCreateReadStream;
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("Codex rollout signatures avoid synchronous filesystem stats", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "local-api.js"), "utf8");
  const signature = source.match(
    /async function codexRolloutFilesSignature\(files\)\s*\{[\s\S]*?\n\}/u,
  )?.[0];
  assert.ok(signature, "async Codex rollout signature helper must exist");
  assert.doesNotMatch(signature, /statSync/u);
  assert.match(signature, /await fs\.promises\.stat\(filePath\)/u);
});

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

test("three-caliber consistency: filtered by sources param", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-caliber-filter-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, CONSISTENCY_ROWS);
    const qs = "?from=2026-05-09&to=2026-05-09&tz=UTC&sources=claude";

    const summary = await callEndpoint(
      queuePath,
      `/functions/tokentracker-usage-summary${qs}`,
    );
    const timeseries = await callEndpoint(
      queuePath,
      `/functions/tokentracker-spend-timeseries${qs}`,
    );
    const providerStats = await callEndpoint(
      queuePath,
      `/functions/tokentracker-provider-stats${qs}`,
    );
    const modelStats = await callEndpoint(
      queuePath,
      `/functions/tokentracker-model-stats${qs}`,
    );

    // Filtered to claude only: 350 + 35 = 385 tokens
    assert.equal(summary.totals.total_tokens, 385);
    assert.equal(timeseries.totals.total_tokens, 385);
    assert.equal(providerStats.totals.total_tokens, 385);
    assert.equal(modelStats.totals.total_tokens, 385);

    // cost_usd consistency
    const sCost = Number(summary.totals.cost_usd);
    const tCost = Number(timeseries.totals.cost_usd);
    const pCost = Number(providerStats.totals.cost_usd);
    const mCost = Number(modelStats.totals.cost_usd);
    assert.ok(Math.abs(sCost - tCost) < CALIBER_TOLERANCE);
    assert.ok(Math.abs(sCost - pCost) < CALIBER_TOLERANCE);
    assert.ok(Math.abs(sCost - mCost) < CALIBER_TOLERANCE);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("three-caliber consistency: filtered by models param", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-caliber-model-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, CONSISTENCY_ROWS);
    const qs = "?from=2026-05-09&to=2026-05-09&tz=UTC&models=gemini-2.5-pro";

    const summary = await callEndpoint(
      queuePath,
      `/functions/tokentracker-usage-summary${qs}`,
    );
    const timeseries = await callEndpoint(
      queuePath,
      `/functions/tokentracker-spend-timeseries${qs}`,
    );
    const providerStats = await callEndpoint(
      queuePath,
      `/functions/tokentracker-provider-stats${qs}`,
    );
    const modelStats = await callEndpoint(
      queuePath,
      `/functions/tokentracker-model-stats${qs}`,
    );

    // Filtered to gemini-2.5-pro only: 1500 tokens
    assert.equal(summary.totals.total_tokens, 1500);
    assert.equal(timeseries.totals.total_tokens, 1500);
    assert.equal(providerStats.totals.total_tokens, 1500);
    assert.equal(modelStats.totals.total_tokens, 1500);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("three-caliber consistency: empty data returns zeros across all endpoints", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-caliber-empty-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, []);
    const qs = "?from=2026-05-09&to=2026-05-09&tz=UTC";

    const summary = await callEndpoint(
      queuePath,
      `/functions/tokentracker-usage-summary${qs}`,
    );
    const timeseries = await callEndpoint(
      queuePath,
      `/functions/tokentracker-spend-timeseries${qs}`,
    );
    const providerStats = await callEndpoint(
      queuePath,
      `/functions/tokentracker-provider-stats${qs}`,
    );
    const modelStats = await callEndpoint(
      queuePath,
      `/functions/tokentracker-model-stats${qs}`,
    );

    assert.equal(summary.totals.total_tokens, 0);
    assert.equal(timeseries.totals.total_tokens, 0);
    assert.equal(providerStats.totals.total_tokens, 0);
    assert.equal(modelStats.totals.total_tokens, 0);

    assert.equal(Number(summary.totals.cost_usd), 0);
    assert.equal(Number(timeseries.totals.cost_usd), 0);
    assert.equal(Number(providerStats.totals.cost_usd), 0);
    assert.equal(Number(modelStats.totals.cost_usd), 0);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("three-caliber consistency: provider-stats sum of providers === totals", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-caliber-sum-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, CONSISTENCY_ROWS);
    const qs = "?from=2026-05-09&to=2026-05-09&tz=UTC";

    const providerStats = await callEndpoint(
      queuePath,
      `/functions/tokentracker-provider-stats${qs}`,
    );
    const modelStats = await callEndpoint(
      queuePath,
      `/functions/tokentracker-model-stats${qs}`,
    );

    // Sum of provider tokens === totals.total_tokens
    const psSum = providerStats.providers.reduce((a, p) => a + p.tokens, 0);
    assert.equal(psSum, providerStats.totals.total_tokens);

    // Sum of model tokens === totals.total_tokens
    const msSum = modelStats.models.reduce((a, m) => a + m.tokens, 0);
    assert.equal(msSum, modelStats.totals.total_tokens);

    // Both sums equal the same value
    assert.equal(psSum, msSum);
    assert.equal(psSum, 1885);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("three-caliber consistency: request-usage-records queue_baseline_totals matches usage-summary (non-codex)", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-caliber-records-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, CONSISTENCY_ROWS);
    const qs = "?from=2026-05-09&to=2026-05-09&tz=UTC&sources=claude";

    const summary = await callEndpoint(
      queuePath,
      `/functions/tokentracker-usage-summary${qs}`,
    );
    const records = await callEndpoint(
      queuePath,
      `/functions/tokentracker-request-usage-records${qs}`,
    );

    // For non-codex sources, request-usage-records synthesizes records from
    // queue.jsonl. The `queue_baseline_totals` field must match usage-summary
    // totals (both come from computeQueueTotals over the same rows + filters).
    assert.ok(records.queue_baseline_totals, "queue_baseline_totals should exist");

    assert.equal(
      records.queue_baseline_totals.total_tokens,
      summary.totals.total_tokens,
      "queue_baseline_totals.total_tokens must match usage-summary",
    );
    assert.ok(
      Math.abs(
        Number(records.queue_baseline_totals.cost_usd) - Number(summary.totals.cost_usd),
      ) < CALIBER_TOLERANCE,
      "queue_baseline_totals.cost_usd must match usage-summary",
    );
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("three-caliber consistency: request-usage-records aggregate totals match usage-summary for non-codex", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-caliber-records-totals-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, CONSISTENCY_ROWS);
    // sources=claude,gemini avoids the codex rollout branch.
    // Non-codex queue rows are aggregate-only, but the request log must still
    // expose explicit aggregate bucket records so Spend and Overview do not
    // diverge visually.
    const qs = "?from=2026-05-09&to=2026-05-09&tz=UTC&sources=claude,gemini";

    const summary = await callEndpoint(
      queuePath,
      `/functions/tokentracker-usage-summary${qs}`,
    );
    const records = await callEndpoint(
      queuePath,
      `/functions/tokentracker-request-usage-records${qs}`,
    );

    assert.ok(records.records.length > 0, "aggregate-only queue sources should still return aggregate bucket records");
    assert.ok(records.records.every((r) => r.record_kind === "aggregate_bucket"));
    assert.equal(records.totals.total_tokens, summary.totals.total_tokens,
      "request-usage-records totals.total_tokens should match usage-summary aggregate tokens");
    assert.equal(records.totals.request_count, summary.totals.conversation_count,
      "request-usage-records totals.request_count should use conversation_count fallback");
    assert.equal(records.totals.success_count, null,
      "request-usage-records totals.success_count should be null for non-codex");
    assert.equal(records.totals.success_rate, null,
      "request-usage-records totals.success_rate should be null for non-codex");
    assert.equal(records.totals.avg_latency_ms, null,
      "request-usage-records totals.avg_latency_ms should be null for non-codex");

    // Expected: 350 + 35 + 1500 = 1885 (from usage-summary)
    assert.equal(summary.totals.total_tokens, 1885);

    // queue_baseline_totals (computeQueueTotals path) must match usage-summary —
    // this is the explicit three-way consistency baseline for non-codex sources.
    assert.equal(
      records.queue_baseline_totals.total_tokens,
      summary.totals.total_tokens,
      "queue_baseline_totals.total_tokens must match usage-summary",
    );
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("WO-7: agent_ids scopes to single agent (not union with sources allowlist)", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-caliber-agent-filter-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, CONSISTENCY_ROWS);

    const allSummary = await callEndpoint(
      queuePath,
      "/functions/tokentracker-usage-summary?from=2026-05-09&to=2026-05-09&tz=UTC&sources=claude,gemini",
    );
    const claudeOnly = await callEndpoint(
      queuePath,
      "/functions/tokentracker-usage-summary?from=2026-05-09&to=2026-05-09&tz=UTC&sources=claude,gemini&agent_ids=claude",
    );
    const hermesOnly = await callEndpoint(
      queuePath,
      "/functions/tokentracker-usage-summary?from=2026-05-09&to=2026-05-09&tz=UTC&sources=claude,gemini&agent_ids=hermes",
    );

    assert.equal(allSummary.totals.total_tokens, 1885);
    assert.equal(claudeOnly.totals.total_tokens, 385, "claude agent filter must exclude gemini");
    assert.equal(hermesOnly.totals.total_tokens, 0, "hermes with no queue rows must be zero");
    assert.notEqual(claudeOnly.totals.total_tokens, allSummary.totals.total_tokens);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("project-usage-summary respects date range and limit", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-project-summary-range-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const projectQueuePath = path.join(tmp, "project.queue.jsonl");
    await writeQueue(queuePath, []);
    await writeQueue(projectQueuePath, [
      {
        project_key: "old-project",
        project_ref: "old-project",
        hour_start: "2026-07-01T00:00:00.000Z",
        source: "claude",
        model: "sonnet",
        total_tokens: 9999,
        conversation_count: 9,
      },
      {
        project_key: "today-project",
        project_ref: "today-project",
        hour_start: "2026-07-06T00:00:00.000Z",
        source: "hermes",
        model: "deepseek-v4-pro",
        total_tokens: 123,
        conversation_count: 2,
      },
      {
        project_key: "today-project",
        project_ref: "today-project",
        hour_start: "2026-07-06T12:00:00.000Z",
        source: "codex",
        model: "gpt-5.6-sol",
        total_tokens: 77,
        conversation_count: 1,
      },
    ]);

    const body = await callEndpoint(
      queuePath,
      "/functions/tokentracker-project-usage-summary?from=2026-07-06&to=2026-07-06&tz=UTC&limit=1",
    );

    assert.equal(body.entries.length, 1);
    assert.equal(body.entries[0].project_key, "today-project");
    assert.equal(body.entries[0].total_tokens, "200");
    assert.equal(body.entries[0].request_count, "3");
    assert.deepEqual(body.entries[0].agent_usage, [
      { id: "hermes", tokens: "123", percent: 61.5 },
      { id: "codex", tokens: "77", percent: 38.5 },
    ]);
    assert.deepEqual(body.entries[0].model_usage, [
      { id: "deepseek-v4-pro", provider: "hermes", tokens: "123", percent: 61.5 },
      { id: "gpt-5.6-sol", provider: "codex", tokens: "77", percent: 38.5 },
    ]);
    assert.deepEqual(body.entries[0].usage_trend, [{ day: "2026-07-06", tokens: "200" }]);
    assert.equal(body.entries[0].period_from, "2026-07-06");
    assert.equal(body.entries[0].period_to, "2026-07-06");
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("project-usage-summary apportions legacy project rows across real models from the same source hour", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-project-summary-models-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const projectQueuePath = path.join(tmp, "project.queue.jsonl");
    await writeQueue(queuePath, [
      { hour_start: "2026-07-06T00:00:00.000Z", source: "codex", model: "gpt-a", total_tokens: 70 },
      { hour_start: "2026-07-06T00:00:00.000Z", source: "codex", model: "gpt-b", total_tokens: 30 },
    ]);
    await writeQueue(projectQueuePath, [
      {
        project_key: "legacy-project",
        project_ref: "legacy-project",
        hour_start: "2026-07-06T00:00:00.000Z",
        source: "codex",
        total_tokens: 100,
        conversation_count: 1,
      },
    ]);

    const body = await callEndpoint(
      queuePath,
      "/functions/tokentracker-project-usage-summary?from=2026-07-06&to=2026-07-06&tz=UTC&limit=1",
    );

    assert.deepEqual(body.entries[0].model_usage, [
      { id: "gpt-a", provider: "codex", tokens: "70", percent: 70 },
      { id: "gpt-b", provider: "codex", tokens: "30", percent: 30 },
    ]);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("dashboard 30d period matches spend 30d rolling window", async () => {
  const { loadDashboardModule } = require("./helpers/load-dashboard-module");
  const dateRange = await loadDashboardModule("dashboard/src/lib/date-range.ts");
  const opts = {
    timeZone: "UTC",
    offsetMinutes: 0,
    now: new Date("2026-07-07T12:00:00.000Z"),
  };
  const dashboardRange = dateRange.getRangeForPeriod("30d", opts);
  const spendRange = dateRange.computeRangeFromKey("30d", opts);
  assert.deepEqual(dashboardRange, { from: "2026-06-08", to: "2026-07-07" });
  assert.deepEqual(spendRange, { from: "2026-06-08", to: "2026-07-07" });
  assert.equal(dashboardRange.from, spendRange.from);
  assert.equal(dashboardRange.to, spendRange.to);
});
