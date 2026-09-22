const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  createLocalApiHandler,
  clearRequestUsageRecordsListCacheForTests,
  computeRecordTotals,
} = require("../src/lib/local-api");

async function writeQueue(queuePath, rows) {
  await fs.promises.writeFile(
    queuePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
}

async function callEndpoint(queuePath, endpoint, configOverrides = {}) {
  const trackerDataDir = path.dirname(queuePath);
  await fs.promises.writeFile(
    path.join(trackerDataDir, "config.json"),
    JSON.stringify({
      dataDirectories: {
        claude: path.join(trackerDataDir, "claude"),
        codex: path.join(trackerDataDir, "codex"),
      },
      ...configOverrides,
    }),
  );
  const handler = createLocalApiHandler({ queuePath, trackerDataDir });
  return callEndpointWithHandler(handler, endpoint);
}

async function callEndpointWithHandler(handler, endpoint) {
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

function buildCodexTokenCountLine({ ts, usage }) {
  return JSON.stringify({
    type: "event_msg",
    timestamp: ts,
    payload: {
      type: "token_count",
      info: {
        last_token_usage: usage,
        // Independent last-only usage; unchanged cumulative totals would be duplicates.
      },
    },
  });
}

const FIXED_DAY = "2026-07-06";
const FIXED_HOUR = `${FIXED_DAY}T12:00:00.000Z`;
const NOW = new Date();
const TODAY_HOUR = NOW.toISOString().slice(0, 13) + ":00:00.000Z";
const TODAY_STR = NOW.toISOString().slice(0, 10);
const YESTERDAY = new Date(NOW);
YESTERDAY.setUTCDate(YESTERDAY.getUTCDate() - 1);
const YESTERDAY_HOUR = YESTERDAY.toISOString().slice(0, 13) + ":00:00.000Z";
const YESTERDAY_STR = YESTERDAY.toISOString().slice(0, 10);

for(const source of ['codex','claude'])test(`request records ${source} read failure cannot become a complete empty success`,async t=>{
 const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'tt-request-failure-'));t.after(()=>fs.promises.rm(dir,{recursive:true,force:true}));
 const queuePath=path.join(dir,'queue.jsonl');await writeQueue(queuePath,[]);
 const folder=path.join(dir,source,source==='codex'?'sessions':'projects','fixture');await fs.promises.mkdir(folder,{recursive:true});
 const file=path.join(folder,source==='codex'?'rollout-fixture.jsonl':'session.jsonl');await fs.promises.writeFile(file,'{}\n');
 const stat=fs.promises.stat;fs.promises.stat=async(p,...args)=>{if(String(p)===file)throw Object.assign(new Error('fixture-private-path'),{code:'EACCES'});return stat(p,...args);};
 let failed;try{failed=await callEndpoint(queuePath,`/functions/tokentracker-request-usage-records?sources=${source}`);}finally{fs.promises.stat=stat;}
 assert.equal(failed.ok,false);assert.ok(failed.error);assert.equal(failed.totals,undefined);assert.doesNotMatch(JSON.stringify(failed),/fixture-private-path/);
 const recovered=await callEndpoint(queuePath,`/functions/tokentracker-request-usage-records?sources=${source}`);assert.equal(recovered.ok,true);assert.equal(recovered.page.totals_scope,'all_matching');
});

