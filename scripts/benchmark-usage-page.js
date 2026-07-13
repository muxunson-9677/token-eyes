const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const {
  createLocalApiHandler,
  resolveQueuePath,
} = require("../src/lib/local-api");

const COLD_LIMIT_MS = 2000;
const REFRESH_P95_LIMIT_MS = 1000;
const REPEATED_P95_LIMIT_MS = 500;
const COLD_RUNS = 10;
const REFRESH_RUNS = 10;
const REPEATED_RUNS = 10;

function percentile(values, percentileValue) {
  const sorted = values.slice().sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((percentileValue / 100) * sorted.length) - 1,
  );
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
      writeHead(code) {
        this.statusCode = code;
      },
      write(chunk) {
        body += chunk;
      },
      end(chunk) {
        if (chunk) body += chunk;
      },
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
  const results = await Promise.all(
    endpoints.map((endpoint) => callEndpoint(handler, endpoint)),
  );
  return {
    wall_ms: Number((performance.now() - startedAt).toFixed(1)),
    endpoints: results,
  };
}

async function runColdSample() {
  const handler = createLocalApiHandler({
    queuePath: resolveQueuePath(),
    trackerDataDir: process.cwd(),
  });
  return runFanout(handler, defaultRange());
}

async function main() {
  if (process.argv.includes("--cold-sample")) {
    process.stdout.write(`${JSON.stringify(await runColdSample())}\n`);
    return;
  }
  const queuePath = resolveQueuePath();
  const queueStat = fs.statSync(queuePath);
  const createHandler = () => createLocalApiHandler({
    queuePath,
    trackerDataDir: process.cwd(),
  });
  const handler = createHandler();
  const range = defaultRange();
  const cold = [];
  for (let index = 0; index < COLD_RUNS; index += 1) {
    cold.push(JSON.parse(execFileSync(
      process.execPath,
      [__filename, "--cold-sample"],
      { encoding: "utf8" },
    )));
  }
  const refresh = [];
  for (let index = 0; index < REFRESH_RUNS; index += 1) {
    refresh.push(await runFanout(createHandler(), range));
  }
  await runFanout(handler, range);
  const repeated = [];
  for (let index = 0; index < REPEATED_RUNS; index += 1) {
    repeated.push(await runFanout(handler, range));
  }
  const coldWalls = cold.map((run) => run.wall_ms);
  const refreshWalls = refresh.map((run) => run.wall_ms);
  const repeatedWalls = repeated.map((run) => run.wall_ms);
  const report = {
    queue_path: queuePath,
    queue_bytes: queueStat.size,
    range,
    thresholds_ms: {
      cold_p95: COLD_LIMIT_MS,
      refresh_p95: REFRESH_P95_LIMIT_MS,
      repeated_p95: REPEATED_P95_LIMIT_MS,
    },
    cold: {
      runs: COLD_RUNS,
      p50_ms: percentile(coldWalls, 50),
      p95_ms: percentile(coldWalls, 95),
      samples_ms: coldWalls,
      endpoints: cold[0].endpoints,
    },
    refresh: {
      runs: REFRESH_RUNS,
      p50_ms: percentile(refreshWalls, 50),
      p95_ms: percentile(refreshWalls, 95),
      samples_ms: refreshWalls,
    },
    repeated: {
      runs: REPEATED_RUNS,
      p50_ms: percentile(repeatedWalls, 50),
      p95_ms: percentile(repeatedWalls, 95),
      samples_ms: repeatedWalls,
    },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (
    report.cold.p95_ms > COLD_LIMIT_MS
    || report.refresh.p95_ms > REFRESH_P95_LIMIT_MS
    || report.repeated.p95_ms > REPEATED_P95_LIMIT_MS
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
