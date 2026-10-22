const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runSql } = require("./helpers/sqlite-builder.cjs");

const { parseKiroIncremental } = require("../src/lib/rollout.js");

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fallback-"));
}

function writeJsonl(filePath, events) {
  const lines = events
    .map((e) => JSON.stringify({ model: "claude-sonnet-4", provider: "kiro", ...e }))
    .join("\n");
  fs.writeFileSync(filePath, lines + "\n");
}

function seedSqlite(dbPath, events) {
  runSql(
    dbPath,
    "CREATE TABLE tokens_generated (id INTEGER PRIMARY KEY AUTOINCREMENT, tokens_prompt INTEGER, tokens_generated INTEGER, model TEXT, provider TEXT, timestamp TEXT);",
  );
  for (const e of events) {
    runSql(
      dbPath,
      `INSERT INTO tokens_generated (tokens_prompt, tokens_generated, model, provider, timestamp) VALUES (${e.promptTokens}, ${e.generatedTokens}, 'claude-sonnet-4', 'kiro', '2026-04-19 08:00:00');`,
    );
  }
}

function jsonlFixture(t) {
  const dir = makeTmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dbPath: path.join(dir, "missing.db"), jsonlPath: path.join(dir, "usage.jsonl"),
    basePath: dir, queuePath: path.join(dir, "queue.jsonl"), cursors: {}, collectionStatus: {} };
}

function queueTotal(file) {
  const latest = new Map(fs.readFileSync(file, "utf8").trim().split("\n").map(JSON.parse)
    .map(row => [[row.source, row.model, row.hour_start, row.billing_mode].join("|"), row.total_tokens]));
  return [...latest.values()].reduce((sum, value) => sum + value, 0);
}

test("Kiro JSONL leaves incomplete UTF-8 tail pending and accepts complete no-newline records", async t => {
  const f = jsonlFixture(t);
  const first = JSON.stringify({ promptTokens: 100, generatedTokens: 0 });
  const next = Buffer.from(JSON.stringify({ promptTokens: 50, generatedTokens: 0, marker: "中文" }));
  const cut = next.indexOf(Buffer.from("中文")) + 1;
  fs.writeFileSync(f.jsonlPath, Buffer.concat([Buffer.from(first + "\r\n"), next.subarray(0, cut)]));
  await parseKiroIncremental(f);
  assert.equal(f.cursors.kiro.jsonl.lastLine, 1);
  assert.equal(queueTotal(f.queuePath), 100);
  fs.appendFileSync(f.jsonlPath, next.subarray(cut));
  await parseKiroIncremental(f);
  const disk = fs.readFileSync(f.queuePath, "utf8");
  await parseKiroIncremental(f);
  assert.equal(f.cursors.kiro.jsonl.lastLine, 2);
  assert.equal(queueTotal(f.queuePath), 150);
  assert.equal(fs.readFileSync(f.queuePath, "utf8"), disk);
});

for (const method of ["readFileSync", "statSync"]) test(`Kiro ${method} error preserves history and recovers`, async t => {
  const f = jsonlFixture(t);
  writeJsonl(f.jsonlPath, [{ promptTokens: 100, generatedTokens: 0 }]);
  await parseKiroIncremental(f);
  const before = structuredClone(f.cursors), disk = fs.readFileSync(f.queuePath, "utf8");
  const successful = f.collectionStatus.kiro.last_successful_at;
  fs.appendFileSync(f.jsonlPath, JSON.stringify({ promptTokens: 50, generatedTokens: 0 }) + "\n");
  const original = fs[method];
  fs[method] = function(file, ...args) {
    if (file === f.jsonlPath) throw Object.assign(new Error("injected source access"), { code: "EACCES" });
    return original.call(this, file, ...args);
  };
  try { await assert.rejects(parseKiroIncremental(f), { code: "EACCES" }); }
  finally { fs[method] = original; }
  assert.deepEqual(f.cursors, before);
  assert.equal(fs.readFileSync(f.queuePath, "utf8"), disk);
  assert.equal(f.collectionStatus.kiro.status, "error");
  assert.equal(f.collectionStatus.kiro.last_successful_at, successful);
  await parseKiroIncremental(f);
  await parseKiroIncremental(f);
  assert.equal(queueTotal(f.queuePath), 150);
  assert.equal(f.collectionStatus.kiro.status, "ok");
});