for(const source of ['codex','claude'])for(const method of ['stat','readdir'])test(`cached ${source} requests recheck ${method} after failed sync without queue changes`,async t=>{
 const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'tt-request-health-cache-'));t.after(()=>fs.promises.rm(dir,{recursive:true,force:true}));
 const queuePath=path.join(dir,'queue.jsonl');await writeQueue(queuePath,[]);
 const folder=path.join(dir,source,source==='codex'?'sessions':'projects','fixture');await fs.promises.mkdir(folder,{recursive:true});
 const file=path.join(folder,source==='codex'?'rollout-fixture.jsonl':'session.jsonl');
 const usage={input_tokens:100,output_tokens:0,total_tokens:100};
 const record=source==='codex'?buildCodexTokenCountLine({ts:FIXED_HOUR,usage}):JSON.stringify({type:'assistant',timestamp:FIXED_HOUR,message:{id:'m',model:'fixture',usage}});
 await fs.promises.writeFile(file,record+'\n');
 const endpoint=`/functions/tokentracker-request-usage-records?from=${FIXED_DAY}&to=${FIXED_DAY}&sources=${source}&record_kind=request_event`;
 const first=await callEndpoint(queuePath,endpoint);assert.equal(first.totals.total_tokens,100);
 const before=await fs.promises.stat(queuePath);
 await fs.promises.writeFile(path.join(dir,'collection-status.json'),JSON.stringify({[source]:{status:'error',error_code:'EACCES'}}));
 const original=fs.promises[method],target=method==='stat'?file:path.dirname(folder);
 fs.promises[method]=async(p,...args)=>{if(p===target)throw Object.assign(new Error('fixture denied'),{code:'EACCES'});return original(p,...args);};
 let failed;try{failed=await callEndpoint(queuePath,endpoint);}finally{fs.promises[method]=original;}
 assert.equal(failed.ok,false);assert.equal(failed.totals,undefined);
 assert.equal((await fs.promises.stat(queuePath)).mtimeMs,before.mtimeMs);
 await fs.promises.writeFile(path.join(dir,'collection-status.json'),JSON.stringify({[source]:{status:'ok'}}));
 const recovered=await callEndpoint(queuePath,endpoint);assert.equal(recovered.totals.total_tokens,100);
});

test('Codex discovery directory failure is visible before any raw file is read',async t=>{
 const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'tt-request-discovery-'));t.after(()=>fs.promises.rm(dir,{recursive:true,force:true}));
 const queuePath=path.join(dir,'queue.jsonl');await writeQueue(queuePath,[]);await fs.promises.mkdir(path.join(dir,'codex'));
 await fs.promises.writeFile(path.join(dir,'codex','sessions'),'not-a-directory');
 const failed=await callEndpoint(queuePath,'/functions/tokentracker-request-usage-records?sources=codex');assert.equal(failed.ok,false);assert.ok(failed.error);
});

function makeRow(overrides = {}) {
  return {
    hour_start: TODAY_HOUR,
    source: "claude",
    model: "claude-sonnet-4",
    input_tokens: 1000,
    output_tokens: 500,
    cached_input_tokens: 200,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 1700,
    conversation_count: 1,
    ...overrides,
  };
}

test("request totals separate interrupted turns from provider failures", () => {
  const totals = computeRecordTotals([
    { record_kind: "request_event", status: 200 },
    { record_kind: "request_event", status: 499 },
    { record_kind: "request_event", status: 500 },
    { record_kind: "request_event", status: null },
  ]);

  assert.equal(totals.status_sample_count, 3);
  assert.equal(totals.success_count, 1);
  assert.equal(totals.interrupted_count, 1);
  assert.equal(totals.failure_count, 1);
  assert.equal(totals.success_rate, 50);
});

