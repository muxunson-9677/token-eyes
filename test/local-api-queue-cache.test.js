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

    await writeRows(queuePath, [
      queueRow(1000),
      queueRow(2000, "2026-05-09T10:30:00Z"),
    ]);
    assert.equal(
      readQueueData(queuePath).reduce((total, row) => total + row.total_tokens, 0),
      3000,
    );
    assert.equal(queueReads, 2);
  } finally {
    fs.readFileSync = originalReadFileSync;
    clearQueueDataCacheForTests();
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});
