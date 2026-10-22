const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { test } = require("node:test");

const {
  parseRolloutIncremental,
  collectRolloutRequestUsageRecords,
} = require("../src/lib/rollout");

// Forked Codex rollouts (Codex Desktop subagent fan-out, `codex fork`) REPLAY the
// parent session's whole event history into the new file at creation time. The
// replayed token_count events carry FRESH timestamps (the fork moment) and the
// file has a fresh session UUID, so neither the sessionUUID:timestamp dedup nor
// the old date-only guard (`current_date < rollout date`) can catch a same-day
// replay — every same-day fork double-counted the parent's usage (observed
// +52.6% on 2026-08-10 vs ccusage before the fix).
//
// The discriminator: replayed turn_context.turn_id ULIDs (UUIDv7, ms-ordered)
// were minted BEFORE the fork file's own session UUID, while live turns mint
// fresh ids at/after it. These fixtures mirror the structure of real rollouts
// (token totals preserved from the 2026-08-10 / 2026-05-31 diagnosis); no
// conversation content is included.

const PARENT_ID = "019fe730-3190-7de2-a2c1-c18ab0893729";
const FORK_ID = "019fec47-8e92-7602-822e-00cf303d052e";
const REPLAYED_TURN_ID = "019fe730-3267-7143-9c5a-210ac0260019";
const LIVE_TURN_ID = "019fec47-908c-7723-b788-df9414726de5";

function sessionMetaLine({ ts, id, forkedFromId, cwd, model }) {
  const payload = { id, timestamp: ts };
  if (typeof cwd === "string" && cwd.length > 0) payload.cwd = cwd;
  if (typeof model === "string" && model.length > 0) payload.model = model;
  if (typeof forkedFromId === "string" && forkedFromId.length > 0) {
    payload.forked_from_id = forkedFromId;
  }
  return JSON.stringify({ type: "session_meta", timestamp: ts, payload });
}

function turnContextLine({ ts, turnId, model, currentDate, cwd }) {
  const payload = { model };
  if (typeof turnId === "string" && turnId.length > 0) payload.turn_id = turnId;
  if (typeof cwd === "string" && cwd.length > 0) payload.cwd = cwd;
  if (typeof currentDate === "string" && currentDate.length > 0) {
    payload.current_date = currentDate;
  }
  return JSON.stringify({ type: "turn_context", timestamp: ts, payload });
}

function tokenCountLine({ ts, last, total }) {
  return JSON.stringify({
    type: "event_msg",
    timestamp: ts,
    payload: {
      type: "token_count",
      info: { last_token_usage: last, total_token_usage: total },
    },
  });
}

function usage({ input, output, total }) {
  return {
    input_tokens: input,
    cached_input_tokens: 0,
    output_tokens: output,
    reasoning_output_tokens: 0,
    total_tokens: total,
  };
}

async function readJsonLines(filePath) {
  let raw = "";
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") return [];
    throw e;
  }
  return raw
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

/**
 * Fixture mirroring sessions/2026/08/10/rollout-...-019fec47-8e92-....jsonl:
 * a subagent fork of PARENT_ID whose replay burst reaches total=158,051,580 the
 * SAME UTC day, followed by two live turns ending at total=158,139,380.
 */
function buildSameDayForkLines() {
  return [
    sessionMetaLine({
      ts: "2026-08-10T15:25:40.753Z",
      id: FORK_ID,
      forkedFromId: PARENT_ID,
    }),
    // Replayed copy of the parent's own session_meta (id differs from filename).
    sessionMetaLine({ ts: "2026-08-10T15:25:40.754Z", id: PARENT_ID }),
    // Replayed turn_context: turn ULID minted before the fork, but current_date
    // is the SAME day as the fork file, so the old date guard let it through.
    turnContextLine({
      ts: "2026-08-10T15:25:40.755Z",
      turnId: REPLAYED_TURN_ID,
      model: "gpt-5.6-sol",
      currentDate: "2026-08-10",
    }),
    tokenCountLine({
      ts: "2026-08-10T15:25:40.755Z",
      last: usage({ input: 20000, output: 4639, total: 24639 }),
      total: usage({ input: 20000, output: 4639, total: 24639 }),
    }),
    tokenCountLine({
      ts: "2026-08-10T15:25:40.755Z",
      last: usage({ input: 24000, output: 5369, total: 29369 }),
      total: usage({ input: 44000, output: 10008, total: 54008 }),
    }),
    tokenCountLine({
      ts: "2026-08-10T15:25:40.756Z",
      last: usage({ input: 30000, output: 13654, total: 43654 }),
      total: usage({ input: 120000000, output: 38051580, total: 158051580 }),
    }),
    // Live boundary: fresh turn ULID minted after the fork's own session UUID.
    turnContextLine({
      ts: "2026-08-10T15:25:56.546Z",
      turnId: LIVE_TURN_ID,
      model: "gpt-5.6-sol",
      currentDate: "2026-08-10",
    }),
    tokenCountLine({
      ts: "2026-08-10T15:26:07.295Z",
      last: usage({ input: 30000, output: 13044, total: 43044 }),
      total: usage({ input: 120030000, output: 38064624, total: 158094624 }),
    }),
    tokenCountLine({
      ts: "2026-08-10T15:26:17.286Z",
      last: usage({ input: 30000, output: 14756, total: 44756 }),
      total: usage({ input: 120060000, output: 38079380, total: 158139380 }),
    }),
  ];
}