test("TICKET-06: queue-derived sources return explicit aggregate bucket records", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-req-records-aggregate-bucket-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, [makeRow({ conversation_count: 3 })]);

    const body = await callEndpoint(
      queuePath,
      `/functions/tokentracker-request-usage-records?from=${TODAY_STR}&to=${TODAY_STR}&sources=claude&tz=UTC`,
    );

    assert.ok(Array.isArray(body.records), "response should have records array");
    assert.equal(body.records.length, 1, "aggregate queue bucket should be represented as one record");
    assert.equal(body.records[0].record_kind, "aggregate_bucket");
    assert.equal(body.records[0].request_source, "queue_aggregate");
    assert.equal(body.records[0].source, "claude");
    assert.equal(body.records[0].total_tokens, 1700);
    assert.equal(body.records[0].conversation_count, 3);
    assert.ok(Array.isArray(body.aggregate_only_sources), "response should have aggregate_only_sources");
    assert.ok(body.aggregate_only_sources.includes("claude"), "aggregate_only_sources should include claude");
    assert.equal(body.availability.request_records, "aggregate_only", "request_records availability should be aggregate_only");
    assert.equal(body.availability.status, "unavailable", "status availability should be unavailable");
    assert.equal(body.availability.latency, "unavailable", "latency availability should be unavailable");
    assert.equal(body.totals.total_tokens, 1700);
    assert.equal(body.totals.request_count, 3, "aggregate bucket totals should use conversation_count as request display count");
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("TICKET-06: totals contain nullable success_count, success_rate, avg_latency_ms", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-req-records-totals-null-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, [makeRow()]);

    const body = await callEndpoint(
      queuePath,
      `/functions/tokentracker-request-usage-records?from=${TODAY_STR}&to=${TODAY_STR}&sources=claude&tz=UTC`,
    );

    const t = body.totals;
    assert.ok(t, "response should have totals");
    assert.equal(t.success_count, null, "success_count should be null for aggregate-only sources");
    assert.equal(t.success_rate, null, "success_rate should be null for aggregate-only sources");
    assert.equal(t.avg_latency_ms, null, "avg_latency_ms should be null for aggregate-only sources");
    assert.equal(t.status_sample_count, 0, "status_sample_count should be 0");
    assert.equal(t.latency_sample_count, 0, "latency_sample_count should be 0");
    assert.ok(["complete", "partial", "unpriced"].includes(t.pricing_coverage), "pricing_coverage should be valid");
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("TICKET-06: queue_baseline_totals still present for caliber consistency", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-req-records-baseline-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, [
      makeRow({ hour_start: TODAY_HOUR, source: "claude", total_tokens: 1500, input_tokens: 1000, output_tokens: 500 }),
      makeRow({ hour_start: TODAY_HOUR, source: "gemini", total_tokens: 3000, input_tokens: 2000, output_tokens: 1000 }),
    ]);

    const body = await callEndpoint(
      queuePath,
      `/functions/tokentracker-request-usage-records?from=${TODAY_STR}&to=${TODAY_STR}&sources=claude&tz=UTC`,
    );

    assert.ok(body.queue_baseline_totals, "response should have queue_baseline_totals");
    assert.equal(body.queue_baseline_totals.total_tokens, 1500, "queue_baseline_totals should count claude");
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("TICKET-06: response includes granularity, page, and availability fields", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-req-records-fields-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, [makeRow()]);

    const body = await callEndpoint(
      queuePath,
      `/functions/tokentracker-request-usage-records?from=${TODAY_STR}&to=${TODAY_STR}&sources=claude&tz=UTC&limit=10`,
    );

    assert.equal(body.granularity, "aggregate_bucket", "response should have granularity=aggregate_bucket");
    assert.ok(body.page, "response should have page object");
    assert.equal(body.page.limit, 10, "page.limit should match request limit");
    assert.equal(body.page.returned_count, 1, "page.returned_count should include aggregate bucket");
    assert.equal(body.page.total_count, 1, "page.total_count should include aggregate bucket");
    assert.equal(body.page.totals_scope, "all_matching", "page.totals_scope should be all_matching");
    assert.ok(body.availability, "response should have availability object");
    assert.ok(["measured", "aggregate_only", "unavailable"].includes(body.availability.request_records));
    assert.ok(["measured", "aggregate_only", "unavailable"].includes(body.availability.status));
    assert.ok(["measured", "aggregate_only", "unavailable"].includes(body.availability.latency));
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("TICKET-06: request usage records limit is capped at 1000", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-req-records-limit-cap-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, [makeRow()]);

    const body = await callEndpoint(
      queuePath,
      `/functions/tokentracker-request-usage-records?from=${TODAY_STR}&to=${TODAY_STR}&sources=claude&tz=UTC&limit=5000`,
    );

    assert.equal(body.page.limit, 1000, "page.limit should be capped at 1000");
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("request usage records total count is capped at 1000 for codex logs", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-req-records-codex-limit-"));
  try {
    const trackerDataDir = path.join(tmp, "tracker");
    const queuePath = path.join(trackerDataDir, "queue.jsonl");
    const codexHome = path.join(tmp, ".codex");
    const sessionsDir = path.join(codexHome, "sessions", "2025", "12", "17");
    const configPath = path.join(trackerDataDir, "config.json");
    const rolloutPath = path.join(sessionsDir, "rollout-2025-12-17T00-00-00.jsonl");

    await fs.promises.mkdir(sessionsDir, { recursive: true });
    await fs.promises.mkdir(trackerDataDir, { recursive: true });
    await fs.promises.writeFile(queuePath, "", "utf8");
    await fs.promises.writeFile(
      configPath,
      JSON.stringify({ dataDirectories: { codex: codexHome } }, null, 2) + "\n",
      "utf8",
    );

    const usage = {
      input_tokens: 10,
      cached_input_tokens: 0,
      output_tokens: 5,
      reasoning_output_tokens: 0,
      total_tokens: 15,
    };
    const baseMs = Date.parse("2025-12-17T00:00:00.000Z");
    const lines = Array.from({ length: 1005 }, (_, i) => (
      buildCodexTokenCountLine({
        ts: new Date(baseMs + i * 1000).toISOString(),
        usage,
      })
    ));
    await fs.promises.writeFile(rolloutPath, lines.join("\n") + "\n", "utf8");

    const handler = createLocalApiHandler({ queuePath, trackerDataDir });
    const body = await callEndpointWithHandler(
      handler,
      "/functions/tokentracker-request-usage-records?from=2025-12-17&to=2025-12-17&sources=codex&tz=UTC&limit=5000&pageSize=10",
    );

    assert.equal(body.page.limit, 1000, "page.limit should be capped at 1000");
    assert.equal(body.page.total, 1000, "page.total should not expose more than 1000 records");
    assert.equal(body.page.total_count, 1000, "page.total_count should not expose more than 1000 records");
    assert.equal(body.records.length, 10, "default page should still return the requested page size");
    assert.equal(body.totals.request_count, 1000, "totals should be scoped to the capped record set");
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("request usage records pagination reuses cached list across pages", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-req-records-page-cache-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const rows = Array.from({ length: 25 }, (_, i) => makeRow({
      hour_start: new Date(Date.parse(FIXED_HOUR) - i * 30 * 60 * 1000).toISOString(),
      model: `claude-sonnet-${i}`,
      total_tokens: 100 + i,
      input_tokens: 100 + i,
      output_tokens: 0,
    }));
    await writeQueue(queuePath, rows);
    clearRequestUsageRecordsListCacheForTests();

    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: path.dirname(queuePath),
    });
    const base = `/functions/tokentracker-request-usage-records?from=${FIXED_DAY}&to=${FIXED_DAY}&sources=claude&tz=UTC&limit=1000&pageSize=5`;

    const page1 = await callEndpointWithHandler(handler, `${base}&page=1`);
    const page2 = await callEndpointWithHandler(handler, `${base}&page=2`);

    assert.equal(page1.page.page, 1);
    assert.equal(page1.records.length, 5);
    assert.equal(page2.page.page, 2);
    assert.equal(page2.records.length, 5);
    assert.equal(page1.page.total, page2.page.total, "total count should match across pages");
    assert.notDeepEqual(
      page1.records.map((r) => r.id),
      page2.records.map((r) => r.id),
      "pages should return different records",
    );
  } finally {
    clearRequestUsageRecordsListCacheForTests();
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("TICKET-06: empty queue.jsonl returns empty records with proper fields", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-req-records-empty-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await fs.promises.writeFile(queuePath, "");

    const body = await callEndpoint(
      queuePath,
      `/functions/tokentracker-request-usage-records?from=${TODAY_STR}&to=${TODAY_STR}&sources=claude&tz=UTC`,
    );

    assert.ok(Array.isArray(body.records), "response should have records array");
    assert.equal(body.records.length, 0, "records should be empty");
    assert.equal(body.totals.total_tokens, 0, "totals.total_tokens should be 0");
    assert.equal(body.totals.request_count, 0, "totals.request_count should be 0");
    assert.equal(body.totals.success_count, null, "totals.success_count should be null");
    assert.equal(body.totals.success_rate, null, "totals.success_rate should be null");
    assert.equal(body.totals.avg_latency_ms, null, "totals.avg_latency_ms should be null");
    assert.ok(body.queue_baseline_totals, "queue_baseline_totals should still be present");
    assert.equal(body.queue_baseline_totals.total_tokens, 0, "queue_baseline_totals.total_tokens should be 0");
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("pricing provenance API: user override fields survive from config to aggregate record and totals", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-req-pricing-override-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, [makeRow({
      source: "custom-agent",
      model: "custom-model",
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cached_input_tokens: 0,
      total_tokens: 2_000_000,
    })]);
    const updatedAt = "2026-01-01T00:00:00.000Z";
    const body = await callEndpoint(
      queuePath,
      `/functions/tokentracker-request-usage-records?from=${TODAY_STR}&to=${TODAY_STR}&sources=custom-agent&tz=UTC`,
      {
        pricingRules: [{
          source: "custom-agent",
          model: "custom-model",
          inputPricePer1M: 1.5,
          outputPricePer1M: 10,
          currency: "USD",
          updated_at: updatedAt,
        }],
      },
    );

    const record = body.records[0];
    for (const field of [
      "pricing_source", "pricing_version", "source_kind", "source_url",
      "source_updated_at", "observed_at", "is_stale", "estimated",
      "match_kind", "matched_model", "note_code",
    ]) {
      assert.ok(Object.hasOwn(record, field), `record must expose ${field}`);
    }
    assert.equal(record.cost_usd, 11.5);
    assert.equal(record.source_kind, "user_override");
    assert.equal(record.source_updated_at, updatedAt);
    assert.equal(record.estimated, false);
    assert.equal(record.is_stale, false);
    assert.equal(body.totals.source_kind, "user_override");
  } finally {
    clearRequestUsageRecordsListCacheForTests();
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("pricing provenance API: unpriced records and totals keep cost null instead of fake zero", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-req-pricing-unpriced-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, [makeRow({
      source: "custom-agent",
      model: "definitely-unpriced-model-2099",
    })]);
    const body = await callEndpoint(
      queuePath,
      `/functions/tokentracker-request-usage-records?from=${TODAY_STR}&to=${TODAY_STR}&sources=custom-agent&tz=UTC`,
    );

    assert.equal(body.records[0].cost_usd, null);
    assert.equal(body.records[0].source_kind, "unpriced");
    assert.equal(body.records[0].pricing_coverage, "unpriced");
    assert.equal(body.totals.cost_usd, null);
    assert.equal(body.totals.source_kind, "unpriced");
  } finally {
    clearRequestUsageRecordsListCacheForTests();
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("pricing provenance API: mixed aggregates identify user override and curated composition", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-req-pricing-mixed-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, [
      makeRow({
        source: "custom-agent",
        model: "custom-model",
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        total_tokens: 2_000_000,
      }),
      makeRow({
        source: "custom-agent",
        model: "kiro-agent",
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        total_tokens: 2_000_000,
      }),
    ]);
    const body = await callEndpoint(
      queuePath,
      `/functions/tokentracker-request-usage-records?from=${TODAY_STR}&to=${TODAY_STR}&sources=custom-agent&tz=UTC`,
      {
        pricingRules: [{
          source: "custom-agent",
          model: "custom-model",
          inputPricePer1M: 1.5,
          outputPricePer1M: 10,
          currency: "USD",
          updated_at: "2026-08-01T00:00:00.000Z",
        }],
      },
    );

    assert.equal(body.totals.source_kind, "mixed");
    assert.deepEqual(
      body.totals.pricing_components.map((component) => component.source_kind).sort(),
      ["curated", "user_override"],
    );
    assert.equal(
      body.totals.pricing_components.reduce(
        (sum, component) => sum + component.priced_tokens,
        0,
      ),
      4_000_000,
    );
  } finally {
    clearRequestUsageRecordsListCacheForTests();
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

 test("local calendar dates and actual truncation remain explicit",async()=>{
  const tmp=await fs.promises.mkdtemp(path.join(os.tmpdir(),"tt-records-coverage-"));
  try {
    const queuePath=path.join(tmp,"queue.jsonl");
    const rows=Array.from({length:1200},(_,i)=>({source:"hermes",model:"m"+i,hour_start:"2026-07-06T18:00:00Z",input_tokens:1,total_tokens:1}));
    await writeQueue(queuePath,rows);
    const body=await callEndpoint(queuePath,"/functions/tokentracker-request-usage-records?source=hermes&from=2026-07-06&to=2026-07-06&tz=America/Los_Angeles&limit=1000");
    assert.equal(body.page.total_count,1000);assert.equal(body.page.totals_scope,"returned_subset");assert.equal(body.page.has_more,true);
    await writeQueue(queuePath,rows.slice(0,1000));clearRequestUsageRecordsListCacheForTests();
    const exact=await callEndpoint(queuePath,"/functions/tokentracker-request-usage-records?source=hermes&from=2026-07-06&to=2026-07-06&tz=America/Los_Angeles&limit=1000");
    assert.equal(exact.page.has_more,false);assert.equal(exact.page.totals_scope,"all_matching");
  } finally {await fs.promises.rm(tmp,{recursive:true,force:true});}
 });

test("price revision invalidates request totals without changing token queue", async t => {
 const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),"tt-req-price-revision-"));t.after(()=>fs.promises.rm(dir,{recursive:true,force:true}));
 const queuePath=path.join(dir,"queue.jsonl");await writeQueue(queuePath,[makeRow({source:"custom-agent",model:"custom-model",input_tokens:1000000,output_tokens:0,cached_input_tokens:0,total_tokens:1000000})]);
 const handler=createLocalApiHandler({queuePath,trackerDataDir:dir});
 const query="/functions/tokentracker-request-usage-records?sources=custom-agent&tz=UTC";
 const save=price=>fs.promises.writeFile(path.join(dir,"config.json"),JSON.stringify({pricingRules:[{source:"custom-agent",model:"custom-model",inputPricePer1M:price,outputPricePer1M:0,currency:"USD"}]}));
 await save(1);const first=await callEndpointWithHandler(handler,query);assert.equal(first.records[0].cost_usd,1);
 await save(2);const next=await callEndpointWithHandler(handler,query);assert.equal(next.records[0].cost_usd,2);assert.equal(next.totals.total_tokens,1000000);
});