test("Kiro real SQLite handoff counts only complete JSONL rows and rolls back unreadable tail", async t => {
  const f = jsonlFixture(t);
  const { runSql } = require("./helpers/sqlite-builder.cjs");
  runSql(f.dbPath, "CREATE TABLE tokens_generated (id INTEGER PRIMARY KEY, model TEXT, provider TEXT, tokens_prompt INTEGER, tokens_generated INTEGER, timestamp TEXT); INSERT INTO tokens_generated VALUES (1, 'agent', 'kiro', 100, 0, '2026-09-22 08:00:00');");
  const first = JSON.stringify({ promptTokens: 100, generatedTokens: 0 });
  const next = JSON.stringify({ promptTokens: 25, generatedTokens: 0 });
  fs.writeFileSync(f.jsonlPath, first + "\n\n" + next.slice(0, 12));
  const original = fs.readFileSync;
  fs.readFileSync = function(file, ...args) {
    if (file === f.jsonlPath) throw Object.assign(new Error("injected tail access"), { code: "EACCES" });
    return original.call(this, file, ...args);
  };
  try { await assert.rejects(parseKiroIncremental(f), { code: "EACCES" }); }
  finally { fs.readFileSync = original; }
  assert.deepEqual(f.cursors, {});
  assert.equal(fs.existsSync(f.queuePath), false);
  await parseKiroIncremental(f);
  assert.equal(queueTotal(f.queuePath), 100);
  assert.equal(f.cursors.kiro.jsonl.lastLine, 1);
  fs.unlinkSync(f.dbPath);
  fs.appendFileSync(f.jsonlPath, next.slice(12) + "\r\n");
  await parseKiroIncremental(f);
  assert.equal(queueTotal(f.queuePath), 125);
  const disk = fs.readFileSync(f.queuePath, "utf8");
  await parseKiroIncremental(f);
  assert.equal(fs.readFileSync(f.queuePath, "utf8"), disk);
});

test("kiro DB→JSONL fallback does not re-read rows the DB path already consumed", async (t) => {
  const tmp = makeTmpDir();
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const dbPath = path.join(tmp, "kiro.db");
  const jsonlPath = path.join(tmp, "kiro.jsonl");
  const queuePath = path.join(tmp, "queue.jsonl");
  const events = [
    { promptTokens: 100, generatedTokens: 50 },
    { promptTokens: 200, generatedTokens: 60 },
    { promptTokens: 300, generatedTokens: 70 },
  ];
  writeJsonl(jsonlPath, events);
  seedSqlite(dbPath, events);

  const cursors = {};

  // Run 1: DB present. DB consumes all 3 rows AND the JSONL line cursor
  // must be advanced to the JSONL tail so fallback won't re-read them.
  const r1 = await parseKiroIncremental({ dbPath, jsonlPath, cursors, queuePath });
  assert.equal(r1.eventsAggregated, 3);
  assert.equal(cursors.kiro.lastDbId, 3);
  assert.equal(cursors.kiro.jsonl.lastLine, 3);

  // Run 2: DB gone. JSONL fallback must see zero new rows — the 3 rows the
  // DB path already handled must NOT be double-counted.
  fs.unlinkSync(dbPath);
  const r2 = await parseKiroIncremental({ dbPath, jsonlPath, cursors, queuePath });
  assert.equal(r2.eventsAggregated, 0);

  // Run 3: append one genuinely new JSONL row; only that should be counted.
  fs.appendFileSync(
    jsonlPath,
    JSON.stringify({ model: "claude-sonnet-4", provider: "kiro", promptTokens: 400, generatedTokens: 80 }) + "\n",
  );
  const r3 = await parseKiroIncremental({ dbPath, jsonlPath, cursors, queuePath });
  assert.equal(r3.eventsAggregated, 1);
});