async function writeForkFixture(tmp, lines) {
  const rolloutPath = path.join(
    tmp,
    "2026",
    "08",
    "10",
    `rollout-2026-08-10T23-25-40-${FORK_ID}.jsonl`,
  );
  await fs.mkdir(path.dirname(rolloutPath), { recursive: true });
  await fs.writeFile(rolloutPath, lines.join("\n") + "\n", "utf8");
  return rolloutPath;
}

test("parseRolloutIncremental skips same-day fork replay and counts only live turns", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-fork-replay-"));
  try {
    const rolloutPath = await writeForkFixture(tmp, buildSameDayForkLines());
    const queuePath = path.join(tmp, "queue.jsonl");
    const cursors = { version: 1, files: {}, updatedAt: null };

    const res = await parseRolloutIncremental({ rolloutFiles: [rolloutPath], cursors, queuePath });
    assert.equal(res.filesProcessed, 1);
    // Only the two live token_count events; the three replayed ones are skipped.
    assert.equal(res.eventsAggregated, 2);
    assert.equal(res.bucketsQueued, 1);

    const queued = await readJsonLines(queuePath);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].model, "gpt-5.6-sol");
    // Live usage = 158,139,380 - 158,051,580 (the replay baseline).
    assert.equal(queued[0].total_tokens, 158139380 - 158051580);
    assert.equal(queued[0].input_tokens, 60000);
    assert.equal(queued[0].output_tokens, 27800);

    // The cumulative-delta chain must stay anchored at the final live totals so
    // later appends produce correct deltas.
    assert.equal(cursors.files[rolloutPath].lastTotal.total_tokens, 158139380);
    assert.equal(cursors.files[rolloutPath].sessionId, FORK_ID);
    assert.equal(cursors.files[rolloutPath].forked, true);
    assert.equal(cursors.files[rolloutPath].replayDone, true);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("parseRolloutIncremental counts nothing for a pure-replay fork with no live turns", async () => {
  // Mirrors sessions/2026/05/31/rollout-...-019e7bf8-c5c2-....jsonl: the fork
  // was created and never used, so the file is 100% same-day replay.
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-fork-replay-"));
  try {
    const mayForkId = "019e7bf8-c5c2-7dc3-b826-3fad0db7dd66";
    const mayParentId = "019e7beb-76b3-7192-8894-8e165d47a6a6";
    const rolloutPath = path.join(
      tmp,
      "2026",
      "05",
      "31",
      `rollout-2026-05-31T10-59-23-${mayForkId}.jsonl`,
    );
    await fs.mkdir(path.dirname(rolloutPath), { recursive: true });
    const lines = [
      sessionMetaLine({ ts: "2026-05-31T02:59:30.874Z", id: mayForkId, forkedFromId: mayParentId }),
      sessionMetaLine({ ts: "2026-05-31T02:59:30.874Z", id: mayParentId }),
      turnContextLine({
        ts: "2026-05-31T02:59:30.875Z",
        turnId: "019e7beb-fc80-7a21-a6dc-0cdec2b90b85",
        model: "gpt-5.4",
        currentDate: "2026-05-31",
      }),
      tokenCountLine({
        ts: "2026-05-31T02:59:30.876Z",
        last: usage({ input: 18000, output: 2404, total: 20404 }),
        total: usage({ input: 18000, output: 2404, total: 20404 }),
      }),
      tokenCountLine({
        ts: "2026-05-31T02:59:30.876Z",
        last: usage({ input: 20000, output: 3309, total: 23309 }),
        total: usage({ input: 38000, output: 5713, total: 43713 }),
      }),
      // Replayed copy of a parent "reopen" session_meta mid-stream.
      sessionMetaLine({ ts: "2026-05-31T02:59:30.878Z", id: mayParentId }),
      tokenCountLine({
        ts: "2026-05-31T02:59:30.881Z",
        last: usage({ input: 90000, output: 9702, total: 99702 }),
        total: usage({ input: 1250000, output: 115039, total: 1365039 }),
      }),
    ];
    await fs.writeFile(rolloutPath, lines.join("\n") + "\n", "utf8");
    const queuePath = path.join(tmp, "queue.jsonl");
    const cursors = { version: 1, files: {}, updatedAt: null };

    const res = await parseRolloutIncremental({ rolloutFiles: [rolloutPath], cursors, queuePath });
    assert.equal(res.filesProcessed, 1);
    assert.equal(res.eventsAggregated, 0);
    assert.equal(res.bucketsQueued, 0);
    assert.deepEqual(await readJsonLines(queuePath), []);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("parseRolloutIncremental does not book fork replay head (before any turn_context) as unknown model", async () => {
  // Some fork replays start streaming token_count events before the first
  // replayed turn_context; those used to be counted under model "unknown"
  // (the SIDE-ONLY unknown rows in the ccusage parity report).
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-fork-replay-"));
  try {
    const forkId = "019fecdd-eb61-7513-8788-e4864554962a";
    const rolloutPath = path.join(
      tmp,
      "2026",
      "08",
      "11",
      `rollout-2026-08-11T02-09-54-${forkId}.jsonl`,
    );
    await fs.mkdir(path.dirname(rolloutPath), { recursive: true });
    const lines = [
      sessionMetaLine({ ts: "2026-08-10T18:09:54.100Z", id: forkId, forkedFromId: PARENT_ID }),
      tokenCountLine({
        ts: "2026-08-10T18:09:54.101Z",
        last: usage({ input: 400000, output: 100000, total: 500000 }),
        total: usage({ input: 400000, output: 100000, total: 500000 }),
      }),
      tokenCountLine({
        ts: "2026-08-10T18:09:54.102Z",
        last: usage({ input: 80000, output: 18815, total: 98815 }),
        total: usage({ input: 4400000, output: 998815, total: 5398815 }),
      }),
      turnContextLine({
        ts: "2026-08-10T18:10:02.000Z",
        turnId: "019fecdd-f000-7000-8000-000000000001",
        model: "gpt-5.6-sol",
        currentDate: "2026-08-10",
      }),
      tokenCountLine({
        ts: "2026-08-10T18:10:05.000Z",
        last: usage({ input: 15000, output: 6185, total: 21185 }),
        total: usage({ input: 4415000, output: 1005000, total: 5420000 }),
      }),
    ];
    await fs.writeFile(rolloutPath, lines.join("\n") + "\n", "utf8");
    const queuePath = path.join(tmp, "queue.jsonl");
    const cursors = { version: 1, files: {}, updatedAt: null };

    const res = await parseRolloutIncremental({ rolloutFiles: [rolloutPath], cursors, queuePath });
    assert.equal(res.eventsAggregated, 1);

    const queued = await readJsonLines(queuePath);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].model, "gpt-5.6-sol");
    assert.equal(queued[0].total_tokens, 21185);
    assert.ok(!queued.some((row) => row.model === "unknown"));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("parseRolloutIncremental stays in replay across UUIDv4 sub-turn contexts inside the replayed history", async () => {
  // Mirrors sessions/2026/07/31/rollout-...-019fb48d-ddb8-....jsonl: the
  // replayed parent history contains auto-review/compact style sub-turns whose
  // turn_id is UUIDv4 (no timestamp bits) and whose current_date equals the
  // fork file's own date. A date fallback would flip to live mid-replay and
  // over-count (+11.8% on 2026-07-30); with a v7 session baseline, only a v7
  // turn id at/after the baseline may end the replay.
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-fork-replay-"));
  try {
    const forkId = "019fb48d-ddb8-77a2-98b8-aafe0bf9ce65";
    const parentId = "019fb3f6-0467-7680-a383-203a38d09258";
    const rolloutPath = path.join(
      tmp,
      "2026",
      "07",
      "31",
      `rollout-2026-07-31T03-43-49-${forkId}.jsonl`,
    );
    await fs.mkdir(path.dirname(rolloutPath), { recursive: true });
    const lines = [
      sessionMetaLine({ ts: "2026-07-30T19:43:54.334Z", id: forkId, forkedFromId: parentId }),
      sessionMetaLine({ ts: "2026-07-30T19:43:54.339Z", id: parentId }),
      // Replayed v7 turn minted during the parent's life (before the fork).
      turnContextLine({
        ts: "2026-07-30T19:43:54.360Z",
        turnId: "019fb3f6-1ab0-7453-9270-bac63fd060fb",
        model: "gpt-5.6-sol",
        currentDate: "2026-07-31",
      }),
      tokenCountLine({
        ts: "2026-07-30T19:43:54.361Z",
        last: usage({ input: 15000, output: 5302, total: 20302 }),
        total: usage({ input: 15000, output: 5302, total: 20302 }),
      }),
      // Replayed v4 sub-turn: no timestamp bits, current_date == file date.
      turnContextLine({
        ts: "2026-07-30T19:43:54.428Z",
        turnId: "e7e42e6f-f5e7-4c26-97c2-33854bb00ad6",
        model: "gpt-5.6-sol",
        currentDate: "2026-07-31",
      }),
      tokenCountLine({
        ts: "2026-07-30T19:43:54.430Z",
        last: usage({ input: 30000, output: 12000, total: 42000 }),
        total: usage({ input: 52000000, output: 16630491, total: 68630491 }),
      }),
      // Live boundary: fresh v7 turn minted after the fork's own session UUID.
      turnContextLine({
        ts: "2026-07-30T19:44:00.000Z",
        turnId: "019fb48d-e000-7000-8000-000000000001",
        model: "gpt-5.6-sol",
        currentDate: "2026-07-31",
      }),
      tokenCountLine({
        ts: "2026-07-30T19:44:04.000Z",
        last: usage({ input: 20000, output: 3566, total: 23566 }),
        total: usage({ input: 52020000, output: 16634057, total: 68654057 }),
      }),
      tokenCountLine({
        ts: "2026-07-30T20:07:42.000Z",
        last: usage({ input: 6000000, output: 832013, total: 6832013 }),
        total: usage({ input: 58020000, output: 17466070, total: 75486070 }),
      }),
    ];
    await fs.writeFile(rolloutPath, lines.join("\n") + "\n", "utf8");
    const queuePath = path.join(tmp, "queue.jsonl");
    const cursors = { version: 1, files: {}, updatedAt: null };

    const res = await parseRolloutIncremental({ rolloutFiles: [rolloutPath], cursors, queuePath });
    assert.equal(res.eventsAggregated, 2);

    const queued = await readJsonLines(queuePath);
    const total = queued.reduce((sum, row) => sum + row.total_tokens, 0);
    // Live usage only: 75,486,070 - 68,630,491 (matches ccusage for the real file).
    assert.equal(total, 75486070 - 68630491);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("parseRolloutIncremental keeps counting non-forked sessions with mid-file reopen session_meta", async () => {
  // Mirrors the long-lived parent session (46 session_meta reopen markers, one
  // monotonic token chain, NO replay bursts) — every event must stay counted.
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-fork-replay-"));
  try {
    const rolloutPath = path.join(
      tmp,
      "2026",
      "08",
      "09",
      `rollout-2026-08-09T23-42-03-${PARENT_ID}.jsonl`,
    );
    await fs.mkdir(path.dirname(rolloutPath), { recursive: true });
    const lines = [
      sessionMetaLine({ ts: "2026-08-09T15:42:03.373Z", id: PARENT_ID }),
      turnContextLine({
        ts: "2026-08-09T15:42:03.400Z",
        turnId: REPLAYED_TURN_ID,
        model: "gpt-5.6-sol",
        currentDate: "2026-08-09",
      }),
      tokenCountLine({
        ts: "2026-08-09T15:42:17.000Z",
        last: usage({ input: 20000, output: 4639, total: 24639 }),
        total: usage({ input: 20000, output: 4639, total: 24639 }),
      }),
      tokenCountLine({
        ts: "2026-08-09T15:42:29.000Z",
        last: usage({ input: 24000, output: 5369, total: 29369 }),
        total: usage({ input: 44000, output: 10008, total: 54008 }),
      }),
      // Thread reopened by the desktop app: same id appended again mid-file,
      // cumulative counter keeps rising (not a fork, not a replay).
      sessionMetaLine({ ts: "2026-08-10T06:19:55.350Z", id: PARENT_ID }),
      tokenCountLine({
        ts: "2026-08-10T06:20:10.000Z",
        last: usage({ input: 26000, output: 6544, total: 32544 }),
        total: usage({ input: 70000, output: 16552, total: 86552 }),
      }),
      tokenCountLine({
        ts: "2026-08-10T06:20:40.000Z",
        last: usage({ input: 36000, output: 6437, total: 42437 }),
        total: usage({ input: 106000, output: 22989, total: 128989 }),
      }),
    ];
    await fs.writeFile(rolloutPath, lines.join("\n") + "\n", "utf8");
    const queuePath = path.join(tmp, "queue.jsonl");
    const cursors = { version: 1, files: {}, updatedAt: null };

    const res = await parseRolloutIncremental({ rolloutFiles: [rolloutPath], cursors, queuePath });
    assert.equal(res.eventsAggregated, 4);

    const queued = await readJsonLines(queuePath);
    const total = queued.reduce((sum, row) => sum + row.total_tokens, 0);
    assert.equal(total, 128989);
    assert.equal(cursors.files[rolloutPath].forked, false);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("parseRolloutIncremental resumes a forked file after replay without re-entering replay mode", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-fork-replay-"));
  try {
    const lines = buildSameDayForkLines();
    const firstBatch = lines.slice(0, 8); // through the first live token_count
    const rolloutPath = await writeForkFixture(tmp, firstBatch);
    const queuePath = path.join(tmp, "queue.jsonl");
    const cursors = { version: 1, files: {}, updatedAt: null };

    const first = await parseRolloutIncremental({ rolloutFiles: [rolloutPath], cursors, queuePath });
    assert.equal(first.eventsAggregated, 1);
    assert.equal(cursors.files[rolloutPath].replayDone, true);

    // Append the second live turn and re-sync with the persisted cursors: the
    // resumed scan starts mid-file (no session_meta in view) and must classify
    // the appended event as live usage exactly once.
    await fs.appendFile(rolloutPath, lines[8] + "\n", "utf8");
    const second = await parseRolloutIncremental({ rolloutFiles: [rolloutPath], cursors, queuePath });
    assert.equal(second.eventsAggregated, 1);
    assert.equal(cursors.files[rolloutPath].sessionId, FORK_ID);
    const archived = path.join(tmp, "archived", path.basename(rolloutPath));
    await fs.mkdir(path.dirname(archived));
    await fs.copyFile(rolloutPath, archived);
    const reread = await parseRolloutIncremental({ rolloutFiles: [archived, rolloutPath], cursors, queuePath });
    assert.equal(reread.eventsAggregated, 0);
    assert.equal(cursors.files[rolloutPath].sessionId, FORK_ID);
    assert.equal(cursors.files[archived].sessionId, FORK_ID);

    const queued = await readJsonLines(queuePath);
    const latestTotal = queued.reduce((max, row) => Math.max(max, row.total_tokens), 0);
    // Bucket rows are cumulative per half-hour: final bucket = both live deltas.
    assert.equal(latestTotal, 43044 + 44756);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("collectRolloutRequestUsageRecords skips fork replay token counts and lifecycle noise", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-fork-replay-"));
  try {
    const rolloutPath = await writeForkFixture(tmp, buildSameDayForkLines());

    const result = await collectRolloutRequestUsageRecords({
      rolloutFiles: [rolloutPath],
      source: "codex",
    });

    assert.equal(result.records.length, 2);
    const timestamps = result.records.map((r) => r.timestamp).sort();
    assert.deepEqual(timestamps, ["2026-08-10T15:26:07.295Z", "2026-08-10T15:26:17.286Z"]);
    assert.equal(result.totals.total_tokens, 43044 + 44756);
    assert.ok(result.records.every((r) => r.model === "gpt-5.6-sol"));
    assert.ok(result.records.every((r) => r.id.startsWith(`codex:${FORK_ID}:`)));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