test("a Codex terminal event without usage keeps its outcome but never reports exact zero tokens", async t => {
 const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),"tt-request-missing-usage-"));t.after(()=>fs.promises.rm(dir,{recursive:true,force:true}));
 const queuePath=path.join(dir,"queue.jsonl");await writeQueue(queuePath,[]);const sessionDir=path.join(dir,"codex","sessions");await fs.promises.mkdir(sessionDir,{recursive:true});
 await fs.promises.writeFile(path.join(sessionDir,"rollout-test.jsonl"),JSON.stringify({type:"event_msg",timestamp:FIXED_HOUR,payload:{type:"turn_aborted",turn_id:"synthetic"}})+"\n");
 const body=await callEndpoint(queuePath,"/functions/tokentracker-request-usage-records?sources=codex&tz=UTC");
 assert.equal(body.records.length,1);assert.equal(body.records[0].status,499);assert.equal(body.records[0].total_tokens,null);assert.equal(body.records[0].cost_usd,null);assert.equal(body.totals.total_tokens,null);assert.equal(body.page.totals_scope,"unknown");
});

for (const source of ['codex','claude']) for (const [label,queued,raw] of [['queue-lag',100,150],['partial-raw-history',200,100],['equal-total-different-attribution',100,100]]) test('raw requests preserve independent queue evidence: '+source+' '+label,async t=>{
 const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'tt-independent-records-'));t.after(()=>fs.promises.rm(dir,{recursive:true,force:true}));
 const queuePath=path.join(dir,'queue.jsonl');
 await writeQueue(queuePath,[makeRow({source,model:'gpt-5',hour_start:FIXED_HOUR,input_tokens:queued,output_tokens:0,cached_input_tokens:0,total_tokens:queued,billing_mode:'token_plan',billing_mode_confidence:'explicit_runtime',provider_id:'openai',account_ref:'account/openai/a'})]);
 const sessions=path.join(dir,'codex','sessions');await fs.promises.mkdir(sessions,{recursive:true});
 await fs.promises.writeFile(path.join(sessions,'rollout-review.jsonl'),JSON.stringify({type:'session_meta',payload:{id:'child',model:'gpt-5'}})+'\n'+buildCodexTokenCountLine({ts:FIXED_HOUR,usage:{input_tokens:raw,output_tokens:0,total_tokens:raw}})+'\n');
 if(source==='claude') {
 const dirClaude=path.join(dir,'claude','projects','fixture');await fs.promises.mkdir(dirClaude,{recursive:true});
 await fs.promises.writeFile(path.join(dirClaude,'session.jsonl'),JSON.stringify({type:'assistant',timestamp:FIXED_HOUR,message:{id:'m',model:'gpt-5',usage:{input_tokens:raw,output_tokens:0}}})+'\n');
 }
 const query='?from='+FIXED_DAY+'&to='+FIXED_DAY+'&sources='+source+'&tz=UTC';
 const body=await callEndpoint(queuePath,'/functions/tokentracker-request-usage-records'+query);
 assert.equal(body.records.filter(r=>r.record_kind==='request_event').length,1);
 assert.equal(body.totals.total_tokens,raw);assert.equal(body.queue_baseline_totals.total_tokens,queued);
 assert.ok(Array.isArray(body.queue_baseline_records),'separate queue evidence must be retained');
 assert.equal(body.queue_baseline_records[0].account_ref,'account/openai/a');
 assert.equal(body.queue_baseline_records[0].billing_mode,'token_plan');
 assert.equal(body.page.totals_scope,'unknown');
 const summary=await callEndpoint(queuePath,'/functions/tokentracker-usage-summary'+query);
 assert.equal(Number(summary.total_tokens ?? summary.totals?.total_tokens),queued);
});

