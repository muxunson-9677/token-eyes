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
  if (
    cold.wall_ms > COLD_LIMIT_MS
    || report.repeated.p95_ms > REPEATED_P95_LIMIT_MS
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