test('Codex historical queue survives absent or partial raw logs and requests-only filtering',async t=>{
 const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'tt-codex-history-'));t.after(()=>fs.promises.rm(dir,{recursive:true,force:true}));
 const queuePath=path.join(dir,'queue.jsonl');const query=`/functions/tokentracker-request-usage-records?from=${FIXED_DAY}&to=${FIXED_DAY}&sources=codex&tz=UTC`;
 await writeQueue(queuePath,[makeRow({source:'codex',model:'gpt-5',hour_start:FIXED_HOUR,input_tokens:100,output_tokens:0,cached_input_tokens:0,total_tokens:100}),makeRow({source:'codex',model:'gpt-5',hour_start:`${FIXED_DAY}T13:00:00.000Z`,input_tokens:200,output_tokens:0,cached_input_tokens:0,total_tokens:200})]);
 const all=await callEndpoint(queuePath,query);assert.equal(all.records.length,2);assert.ok(all.records.every(r=>r.record_kind==='aggregate_bucket'));assert.equal(all.totals.total_tokens,300);
 const requests=await callEndpoint(queuePath,query+'&record_kind=request_event');assert.equal(requests.records.length,0);assert.equal(requests.queue_history_record_count,2);assert.equal(requests.queue_baseline_totals.total_tokens,300);assert.equal(requests.page.totals_scope,'unknown');
 const sessions=path.join(dir,'codex','sessions');await fs.promises.mkdir(sessions,{recursive:true});await fs.promises.writeFile(path.join(sessions,'rollout-history.jsonl'),JSON.stringify({type:'session_meta',payload:{id:'fixture',model:'gpt-5'}})+'\n'+buildCodexTokenCountLine({ts:FIXED_HOUR,usage:{input_tokens:80,output_tokens:0,total_tokens:80}})+'\n');clearRequestUsageRecordsListCacheForTests();
 const realNow=Date.now;Date.now=()=>realNow()+61_000;let partial;
 try{partial=await callEndpoint(queuePath,query);}finally{Date.now=realNow;}
 assert.equal(partial.records.length,2);assert.equal(partial.totals.total_tokens,280);assert.equal(partial.records.find(r=>r.record_kind==='aggregate_bucket').total_tokens,200);assert.equal(partial.queue_baseline_totals.total_tokens,300);assert.equal(partial.page.totals_scope,'unknown');
 const empty=await callEndpoint(queuePath,query.replace(FIXED_DAY,'2025-01-01').replace(FIXED_DAY,'2025-01-01')+'&record_kind=request_event');assert.equal(empty.records.length,0);assert.equal(empty.queue_history_record_count,0);assert.equal(empty.page.totals_scope,'all_matching');
});

test('request-kind filter keeps an older Codex request when newer aggregate buckets reach the list limit', async t => {
 const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'tt-request-kind-truncation-'));t.after(()=>fs.promises.rm(dir,{recursive:true,force:true}));
 const queuePath=path.join(dir,'queue.jsonl');
 const rows=Array.from({length:100},(_,index)=>makeRow({
   source:'codex',model:`aggregate-${index}`,hour_start:`${FIXED_DAY}T23:00:00.000Z`,
   input_tokens:index+1,output_tokens:0,cached_input_tokens:0,total_tokens:index+1,
 }));
 await writeQueue(queuePath,rows);
 const sessions=path.join(dir,'codex','sessions');await fs.promises.mkdir(sessions,{recursive:true});
 await fs.promises.writeFile(path.join(sessions,'rollout-older-request.jsonl'),
   JSON.stringify({type:'session_meta',payload:{id:'kind-filter-session',model:'gpt-5'}})+'\n'+
   buildCodexTokenCountLine({ts:`${FIXED_DAY}T00:00:00.000Z`,usage:{input_tokens:7,output_tokens:0,total_tokens:7}})+'\n');
 clearRequestUsageRecordsListCacheForTests();
 const query=`/functions/tokentracker-request-usage-records?from=${FIXED_DAY}&to=${FIXED_DAY}&sources=codex&tz=UTC&limit=100&pageSize=100`;
 const all=await callEndpoint(queuePath,query);
 assert.equal(all.records.length,100,'mixed list remains bounded at its existing capacity');
 assert.ok(all.records.every(row=>row.record_kind==='aggregate_bucket'),'newer aggregates occupy the mixed page');
 const requests=await callEndpoint(queuePath,query+'&record_kind=request_event');
 assert.equal(requests.records.length,1,'request-kind filtering must happen before mixed-list truncation');
 assert.equal(requests.records[0].total_tokens,7);
 assert.equal(requests.page.total_count,1);
 assert.equal(requests.totals.total_tokens,7);
 const aggregates=await callEndpoint(queuePath,query+'&record_kind=aggregate_bucket');
 assert.equal(aggregates.records.length,100,'request-kind cache entries must not replace aggregate pagination');
 assert.ok(aggregates.records.every(row=>row.record_kind==='aggregate_bucket'));
 assert.equal(aggregates.page.total_count,100);
 const allAgain=await callEndpoint(queuePath,query);
 assert.equal(allAgain.records.length,100,'switching modes retains the mixed-list capacity');
 assert.ok(allAgain.records.every(row=>row.record_kind==='aggregate_bucket'));
});
